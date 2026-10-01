// Office Studio editing model: immutable fixture snapshots with undo/redo.
// Every operation is validated before it is committed; a rejected operation
// leaves the draft exactly as it was and returns the reasons.
import { geometryIssues, navIssues, roomAt, type Issue } from './validate';
import type { DerivedWalls, Fixture, FloorId, Vec2, World } from '../world/types';

export const GRID = 0.25;
export const LOCKED_FAMILIES = new Set(['shell', 'sanitary']);

export type Op =
  | { kind: 'move'; id: string; pos: Vec2 }
  | { kind: 'rotate'; id: string; delta: 90 | -90 }
  | { kind: 'delete'; id: string }
  | { kind: 'add'; type: string; floor: FloorId; pos: Vec2; rot?: number };

export interface Result { ok: boolean; issues: Issue[]; id?: string }

export function snap(v: number): number { return Math.round(v / GRID) * GRID; }

export class Editor {
  fixtures: Fixture[];
  private undoStack: Fixture[][] = [];
  private redoStack: Fixture[][] = [];
  private addCounter = 0;
  private navBaseline: Set<string> | null = null;
  dirty = false;

  constructor(private world: World, private walls: DerivedWalls, start: Fixture[]) {
    this.fixtures = start.map((f) => ({ ...f, pos: [...f.pos] as Vec2, size: [...f.size] as [number, number, number] }));
    for (const f of this.fixtures) {
      const m = /^FX-L[12]-D(\d+)$/.exec(f.id);
      if (m) this.addCounter = Math.max(this.addCounter, Number(m[1]));
    }
  }

  editable(fx: Fixture): boolean {
    const fam = this.world.catalog[fx.type]?.family;
    return !LOCKED_FAMILIES.has(fam) && !fx.ictRack && !fx.verticalLink;
  }

  /** Fixtures whose collider or ICT data other records depend on stay put. */
  lockedReason(fx: Fixture): string | null {
    if (fx.verticalLink) return 'Tangga/lift adalah bagian struktur.';
    if (fx.ictRack) return 'Rack terhubung ke port map ICT.';
    const fam = this.world.catalog[fx.type]?.family;
    if (fam === 'shell') return 'Elemen bangunan.';
    if (fam === 'sanitary') return 'Fixture sanitasi terikat shaft basah.';
    if (this.world.ict.outlets.some((o) => o.serves === fx.id)) return null; // movable, outlet follows in a future ICT pass
    return null;
  }

  apply(op: Op): Result {
    const next = this.fixtures.map((f) => ({ ...f }));
    let target: Fixture | undefined;
    if (op.kind === 'add') {
      const cat = this.world.catalog[op.type];
      if (!cat) return { ok: false, issues: [{ code: 'outside', message: `Tipe ${op.type} tidak dikenal` }] };
      if (LOCKED_FAMILIES.has(cat.family)) return { ok: false, issues: [{ code: 'outside', message: `${cat.label} tidak dapat ditambah di Studio` }] };
      const pos: Vec2 = [snap(op.pos[0]), snap(op.pos[1])];
      const room = roomAt(this.world, op.floor, pos);
      if (!room) return { ok: false, issues: [{ code: 'outside', message: 'Posisi di luar ruang' }] };
      const id = `FX-${op.floor}-D${String(this.addCounter + 1).padStart(3, '0')}`;
      target = { id, floor: op.floor, room, type: op.type, asset: `AST-${op.type.toUpperCase().replace(/_/g, '-')}`, pos, rot: op.rot ?? 0, size: [...cat.size] as [number, number, number], collider: cat.collider };
      next.push(target);
    } else {
      const idx = next.findIndex((f) => f.id === op.id);
      if (idx < 0) return { ok: false, issues: [{ code: 'outside', message: `${op.id} tidak ditemukan` }] };
      const cur = next[idx];
      const lock = this.lockedReason(cur);
      if (lock || !this.editable(cur)) return { ok: false, issues: [{ code: 'outside', fixture: cur.id, message: `${cur.id} terkunci: ${lock ?? 'tidak dapat disunting'}` }] };
      if (op.kind === 'delete') {
        next.splice(idx, 1);
        // A chair paired with a desk loses its pair link instead of dangling.
        for (const f of next) if (f.pairedWith === cur.id) delete f.pairedWith;
      } else if (op.kind === 'move') {
        const pos: Vec2 = [snap(op.pos[0]), snap(op.pos[1])];
        const room = roomAt(this.world, cur.floor, pos);
        if (!room) return { ok: false, issues: [{ code: 'outside', fixture: cur.id, message: 'Posisi di luar ruang' }] };
        target = next[idx] = { ...cur, pos, room };
      } else {
        target = next[idx] = { ...cur, rot: (((cur.rot + op.delta) % 360) + 360) % 360 };
      }
    }
    const only = target ? new Set([target.id]) : new Set<string>();
    const geo = target ? geometryIssues(this.world, next, only) : [];
    if (geo.length) return { ok: false, issues: geo };
    const { issues: nav } = navIssues(this.world, this.walls, next);
    // Navigation issues already present before this op are not blamed on it.
    const before = this.baseline();
    const fresh = nav.filter((i) => !before.has(i.message));
    if (fresh.length) return { ok: false, issues: fresh };
    this.undoStack.push(this.fixtures);
    this.redoStack = [];
    this.fixtures = next;
    this.navBaseline = new Set(nav.map((i) => i.message));
    if (op.kind === 'add') this.addCounter++;
    this.dirty = true;
    return { ok: true, issues: [], id: target?.id };
  }

  private baseline(): Set<string> {
    if (!this.navBaseline) this.navBaseline = new Set(navIssues(this.world, this.walls, this.fixtures).issues.map((i) => i.message));
    return this.navBaseline;
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.fixtures);
    this.fixtures = prev;
    this.navBaseline = null;
    this.dirty = true;
    return true;
  }
  redo(): boolean {
    const nxt = this.redoStack.pop();
    if (!nxt) return false;
    this.undoStack.push(this.fixtures);
    this.fixtures = nxt;
    this.navBaseline = null;
    this.dirty = true;
    return true;
  }

  /** Full validation, used before publish and on import. */
  validateAll(): Issue[] {
    return [...geometryIssues(this.world, this.fixtures), ...navIssues(this.world, this.walls, this.fixtures).issues];
  }
}
