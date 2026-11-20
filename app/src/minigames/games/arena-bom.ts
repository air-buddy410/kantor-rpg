// Arena Bom (Game Station slot 5). Top-down grid arena: Budi and three CPU
// teammates in the corners, permanent pillars in a checker pattern, filing
// cabinets that break and sometimes drop power-ups. Best of three rounds; after
// 120 s the arena closes in from the outside so every round ends.
// Local multiplayer: up to four players on gamepads take the corners; the rest
// stay CPU. Last one standing wins the round, first to two rounds wins.
import type { CastMember, GameCtx, GameInstance, GameModule, InputState } from '../types';
import { PLAYER_COLORS, seatLook } from '../local-players';
import { PAL, drawToken, roundRect, seatRing, seatTag, text } from '../cast';

export const GW = 15;
export const GH = 13;
export const FLOOR = 0;
export const WALL = 1;
export const BOX = 2;
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
const FUSE = 2.2;
const FLAME_T = 0.55;
const ROUND_T = 120;
const SHRINK_STEP = 0.32;
const T = 40;
const TOP = 40;
const NCELL = GW * GH;
/** Clockwise from top left, the order of the top bar, so P2 starts next to P1's card side. */
const CORNERS: [number, number][] = [[1, 1], [GW - 2, 1], [GW - 2, GH - 2], [1, GH - 2]];

export type Item = 'bomb' | 'range' | 'speed';
export interface BombLite { x: number; y: number; range: number }

export const isPillar = (x: number, y: number) => x === 0 || y === 0 || x === GW - 1 || y === GH - 1 || (x % 2 === 0 && y % 2 === 0);

/** Cells reached by one bomb's cross: stops at walls, at the first box (included) and at another bomb (included). */
export function rays(grid: ArrayLike<number>, b: BombLite, bombAt: (c: number) => boolean): number[] {
  const out = [b.y * GW + b.x];
  for (let d = 0; d < 4; d++) {
    for (let k = 1; k <= b.range; k++) {
      const x = b.x + DX[d] * k, y = b.y + DY[d] * k;
      if (x < 0 || y < 0 || x >= GW || y >= GH) break;
      const c = y * GW + x;
      if (grid[c] === WALL) break;
      out.push(c);
      if (grid[c] === BOX || bombAt(c)) break;
    }
  }
  return out;
}

/**
 * Detonate bomb `first` and everything it chains into. Returns the flame cells
 * (cell -> index of the bomb that lit it), the boxes hit and the bombs fired.
 */
export function blast(grid: ArrayLike<number>, bombs: BombLite[], first: number) {
  const where = new Map<number, number>();
  bombs.forEach((b, i) => where.set(b.y * GW + b.x, i));
  const fired = [first];
  const flame = new Map<number, number>();
  const boxes: number[] = [];
  for (let q = 0; q < fired.length; q++) {
    const bi = fired[q];
    for (const c of rays(grid, bombs[bi], (cc) => where.has(cc))) {
      if (!flame.has(c)) flame.set(c, bi);
      if (grid[c] === BOX && !boxes.includes(c)) boxes.push(c);
      const j = where.get(c);
      if (j !== undefined && !fired.includes(j)) fired.push(j);
    }
  }
  return { flame, boxes, fired };
}

const meta: GameModule['meta'] = {
  id: 'arena-bom', title: 'Arena Bom', place: 'arcade', music: 'bomb',
  blurb: 'Pasang bom, buka jalan, kalahkan 3 lawan.',
  view: { w: GW * T, h: GH * T + TOP }, score: { unit: 'poin', higherIsBetter: true }, touch: ['left', 'up', 'down', 'right', 'a'],
  tutorial: [
    'Jalan dengan {arah}, tekan {a} untuk pasang bom.',
    'Ledakan menghancurkan lemari arsip. Ambil power-up yang jatuh.',
    'Menang 2 dari 3 ronde. Setelah 2 menit arena menyempit.',
  ],
  legend: [['arah', 'Jalan'], ['a', 'Pasang bom']],
  actions: { arah: 'Jalan (tahan untuk terus jalan)', a: 'Pasang bom' },
  players: 4,
  playersHint: 'Bareng: sampai 4 pemain. P1 kiri atas, P2 kanan atas, P3 kanan bawah, P4 kiri bawah; sudut kosong diisi komputer. Yang terakhir bertahan menang ronde.',
};

const NO_INPUT: InputState = {
  down: { left: false, right: false, up: false, down: false, a: false, b: false, x: false, y: false },
  hit: { left: false, right: false, up: false, down: false, a: false, b: false, x: false, y: false },
  ax: 0, ay: 0, tap: null,
};

/** Seconds a press is remembered: a turn or bomb pressed slightly early still happens. */
export const BUFFER_T = 0.15;
/** Furthest sideways slide (cells) the corner assist will do for the player. */
export const CORNER_ASSIST = 0.6;

interface Player {
  c: CastMember; x: number; y: number; alive: boolean; cpu: boolean;
  maxBombs: number; range: number; speed: number;
  target: number | null; wait: number; moving: boolean; deathT: number;
}
interface Bomb extends BombLite { t: number; owner: number; pass: Set<number>; age: number }

function create(ctx: GameCtx): GameInstance {
  const { g, w, h } = ctx;
  const me = ctx.cast.find((c) => c.id === ctx.playerId) ?? ctx.cast[0];
  const pool = ctx.cast.filter((c) => c.id !== me.id);
  const rivals: CastMember[] = [];
  while (rivals.length < 3 && pool.length) rivals.push(pool.splice(Math.floor(ctx.rand() * pool.length), 1)[0]);
  const cast = [me, ...rivals];
  const humans = Math.max(1, Math.min(4, ctx.players));
  const versus = humans > 1;
  /** Round wins per player (versus). */
  const winsBy = [0, 0, 0, 0];
  let roundWinner = -1;
  // walking memory of each human (the globals below hold the one being stepped)
  interface Walk { lastDir: number; lastDirT: number; prefAxis: number; prevH: boolean; prevV: boolean; bombBuf: number; squash: number }
  const walks: Walk[] = Array.from({ length: humans }, () => ({ lastDir: -1, lastDirT: 0, prefAxis: 1, prevH: false, prevV: false, bombBuf: 0, squash: 0 }));
  /** Index of the human being stepped right now. */
  let HP = 0;

  const grid = new Uint8Array(GW * GH);
  const hidden = new Map<number, Item>();
  const items = new Map<number, Item>();
  const flameT = new Float32Array(GW * GH);
  const flameOwner = new Int8Array(GW * GH);
  let players: Player[] = [];
  let bombs: Bomb[] = [];
  let shrinkOrder: number[] = [];
  let shrinkIdx = 0;
  let shrinkAcc = 0;
  let danger: Float64Array = new Float64Array(NCELL * 2);

  let round = 0;
  let wins = 0;
  let losses = 0;
  let boxesBroken = 0;
  let kills = 0;
  let suicides = 0;
  let suicideTimes: number[] = [];
  let phase: 'intro' | 'play' | 'roundEnd' | 'over' = 'intro';
  let phaseT = 1.6;
  let roundT = 0;
  let outcome: 'win' | 'lose' | 'draw' = 'draw';
  let time = 0;
  let playT = 0;
  let shake = 0;
  // player movement memory: the direction actually walked last and how long ago,
  // plus a buffered bomb press
  let lastDir = -1;
  let lastDirT = 0;
  // axis pressed most recently (0 vertical, 1 horizontal): with two keys held it wins
  let prefAxis = 1;
  let prevH = false, prevV = false;
  let bombBuf = 0;
  let goT = 0;
  let squash = 0;

  const score = () => boxesBroken * 10 + kills * 300 + wins * 500;
  /** Human seats wear their seat colour in versus; computer seats keep their own clothes. */
  const look = (i: number) => (versus && i < humans ? seatLook(cast[i], i) : cast[i]);
  const hud = () => ctx.setHud(versus
    ? ctx.t('Ronde {r} · {list}', { r: round, list: winsBy.slice(0, humans).map((n, i) => `P${i + 1} ${n}`).join(' · ') })
    : ctx.t('Ronde {r} · Menang {w} · Skor {s}', { r: round, w: wins, s: score() }));
  function load(i: number) {
    const k = walks[i]; HP = i;
    lastDir = k.lastDir; lastDirT = k.lastDirT; prefAxis = k.prefAxis; prevH = k.prevH; prevV = k.prevV; bombBuf = k.bombBuf; squash = k.squash;
  }
  function save(i: number) {
    walks[i] = { lastDir, lastDirT, prefAxis, prevH, prevV, bombBuf, squash };
  }

  function newRound() {
    round++;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) grid[y * GW + x] = isPillar(x, y) ? WALL : FLOOR;
    hidden.clear();
    items.clear();
    flameT.fill(0);
    const safe = new Set<number>();
    for (const [cx, cy] of CORNERS) for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) safe.add((cy + oy) * GW + cx + ox);
    for (let c = 0; c < GW * GH; c++) {
      if (grid[c] !== FLOOR || safe.has(c)) continue;
      if (ctx.rand() < 0.72) {
        grid[c] = BOX;
        if (ctx.rand() < 0.32) hidden.set(c, (['bomb', 'range', 'speed'] as Item[])[Math.floor(ctx.rand() * 3)]);
      }
    }
    players = cast.map((c, i) => ({
      c, x: CORNERS[i][0], y: CORNERS[i][1], alive: true, cpu: i >= humans, maxBombs: 1, range: 2, speed: 3.4,
      target: null, wait: 0.3 + ctx.rand() * 0.4, moving: false, deathT: 0,
    }));
    bombs = [];
    roundT = 0;
    shrinkIdx = 0;
    shrinkAcc = 0;
    shrinkOrder = [];
    // spiral from the outer ring inwards
    let x0 = 1, y0 = 1, x1 = GW - 2, y1 = GH - 2;
    while (x0 <= x1 && y0 <= y1) {
      for (let x = x0; x <= x1; x++) shrinkOrder.push(y0 * GW + x);
      for (let y = y0 + 1; y <= y1; y++) shrinkOrder.push(y * GW + x1);
      if (y1 > y0) for (let x = x1 - 1; x >= x0; x--) shrinkOrder.push(y1 * GW + x);
      if (x1 > x0) for (let y = y1 - 1; y > y0; y--) shrinkOrder.push(y * GW + x0);
      x0++; y0++; x1--; y1--;
    }
    shrinkOrder = shrinkOrder.filter((c) => grid[c] !== WALL);
    phase = 'intro';
    phaseT = 1.6;
    lastDir = -1;
    lastDirT = 0;
    bombBuf = 0;
    for (let i = 0; i < walks.length; i++) walks[i] = { lastDir: -1, lastDirT: 0, prefAxis: 1, prevH: false, prevV: false, bombBuf: 0, squash: 0 };
    roundWinner = -1;
    hud();
  }
  newRound();

  const cellOf = (p: Player) => Math.round(p.y) * GW + Math.round(p.x);
  const bombAt = (c: number) => bombs.findIndex((b) => b.y * GW + b.x === c);
  const walkable = (pi: number, c: number) => {
    if (grid[c] !== FLOOR) return false;
    const bi = bombAt(c);
    return bi < 0 || bombs[bi].pass.has(pi);
  };

  function move(pi: number, dir: number, dist: number, maxSlide = Infinity) {
    const p = players[pi];
    const dx = DX[dir], dy = DY[dir];
    const cx = Math.round(p.x), cy = Math.round(p.y);
    const along = dx ? p.x - cx : p.y - cy;
    const off = dx ? p.y - cy : p.x - cx;
    const nextC = (cy + dy) * GW + cx + dx;
    const sgn = dx || dy;
    const open = walkable(pi, nextC);
    if (Math.abs(off) > 1e-4) {
      if (open || sgn * along < 0) {
        // corridor correction: slide onto the lane before going ahead
        const s = Math.min(Math.abs(off), dist);
        if (dx) p.y -= Math.sign(off) * s; else p.x -= Math.sign(off) * s;
        dist -= s;
        if (Math.abs(off) - s > 1e-4) return;
        if (dx) p.y = cy; else p.x = cx;
      } else {
        // blocked ahead on this lane: if the neighbour lane is open, slide toward it
        const o = Math.sign(off);
        const lane = dx ? (cy + o) * GW + cx : cy * GW + cx + o;
        const laneAhead = dx ? (cy + o) * GW + cx + dx : (cy + dy) * GW + cx + o;
        if (1 - Math.abs(off) <= maxSlide && walkable(pi, lane) && walkable(pi, laneAhead)) {
          if (dx) p.y += o * dist; else p.x += o * dist;
        }
        return;
      }
    }
    if (dist <= 0) return;
    if (open) { if (dx) p.x += dx * dist; else p.y += dy * dist; }
    else if (sgn * along < 0) {
      const s = Math.min(dist, -sgn * along);
      if (dx) p.x += dx * s; else p.y += dy * s;
    }
  }

  function placeBomb(pi: number): boolean {
    const p = players[pi];
    const cx = Math.round(p.x), cy = Math.round(p.y);
    const c = cy * GW + cx;
    if (!p.alive || grid[c] !== FLOOR || bombAt(c) >= 0) return false;
    if (bombs.filter((b) => b.owner === pi).length >= p.maxBombs) return false;
    const pass = new Set<number>();
    players.forEach((q, qi) => { if (q.alive && Math.abs(q.x - cx) < 0.95 && Math.abs(q.y - cy) < 0.95) pass.add(qi); });
    bombs.push({ x: cx, y: cy, range: p.range, t: FUSE, owner: pi, pass, age: 0 });
    ctx.sfx('fuse', { pan: (cx / GW) * 2 - 1, gain: pi === 0 ? 1 : 0.6 });
    return true;
  }

  /** Seconds until each cell burns (first half) and the last time it burns (second half, NCELL + c). */
  function computeDanger(extra?: BombLite & { t: number }): Float64Array {
    const D = new Float64Array(NCELL * 2).fill(Infinity);
    D.fill(-Infinity, NCELL);
    for (let c = 0; c < NCELL; c++) if (flameT[c] > 0) { D[c] = 0; D[NCELL + c] = 0; }
    const all: (BombLite & { t: number })[] = extra ? [...bombs, extra] : bombs;
    const at = new Map<number, number>();
    all.forEach((b, i) => at.set(b.y * GW + b.x, i));
    const cells = all.map((b) => rays(grid, b, (c) => at.has(c)));
    const eff = all.map((b) => b.t);
    for (let pass = 0, changed = true; changed && pass < all.length + 1; pass++) {
      changed = false;
      cells.forEach((cs, i) => {
        for (const c of cs) {
          const j = at.get(c);
          if (j !== undefined && eff[j] > eff[i]) { eff[j] = eff[i]; changed = true; }
        }
      });
    }
    cells.forEach((cs, i) => { for (const c of cs) { D[c] = Math.min(D[c], eff[i]); D[NCELL + c] = Math.max(D[NCELL + c], eff[i]); } });
    if (roundT >= ROUND_T) {
      for (let k = 0; k < 6 && shrinkIdx + k < shrinkOrder.length; k++) {
        const c = shrinkOrder[shrinkIdx + k];
        D[c] = Math.min(D[c], (k + 1) * SHRINK_STEP - shrinkAcc);
        D[NCELL + c] = Infinity;
      }
    }
    return D;
  }

  /** First step toward the nearest cell with no danger, or null when none is reachable in time. */
  function escapeStep(pi: number, start: number, D: Float64Array, limit = Infinity, block = -1, margin = 0.15): number | null {
    if (D[start] === Infinity) return start;
    const tt = 1 / players[pi].speed;
    const prev = new Map<number, number>([[start, -1]]);
    let frontier = [start];
    for (let d = 0; frontier.length && d < 14; d++) {
      const next: number[] = [];
      for (const a of frontier) {
        for (let k = 0; k < 4; k++) {
          const n = a + DX[k] + DY[k] * GW;
          if (prev.has(n) || n === block || !walkable(pi, n) || flameT[n] > 0) continue;
          // unsafe if the blast (or its lingering flame) overlaps our stay on this cell
          if (D[n] !== Infinity && D[n] <= (d + 2) * tt + margin && D[NCELL + n] + FLAME_T + 0.1 >= (d + 1) * tt) continue;
          prev.set(n, a);
          if (D[n] === Infinity) {
            if ((d + 1) * tt > limit) return null;
            let c = n;
            while (prev.get(c) !== start) c = prev.get(c)!;
            return c;
          }
          next.push(n);
        }
      }
      frontier = next;
    }
    return null;
  }

  function bombValue(pi: number, c: number): number {
    const p = players[pi];
    let v = 0;
    const cs = rays(grid, { x: c % GW, y: Math.floor(c / GW), range: p.range }, (cc) => bombAt(cc) >= 0);
    for (const cc of cs) {
      if (grid[cc] === BOX) v += 1;
      players.forEach((q, qi) => { if (qi !== pi && q.alive && cellOf(q) === cc) v += 3; });
    }
    return v;
  }

  function decide(pi: number, cur: number) {
    const p = players[pi];
    if (danger[cur] !== Infinity) {
      // tight squeeze: accept a riskier path rather than freezing
      p.target = escapeStep(pi, cur, danger) ?? escapeStep(pi, cur, danger, Infinity, -1, -0.05);
      return;
    }
    // BFS over safe cells for the best thing to do
    const dist = new Map<number, number>([[cur, 0]]);
    const prev = new Map<number, number>([[cur, -1]]);
    const order = [cur];
    for (let q = 0; q < order.length; q++) {
      const a = order[q];
      if (dist.get(a)! >= 14) continue;
      for (let k = 0; k < 4; k++) {
        const n = a + DX[k] + DY[k] * GW;
        if (dist.has(n) || !walkable(pi, n) || danger[n] !== Infinity) continue;
        dist.set(n, dist.get(a)! + 1);
        prev.set(n, a);
        order.push(n);
      }
    }
    const canBomb = bombs.filter((b) => b.owner === pi).length < p.maxBombs;
    const cands: { c: number; s: number; bomb: boolean }[] = [];
    for (const c of order) {
      const d = dist.get(c)!;
      if (items.has(c)) cands.push({ c, s: d - 6, bomb: false });
      const v = canBomb ? bombValue(pi, c) : 0;
      if (v > 0) cands.push({ c, s: d - v * 1.5, bomb: true });
    }
    cands.sort((a, b) => a.s - b.s);
    // a bomb spot only counts if a way out exists once the bomb is down
    const escapable = (c: number) => escapeStep(pi, c, computeDanger({ x: c % GW, y: Math.floor(c / GW), range: p.range, t: FUSE }), FUSE - 0.5, -1, 0.4) !== null;
    let best = -1, bestBomb = false, tests = 0;
    for (const k of cands) {
      if (k.bomb && (tests++ >= 8 || !escapable(k.c))) continue;
      best = k.c;
      bestBomb = k.bomb;
      break;
    }
    const stepTo = (goal: number) => { let c = goal; while (prev.get(c) !== cur && prev.get(c) !== -1) c = prev.get(c)!; return c; };
    if (best === cur && bestBomb) {
      // do not seal another CPU's only way out (it would read as that CPU walking into its own blast)
      const D2 = computeDanger({ x: cur % GW, y: Math.floor(cur / GW), range: p.range, t: FUSE });
      const traps = players.some((q, qi) => qi !== pi && qi > 0 && q.alive && D2[cellOf(q)] !== Infinity && escapeStep(qi, cellOf(q), D2, Infinity, cur) === null);
      if (!traps && placeBomb(pi)) {
        danger = computeDanger();
        p.target = escapeStep(pi, cur, danger);
        return;
      }
      p.wait = 0.25 + ctx.rand() * 0.3;
      best = -1;
    }
    if (best >= 0 && best !== cur) { p.target = stepTo(best); return; }
    // nothing useful nearby: drift toward the closest opponent
    let hunt = -1, hd = Infinity;
    for (const c of order) {
      for (let qi = 0; qi < players.length; qi++) {
        const q = players[qi];
        if (qi === pi || !q.alive) continue;
        const md = Math.abs(c % GW - Math.round(q.x)) + Math.abs(Math.floor(c / GW) - Math.round(q.y)) + dist.get(c)! * 0.1;
        if (md < hd) { hd = md; hunt = c; }
      }
    }
    if (hunt >= 0 && hunt !== cur) p.target = stepTo(hunt);
    else p.wait = 0.2 + ctx.rand() * 0.4;
  }

  function walkTo(pi: number, target: number, dist: number) {
    const p = players[pi];
    const tx = target % GW, ty = Math.floor(target / GW);
    const ex = tx - p.x, ey = ty - p.y;
    if (Math.abs(ex) < 1e-4 && Math.abs(ey) < 1e-4) { p.x = tx; p.y = ty; return; }
    const dir = Math.abs(ex) >= Math.abs(ey) ? (ex > 0 ? 1 : 3) : ey > 0 ? 2 : 0;
    const bx = p.x, by = p.y;
    move(pi, dir, dist);
    // never overshoot the target centre
    if ((tx - bx) * (tx - p.x) < 0) p.x = tx;
    if ((ty - by) * (ty - p.y) < 0) p.y = ty;
    p.moving = p.x !== bx || p.y !== by;
  }

  function ai(pi: number, dt: number) {
    const p = players[pi];
    const cx = Math.round(p.x), cy = Math.round(p.y);
    const cur = cy * GW + cx;
    const atCenter = Math.abs(p.x - cx) < 1e-4 && Math.abs(p.y - cy) < 1e-4;
    p.moving = false;
    if (p.target !== null && p.target !== cur && (!walkable(pi, p.target) || flameT[p.target] > 0 || (danger[p.target] !== Infinity && danger[cur] === Infinity))) p.target = atCenter ? null : cur;
    if (p.target === null || (p.target === cur && atCenter)) {
      p.target = null;
      if (p.wait > 0 && danger[cur] === Infinity) { p.wait -= dt; return; }
      p.wait = 0;
      decide(pi, cur);
    }
    if (p.target !== null) walkTo(pi, p.target, p.speed * dt);
  }

  /** Try walking `dir`; true when the player actually moved. */
  function tryMove(dir: number, dist: number, maxSlide = Infinity): boolean {
    const P = players[HP];
    const bx = P.x, by = P.y;
    move(HP, dir, dist, maxSlide);
    return P.x !== bx || P.y !== by;
  }

  /**
   * Player walking. Holding a direction keeps walking; a turn pressed before the
   * junction keeps the old heading for up to BUFFER_T so the corner assist in
   * move() can take it; with two directions held the new axis wins and the
   * other is the fallback; releasing mid-step glides on to the next cell centre
   * so a quick tap is one clean step.
   */
  function playerWalk(dt: number, ax: number, ay: number) {
    const P = players[HP];
    const mag = Math.min(1, Math.hypot(ax, ay));
    const hx = Math.abs(ax) > 0.3, vy = Math.abs(ay) > 0.3;
    if (vy && !prevV) prefAxis = 0;
    if (hx && !prevH) prefAxis = 1;
    prevH = hx; prevV = vy;
    lastDirT += dt;
    if (hx || vy) {
      const dh = ax > 0 ? 1 : 3, dv = ay > 0 ? 2 : 0;
      let order: number[];
      if (hx && vy) order = prefAxis === 0 ? [dv, dh] : [dh, dv];
      else order = [hx ? dh : dv];
      // analog sticks: gentle tilt walks slower, full tilt or keys at full speed
      const dist = P.speed * dt * Math.max(0.45, Math.min(1, (mag - 0.25) / 0.55));
      // corner assist slides at most 0.6 cell sideways into an open lane; a
      // turn pressed a little early (two keys held, or the last heading
      // within BUFFER_T) carries on to the next junction instead of backing up
      const tries: [number, number][] = order.map((d) => [d, CORNER_ASSIST]);
      if (order.length === 1 && lastDir >= 0 && lastDir % 2 !== order[0] % 2 && lastDirT <= BUFFER_T) tries.push([lastDir, CORNER_ASSIST]);
      // one key held and nothing else works: full slide toward the open lane (classic assist)
      if (order.length === 1) tries.push([order[0], Infinity]);
      for (const [d, lim] of tries) {
        if (tryMove(d, dist, lim)) {
          // the buffered heading does not reset the timer, so the turn wins as soon as it opens
          if (order.includes(d)) { lastDir = d; lastDirT = 0; }
          P.moving = true;
          return;
        }
      }
      return;
    }
    if (lastDir < 0) return;
    // glide to the next cell centre along the last heading
    const along = lastDir % 2 ? P.x : P.y;
    const sgn = lastDir === 1 || lastDir === 2 ? 1 : -1;
    const goal = sgn > 0 ? Math.ceil(along - 1e-6) : Math.floor(along + 1e-6);
    const left = Math.abs(goal - along);
    if (left < 1e-4) { if (lastDir % 2) P.x = goal; else P.y = goal; lastDir = -1; return; }
    const step = Math.min(left, P.speed * dt);
    if (tryMove(lastDir, step)) {
      P.moving = true;
      if (Math.abs(goal - (lastDir % 2 ? P.x : P.y)) < 1e-4) { if (lastDir % 2) P.x = goal; else P.y = goal; }
    } else lastDir = -1;
  }

  function kill(pi: number, by: number) {
    const p = players[pi];
    if (!p.alive) return;
    p.alive = false;
    p.deathT = 0;
    if (by === 0 && pi !== 0) kills++;
    if (pi > 0 && by === pi) { suicides++; suicideTimes.push(Math.round(playT * 10) / 10); }
    ctx.sfx('hurt', { pan: (p.x / GW) * 2 - 1 });
    hud();
  }

  function detonate() {
    for (let guard = 0; guard < 40; guard++) {
      const i = bombs.findIndex((b) => b.t <= 0);
      if (i < 0) return;
      const r = blast(grid, bombs, i);
      for (const [c, bi] of r.flame) {
        flameT[c] = FLAME_T;
        flameOwner[c] = bombs[bi].owner;
        if (grid[c] === FLOOR) items.delete(c);
      }
      for (const c of r.boxes) {
        grid[c] = FLOOR;
        const it = hidden.get(c);
        if (it) { items.set(c, it); hidden.delete(c); }
        const owner = bombs[r.flame.get(c)!].owner;
        if (owner === 0) boxesBroken++;
      }
      const gone = new Set(r.fired);
      const pan = (bombs[i].x / GW) * 2 - 1;
      bombs = bombs.filter((_, k) => !gone.has(k));
      ctx.sfx('explode', { pan, rate: 0.9 + ctx.rand() * 0.2 });
      if (!ctx.reducedMotion) shake = Math.min(0.35, shake + 0.18);
      hud();
    }
  }

  function endRound(o: 'win' | 'lose' | 'draw') {
    outcome = o;
    if (o === 'win') { wins++; ctx.sfx('win'); } else if (o === 'lose') { losses++; ctx.sfx('lose'); } else ctx.sfx('wrong');
    phase = 'roundEnd';
    phaseT = 2.4;
    hud();
  }

  return {
    update(dt, inp) {
      time += dt;
      shake = Math.max(0, shake - dt);
      for (const p of players) if (!p.alive) p.deathT += dt;
      if (phase === 'over') return;
      const ins: InputState[] = inp.players ?? [inp];
      const inOf = (i: number): InputState => ins[i] ?? NO_INPUT;
      for (const k of walks) k.squash = Math.max(0, k.squash - dt);
      goT = Math.max(0, goT - dt);
      if (phase === 'intro') {
        phaseT -= dt;
        for (let i = 0; i < humans; i++) {
          load(i);
          bombBuf = inOf(i).hit.a && phaseT < BUFFER_T ? BUFFER_T : Math.max(0, bombBuf - dt);
          save(i);
        }
        if (phaseT <= 0) { phase = 'play'; goT = 0.7; ctx.sfx('start'); }
        return;
      }
      if (phase === 'roundEnd') {
        phaseT -= dt;
        for (let c = 0; c < flameT.length; c++) flameT[c] = Math.max(0, flameT[c] - dt);
        if (phaseT > 0) return;
        if (versus && (Math.max(...winsBy) >= 2 || round >= 5)) {
          phase = 'over';
          const best = Math.max(...winsBy.slice(0, humans));
          const top = winsBy.slice(0, humans).map((n, i) => (n === best && best > 0 ? i : -1)).filter((i) => i >= 0);
          const summary = top.length === 1
            ? ctx.t('Pemain {n} ({name}) menang {w} ronde', { n: top[0] + 1, name: cast[top[0]].name, w: best })
            : ctx.t('Seri, tidak ada pemenang');
          ctx.end({ score: 0, versus: true, won: top.length === 1, summary });
          return;
        }
        if (!versus && (wins >= 2 || losses >= 2 || round >= 5)) {
          phase = 'over';
          const won = wins > losses;
          ctx.end({ score: score(), won, summary: ctx.t('Ronde menang {w}, lawan kalah {k}, lemari {b}', { w: wins, k: kills, b: boxesBroken }) });
          return;
        }
        newRound();
        return;
      }
      playT += dt;
      roundT += dt;
      const P = players[0];
      for (let hi = 0; hi < humans; hi++) {
        const H = players[hi];
        const hin = inOf(hi);
        load(hi);
        H.moving = false;
        if (H.alive) {
          // bomb first so a press while walking lands on the cell you stand on now
          if (hin.hit.a) bombBuf = BUFFER_T;
          if (bombBuf > 0) {
            if (placeBomb(hi)) { bombBuf = 0; squash = 0.12; } else bombBuf = Math.max(0, bombBuf - dt);
          }
          playerWalk(dt, hin.ax, hin.ay);
        }
        save(hi);
      }
      danger = computeDanger();
      // only empty seats think: a human seat moves on its own pad alone
      for (let i = 1; i < players.length; i++) if (players[i].alive && players[i].cpu) ai(i, dt);
      for (const b of bombs) {
        for (const qi of [...b.pass]) {
          const q = players[qi];
          if (!q.alive || Math.abs(q.x - b.x) >= 0.95 || Math.abs(q.y - b.y) >= 0.95) b.pass.delete(qi);
        }
        b.t -= dt;
        b.age += dt;
      }
      for (let c = 0; c < flameT.length; c++) flameT[c] = Math.max(0, flameT[c] - dt);
      detonate();
      players.forEach((p, i) => {
        if (!p.alive) return;
        const c = cellOf(p);
        if (flameT[c] > 0) { kill(i, flameOwner[c]); return; }
        const it = items.get(c);
        if (it) {
          items.delete(c);
          if (it === 'bomb') p.maxBombs = Math.min(6, p.maxBombs + 1);
          if (it === 'range') p.range = Math.min(7, p.range + 1);
          if (it === 'speed') p.speed = Math.min(5.8, p.speed + 0.6);
          if (i === 0) ctx.sfx('power');
        }
      });
      if (roundT >= ROUND_T && shrinkIdx < shrinkOrder.length) {
        if (shrinkIdx === 0 && shrinkAcc === 0) ctx.sfx('alarm');
        shrinkAcc += dt;
        while (shrinkAcc >= SHRINK_STEP && shrinkIdx < shrinkOrder.length) {
          shrinkAcc -= SHRINK_STEP;
          const c = shrinkOrder[shrinkIdx++];
          grid[c] = WALL;
          items.delete(c);
          hidden.delete(c);
          bombs = bombs.filter((b) => b.y * GW + b.x !== c);
          players.forEach((p, i) => { if (p.alive && cellOf(p) === c) kill(i, -1); });
          ctx.sfx('thud', { gain: 0.5 });
        }
      }
      if (versus) {
        const alive = players.map((p, i) => (p.alive ? i : -1)).filter((i) => i >= 0);
        const humanAlive = alive.some((i) => i < humans);
        if (alive.length <= 1 || !humanAlive) {
          roundWinner = alive.length === 1 ? alive[0] : -1;
          if (roundWinner >= 0 && roundWinner < humans) winsBy[roundWinner]++;
          endRound(roundWinner >= 0 && roundWinner < humans ? 'win' : 'draw');
        }
        return;
      }
      const cpuAlive = players.slice(1).some((p) => p.alive);
      if (!P.alive) endRound(cpuAlive ? 'lose' : 'draw');
      else if (!cpuAlive) endRound('win');
    },

    render() {
      g.save();
      if (shake > 0 && !ctx.reducedMotion) g.translate(Math.sin(time * 90) * shake * 8, Math.cos(time * 70) * shake * 6);
      g.fillStyle = PAL.surface;
      g.fillRect(-10, -10, w + 20, h + 20);
      // top bar
      const left = Math.max(0, ROUND_T - roundT);
      cast.forEach((c, i) => {
        const x = 8 + i * 118;
        const p = players[i];
        g.fillStyle = p.alive ? (i === 0 && !versus ? '#e7efe0' : '#f2e8d6') : '#e2dcd2';
        roundRect(g, x, 5, 112, 30, 8);
        if (versus && i < humans) { g.fillStyle = PLAYER_COLORS[i]; roundRect(g, x, 5, 6, 30, 3); }
        g.globalAlpha = p.alive ? 1 : 0.4;
        drawToken(g, look(i), x + 17, 19, 10, time, false);
        g.globalAlpha = 1;
        if (versus && i < humans) { g.fillStyle = PLAYER_COLORS[i]; roundRect(g, x, 31, 112, 4, 2); }
        text(g, versus ? (i < humans ? `P${i + 1} ${c.name}` : c.name) : i === 0 ? ctx.t('Kamu') : c.name, x + 34, 20, 13, p.alive ? PAL.ink : PAL.ink2, 'left');
      });
      text(g, roundT >= ROUND_T ? ctx.t('Menyempit!') : `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`, w - 64, 13, 15, roundT >= ROUND_T ? PAL.red : PAL.ink);
      text(g, versus ? ctx.t('Ronde {r}', { r: round }) : ctx.t('Ronde {r} · {w}-{l}', { r: round, w: wins, l: losses }), w - 64, 30, 12, PAL.ink2);

      g.save();
      g.translate(0, TOP);
      for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
        const c = y * GW + x;
        const px = x * T, py = y * T;
        if (grid[c] === WALL) {
          g.fillStyle = '#2f4a3d';
          g.fillRect(px, py, T, T);
          g.fillStyle = '#41634f';
          g.fillRect(px + 3, py + 3, T - 6, T - 12);
          continue;
        }
        g.fillStyle = (x + y) % 2 ? '#efe3cc' : '#e7d8bb';
        g.fillRect(px, py, T, T);
        if (flameT[c] > 0) {
          const a = Math.min(1, flameT[c] / 0.2);
          g.fillStyle = `rgba(232,110,30,${0.85 * a})`;
          roundRect(g, px + 2, py + 2, T - 4, T - 4, 10);
          g.fillStyle = `rgba(255,214,90,${0.95 * a})`;
          roundRect(g, px + 10, py + 10, T - 20, T - 20, 6);
        }
        if (grid[c] === BOX) drawCabinet(px, py);
        const it = items.get(c);
        if (it && grid[c] === FLOOR) drawItem(it, px + T / 2, py + T / 2);
      }
      for (const b of bombs) {
        const pulse = ctx.reducedMotion ? 0 : Math.sin(time * (8 + (FUSE - b.t) * 6)) * 1.5;
        const cx = b.x * T + T / 2, cy = b.y * T + T / 2 + 2;
        g.fillStyle = 'rgba(0,0,0,0.2)';
        g.beginPath(); g.ellipse(cx, cy + 12, 12, 4, 0, 0, Math.PI * 2); g.fill();
        const pop = ctx.reducedMotion ? 0 : Math.max(0, 1 - b.age / 0.15) * 5;
        g.fillStyle = b.t < 0.6 ? '#7a2418' : '#2b2b2b';
        g.beginPath(); g.arc(cx, cy, 13 + pulse + pop, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.beginPath(); g.arc(cx - 4, cy - 5, 4, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#8a6a3c'; g.lineWidth = 2.5;
        g.beginPath(); g.moveTo(cx + 6, cy - 10); g.quadraticCurveTo(cx + 10, cy - 18, cx + 14, cy - 16); g.stroke();
        g.fillStyle = Math.sin(time * 30) > 0 ? '#ffd75e' : '#f08a24';
        g.beginPath(); g.arc(cx + 14, cy - 16, 3, 0, Math.PI * 2); g.fill();
      }
      const order = players.map((_p, i) => i).sort((a, b) => players[a].y - players[b].y);
      for (const i of order) {
        const p = players[i];
        if (!p.alive && p.deathT > 1.2) continue;
        g.globalAlpha = p.alive ? 1 : Math.max(0, 1 - p.deathT / 1.2);
        if (versus && i < humans && p.alive) seatRing(g, p.x * T + T / 2, p.y * T + T / 2 + 11, 17, PLAYER_COLORS[i]);
        const sq = i < humans ? walks[i].squash : 0;
        if (sq > 0 && !ctx.reducedMotion) {
          // squash on dropping a bomb
          const k = Math.sin((sq / 0.12) * Math.PI) * 0.18;
          const bx = p.x * T + T / 2, by = p.y * T + T / 2 + 10;
          g.save(); g.translate(bx, by); g.scale(1 + k, 1 - k); g.translate(-bx, -by);
          drawToken(g, look(i), p.x * T + T / 2, p.y * T + T / 2 - 4, 15, time, p.moving);
          g.restore();
        } else drawToken(g, look(i), p.x * T + T / 2, p.y * T + T / 2 - 4, 15, time, p.moving);
        g.globalAlpha = 1;
        if (i < humans && p.alive) {
          if (versus) seatTag(g, `P${i + 1}`, p.x * T + T / 2, p.y * T - 14, PLAYER_COLORS[i]);
          else {
            g.fillStyle = PAL.accent;
            g.beginPath();
            const ax = p.x * T + T / 2, ay = p.y * T - 12;
            g.moveTo(ax - 5, ay - 6); g.lineTo(ax + 5, ay - 6); g.lineTo(ax, ay); g.closePath(); g.fill();
          }
        }
      }
      g.restore();

      if (phase === 'intro' || phase === 'roundEnd') {
        g.fillStyle = 'rgba(255,250,240,0.92)';
        roundRect(g, w / 2 - 170, TOP + GH * T / 2 - 44, 340, 88, 16);
        if (phase === 'intro') {
          text(g, ctx.t('Ronde {r}', { r: round }), w / 2, TOP + GH * T / 2 - 12, 28, PAL.green);
          text(g, versus ? ctx.t('Cari tanda P di atas kepalamu') : ctx.t('Bersiap...'), w / 2, TOP + GH * T / 2 + 20, 18, PAL.ink2);
        } else {
          if (versus) {
            const msg = roundWinner >= 0 && roundWinner < humans ? ctx.t('Pemain {n} menang ronde!', { n: roundWinner + 1 }) : roundWinner >= 0 ? ctx.t('Komputer bertahan terakhir') : ctx.t('Seri');
            text(g, msg, w / 2, TOP + GH * T / 2 - 12, 24, roundWinner >= 0 && roundWinner < humans ? PLAYER_COLORS[roundWinner] : PAL.red);
            text(g, winsBy.slice(0, humans).map((n, i) => `P${i + 1}: ${n}`).join('   '), w / 2, TOP + GH * T / 2 + 20, 18, PAL.ink2);
          } else {
            const msg = outcome === 'win' ? ctx.t('Kamu menang ronde ini!') : outcome === 'lose' ? ctx.t('Kamu tersingkir') : ctx.t('Seri');
            text(g, msg, w / 2, TOP + GH * T / 2 - 12, 24, outcome === 'win' ? PAL.green : PAL.red);
            text(g, ctx.t('Skor {s}', { s: score() }), w / 2, TOP + GH * T / 2 + 20, 18, PAL.ink2);
          }
        }
      }
      if (phase === 'play' && goT > 0) {
        // non-blocking start cue: the round is already live underneath
        g.globalAlpha = Math.min(1, goT / 0.3);
        text(g, ctx.t('Mulai!'), w / 2, TOP + GH * T / 2, 40, PAL.green);
        g.globalAlpha = 1;
      }
      g.restore();
    },

    snapshot: () => ({
      phase, round, wins, losses, versus, humans, winsBy: winsBy.slice(0, humans), score: score(), kills, boxesBroken, suicides, suicideTimes: [...suicideTimes],
      roundT: Math.round(roundT * 100) / 100, playT: Math.round(playT * 100) / 100,
      bombs: bombs.length, myBombs: bombs.filter((b) => b.owner === 0).length, boxes: Array.from(grid).filter((v) => v === BOX).length, grid: Array.from(grid).join(''),
      players: players.map((p) => ({ id: p.c.id, x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000, alive: p.alive, maxBombs: p.maxBombs, range: p.range })),
    }),
  };

  function drawCabinet(px: number, py: number) {
    g.fillStyle = 'rgba(0,0,0,0.15)';
    g.fillRect(px + 5, py + T - 6, T - 8, 4);
    g.fillStyle = '#9c7446';
    roundRect(g, px + 4, py + 3, T - 8, T - 7, 4);
    g.fillStyle = '#b98a55';
    for (let k = 0; k < 3; k++) {
      g.fillRect(px + 7, py + 6 + k * 10.5, T - 14, 8.5);
      g.fillStyle = '#5b4126';
      g.fillRect(px + T / 2 - 4, py + 9 + k * 10.5, 8, 2.5);
      g.fillStyle = '#b98a55';
    }
  }

  function drawItem(it: Item, cx: number, cy: number) {
    const bob = ctx.reducedMotion ? 0 : Math.sin(time * 4) * 1.5;
    g.fillStyle = it === 'bomb' ? PAL.blue : it === 'range' ? PAL.accent : PAL.green;
    roundRect(g, cx - 14, cy - 14 + bob, 28, 28, 7);
    g.fillStyle = '#fffaf0';
    if (it === 'bomb') {
      g.beginPath(); g.arc(cx - 2, cy + 2 + bob, 7, 0, Math.PI * 2); g.fill();
      text(g, '+', cx + 7, cy - 6 + bob, 14, '#fffaf0');
    } else if (it === 'range') {
      g.fillRect(cx - 9, cy - 2 + bob, 18, 4);
      g.fillRect(cx - 2, cy - 9 + bob, 4, 18);
    } else {
      text(g, '»', cx, cy + bob, 22, '#fffaf0');
    }
  }
}

export default { meta, create } satisfies GameModule;
