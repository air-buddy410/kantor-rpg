// Layout validation for Office Studio, mirroring tools/validate_world.py
// (fixtures inside rooms and clear of walls, no collider overlap, door
// approach zones clear, functional clearances, every room still reachable,
// every activity slot still approachable). Same rules, so a layout the
// studio accepts would also pass the dataset validator.
import { NavGrid } from '../world/navgrid';
import { withFixtures } from '../world/slots';
import type { DerivedWalls, Fixture, FloorId, Vec2, World } from '../world/types';

export interface Issue { code: 'outside' | 'wall' | 'overlap' | 'door' | 'swing' | 'clearance' | 'unreachable' | 'slot' | 'link'; fixture?: string; message: string }

const TOL = 0.011;

export function corners(fx: Pick<Fixture, 'pos' | 'rot' | 'size'>, size = fx.size): Vec2[] {
  const [w, d] = size;
  const r = (fx.rot * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([lx, ly]) => [fx.pos[0] + lx * c - ly * s, fx.pos[1] + lx * s + ly * c] as Vec2);
}

export function pointInPoly(p: Vec2, poly: Vec2[]): boolean {
  // Boundary counts as inside, like geometry.point_in_polygon.
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (Math.abs(cross) < 1e-6 && Math.min(a[0], b[0]) - 1e-6 <= p[0] && p[0] <= Math.max(a[0], b[0]) + 1e-6 && Math.min(a[1], b[1]) - 1e-6 <= p[1] && p[1] <= Math.max(a[1], b[1]) + 1e-6) return true;
  }
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function overlaps(a: Vec2[], b: Vec2[], eps = 1e-6): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i];
      const [x1, y1] = poly[(i + 1) % poly.length];
      const nx = y1 - y0;
      const ny = x0 - x1;
      const n = Math.hypot(nx, ny);
      const pa = a.map(([x, y]) => nx * x + ny * y);
      const pb = b.map(([x, y]) => nx * x + ny * y);
      if (Math.max(...pa) <= Math.min(...pb) + eps * n || Math.max(...pb) <= Math.min(...pa) + eps * n) return false;
    }
  }
  return true;
}

function rectPoly(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

export function roomAt(world: World, floor: FloorId, p: Vec2): string | null {
  for (const r of world.rooms) if (r.floor === floor && pointInPoly(p, r.polygon)) return r.id;
  return null;
}

/** Geometry checks for a set of fixtures; `only` limits reported issues to those ids. */
export function geometryIssues(world: World, fixtures: Fixture[], only?: Set<string>): Issue[] {
  const issues: Issue[] = [];
  const rooms = new Map(world.rooms.map((r) => [r.id, r]));
  const inner = world.building.wall.interior / 2;
  const outer = world.building.wall.exterior / 2;
  const [W, D] = world.building.footprint;
  const want = (id: string) => !only || only.has(id);
  for (const fx of fixtures) {
    if (!want(fx.id)) continue;
    const room = rooms.get(fx.room);
    if (!room) { issues.push({ code: 'outside', fixture: fx.id, message: `${fx.id}: ruang ${fx.room} tidak ada` }); continue; }
    const poly = room.polygon;
    for (const [x, y] of corners(fx)) {
      if (!pointInPoly([x, y], poly)) { issues.push({ code: 'outside', fixture: fx.id, message: `${fx.id} keluar dari ${room.name}` }); break; }
      let hit = false;
      for (let i = 0; i < poly.length && !hit; i++) {
        const [x0, y0] = poly[i];
        const [x1, y1] = poly[(i + 1) % poly.length];
        const env = (y0 === y1 && (y0 === 0 || y0 === D)) || (x0 === x1 && (x0 === 0 || x0 === W));
        const need = (env ? outer : inner) - TOL;
        if (y0 === y1 && Math.min(x0, x1) < x && x < Math.max(x0, x1) && Math.abs(y - y0) < need) hit = true;
        if (x0 === x1 && Math.min(y0, y1) < y && y < Math.max(y0, y1) && Math.abs(x - x0) < need) hit = true;
      }
      if (hit) { issues.push({ code: 'wall', fixture: fx.id, message: `${fx.id} menembus dinding ${room.name}` }); break; }
    }
  }
  const cols = fixtures.filter((f) => f.collider);
  for (let i = 0; i < cols.length; i++) {
    const a = cols[i];
    const ca = corners(a);
    for (let j = i + 1; j < cols.length; j++) {
      const b = cols[j];
      if (a.floor !== b.floor || (!want(a.id) && !want(b.id))) continue;
      if (overlaps(ca, corners(b))) issues.push({ code: 'overlap', fixture: want(a.id) ? a.id : b.id, message: `${a.id} bertabrakan dengan ${b.id}` });
    }
  }
  for (const d of world.doors) {
    if (d.type === 'hatch') continue;
    const [cx, cy] = d.center;
    const h = d.width / 2;
    const zone = d.wallAxis === 'x' ? rectPoly(cx - h, cy - 0.9, cx + h, cy + 0.9) : rectPoly(cx - 0.9, cy - h, cx + 0.9, cy + h);
    for (const fx of cols) if (fx.floor === d.floor && want(fx.id) && overlaps(zone, corners(fx))) issues.push({ code: 'door', fixture: fx.id, message: `${fx.id} menghalangi pintu ${d.id}` });
    // Swing square of each leaf on the 'into' side, as tools/validate_world.py
    // swing_boxes: the open leaf is solid at runtime, so nothing may stand there.
    if (d.swing && d.swing.into !== 'EXT') {
      const room = world.rooms.find((r) => r.id === d.swing!.into);
      const along = d.wallAxis === 'x' ? cx : cy;
      const at = d.wallAxis === 'x' ? cy : cx;
      const probe: Vec2 = d.wallAxis === 'x' ? [along, at + 0.05] : [at + 0.05, along];
      const sign = room && pointInPoly(probe, room.polygon) ? 1 : -1;
      const lo = along - h;
      const spans: [number, number][] = d.swing.hinge === 'both' ? [[lo, along], [along, along + h]] : [[lo, along + h]];
      for (const [u0, u1] of spans) {
        const [v0, v1] = [Math.min(at, at + sign * (u1 - u0)), Math.max(at, at + sign * (u1 - u0))];
        const box = d.wallAxis === 'x' ? rectPoly(u0, v0, u1, v1) : rectPoly(v0, u0, v1, u1);
        for (const fx of cols) if (fx.floor === d.floor && want(fx.id) && overlaps(box, corners(fx))) issues.push({ code: 'swing', fixture: fx.id, message: `${fx.id} menghalangi ayunan daun pintu ${d.id}` });
      }
    }
  }
  for (const fx of fixtures) {
    const c = (world.catalog[fx.type] as unknown as { clearance?: { cue?: number; playing?: [number, number]; front?: number; rear?: number } }).clearance;
    if (!c) continue;
    const zones: Vec2[][] = [];
    if (c.cue && c.playing) zones.push(corners(fx, [c.playing[0] + 2 * c.cue, c.playing[1] + 2 * c.cue, 0]));
    if (c.front !== undefined && c.rear !== undefined) {
      const [w, d] = fx.size;
      const r = (fx.rot * Math.PI) / 180;
      const off = (k: number) => [fx.pos[0] + k * Math.sin(r), fx.pos[1] - k * Math.cos(r)] as Vec2;
      zones.push(corners({ pos: off(d / 2 + c.front / 2), rot: fx.rot, size: [w, c.front, 0] }));
      zones.push(corners({ pos: off(-(d / 2 + c.rear / 2)), rot: fx.rot, size: [w, c.rear, 0] }));
    }
    for (const z of zones) for (const o of cols) {
      if (o.id === fx.id || o.floor !== fx.floor || (o.ictRack && fx.ictRack)) continue;
      if ((want(o.id) || want(fx.id)) && overlaps(z, corners(o))) issues.push({ code: 'clearance', fixture: want(o.id) ? o.id : fx.id, message: `${o.id} masuk area bebas ${fx.id}` });
    }
  }
  return issues;
}

/** Navigation consequences of a layout: rooms reachable, slots and links usable. */
export function navIssues(world: World, walls: DerivedWalls, fixtures: Fixture[]): { issues: Issue[]; nav: Record<FloorId, NavGrid> } {
  const w2 = withFixtures(world, fixtures);
  const nav = { L1: new NavGrid(w2, walls, 'L1', fixtures), L2: new NavGrid(w2, walls, 'L2', fixtures) } as Record<FloorId, NavGrid>;
  const issues: Issue[] = [];
  const spawn = world.waypoints.find((x) => x.id === world.floors[0].spawn)!;
  const reach: Record<FloorId, Uint8Array> = { L1: nav.L1.flood([nav.L1.cellOf(spawn.pos)]), L2: new Uint8Array(0) };
  const seeds: [number, number][] = [];
  for (const vl of world.verticalLinks) {
    if (vl.playable === false) continue;
    const e1 = vl.ends.find((e) => e.floor === 'L1')!;
    const e2 = vl.ends.find((e) => e.floor === 'L2')!;
    if (nav.L1.nearestWalkable(e1.point, 0.6, reach.L1)) seeds.push(nav.L2.cellOf(e2.arrive ?? e2.point));
    else issues.push({ code: 'link', message: `Titik ${vl.id} di L1 tertutup` });
  }
  reach.L2 = nav.L2.flood(seeds);
  for (const r of world.rooms) {
    if (r.category === 'shaft') continue;
    const g = nav[r.floor];
    const xs = r.polygon.map((p) => p[0]);
    const ys = r.polygon.map((p) => p[1]);
    const [ia, ja] = g.cellOf([Math.min(...xs), Math.min(...ys)]);
    const [ib, jb] = g.cellOf([Math.max(...xs), Math.max(...ys)]);
    let ok = false;
    for (let j = ja; j <= jb && !ok; j++) for (let i = ia; i <= ib && !ok; i++) if (reach[r.floor][j * g.w + i] && pointInPoly(g.center(i, j), r.polygon)) ok = true;
    if (!ok) issues.push({ code: 'unreachable', message: `${r.name} tidak dapat dicapai` });
  }
  for (const s of w2.activitySlots) if (!nav[s.floor].nearestWalkable(s.pos, 0.9, reach[s.floor])) issues.push({ code: 'slot', fixture: s.fixture, message: `Slot ${s.activity} di ${s.fixture} tidak dapat didekati` });
  return { issues, nav };
}
