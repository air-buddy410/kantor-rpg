import { beforeAll, describe, expect, it } from 'vitest';
import world from '@design/world.json';
import walls from '@design/derived/walls.json';
import { NavGrid } from '../../src/world/navgrid';
import { IdleSim } from '../../src/sim/idle';
import { DoorController, OPEN_RADIUS } from '../../src/world/doors';
import type { DerivedWalls, FloorId, Vec2, World } from '../../src/world/types';

const W = world as unknown as World;
const WALLS = walls as unknown as DerivedWalls;
let nav: Record<FloorId, NavGrid>;
beforeAll(() => { nav = { L1: new NavGrid(W, WALLS, 'L1'), L2: new NavGrid(W, WALLS, 'L2') }; });

describe('door leaves (R2): runtime matches the dataset, CAD and Blender', () => {
  it('one leaf per single door, two per double, from derived walls.json', () => {
    for (const f of ['L1', 'L2'] as const) {
      const expected = W.doors.filter((d) => d.floor === f && d.swing).reduce((n, d) => n + (d.type === 'double' ? 2 : 1), 0);
      expect(WALLS.floors[f].leaves.length).toBe(expected);
    }
  });

  it('open leaves are solid in the TS navgrid exactly like Python (cell parity)', () => {
    for (const f of ['L1', 'L2'] as const) {
      for (const lf of WALLS.floors[f].leaves) {
        if (lf.into === 'EXT') continue;
        const mid: Vec2 = [(lf.openRect[0] + lf.openRect[2]) / 2, (lf.openRect[1] + lf.openRect[3]) / 2];
        const [i, j] = nav[f].cellOf(mid);
        expect(nav[f].raw[j * nav[f].w + i], lf.id).toBe(1);
      }
    }
  });

  it('a door opens when someone comes near, closes after, and a locked door stays shut for visitors', () => {
    const dc = new DoorController(W, WALLS);
    const leaf = WALLS.floors.L1.leaves.find((l) => l.door === 'D-L1-03')!;
    const door = W.doors.find((d) => d.id === 'D-L1-03')!;
    for (let k = 0; k < 20; k++) dc.update(0.05, [{ floor: 'L1', pos: door.center }], false, false);
    expect(dc.openness(leaf.id)).toBe(1);
    for (let k = 0; k < 40; k++) dc.update(0.05, [{ floor: 'L1', pos: [door.center[0] + OPEN_RADIUS + 1, door.center[1] + 3] }], false, false);
    expect(dc.openness(leaf.id)).toBe(0);
    const srv = WALLS.floors.L1.leaves.find((l) => l.restricted)!;
    const sdoor = W.doors.find((d) => d.id === srv.door)!;
    for (let k = 0; k < 20; k++) dc.update(0.05, [{ floor: 'L1', pos: sdoor.center }], true, false);
    expect(dc.openness(srv.id)).toBe(0);
  });

  it('nobody ever stands in a doorway whose leaf is not fully open (NPC soak 20 min + CEO walking a door route)', () => {
    const sim = new IdleSim(W, nav, { seed: 5, startHour: 9 });
    const dc = new DoorController(W, WALLS);
    const doorRects = W.doors.filter((d) => d.swing).map((d) => {
      const half = d.width / 2;
      const t = 0.2;
      const r = d.wallAxis === 'x' ? [d.center[0] - half, d.center[1] - t, d.center[0] + half, d.center[1] + t] : [d.center[0] - t, d.center[1] - half, d.center[0] + t, d.center[1] + half];
      return { d, r };
    });
    let checks = 0;
    for (let t = 0; t < 1200; t += 0.05) {
      sim.step(0.05);
      const agents = sim.npcs.map((n) => ({ floor: n.floor, pos: n.pos }));
      dc.update(0.05, agents, false, false);
      for (const a of agents) {
        for (const { d, r } of doorRects) {
          if (d.floor !== a.floor || a.pos[0] < r[0] || a.pos[0] > r[2] || a.pos[1] < r[1] || a.pos[1] > r[3]) continue;
          checks++;
          for (const lf of WALLS.floors[d.floor].leaves.filter((l) => l.door === d.id)) expect(dc.openness(lf.id), `${lf.id} at t=${t.toFixed(1)}`).toBeGreaterThan(0.95);
        }
      }
    }
    expect(checks).toBeGreaterThan(20);
  });
});

describe('Office Studio keeps door swings clear (mirror of validator door_swing_clear_of_fixtures)', () => {
  it('moving a fixture into the CEO door swing is rejected with a door-swing issue', async () => {
    const { Editor } = await import('../../src/studio/editor');
    const ed = new Editor(W, WALLS, W.fixtures);
    // Plant into the leaf's swing square (hinge low at x 3.0, swings north into L1-CEO).
    const r = ed.apply({ kind: 'move', id: 'FX-L1-088', pos: [3.25, 19.25] });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'swing')).toBe(true);
  });
});
