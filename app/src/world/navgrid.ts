// Runtime port of tools/kantor/nav.py. The raster rules must stay identical:
// tests/unit/navgrid.test.ts compares walkable counts with the Python output.
import type { AccessMode, DerivedWalls, Fixture, FloorId, Vec2, World } from './types';

export const CELL = 0.1;
export const RADIUS = 0.25;

type Rect = [number, number, number, number];

export function wallRect(w: { axis: 'x' | 'y'; at: number; from: number; to: number; thickness: number }): Rect {
  const t = w.thickness / 2;
  return w.axis === 'x' ? [w.from - t, w.at - t, w.to + t, w.at + t] : [w.at - t, w.from - t, w.at + t, w.to + t];
}

export function openingRect(o: { axis: 'x' | 'y'; at: number; from: number; to: number }, exteriorThickness: number): Rect {
  const t = exteriorThickness / 2 + 0.01;
  return o.axis === 'x' ? [o.from, o.at - t, o.to, o.at + t] : [o.at - t, o.from, o.at + t, o.to];
}

export function pointInFixture(p: Vec2, fx: Pick<Fixture, 'pos' | 'rot' | 'size'>, pad = 0): boolean {
  const [w, d] = fx.size;
  const r = (fx.rot * Math.PI) / 180;
  const dx = p[0] - fx.pos[0];
  const dy = p[1] - fx.pos[1];
  const lx = dx * Math.cos(r) + dy * Math.sin(r);
  const ly = -dx * Math.sin(r) + dy * Math.cos(r);
  return Math.abs(lx) <= w / 2 + pad && Math.abs(ly) <= d / 2 + pad;
}

export class NavGrid {
  readonly w: number;
  readonly h: number;
  readonly x0: number;
  readonly y0: number;
  readonly cell = CELL;
  raw: Uint8Array;
  blocked: Uint8Array;

  constructor(world: World, walls: DerivedWalls, readonly floor: FloorId, fixtures: Fixture[] = world.fixtures, readonly mode: AccessMode = 'staff') {
    const env = world.floors.find((f) => f.id === floor)!.envelope;
    const xs = env.map((p) => p[0]);
    const ys = env.map((p) => p[1]);
    this.x0 = Math.min(...xs);
    this.y0 = Math.min(...ys);
    this.w = Math.round((Math.max(...xs) - this.x0) / CELL);
    this.h = Math.round((Math.max(...ys) - this.y0) / CELL);
    this.raw = new Uint8Array(this.w * this.h);
    const fw = walls.floors[floor];
    for (const wall of fw.walls) this.fillRect(wallRect(wall), 1);
    for (const op of fw.openings) {
      // Walls were cut at every door; a locked door is re-filled for visitors.
      const locked = mode === 'visitor' && op.access === 'restricted';
      this.fillRect(openingRect(op, world.building.wall.exterior), locked ? 1 : 0);
    }
    for (const fx of fixtures) if (fx.floor === floor && fx.collider) this.fillFixture(fx);
    // Open door leaves are solid (same rule as tools/kantor/nav.py): a 4 cm
    // leaf is thinner than a cell, so every touched cell is filled.
    for (const leaf of fw.leaves ?? []) this.fillRectTouching(leaf.openRect);
    this.blocked = this.inflate(RADIUS);
  }

  center(i: number, j: number): Vec2 {
    return [this.x0 + (i + 0.5) * CELL, this.y0 + (j + 0.5) * CELL];
  }

  private range(lo: number, hi: number, n: number, origin: number): [number, number] {
    const a = Math.max(0, Math.floor((lo - origin) / CELL - 0.5));
    const b = Math.min(n - 1, Math.ceil((hi - origin) / CELL - 0.5));
    return [a, b];
  }

  private fillRectTouching([x0, y0, x1, y1]: Rect): void {
    const ia = Math.max(0, Math.floor((x0 - this.x0) / CELL));
    const ib = Math.min(this.w - 1, Math.ceil((x1 - this.x0) / CELL) - 1);
    const ja = Math.max(0, Math.floor((y0 - this.y0) / CELL));
    const jb = Math.min(this.h - 1, Math.ceil((y1 - this.y0) / CELL) - 1);
    for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) this.raw[j * this.w + i] = 1;
  }

  private fillRect([x0, y0, x1, y1]: Rect, value: number): void {
    const [ia, ib] = this.range(x0, x1, this.w, this.x0);
    const [ja, jb] = this.range(y0, y1, this.h, this.y0);
    for (let j = ja; j <= jb; j++) {
      const cy = this.y0 + (j + 0.5) * CELL;
      if (cy < y0 || cy > y1) continue;
      for (let i = ia; i <= ib; i++) {
        const cx = this.x0 + (i + 0.5) * CELL;
        if (x0 <= cx && cx <= x1) this.raw[j * this.w + i] = value;
      }
    }
  }

  private fillFixture(fx: Fixture): void {
    const rad = Math.hypot(fx.size[0], fx.size[1]) / 2;
    const [ia, ib] = this.range(fx.pos[0] - rad, fx.pos[0] + rad, this.w, this.x0);
    const [ja, jb] = this.range(fx.pos[1] - rad, fx.pos[1] + rad, this.h, this.y0);
    for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) if (pointInFixture(this.center(i, j), fx)) this.raw[j * this.w + i] = 1;
  }

  private inflate(radius: number): Uint8Array {
    const r = radius / CELL;
    const k = Math.ceil(r);
    const offsets: [number, number][] = [];
    for (let dj = -k; dj <= k; dj++) for (let di = -k; di <= k; di++) if (Math.hypot(di, dj) <= r + 1e-9) offsets.push([di, dj]);
    const out = new Uint8Array(this.w * this.h);
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        if (!this.raw[j * this.w + i]) continue;
        for (const [di, dj] of offsets) {
          const ii = i + di;
          const jj = j + dj;
          if (ii >= 0 && ii < this.w && jj >= 0 && jj < this.h) out[jj * this.w + ii] = 1;
        }
      }
    }
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        if (i >= k && j >= k && i < this.w - k && j < this.h - k) continue;
        for (const [di, dj] of offsets) {
          const ii = i + di;
          const jj = j + dj;
          if (!(ii >= 0 && ii < this.w && jj >= 0 && jj < this.h)) {
            out[j * this.w + i] = 1;
            break;
          }
        }
      }
    }
    return out;
  }

  cellOf(p: Vec2): [number, number] {
    const i = Math.floor((p[0] - this.x0) / CELL);
    const j = Math.floor((p[1] - this.y0) / CELL);
    return [Math.max(0, Math.min(this.w - 1, i)), Math.max(0, Math.min(this.h - 1, j))];
  }

  walkable(i: number, j: number): boolean {
    return i >= 0 && i < this.w && j >= 0 && j < this.h && !this.blocked[j * this.w + i];
  }

  walkableAt(p: Vec2): boolean {
    const i = Math.floor((p[0] - this.x0) / CELL);
    const j = Math.floor((p[1] - this.y0) / CELL);
    return this.walkable(i, j);
  }

  walkableCount(): number {
    let n = 0;
    for (let k = 0; k < this.blocked.length; k++) if (!this.blocked[k]) n++;
    return n;
  }

  flood(starts: [number, number][]): Uint8Array {
    const seen = new Uint8Array(this.w * this.h);
    const q: number[] = [];
    for (const [i, j] of starts) if (this.walkable(i, j) && !seen[j * this.w + i]) { seen[j * this.w + i] = 1; q.push(j * this.w + i); }
    for (let head = 0; head < q.length; head++) {
      const idx = q[head];
      const i = idx % this.w;
      const j = (idx - i) / this.w;
      const nb: [number, number][] = [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]];
      for (const [ni, nj] of nb) {
        if (this.walkable(ni, nj) && !seen[nj * this.w + ni]) { seen[nj * this.w + ni] = 1; q.push(nj * this.w + ni); }
      }
    }
    return seen;
  }

  nearestWalkable(p: Vec2, maxDist: number, mask?: Uint8Array): Vec2 | null {
    const [ci, cj] = this.cellOf(p);
    const k = Math.ceil(maxDist / CELL);
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (let dj = -k; dj <= k; dj++) {
      for (let di = -k; di <= k; di++) {
        const i = ci + di;
        const j = cj + dj;
        if (!this.walkable(i, j) || (mask && !mask[j * this.w + i])) continue;
        const c = this.center(i, j);
        const d = Math.hypot(c[0] - p[0], c[1] - p[1]);
        if (d <= maxDist && d < bestD) { bestD = d; best = c; }
      }
    }
    return best;
  }

  /** A* on 8-neighbours without corner cutting. Returns world-space cell centres or null. */
  findPath(from: Vec2, to: Vec2, maxExpand = 60000): Vec2[] | null {
    const s = this.nearestWalkable(from, 1.0);
    const g = this.nearestWalkable(to, 1.0);
    if (!s || !g) return null;
    const [si, sj] = this.cellOf(s);
    const [gi, gj] = this.cellOf(g);
    const start = sj * this.w + si;
    const goal = gj * this.w + gi;
    const gScore = new Float32Array(this.w * this.h).fill(Infinity);
    const came = new Int32Array(this.w * this.h).fill(-1);
    const closed = new Uint8Array(this.w * this.h);
    const heap = new MinHeap();
    const hfn = (idx: number) => {
      const i = idx % this.w;
      const j = (idx - i) / this.w;
      const dx = Math.abs(i - gi);
      const dy = Math.abs(j - gj);
      return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * CELL;
    };
    gScore[start] = 0;
    heap.push(start, hfn(start));
    let expanded = 0;
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (++expanded > maxExpand) return null;
      const i = cur % this.w;
      const j = (cur - i) / this.w;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di;
          const nj = j + dj;
          if (!this.walkable(ni, nj)) continue;
          if (di && dj && !(this.walkable(i + di, j) && this.walkable(i, j + dj))) continue;
          const n = nj * this.w + ni;
          const cand = gScore[cur] + (di && dj ? Math.SQRT2 * CELL : CELL);
          if (cand < gScore[n]) {
            gScore[n] = cand;
            came[n] = cur;
            heap.push(n, cand + hfn(n));
          }
        }
      }
    }
    if (start !== goal && came[goal] < 0) return null;
    const cells: number[] = [goal];
    while (cells[cells.length - 1] !== start) cells.push(came[cells[cells.length - 1]]);
    cells.reverse();
    return this.smooth(cells.map((idx) => this.center(idx % this.w, Math.floor(idx / this.w))));
  }

  /** Drop intermediate points while the straight segment stays on walkable cells. */
  smooth(pts: Vec2[]): Vec2[] {
    if (pts.length <= 2) return pts;
    const out: Vec2[] = [pts[0]];
    let anchor = 0;
    for (let k = 2; k < pts.length; k++) {
      if (!this.lineWalkable(pts[anchor], pts[k])) {
        out.push(pts[k - 1]);
        anchor = k - 1;
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  /** Exact grid traversal: every cell the segment touches must be free.
   * Point sampling (the earlier version, 0.05 m steps) could skip a cell the
   * segment only clips at a corner; an NPC whose step landed there stopped
   * for good (seed 11 soak, hardening round). Corner crossings require both
   * side cells free so a path never squeezes diagonally between two blocks. */
  lineWalkable(a: Vec2, b: Vec2): boolean {
    let i = Math.floor((a[0] - this.x0) / CELL);
    let j = Math.floor((a[1] - this.y0) / CELL);
    const gi = Math.floor((b[0] - this.x0) / CELL);
    const gj = Math.floor((b[1] - this.y0) / CELL);
    if (!this.walkable(i, j)) return false;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const si = Math.sign(dx);
    const sj = Math.sign(dy);
    let tMaxX = dx !== 0 ? ((si > 0 ? (i + 1) * CELL : i * CELL) + this.x0 - a[0]) / dx : Infinity;
    let tMaxY = dy !== 0 ? ((sj > 0 ? (j + 1) * CELL : j * CELL) + this.y0 - a[1]) / dy : Infinity;
    const tdx = dx !== 0 ? CELL / Math.abs(dx) : Infinity;
    const tdy = dy !== 0 ? CELL / Math.abs(dy) : Infinity;
    for (let guard = Math.abs(gi - i) + Math.abs(gj - j) + 2; (i !== gi || j !== gj) && guard > 0; guard--) {
      if (Math.abs(tMaxX - tMaxY) < 1e-9) {
        if (!this.walkable(i + si, j) || !this.walkable(i, j + sj)) return false;
        i += si; j += sj; tMaxX += tdx; tMaxY += tdy;
      } else if (tMaxX < tMaxY) { i += si; tMaxX += tdx; } else { j += sj; tMaxY += tdy; }
      if (!this.walkable(i, j)) return false;
    }
    return this.walkable(gi, gj);
  }
}

class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size() { return this.items.length; }
  push(item: number, p: number) {
    this.items.push(item); this.prio.push(p);
    let k = this.items.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (this.prio[parent] <= this.prio[k]) break;
      this.swap(k, parent); k = parent;
    }
  }
  pop(): number {
    const top = this.items[0];
    const lastI = this.items.pop()!;
    const lastP = this.prio.pop()!;
    if (this.items.length) {
      this.items[0] = lastI; this.prio[0] = lastP;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1; const r = l + 1; let m = k;
        if (l < this.items.length && this.prio[l] < this.prio[m]) m = l;
        if (r < this.items.length && this.prio[r] < this.prio[m]) m = r;
        if (m === k) break;
        this.swap(k, m); k = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
  }
}
