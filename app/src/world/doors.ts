// Door leaves at runtime (R2). Leaves come from design/derived/walls.json
// (tools/kantor/geometry.py::door_leaves), the same derivation the navgrid,
// the CAD swing arcs and the Blender LEAF-* nodes are checked against.
// Doors open automatically for anyone nearby; the open position is solid in
// the navgrid, so walking into an open leaf is impossible, and the timing
// below guarantees a leaf is fully open before an agent reaches the doorway.
import type { DerivedWalls, DoorLeaf, FloorId, Vec2, World } from './types';

/** Distance from the door centre at which a leaf starts to open (m). */
export const OPEN_RADIUS = 1.8;
/** Full swing time (s). The CEO runs at 3.4 m/s: 0.3 s covers 1.02 m, so the
 * leaf is fully open while the CEO is still >= 0.78 m from the door centre,
 * outside the 0.2 m doorway band. NPCs walk at most 1.55 m/s. */
export const SWING_SECONDS = 0.3;

export interface Agent { floor: FloorId; pos: Vec2 }

export class DoorController {
  private state = new Map<string, number>(); // leaf id -> openness 0..1
  private byFloor: Record<FloorId, { leaf: DoorLeaf; centre: Vec2 }[]>;

  constructor(world: World, walls: DerivedWalls) {
    const centres = new Map(world.doors.map((d) => [d.id, d.center]));
    this.byFloor = { L1: [], L2: [] };
    for (const f of ['L1', 'L2'] as const) {
      for (const leaf of walls.floors[f].leaves ?? []) {
        this.byFloor[f].push({ leaf, centre: centres.get(leaf.door)! });
        this.state.set(leaf.id, 0);
      }
    }
  }

  leaves(floor: FloorId): DoorLeaf[] { return this.byFloor[floor].map((x) => x.leaf); }

  openness(leafId: string): number { return this.state.get(leafId) ?? 0; }

  /** Plan angle (deg) of the leaf now: closed -> open, shortest way round. */
  angle(leaf: DoorLeaf): number {
    const d = ((leaf.openDeg - leaf.closedDeg + 540) % 360) - 180;
    return leaf.closedDeg + d * this.openness(leaf.id);
  }

  update(dt: number, agents: Agent[], visitor: boolean, reducedMotion: boolean): void {
    const step = reducedMotion ? 1 : dt / SWING_SECONDS;
    for (const f of ['L1', 'L2'] as const) {
      for (const { leaf, centre } of this.byFloor[f]) {
        const locked = visitor && leaf.restricted;
        const near = !locked && agents.some((a) => a.floor === f && Math.hypot(a.pos[0] - centre[0], a.pos[1] - centre[1]) < OPEN_RADIUS);
        const cur = this.state.get(leaf.id)!;
        this.state.set(leaf.id, near ? Math.min(1, cur + step) : Math.max(0, cur - step));
      }
    }
  }
}
