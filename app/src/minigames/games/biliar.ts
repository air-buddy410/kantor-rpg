// Biliar 8-Ball (billiard table, L2-BILLIARD). Top-down eight ball against a
// CPU teammate.
// Physics: every ball carries its linear velocity (vx, vy) and the surface
// speed of its spin (wx, wy). While the two differ the ball slides and cloth
// friction pulls them together (5/2 ratio of a solid sphere); once equal it
// rolls with a small rolling resistance. Ball to ball contacts are frictionless
// equal-mass impulses, so a stun shot stops dead and top/back spin makes the
// cue ball follow or draw afterwards. At least 8 sub-steps per frame and never
// more than 0.4 R of travel per sub-step, so nothing tunnels.
import type { CastMember, GameCtx, GameInstance, GameModule, InputState } from '../types';
import { stick } from '../../input/pad-profiles';
import { PAL, drawToken, roundRect, text } from '../cast';

export const R = 8;
export const TABLE = { x0: 70, y0: 84, x1: 570, y1: 334 };
const MIDX = (TABLE.x0 + TABLE.x1) / 2;
const MIDY = (TABLE.y0 + TABLE.y1) / 2;
export const POCKETS = [
  { x: TABLE.x0 - 2, y: TABLE.y0 - 2, r: 15 }, { x: MIDX, y: TABLE.y0 - 5, r: 13 }, { x: TABLE.x1 + 2, y: TABLE.y0 - 2, r: 15 },
  { x: TABLE.x0 - 2, y: TABLE.y1 + 2, r: 15 }, { x: MIDX, y: TABLE.y1 + 5, r: 13 }, { x: TABLE.x1 + 2, y: TABLE.y1 + 2, r: 15 },
];
export const HEAD = { x: TABLE.x0 + 125, y: MIDY };
export const FOOT = { x: TABLE.x0 + 375, y: MIDY };
/** Sliding friction (mu g), rolling resistance and a little cloth drag, in game units. */
export const SLIDE = 360;
export const ROLL = 80;
const DRAG = 0.22;
export const E_BALL = 0.95;
export const E_RAIL = 0.75;
export const MIN_SPEED = 90;
export const MAX_SPEED = 1250;
export const SUBSTEPS = 8;
export const MAX_SHOTS = 40;
export const TIME_LIMIT = 600;
const MEDIUM = 0.5;
/** Camera stick at full tilt turns the cue this many rad/s (about 46 degrees). */
export const PAD_TURN = 0.8;
const STOP = 2;
const FALL_T = 0.32;

export type Group = 'solid' | 'stripe';
export type Spin = 'none' | 'top' | 'back';
export interface Ball {
  n: number; x: number; y: number; vx: number; vy: number;
  /** Surface speed of the spin; equals (vx, vy) when the ball rolls cleanly. */
  wx: number; wy: number;
  down: boolean;
  /** Body-fixed pole (unit vector) carrying the number spot and stripe caps; z points into the table. */
  px: number; py: number; pz: number;
  /** Seconds left of the drop-into-pocket animation. */
  fall: number;
}
export type PhysEvent = { kind: 'pocket'; n: number } | { kind: 'hit'; a: number; b: number; v: number } | { kind: 'rail'; n: number; v: number };
export interface Rules { turn: 0 | 1; groups: (Group | null)[]; winner: 0 | 1 | null }

export const groupOf = (n: number): Group | null => (n >= 1 && n <= 7 ? 'solid' : n >= 9 && n <= 15 ? 'stripe' : null);
const other = (gr: Group): Group => (gr === 'solid' ? 'stripe' : 'solid');
const speedOf = (b: Ball) => Math.hypot(b.vx, b.vy);
export const angDiff = (a: number, b: number) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function makeBall(n: number, x: number, y: number, vx = 0, vy = 0, rolling = false): Ball {
  return { n, x, y, vx, vy, wx: rolling ? vx : 0, wy: rolling ? vy : 0, down: false, px: 0, py: 0, pz: -1, fall: 0 };
}

/** Fresh rack: cue on the head spot, triangle apex on the foot spot. */
export function rack(rand: () => number): Ball[] {
  const shuffle = <T,>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const solids = shuffle([1, 2, 3, 4, 5, 6, 7]);
  const stripes = shuffle([9, 10, 11, 12, 13, 14, 15]);
  let cA = solids.pop()!, cB = stripes.pop()!;
  if (rand() < 0.5) [cA, cB] = [cB, cA];
  const rest = shuffle([...solids, ...stripes]);
  const balls: Ball[] = [makeBall(0, HEAD.x, HEAD.y)];
  for (let row = 0; row < 5; row++) {
    for (let k = 0; k <= row; k++) {
      // 8 in the middle of row 3, one of each group on the back corners
      const n = row === 2 && k === 1 ? 8 : row === 4 && k === 0 ? cA : row === 4 && k === 4 ? cB : rest.pop()!;
      const b = makeBall(n, FOOT.x + row * (2 * R * 0.866 + 0.3), FOOT.y + (k - row / 2) * (2 * R + 0.3));
      // random resting orientation so the numbers do not all face up
      const th = rand() * Math.PI * 2, ph = 0.3 + rand() * 0.8;
      b.px = Math.cos(th) * Math.sin(ph); b.py = Math.sin(th) * Math.sin(ph); b.pz = -Math.cos(ph);
      balls.push(b);
    }
  }
  return balls;
}

/** Resolve one contact between equal masses; returns the closing speed (0 = no impact). Spin is untouched. */
export function collide(a: Ball, b: Ball, e = E_BALL): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d >= 2 * R || d === 0) return 0;
  const nx = dx / d, ny = dy / d;
  const push = (2 * R - d) / 2;
  a.x -= nx * push; a.y -= ny * push;
  b.x += nx * push; b.y += ny * push;
  const vrel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (vrel <= 0) return 0;
  const j = ((1 + e) / 2) * vrel;
  a.vx -= j * nx; a.vy -= j * ny;
  b.vx += j * nx; b.vy += j * ny;
  return vrel;
}

/** Pocket that swallows this ball, or null. Past the cushion line the mouth is a little wider. */
function pocketAt(b: Ball) {
  const { x0, y0, x1, y1 } = TABLE;
  const beyond = b.x < x0 || b.x > x1 || b.y < y0 || b.y > y1;
  for (const p of POCKETS) {
    const d = Math.hypot(b.x - p.x, b.y - p.y);
    if (d < p.r || (beyond && d < p.r + R * 0.9)) return p;
  }
  return null;
}
const inMouth = (b: Ball) => POCKETS.some((p) => Math.hypot(b.x - p.x, b.y - p.y) < p.r + R * 0.9);

function rail(b: Ball, axis: 'x' | 'y', wall: number, sign: 1 | -1, ev: PhysEvent[]) {
  const v = axis === 'x' ? b.vx : b.vy;
  if (axis === 'x') b.x = wall; else b.y = wall;
  if (v * sign <= 0) return;
  ev.push({ kind: 'rail', n: b.n, v: Math.abs(v) });
  if (axis === 'x') { b.vx = -b.vx * E_RAIL; b.vy *= 0.96; b.wx = -b.wx * 0.4; }
  else { b.vy = -b.vy * E_RAIL; b.vx *= 0.96; b.wy = -b.wy * 0.4; }
}

export function physicsStep(balls: Ball[], dt: number, ev: PhysEvent[] = []) {
  let maxV = 0;
  let live = false;
  for (const b of balls) {
    if (b.down) continue;
    if (b.vx || b.vy || b.wx || b.wy) live = true;
    maxV = Math.max(maxV, speedOf(b));
  }
  if (!live) return;
  const n = Math.min(160, Math.max(SUBSTEPS, Math.ceil((maxV * dt) / (R * 0.4))));
  const h = dt / n;
  const { x0, y0, x1, y1 } = TABLE;
  for (let s = 0; s < n; s++) {
    for (const b of balls) {
      if (b.down || (b.vx === 0 && b.vy === 0)) continue;
      b.x += b.vx * h;
      b.y += b.vy * h;
      const p = pocketAt(b);
      if (p) {
        b.down = true; b.fall = FALL_T;
        b.vx = (p.x - b.x) / FALL_T + b.vx * 0.04; b.vy = (p.y - b.y) / FALL_T + b.vy * 0.04;
        b.wx = 0; b.wy = 0;
        ev.push({ kind: 'pocket', n: b.n });
        continue;
      }
      if (inMouth(b)) continue;
      if (b.x < x0 + R) rail(b, 'x', x0 + R, -1, ev);
      if (b.x > x1 - R) rail(b, 'x', x1 - R, 1, ev);
      if (b.y < y0 + R) rail(b, 'y', y0 + R, -1, ev);
      if (b.y > y1 - R) rail(b, 'y', y1 - R, 1, ev);
    }
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (a.down) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        if (b.down || Math.abs(b.x - a.x) >= 2 * R || Math.abs(b.y - a.y) >= 2 * R) continue;
        const v = collide(a, b);
        if (v > 0) ev.push({ kind: 'hit', a: a.n, b: b.n, v });
      }
    }
    for (const b of balls) {
      if (b.down) continue;
      const ux = b.vx - b.wx, uy = b.vy - b.wy;
      const u = Math.hypot(ux, uy);
      if (u > 3.5 * SLIDE * h) {
        // sliding: friction opposes the slip at the contact point
        const fx = (ux / u) * SLIDE * h, fy = (uy / u) * SLIDE * h;
        b.vx -= fx; b.vy -= fy;
        b.wx += 2.5 * fx; b.wy += 2.5 * fy;
      } else {
        // slip gone: angular momentum about the contact point fixes the rolling speed
        const rx = (5 * b.vx + 2 * b.wx) / 7, ry = (5 * b.vy + 2 * b.wy) / 7;
        const sp = Math.hypot(rx, ry);
        const k = sp > 0 ? Math.max(0, (sp - ROLL * h) * (1 - DRAG * h)) / sp : 0;
        b.vx = b.wx = rx * k;
        b.vy = b.wy = ry * k;
      }
      if (Math.abs(b.vx) + Math.abs(b.vy) < STOP && Math.abs(b.wx) + Math.abs(b.wy) < STOP) { b.vx = b.vy = b.wx = b.wy = 0; }
      // turn the body pole: omega = (wy, -wx, 0) / R with z into the table
      const ox = b.wy / R, oy = -b.wx / R;
      if (ox || oy) {
        const { px, py, pz } = b;
        const nx = px + oy * pz * h, ny = py - ox * pz * h, nz = pz + (ox * py - oy * px) * h;
        const l = Math.hypot(nx, ny, nz) || 1;
        b.px = nx / l; b.py = ny / l; b.pz = nz / l;
      }
    }
  }
}

/** Advance the drop-into-pocket animation of sunk balls. */
export function tickFalls(balls: Ball[], dt: number) {
  for (const b of balls) {
    if (!b.down || b.fall <= 0) continue;
    b.fall = Math.max(0, b.fall - dt);
    b.x += b.vx * dt; b.y += b.vy * dt;
  }
}

export const moving = (balls: Ball[]) => balls.some((b) => !b.down && (b.vx !== 0 || b.vy !== 0 || b.wx !== 0 || b.wy !== 0));
export const momentum = (balls: Ball[]) => balls.reduce((m, b) => ({ x: m.x + b.vx, y: m.y + b.vy }), { x: 0, y: 0 });

export interface AimRay { x: number; y: number; hit: Ball | null; rail: 'x' | 'y' | null }
/** Where the cue ball first touches something: ghost-ball position, or the cushion it meets. */
export function aimRay(balls: Ball[], angle: number, maxLen = 900, from?: { x: number; y: number }): AimRay {
  const c = from ?? balls[0];
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let best = maxLen;
  let hit: Ball | null = null;
  let railAxis: 'x' | 'y' | null = null;
  const { x0, y0, x1, y1 } = TABLE;
  const cand = (t: number, ax: 'x' | 'y') => { if (t < best) { best = t; railAxis = ax; } };
  if (dx > 1e-6) cand((x1 - R - c.x) / dx, 'x');
  if (dx < -1e-6) cand((x0 + R - c.x) / dx, 'x');
  if (dy > 1e-6) cand((y1 - R - c.y) / dy, 'y');
  if (dy < -1e-6) cand((y0 + R - c.y) / dy, 'y');
  for (const b of balls) {
    if (b === balls[0] || b.down) continue;
    const fx = c.x - b.x, fy = c.y - b.y;
    const bq = fx * dx + fy * dy;
    const disc = bq * bq - (fx * fx + fy * fy - 4 * R * R);
    if (disc < 0) continue;
    const t = -bq - Math.sqrt(disc);
    if (t > 0 && t < best) { best = t; hit = b; railAxis = null; }
  }
  best = Math.max(0, best);
  return { x: c.x + dx * best, y: c.y + dy * best, hit, rail: railAxis };
}

function pathClear(balls: Ball[], ax: number, ay: number, bx: number, by: number, skip: number[]) {
  const vx = bx - ax, vy = by - ay;
  const L2 = vx * vx + vy * vy || 1;
  for (const b of balls) {
    if (b.down || skip.includes(b.n)) continue;
    const t = Math.max(0, Math.min(1, ((b.x - ax) * vx + (b.y - ay) * vy) / L2));
    if (Math.hypot(ax + vx * t - b.x, ay + vy * t - b.y) < 2 * R - 0.5) return false;
  }
  return true;
}

export const speedFor = (p: number) => MIN_SPEED + clamp(p, 0, 1) * (MAX_SPEED - MIN_SPEED);
/** Spin surface speed as a fraction of the cue speed: top rolls on, back draws back. */
export const SPIN_K: Record<Spin, number> = { none: 0, top: 0.75, back: -0.85 };

/** Put the cue ball in motion: linear speed from power, spin from the english setting. */
export function strike(c: Ball, angle: number, power: number, spin: Spin = 'none') {
  const v = speedFor(power);
  c.vx = Math.cos(angle) * v; c.vy = Math.sin(angle) * v;
  c.wx = c.vx * SPIN_K[spin]; c.wy = c.vy * SPIN_K[spin];
}

/** Play a shot on a copy of the table; returns the balls sunk in order. */
export function simulate(balls: Ball[], angle: number, power: number, spin: Spin = 'none', maxT = 9): number[] {
  const copy = balls.map((b) => ({ ...b }));
  strike(copy[0], angle, power, spin);
  const ev: PhysEvent[] = [];
  for (let t = 0; t < maxT && moving(copy); t += 1 / 30) physicsStep(copy, 1 / 30, ev);
  return ev.filter((e): e is { kind: 'pocket'; n: number } => e.kind === 'pocket').map((e) => e.n);
}

interface Cand { angle: number; power: number; target: number; score: number }
/** Ghost-ball candidates for potting any of `targets`, best first. */
export function candidates(balls: Ball[], targets: number[]): Cand[] {
  const c = balls[0];
  const { x0, y0, x1, y1 } = TABLE;
  const out: Cand[] = [];
  for (const t of balls) {
    if (t.down || !targets.includes(t.n)) continue;
    for (const p of POCKETS) {
      const L2 = Math.hypot(p.x - t.x, p.y - t.y);
      if (L2 < 1) continue;
      const ux = (p.x - t.x) / L2, uy = (p.y - t.y) / L2;
      const gx = t.x - ux * 2 * R, gy = t.y - uy * 2 * R;
      if (gx < x0 + R || gx > x1 - R || gy < y0 + R || gy > y1 - R) continue;
      const L1 = Math.hypot(gx - c.x, gy - c.y);
      if (L1 < 1) continue;
      const cos = ((gx - c.x) * ux + (gy - c.y) * uy) / L1;
      if (cos < 0.3) continue;
      if (!pathClear(balls, c.x, c.y, gx, gy, [0, t.n]) || !pathClear(balls, t.x, t.y, p.x, p.y, [0, t.n])) continue;
      const score = (cos * cos * 1000) / (L1 + L2 * 1.6 + 60);
      const power = clamp(((L1 + L2 / Math.max(0.35, cos)) / 900) * 0.8 + 0.12, 0.15, 1);
      out.push({ angle: Math.atan2(gy - c.y, gx - c.x), power, target: t.n, score });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

const POWERS = [0.22, 0.32, 0.44, 0.58, 0.74, 0.92];
/** Easiest pot among `targets`, power confirmed by simulation; null when nothing is makeable. */
export function plan(balls: Ball[], targets: number[]): { angle: number; power: number; target: number } | null {
  const list = candidates(balls, targets).slice(0, 3);
  if (!list.length) return null;
  for (const cnd of list) {
    for (const pw of POWERS) {
      const sunk = simulate(balls, cnd.angle, pw);
      if (sunk.includes(cnd.target) && !sunk.includes(0) && (cnd.target === 8 || !sunk.includes(8))) return { angle: cnd.angle, power: pw, target: cnd.target };
    }
  }
  const b = list[0];
  return { angle: b.angle, power: b.power, target: b.target };
}

export function targetsFor(rules: Rules, s: 0 | 1, balls: Ball[]): number[] {
  const gr = rules.groups[s];
  const live = balls.filter((b) => !b.down && b.n !== 0);
  if (!gr) return live.filter((b) => b.n !== 8).map((b) => b.n);
  const own = live.filter((b) => groupOf(b.n) === gr).map((b) => b.n);
  return own.length ? own : [8];
}

/**
 * House rules, applied once the balls stop. Mutates `rules`.
 * `pocketed` lists balls sunk on this shot in order; `balls` is the state after it.
 */
export function resolveShot(rules: Rules, pocketed: number[], balls: Ball[]): { foul: boolean; keep: boolean; assigned: Group | null; eight: boolean } {
  const s = rules.turn;
  const o = (1 - s) as 0 | 1;
  const cue = pocketed.includes(0);
  const objs = pocketed.filter((n) => n !== 0 && n !== 8);
  if (pocketed.includes(8)) {
    const gr = rules.groups[s];
    // the group had to be cleared on earlier shots, not on this one
    const cleared = !!gr && balls.every((b) => groupOf(b.n) !== gr || (b.down && !pocketed.includes(b.n)));
    rules.winner = cleared && !cue ? s : o;
    return { foul: cue, keep: false, assigned: null, eight: true };
  }
  let assigned: Group | null = null;
  if (!rules.groups[s] && objs.length && !cue) {
    assigned = groupOf(objs[0])!;
    rules.groups[s] = assigned;
    rules.groups[o] = other(assigned);
  }
  const own = rules.groups[s] ? objs.filter((n) => groupOf(n) === rules.groups[s]).length : 0;
  const keep = !cue && own > 0;
  if (!keep) rules.turn = o;
  return { foul: cue, keep, assigned, eight: false };
}

/** Ball in hand, simplified: the cue goes back to the head spot, or the nearest free spot. */
export function respotCue(balls: Ball[]) {
  const c = balls[0];
  c.down = false; c.fall = 0; c.vx = c.vy = c.wx = c.wy = 0;
  const free = (x: number, y: number) => balls.every((b) => b === c || b.down || Math.hypot(b.x - x, b.y - y) >= 2 * R + 1);
  for (let k = 0; k < 40; k++) {
    const dy = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (2 * R + 2);
    const dx = -Math.floor(k / 12) * (2 * R + 2);
    if (free(HEAD.x + dx, HEAD.y + dy)) { c.x = HEAD.x + dx; c.y = HEAD.y + dy; return; }
  }
  c.x = HEAD.x; c.y = HEAD.y;
}

const COL = ['#fbf6ea', '#e8b923', '#2f5fa8', '#c23b2b', '#6a3f9a', '#e07a2b', '#2f7d4a', '#7d2a2a', '#1b1b1b'];
const ballColor = (n: number) => COL[n <= 8 ? n : n - 8];

const meta: GameModule['meta'] = {
  id: 'biliar', title: 'Biliar 8-Ball', place: 'billiard_table', music: 'lounge',
  blurb: '8-ball tampak atas melawan rekan tim. Masukkan semua bolamu, lalu bola 8.',
  tutorial: [
    'Putar bidikan dengan {lr} (tahan = makin cepat), {ud} untuk putar halus.',
    'Tekan {a}: meter tenaga berayun. Tekan {a} lagi untuk pukul.',
    '{x}: pukul tenaga sedang. {y}: ganti efek bola. Bola putih masuk = foul.',
  ],
  legend: [['lr', 'Bidik'], ['ud', 'Bidik halus'], ['a', 'Tenaga / pukul'], ['x', 'Pukul sedang'], ['y', 'Efek'], ['b', 'Batal']],
  // DualSense (Budi 2026-11-19): analog aim tuned for the pad, trigger for power.
  padTutorial: [
    'Arahkan {ls} ke tujuan untuk bidik kasar, lalu {rs} kiri/kanan untuk bidik halus.',
    'Tahan {l2} supaya {rs} makin pelan dan presisi.',
    'Tarik {r2}: makin dalam makin kuat, lepas untuk pukul. Atau {a} untuk meter tenaga.',
  ],
  padLegend: [['ls', 'Bidik'], ['rs', 'Bidik halus'], ['l2', 'Presisi'], ['r2', 'Tarik lalu lepas'], ['a', 'Meter tenaga'], ['y', 'Efek'], ['b', 'Batal']],
  padActions: {
    ls: 'Tunjuk arah bidikan',
    rs: 'Putar bidikan halus (makin miring makin cepat)',
    l2: 'Tahan: bidik presisi, 4 kali lebih pelan',
    r2: 'Tarik untuk tenaga, lepas untuk pukul',
  },
  actions: {
    left: 'Putar bidikan ke kiri (tahan = cepat)',
    right: 'Putar bidikan ke kanan (tahan = cepat)',
    up: 'Putar halus',
    down: 'Putar halus arah sebaliknya',
    a: 'Mulai meter tenaga / pukul',
    b: 'Batal pukul',
    x: 'Pukul tenaga sedang',
    y: 'Ganti efek bola: atas, bawah, tengah',
  },
  pointerHint: 'Ketuk satu titik untuk membidik ke situ. Seret menjauhi arah tembak untuk menarik tongkat (makin jauh makin kuat), lepas untuk pukul.',
  view: { w: 640, h: 400 }, score: { unit: 'poin', higherIsBetter: true },
  touch: ['left', 'right', 'up', 'down', 'a', 'b', 'x', 'y'],
};

interface Spark { x: number; y: number; vx: number; vy: number; t: number; life: number; c: string }
interface Float { x: number; y: number; t: number; s: string; c: string }

function create(ctx: GameCtx): GameInstance {
  const { g, w, h } = ctx;
  const me = ctx.cast.find((c) => c.id === ctx.playerId) ?? ctx.cast[0];
  const pool = ctx.cast.filter((c) => c.id !== 'CH-CEO');
  const foe: CastMember = pool[Math.floor(ctx.rand() * pool.length)] ?? me;
  const skill = 0.008 + ctx.rand() * 0.016;
  const balls = rack(ctx.rand);
  const rules: Rules = { turn: 0, groups: [null, null], winner: null };
  let phase: 'aim' | 'roll' | 'pause' | 'over' = 'aim';
  let aim = 0;
  let power = 0;
  let powerDir = 1;
  let charging = false;
  let latched = false;
  let holdA = false;
  let chargeT = 0;
  let turnHold = 0;
  let spin: Spin = 'none';
  let aBuf = 0;
  let drag: { sx: number; sy: number; maxL: number } | null = null;
  // R2 shot: power follows the trigger; releasing shoots with the strongest
  // pull of the last moment, so easing off on the way out does not weaken it.
  let trig = { on: false, peak: 0, hist: [] as number[], cancel: false };
  let prevPtrDown = false;
  let cpu = { angle: 0, power: 0.5, t: 0 };
  let hint = { angle: 0, power: 1 };
  let shots = 0;
  let time = 0;
  let pauseT = 0;
  let overT = 0;
  let ended = false;
  let pocketedNow: number[] = [];
  let msg = '';
  let banner = '';
  let sfxGap = 0;
  let fouls = 0;
  let shake = 0;
  let stroke: { x: number; y: number; a: number; pull: number; t: number } | null = null;
  const sparks: Spark[] = [];
  const floats: Float[] = [];
  let result = { score: 0, summary: '', won: false };
  const nameOf = (s: 0 | 1) => (s === 0 ? ctx.t('Kamu') : foe.name);
  const downOf = (gr: Group | null) => (gr ? balls.filter((b) => b.down && groupOf(b.n) === gr).length : 0);
  const hud = () => ctx.setHud(ctx.t('Kamu {a} · {name} {b} · Giliran {n}/40', { a: downOf(rules.groups[0]), name: foe.name, b: downOf(rules.groups[1]), n: Math.min(MAX_SHOTS, shots + 1) }));

  const burst = (x: number, y: number, n: number, c: string, sp: number) => {
    if (ctx.reducedMotion) return;
    for (let i = 0; i < n; i++) {
      const a = ctx.rand() * Math.PI * 2, v = sp * (0.4 + ctx.rand() * 0.6);
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.35 + ctx.rand() * 0.25, c });
    }
  };

  const shotPlan = (s: 0 | 1) => {
    if (shots === 0) {
      const apex = balls.filter((b) => b.n !== 0).reduce((m, b) => (b.x < m.x ? b : m));
      return { angle: Math.atan2(apex.y - balls[0].y, apex.x - balls[0].x), power: 1 };
    }
    const t = targetsFor(rules, s, balls);
    const p = plan(balls, t);
    if (p) return p;
    const c = balls[0];
    const near = balls.filter((b) => !b.down && t.includes(b.n)).sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
    return near ? { angle: Math.atan2(near.y - c.y, near.x - c.x), power: 0.5 } : { angle: aim, power: 0.4 };
  };

  const startTurn = () => {
    phase = 'aim';
    power = 0; charging = false; latched = false; holdA = false; chargeT = 0; drag = null;
    // R2 counts only after it was seen released this turn: a trigger still
    // held from the last shot (or pulled during the roll) never fires at once
    trig = { on: false, peak: 0, hist: [], cancel: true };
    const p = shotPlan(rules.turn);
    hint = { angle: p.angle, power: p.power };
    if (rules.turn === 1) {
      const errA = (ctx.rand() + ctx.rand() - 1) * skill * 2;
      cpu = { angle: p.angle + errA, power: clamp(p.power * (0.94 + ctx.rand() * 0.14), 0.15, 1), t: 0 };
      msg = ctx.t('{name} membidik...', { name: foe.name });
    } else {
      if (!msg) msg = ctx.t('Giliranmu. Bidik lalu pukul.');
      // A pressed just before the turn opened: start the swinging meter right away
      if (aBuf > 0) { charging = true; latched = true; powerDir = 1; aBuf = 0; }
    }
    hud();
  };

  const shoot = (angle: number, p: number) => {
    const c = balls[0];
    const pw = clamp(p, 0.02, 1);
    strike(c, angle, pw, rules.turn === 0 ? spin : 'none');
    stroke = { x: c.x, y: c.y, a: angle, pull: 8 + pw * 46, t: 0 };
    aim = angle;
    shots++;
    pocketedNow = [];
    phase = 'roll';
    charging = false; latched = false; holdA = false; drag = null;
    power = pw;
    msg = '';
    ctx.sfx('clack', { gain: 0.35 + pw * 0.65, rate: 0.9 + pw * 0.25 });
    burst(c.x - Math.cos(angle) * R, c.y - Math.sin(angle) * R, 5, '#9fc6e8', 50);
    if (pw > 0.85 && !ctx.reducedMotion) shake = 0.12;
    if (rules.turn === 0) ctx.rumble(0.25 + pw * 0.75, 70 + pw * 90);
  };

  const finish = (won: boolean | null, reason: string) => {
    const mine = downOf(rules.groups[0]);
    const score = mine * 100 + (won ? 1000 : 0);
    const summary = won ? ctx.t('Menang melawan {name}! {n} bola masuk.', { name: foe.name, n: mine })
      : won === null ? ctx.t('Seri melawan {name}. {n} bola masuk.', { name: foe.name, n: mine })
        : ctx.t('Kalah dari {name}. {n} bola masuk.', { name: foe.name, n: mine });
    result = { score, summary, won: !!won };
    banner = reason;
    msg = summary;
    phase = 'over';
    overT = 1.8;
    ctx.sfx(won ? 'win' : 'lose');
    hud();
  };

  const judge = () => {
    const a = downOf(rules.groups[0]), b = downOf(rules.groups[1]);
    finish(a > b ? true : a < b ? false : null, ctx.t('Batas tercapai: dinilai dari sisa bola'));
  };

  const resolve = () => {
    const s = rules.turn;
    const out = resolveShot(rules, pocketedNow, balls);
    if (rules.winner !== null) {
      const shooterWon = rules.winner === s;
      const why = shooterWon
        ? (s === 0 ? ctx.t('Bola 8 masuk. Kamu menang!') : ctx.t('{name} memasukkan bola 8', { name: foe.name }))
        : out.foul
          ? (s === 0 ? ctx.t('Bola putih ikut masuk bersama bola 8') : ctx.t('{name} memasukkan bola putih bersama bola 8', { name: foe.name }))
          : (s === 0 ? ctx.t('Bola 8 masuk terlalu awal') : ctx.t('{name} memasukkan bola 8 terlalu awal', { name: foe.name }));
      finish(rules.winner === 0, why);
      return;
    }
    if (out.foul) {
      fouls++;
      respotCue(balls);
      msg = ctx.t('Foul! Bola putih masuk. {name} dapat bola di tangan.', { name: nameOf(rules.turn) });
      ctx.sfx('wrong');
    } else if (out.assigned) {
      msg = rules.groups[0] === 'solid' ? ctx.t('Kamu main bola penuh (1-7).') : ctx.t('Kamu main bola belang (9-15).');
      ctx.sfx('right');
    } else if (out.keep) msg = ctx.t('Masuk! {name} lanjut.', { name: nameOf(s) });
    else msg = ctx.t('Giliran {name}.', { name: nameOf(rules.turn) });
    if (shots >= MAX_SHOTS || time >= TIME_LIMIT) { judge(); return; }
    phase = 'pause';
    pauseT = 0.7;
    hud();
  };

  startTurn();

  const tickFx = (dt: number) => {
    tickFalls(balls, dt);
    if (stroke) { stroke.t += dt; if (stroke.t > 0.45) stroke = null; }
    shake = Math.max(0, shake - dt);
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= 0.9; s.vy *= 0.9;
      if (s.t > s.life) sparks.splice(i, 1);
    }
    for (let i = floats.length - 1; i >= 0; i--) { floats[i].t += dt; if (floats[i].t > 1) floats.splice(i, 1); }
  };

  const aimAt = (x: number, y: number) => {
    const c = balls[0];
    if (Math.hypot(x - c.x, y - c.y) > R * 0.5) { aim = Math.atan2(y - c.y, x - c.x); ctx.sfx('tick'); }
  };

  /**
   * Gamepad aim. Walking stick: point at the target, coarse. Camera stick:
   * turn the cue, rate rising with the square of the tilt so a small push
   * moves a fraction of a degree; L2 held slows it four times more. Dead zones
   * come from the controller profile and Santai lowers the speed (aimScale).
   * The D-pad still turns and nudges like the arrow keys.
   */
  const padAim = (dt: number, inp: InputState) => {
    const pad = inp.pad!;
    const [mx, my] = stick(pad.move[0], pad.move[1], pad.dead);
    const mm = Math.hypot(mx, my);
    const fine = pad.l2 > 0.3 ? 0.25 : 1;
    if (Math.hypot(pad.move[0], pad.move[1]) > 0.5 && mm > 0) {
      // smoothing (time constant ~60 ms) keeps stick noise from shaking the cue
      aim += angDiff(Math.atan2(my, mx), aim) * Math.min(1, dt * 16 * mm * pad.aim);
      turnHold = 0;
      return;
    }
    const [rx] = stick(pad.look[0], 0, pad.dead);
    if (rx) aim += Math.sign(rx) * rx * rx * PAD_TURN * pad.aim * fine * dt;
    const turn = (inp.down.right ? 1 : 0) - (inp.down.left ? 1 : 0);
    if (turn && !rx) {
      turnHold += dt;
      const k = Math.min(1, turnHold / 0.9);
      aim += turn * (0.25 + 2.6 * k * k) * fine * dt;
      if (inp.hit.right || inp.hit.left) aim += turn * 0.004;
    } else turnHold = 0;
    const nudge = (inp.down.down ? 1 : 0) - (inp.down.up ? 1 : 0);
    aim += nudge * 0.07 * fine * dt;
    if (inp.hit.down) aim += 0.0015;
    if (inp.hit.up) aim -= 0.0015;
  };

  /** R2 pulled: the meter shows the pull; true once released and shot. */
  const triggerShot = (dt: number, r2: number): boolean => {
    if (trig.cancel) { if (r2 < 0.05) trig.cancel = false; return false; }
    if (!trig.on) {
      if (r2 < 0.08) return false;
      trig = { on: true, peak: 0, hist: [], cancel: false };
      msg = ctx.t('Lepas {r2} untuk memukul.', { r2: ctx.key('r2') });
    }
    trig.hist.push(r2);
    // last 0.12 s of pull at 60 Hz
    if (trig.hist.length > Math.max(1, Math.round(0.12 / Math.max(dt, 1 / 240)))) trig.hist.shift();
    trig.peak = Math.max(...trig.hist);
    power = clamp(r2, 0, 1);
    if (r2 >= 0.05) return false;
    const p = trig.peak;
    trig = { on: false, peak: 0, hist: [], cancel: false };
    if (p < 0.15) { power = 0; msg = ctx.t('Tarikan terlalu pelan, pukulan batal.'); return false; }
    shoot(aim, p);
    return true;
  };

  const playerAim = (dt: number, inp: InputState) => {
    if (inp.hit.y) {
      spin = spin === 'none' ? 'top' : spin === 'top' ? 'back' : 'none';
      ctx.sfx('click');
    }
    // pointer: drag away from the shot to pull the cue back, release to strike; a plain tap aims there
    const ptr = inp.ptr ?? null;
    if (ptr) {
      if (ptr.down && !prevPtrDown) drag = { sx: ptr.x, sy: ptr.y, maxL: 0 };
      if (drag && ptr.down) {
        const dx = ptr.x - drag.sx, dy = ptr.y - drag.sy, L = Math.hypot(dx, dy);
        drag.maxL = Math.max(drag.maxL, L);
        if (L > 10) { aim = Math.atan2(-dy, -dx); power = clamp((L - 10) / 120, 0, 1); charging = false; latched = false; }
        else if (drag.maxL > 10) power = 0;
      }
      if (drag && !ptr.down) {
        const L = Math.hypot(ptr.x - drag.sx, ptr.y - drag.sy);
        const wasDrag = drag.maxL > 10;
        drag = null;
        prevPtrDown = false;
        if (wasDrag && L > 10) { shoot(aim, power); return; }
        if (!wasDrag) aimAt(ptr.x, ptr.y);
        else { power = 0; msg = ctx.t('Pukulan dibatalkan.'); }
      }
      prevPtrDown = ptr.down;
    } else {
      if (drag) { drag = null; power = 0; }
      prevPtrDown = false;
    }
    // a tap that started and ended between two frames never shows ptr.down
    if (inp.tap && !drag && !(ptr && ptr.down)) aimAt(inp.tap.x, inp.tap.y);
    const pad = inp.pad;
    if (!drag && pad) {
      padAim(dt, inp);
    } else if (!drag) {
      const mag = Math.hypot(inp.ax, inp.ay);
      const digital = (inp.ax === 0 || Math.abs(inp.ax) === 1) && (inp.ay === 0 || Math.abs(inp.ay) === 1);
      if (!digital && mag > 0.45) {
        // analog stick points straight at the shot direction
        const target = Math.atan2(inp.ay, inp.ax);
        aim += angDiff(target, aim) * Math.min(1, dt * 20 * mag);
        turnHold = 0;
      } else {
        const turn = (inp.down.right ? 1 : 0) - (inp.down.left ? 1 : 0);
        if (turn) {
          // slow for a precise nudge, then accelerates the longer it is held
          turnHold += dt;
          const k = Math.min(1, turnHold / 0.9);
          aim += turn * (0.25 + 2.6 * k * k) * dt;
          if (inp.hit.right || inp.hit.left) aim += turn * 0.004;
        } else turnHold = 0;
        const fine = (inp.down.down ? 1 : 0) - (inp.down.up ? 1 : 0);
        aim += fine * 0.07 * dt;
        if (inp.hit.down) aim += 0.0015;
        if (inp.hit.up) aim -= 0.0015;
      }
    }
    aim = angDiff(aim, 0);
    if (inp.hit.b && (charging || drag || trig.on)) {
      charging = false; latched = false; holdA = false; drag = null; power = 0;
      if (trig.on) trig = { on: false, peak: 0, hist: [], cancel: true };
      msg = ctx.t('Pukulan dibatalkan.'); ctx.sfx('back'); return;
    }
    if (inp.hit.x && !drag) { shoot(aim, MEDIUM); return; }
    if (drag) return;
    if (pad && !charging && triggerShot(dt, pad.r2)) return;
    if (trig.on) return;
    if (!charging) {
      if (inp.hit.a) { charging = true; holdA = true; latched = false; chargeT = 0; power = 0; powerDir = 1; ctx.sfx('tick'); msg = ctx.t('Tekan {a} lagi untuk memukul.', { a: ctx.key('a') }); }
      return;
    }
    chargeT += dt;
    power += powerDir * dt;
    if (power >= 1) { power = 1; powerDir = -1; }
    if (power <= 0) { power = 0; powerDir = 1; }
    if (inp.hit.a && !holdA) { shoot(aim, power); return; }
    if (holdA && !inp.down.a) {
      holdA = false;
      if (chargeT >= 0.3) shoot(aim, power);
      else latched = true;
    }
  };

  const update = (dt: number, inp: InputState) => {
    tickFx(dt);
    if (phase === 'over') {
      overT -= dt;
      if (overT <= 0 && !ended) { ended = true; ctx.end(result); }
      return;
    }
    time += dt;
    sfxGap = Math.max(0, sfxGap - dt);
    aBuf = Math.max(0, aBuf - dt);
    if (phase !== 'aim' && inp.hit.a) aBuf = 0.15;
    if (phase === 'aim' && time >= TIME_LIMIT) { judge(); return; }
    if (phase === 'pause') {
      pauseT -= dt;
      if (pauseT <= 0) startTurn();
      return;
    }
    if (phase === 'roll') {
      const ev: PhysEvent[] = [];
      physicsStep(balls, dt, ev);
      for (const e of ev) {
        if (e.kind === 'pocket') {
          pocketedNow.push(e.n);
          ctx.sfx('pocket');
          ctx.rumble(e.n === 0 ? 0.6 : 0.3, e.n === 0 ? 160 : 60);
          const b = balls.find((q) => q.n === e.n)!;
          if (e.n !== 0) floats.push({ x: b.x, y: b.y - 10, t: 0, s: e.n === 8 ? '8!' : '+1', c: PAL.gold });
          burst(b.x, b.y, 8, e.n === 0 ? '#ffffff' : ballColor(e.n), 70);
        } else if (e.kind === 'hit' && sfxGap <= 0 && e.v > 20) { ctx.sfx('ball', { gain: Math.min(1, e.v / 600), rate: 0.9 + Math.min(0.3, e.v / 3000) }); sfxGap = 0.03; }
        else if (e.kind === 'rail' && sfxGap <= 0 && e.v > 120) { ctx.sfx('thud', { gain: Math.min(0.5, e.v / 1500), rate: 1.6 }); sfxGap = 0.03; }
      }
      if (!moving(balls)) resolve();
      return;
    }
    if (rules.turn === 1) {
      cpu.t += dt;
      const d = angDiff(cpu.angle, aim);
      const stepA = 2.4 * dt;
      aim += Math.abs(d) <= stepA ? d : Math.sign(d) * stepA;
      if (cpu.t > 0.6 && Math.abs(angDiff(cpu.angle, aim)) < 1e-6) {
        charging = true;
        power = Math.min(cpu.power, power + dt / 0.9);
        if (power >= cpu.power && cpu.t > 1.0) shoot(cpu.angle, cpu.power);
      }
      return;
    }
    playerAim(dt, inp);
  };

  // ---------- drawing ----------
  const fit = (s: string, x: number, y: number, size: number, maxW: number, color: string) => {
    let sz = size;
    g.font = `700 ${sz}px 'Alegreya Sans', system-ui, sans-serif`;
    while (sz > 9 && g.measureText(s).width > maxW) { sz -= 1; g.font = `700 ${sz}px 'Alegreya Sans', system-ui, sans-serif`; }
    text(g, s, x, y, sz, color);
  };

  /** Spherical cap around body vector (px,py,pz) with half angle `a`, projected top-down. */
  // The cap's rim circle is sampled; rim points on the hidden half (z > 0) are
  // pushed out to the silhouette, which traces the visible outline closely.
  const cap = (x: number, y: number, r: number, px: number, py: number, pz: number, a: number, col: string) => {
    const sa = Math.sin(a), ca = Math.cos(a);
    if (pz > ca) return;
    // orthonormal u, v perpendicular to p
    let ux = -py, uy = px, uz = 0;
    let ul = Math.hypot(ux, uy);
    if (ul < 1e-4) { ux = 1; uy = 0; ul = 1; }
    ux /= ul; uy /= ul;
    const vx = py * uz - pz * uy, vy = pz * ux - px * uz, vz = px * uy - py * ux;
    const N = 20;
    let anyVisible = false;
    const pts: number[] = [];
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2, c1 = Math.cos(th) * sa, s1 = Math.sin(th) * sa;
      let qx = px * ca + ux * c1 + vx * s1, qy = py * ca + uy * c1 + vy * s1;
      const qz = pz * ca + uz * c1 + vz * s1;
      if (qz <= 0) anyVisible = true;
      else { const l = Math.hypot(qx, qy) || 1; qx /= l; qy /= l; }
      pts.push(x + qx * r, y + qy * r);
    }
    if (!anyVisible && -pz < ca) return;
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.closePath();
    g.fill();
  };

  const drawBall = (b: Pick<Ball, 'n' | 'x' | 'y' | 'px' | 'py' | 'pz'>, r = R, shadow = true) => {
    const { x, y, n } = b;
    if (shadow) {
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.beginPath(); g.ellipse(x + r * 0.28, y + r * 0.38, r * 1.02, r * 0.92, 0, 0, Math.PI * 2); g.fill();
    }
    g.save();
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
    g.fillStyle = n === 0 ? COL[0] : ballColor(n);
    g.fillRect(x - r, y - r, r * 2, r * 2);
    if (n >= 9) {
      // stripe = coloured band, white caps on both poles
      cap(x, y, r, b.px, b.py, b.pz, 0.82, COL[0]);
      cap(x, y, r, -b.px, -b.py, -b.pz, 0.82, COL[0]);
    }
    if (n === 0) {
      cap(x, y, r, b.px, b.py, b.pz, 0.22, '#c23b2b');
      cap(x, y, r, -b.px, -b.py, -b.pz, 0.22, '#c23b2b');
    } else {
      // number spot: on the pole for solids, on the band (point nearest the viewer) for stripes
      let qx = b.px, qy = b.py, qz = b.pz;
      if (n >= 9) {
        const ex = b.px * b.pz, ey = b.py * b.pz, ez = b.pz * b.pz - 1;
        const el = Math.hypot(ex, ey, ez);
        if (el > 1e-3) { qx = ex / el; qy = ey / el; qz = ez / el; } else { qx = -b.py; qy = b.px; qz = 0; }
      }
      cap(x, y, r, qx, qy, qz, 0.5, COL[0]);
      if (qz < -0.45) {
        const fs = (n >= 10 ? 5.2 : 6.2) * (r / R) * Math.min(1, -qz * 1.2);
        text(g, String(n), x + qx * r * 0.88, y + qy * r * 0.88 + 0.3, fs, '#1b1b1b');
      }
    }
    // shading, light from the top left
    const sh = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.05);
    sh.addColorStop(0, 'rgba(255,255,255,0)');
    sh.addColorStop(0.65, 'rgba(0,0,0,0.05)');
    sh.addColorStop(1, 'rgba(0,0,0,0.42)');
    g.fillStyle = sh;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    g.restore();
    const hx = x - r * 0.38, hy = y - r * 0.42;
    const sp = g.createRadialGradient(hx, hy, 0, hx, hy, r * 0.5);
    sp.addColorStop(0, 'rgba(255,255,255,0.95)');
    sp.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sp;
    g.beginPath(); g.arc(hx, hy, r * 0.5, 0, Math.PI * 2); g.fill();
  };

  const panel = (s: 0 | 1) => {
    const x = s === 0 ? 8 : 402;
    const active = rules.turn === s && phase !== 'over';
    if (active) { g.fillStyle = PAL.gold; roundRect(g, x - 3, 3, 236, 56, 12); }
    g.fillStyle = PAL.surface;
    roundRect(g, x, 6, 230, 50, 10);
    drawToken(g, s === 0 ? me : foe, x + 24, 32, 15, time, active);
    text(g, s === 0 ? ctx.t('Kamu') : foe.name, x + 46, 21, 16, PAL.ink, 'left');
    const gr = rules.groups[s];
    const label = gr === 'solid' ? ctx.t('Penuh (1-7)') : gr === 'stripe' ? ctx.t('Belang (9-15)') : ctx.t('Meja terbuka');
    text(g, label, x + 46, 42, 12, PAL.ink2, 'left', 600);
    if (gr) {
      const nums = gr === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
      nums.forEach((n, i) => {
        const b = balls.find((q) => q.n === n)!;
        g.globalAlpha = b.down ? 0.22 : 1;
        drawBall({ n, x: x + 140 + (i % 4) * 22, y: 21 + Math.floor(i / 4) * 20, px: 0, py: 0.15, pz: -0.99 }, R, false);
        g.globalAlpha = 1;
      });
    }
  };

  const drawTable = () => {
    const { x0, y0, x1, y1 } = TABLE;
    g.fillStyle = 'rgba(0,0,0,0.22)';
    roundRect(g, x0 - 22, y0 - 18, x1 - x0 + 50, y1 - y0 + 50, 16);
    const wood = g.createLinearGradient(0, y0 - 26, 0, y1 + 26);
    wood.addColorStop(0, '#8a5530'); wood.addColorStop(0.5, '#6b3f22'); wood.addColorStop(1, '#4e2d17');
    g.fillStyle = wood;
    roundRect(g, x0 - 26, y0 - 26, x1 - x0 + 52, y1 - y0 + 52, 16);
    // wood grain
    g.strokeStyle = 'rgba(255,220,170,0.14)';
    g.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const yt = y0 - 22 + i * 3.2, yb = y1 + 10 + i * 3;
      g.beginPath(); g.moveTo(x0 - 8, yt); g.bezierCurveTo(x0 + 120, yt + 1.5, x1 - 120, yt - 1.5, x1 + 8, yt); g.stroke();
      g.beginPath(); g.moveTo(x0 - 8, yb); g.bezierCurveTo(x0 + 140, yb - 1.2, x1 - 100, yb + 1.2, x1 + 8, yb); g.stroke();
    }
    g.fillStyle = 'rgba(255,230,190,0.18)';
    g.fillRect(x0 - 20, y0 - 25, x1 - x0 + 40, 2);
    // cushions
    g.fillStyle = '#1d5539';
    g.fillRect(x0 - 9, y0 - 9, x1 - x0 + 18, y1 - y0 + 18);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(x0 - 9, y0 - 9, x1 - x0 + 18, 3);
    // cloth with a soft vignette
    const cloth = g.createRadialGradient(MIDX, MIDY, 30, MIDX, MIDY, 300);
    cloth.addColorStop(0, '#3b9567'); cloth.addColorStop(0.7, '#2f7a55'); cloth.addColorStop(1, '#1f5a3e');
    g.fillStyle = cloth;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.strokeStyle = 'rgba(0,0,0,0.28)';
    g.lineWidth = 2;
    g.strokeRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2);
    g.fillStyle = '#efe2c2';
    for (let i = 1; i < 8; i++) {
      if (i === 4) continue;
      const dx = x0 + ((x1 - x0) * i) / 8;
      g.beginPath(); g.arc(dx, y0 - 17, 1.8, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(dx, y1 + 17, 1.8, 0, Math.PI * 2); g.fill();
    }
    for (let i = 1; i < 4; i++) {
      const dy = y0 + ((y1 - y0) * i) / 4;
      g.beginPath(); g.arc(x0 - 17, dy, 1.8, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(x1 + 17, dy, 1.8, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(255,255,255,0.13)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(HEAD.x, y0); g.lineTo(HEAD.x, y1); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.beginPath(); g.arc(FOOT.x, FOOT.y, 2, 0, Math.PI * 2); g.fill();
    for (const p of POCKETS) {
      g.fillStyle = '#3a2a1c';
      g.beginPath(); g.arc(p.x, p.y, p.r + 2.5, 0, Math.PI * 2); g.fill();
      const pg = g.createRadialGradient(p.x, p.y, 2, p.x, p.y, p.r);
      pg.addColorStop(0, '#050403'); pg.addColorStop(0.75, '#16110d'); pg.addColorStop(1, '#2b2119');
      g.fillStyle = pg;
      g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
    }
  };

  const drawCue = (cx: number, cy: number, a: number, back: number, alpha = 1) => {
    const dx = Math.cos(a), dy = Math.sin(a);
    const sx = cx - dx * (R + back), sy = cy - dy * (R + back);
    const L = 280;
    const ex = sx - dx * L, ey = sy - dy * L;
    g.globalAlpha = alpha;
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.22)';
    g.lineWidth = 6;
    g.beginPath(); g.moveTo(sx + 3, sy + 5); g.lineTo(ex + 3, ey + 5); g.stroke();
    g.lineWidth = 4.5; g.strokeStyle = '#d8b07a';
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.stroke();
    g.lineWidth = 6.5; g.strokeStyle = '#3a2414';
    g.beginPath(); g.moveTo(sx - dx * 175, sy - dy * 175); g.lineTo(ex, ey); g.stroke();
    g.strokeStyle = '#a34a27';
    g.beginPath(); g.moveTo(sx - dx * 172, sy - dy * 172); g.lineTo(sx - dx * 180, sy - dy * 180); g.stroke();
    g.lineWidth = 4; g.strokeStyle = '#f4f1ea';
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx - dx * 7, sy - dy * 7); g.stroke();
    g.strokeStyle = '#4f86b8';
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx - dx * 1.5, sy - dy * 1.5); g.stroke();
    g.lineCap = 'butt';
    g.globalAlpha = 1;
  };

  const drawAim = () => {
    const c = balls[0];
    const mine = rules.turn === 0;
    const ray = aimRay(balls, aim);
    g.strokeStyle = mine ? 'rgba(255,250,240,0.9)' : 'rgba(255,250,240,0.4)';
    g.lineWidth = 1.5;
    g.setLineDash([6, 4]);
    g.beginPath(); g.moveTo(c.x, c.y); g.lineTo(ray.x, ray.y); g.stroke();
    g.setLineDash([]);
    const dx = Math.cos(aim), dy = Math.sin(aim);
    if (ray.hit) {
      // ghost ball where the cue will touch, object path, cue path after contact
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.beginPath(); g.arc(ray.x, ray.y, R, 0, Math.PI * 2); g.fill(); g.stroke();
      const nx = ray.hit.x - ray.x, ny = ray.hit.y - ray.y, nl = Math.hypot(nx, ny) || 1;
      const ux = nx / nl, uy = ny / nl;
      const cos = clamp(dx * ux + dy * uy, 0, 1);
      g.strokeStyle = 'rgba(240,190,80,0.95)';
      g.lineWidth = 2;
      const oL = 18 + 70 * cos;
      g.beginPath(); g.moveTo(ray.hit.x, ray.hit.y); g.lineTo(ray.hit.x + ux * oL, ray.hit.y + uy * oL); g.stroke();
      let tx = dx - cos * ux, ty = dy - cos * uy;
      const k = mine ? SPIN_K[spin] : 0;
      tx += ux * cos * k * 0.8; ty += uy * cos * k * 0.8;
      const tl = Math.hypot(tx, ty);
      if (tl > 0.02) {
        const L = 40 * Math.max(0.35, tl);
        g.strokeStyle = 'rgba(190,225,255,0.85)';
        g.lineWidth = 1.5;
        g.setLineDash([3, 3]);
        g.beginPath(); g.moveTo(ray.x, ray.y); g.lineTo(ray.x + (tx / tl) * L, ray.y + (ty / tl) * L); g.stroke();
        g.setLineDash([]);
      }
    } else if (ray.rail) {
      const rx = ray.rail === 'x' ? -dx : dx, ry = ray.rail === 'y' ? -dy : dy;
      const r2 = aimRay(balls, Math.atan2(ry, rx), 90, { x: ray.x, y: ray.y });
      g.strokeStyle = 'rgba(255,250,240,0.45)';
      g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo(ray.x, ray.y); g.lineTo(r2.x, r2.y); g.stroke();
      g.setLineDash([]);
      g.beginPath(); g.arc(ray.x, ray.y, R, 0, Math.PI * 2); g.stroke();
    }
  };

  const render = () => {
    g.fillStyle = PAL.bg;
    g.fillRect(0, 0, w, h);
    panel(0);
    panel(1);
    text(g, ctx.t('Giliran {n}/40', { n: Math.min(MAX_SHOTS, shots + (phase === 'roll' ? 0 : 1)) }), w / 2, 20, 15, PAL.ink);
    const left = Math.max(0, TIME_LIMIT - time);
    text(g, `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`, w / 2, 42, 15, left < 60 ? PAL.red : PAL.ink2);
    g.save();
    if (shake > 0) g.translate(Math.sin(time * 90) * shake * 12, Math.cos(time * 77) * shake * 8);
    drawTable();
    for (const b of balls) {
      if (!b.down || b.fall <= 0) continue;
      const k = b.fall / FALL_T;
      g.globalAlpha = 0.25 + 0.75 * k;
      drawBall(b, R * (0.4 + 0.6 * k), false);
      g.globalAlpha = 1;
    }
    for (const b of balls) if (!b.down) drawBall(b);
    const c = balls[0];
    if (phase === 'aim' && !c.down) {
      drawAim();
      drawCue(c.x, c.y, aim, 4 + power * 46);
    }
    if (stroke) {
      // snap forward through the cue ball, follow through, then fade
      const t = stroke.t;
      const back = t < 0.05 ? stroke.pull * (1 - t / 0.05) ** 2 + 4 * (t / 0.05) : 4 - Math.min(1, (t - 0.05) / 0.1) * 14;
      drawCue(stroke.x, stroke.y, stroke.a, back, t < 0.2 ? 1 : Math.max(0, 1 - (t - 0.2) / 0.25));
    }
    for (const s of sparks) {
      g.globalAlpha = Math.max(0, 1 - s.t / s.life);
      g.fillStyle = s.c;
      g.beginPath(); g.arc(s.x, s.y, 1.6, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    for (const f of floats) {
      g.globalAlpha = Math.max(0, 1 - f.t);
      text(g, f.s, f.x, f.y - f.t * 22, 14, f.c);
    }
    g.globalAlpha = 1;
    g.restore();
    // footer: power meter, english, message
    g.fillStyle = PAL.surface;
    roundRect(g, 8, 362, 624, 32, 10);
    text(g, ctx.t('Tenaga'), 20, 378, 14, PAL.ink, 'left');
    g.fillStyle = PAL.sand;
    roundRect(g, 72, 371, 130, 14, 7);
    if (power > 0) {
      const pg = g.createLinearGradient(72, 0, 202, 0);
      pg.addColorStop(0, PAL.green); pg.addColorStop(0.55, PAL.gold); pg.addColorStop(1, PAL.red);
      g.fillStyle = pg;
      roundRect(g, 72, 371, Math.max(14, 130 * power), 14, 7);
    }
    g.fillStyle = 'rgba(29,42,35,0.4)';
    g.fillRect(72 + 130 * MEDIUM - 0.5, 369, 1, 18);
    const ix = 222, iy = 378;
    g.fillStyle = '#fbf6ea';
    g.strokeStyle = PAL.ink2;
    g.lineWidth = 1;
    g.beginPath(); g.arc(ix, iy, 9, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = PAL.red;
    g.beginPath(); g.arc(ix, iy + (spin === 'top' ? -5 : spin === 'back' ? 5 : 0), 2.6, 0, Math.PI * 2); g.fill();
    const spinLabel = spin === 'top' ? ctx.t('Efek: atas') : spin === 'back' ? ctx.t('Efek: bawah') : ctx.t('Efek: tengah');
    text(g, spinLabel, 236, 378, 12, PAL.ink2, 'left', 600);
    if (msg) fit(msg, 472, 378, 14, 300, phase === 'over' ? PAL.accent : PAL.ink);
    if (phase === 'over') {
      g.fillStyle = 'rgba(29,42,35,0.82)';
      roundRect(g, 130, 168, 380, 84, 14);
      fit(banner, w / 2, 196, 18, 350, '#fffaf0');
      text(g, ctx.t('Skor: {n} poin', { n: result.score }), w / 2, 226, 16, PAL.gold);
    }
  };

  return {
    update,
    render,
    snapshot: () => ({
      phase, turn: rules.turn, shots, time: Math.round(time * 100) / 100, groups: [...rules.groups], winner: rules.winner,
      aim, power, powerDir, charging, latched, dragging: !!drag, trigger: trig.on, spin, hint: { ...hint }, foe: foe.name, fouls,
      cue: { x: balls[0].x, y: balls[0].y, vx: balls[0].vx, vy: balls[0].vy },
      mine: downOf(rules.groups[0]), theirs: downOf(rules.groups[1]),
      down: balls.filter((b) => b.down).map((b) => b.n), score: result.score,
    }),
  };
}

export default { meta, create } satisfies GameModule;
