// Biliar 8-Ball (billiard table, L2-BILLIARD). Top-down eight ball against a
// CPU teammate, or two local players taking turns (v2.4).
// Physics: every ball carries its linear velocity (vx, vy) and the surface
// speed of its spin (wx, wy). While the two differ the ball slides and cloth
// friction pulls them together (5/2 ratio of a solid sphere); once equal it
// rolls with a small rolling resistance. Ball to ball contacts are frictionless
// equal-mass impulses, so a stun shot stops dead and top/back spin makes the
// cue ball follow or draw afterwards. Side spin (english) is a separate scalar:
// it throws the ball sideways off each cushion and fades while it runs.
// At least 8 sub-steps per frame and never more than 0.4 R of travel per
// sub-step, so nothing tunnels.
// Rules: WPA eight ball, simplified. No safeties or push outs, the 8's pocket
// is called automatically from the aim line, the break never assigns groups.
import type { CastMember, GameCtx, GameInstance, GameModule, GameResult, InputState, LegendKey } from '../types';
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
/** Camera stick at full tilt turns the cue this many rad/s (about 23 degrees). */
export const PAD_TURN = 0.4;
/** L2 held divides every pad turn rate by this. */
export const PAD_FINE = 8;
/** Tip offset limit in ball radii; further out a real cue miscues. */
export const SPIN_MAX = 0.8;
/** Spin dot speed at full stick tilt or a held arrow, ball radii per second. */
export const SPIN_RATE = 1.6;
/** Spin surface speed per unit of vertical tip offset, as a fraction of the cue speed. */
export const SPIN_K = 1.05;
/** Cue ball deflection (rad) at full side spin, away from the side the tip hit. */
export const SQUIRT = 0.02;
/** Tangential cushion kick at full side spin, as a fraction of the impact speed. */
export const ENGLISH = 0.4;
/** Side spin fades at this rate (1/s) while the ball runs. */
const SIDE_DECAY = 0.5;
/** Spin widget in the bottom bar: centre and radius (one ball radius on screen). */
export const SPIN_UI = { x: 222, y: 378, r: 12 };
/** Ball in hand moves this fast with the arrows or the stick. */
const HAND_SPEED = 200;
const STOP = 2;
const FALL_T = 0.32;

export type Group = 'solid' | 'stripe';
/** Tip offset from the cue ball centre in ball radii: x to the shooter's right, y up (top spin). */
export interface Spin { x: number; y: number }
export const CENTER: Spin = { x: 0, y: 0 };
export interface Ball {
  n: number; x: number; y: number; vx: number; vy: number;
  /** Surface speed of the spin; equals (vx, vy) when the ball rolls cleanly. */
  wx: number; wy: number;
  /** Spin about the vertical axis, as the tip offset that made it (positive = right english). */
  side: number;
  down: boolean;
  /** Body-fixed pole (unit vector) carrying the number spot and stripe caps; z points into the table. */
  px: number; py: number; pz: number;
  /** Seconds left of the drop-into-pocket animation. */
  fall: number;
}
export type PhysEvent = { kind: 'pocket'; n: number; p: number; v: number } | { kind: 'hit'; a: number; b: number; v: number } | { kind: 'rail'; n: number; v: number };
export interface Rules { turn: 0 | 1; groups: (Group | null)[]; winner: 0 | 1 | null }

export const groupOf = (n: number): Group | null => (n >= 1 && n <= 7 ? 'solid' : n >= 9 && n <= 15 ? 'stripe' : null);
const other = (gr: Group): Group => (gr === 'solid' ? 'stripe' : 'solid');
const speedOf = (b: Ball) => Math.hypot(b.vx, b.vy);
export const angDiff = (a: number, b: number) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Keep a spin offset inside the legal tip circle. */
export const clampSpin = (x: number, y: number): Spin => { const m = Math.hypot(x, y); const k = m > SPIN_MAX ? SPIN_MAX / m : 1; return { x: x * k, y: y * k }; };

export function makeBall(n: number, x: number, y: number, vx = 0, vy = 0, rolling = false): Ball {
  return { n, x, y, vx, vy, wx: rolling ? vx : 0, wy: rolling ? vy : 0, side: 0, down: false, px: 0, py: 0, pz: -1, fall: 0 };
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

/** Index of the pocket that swallows this ball, or -1. Past the cushion line the mouth is a little wider. */
function pocketAt(b: Ball) {
  const { x0, y0, x1, y1 } = TABLE;
  const beyond = b.x < x0 || b.x > x1 || b.y < y0 || b.y > y1;
  return POCKETS.findIndex((p) => { const d = Math.hypot(b.x - p.x, b.y - p.y); return d < p.r || (beyond && d < p.r + R * 0.9); });
}
const inMouth = (b: Ball) => POCKETS.some((p) => Math.hypot(b.x - p.x, b.y - p.y) < p.r + R * 0.9);

/**
 * Cushion contact. Side spin grips the rubber: the kick runs along the
 * cushion, to the right of the approach for right english, so a ball that
 * already runs that way speeds up (running) and one coming the other way
 * checks up (reverse). The cushion takes half the side spin.
 */
function rail(b: Ball, axis: 'x' | 'y', wall: number, sign: 1 | -1, ev: PhysEvent[]) {
  const v = axis === 'x' ? b.vx : b.vy;
  if (axis === 'x') b.x = wall; else b.y = wall;
  if (v * sign <= 0) return;
  ev.push({ kind: 'rail', n: b.n, v: Math.abs(v) });
  const kick = ((ENGLISH * b.side) / SPIN_MAX) * Math.abs(v);
  // tangent (-ny, nx) of the outward normal: right of a ball heading into this cushion
  if (axis === 'x') { b.vx = -b.vx * E_RAIL; b.vy = b.vy * 0.96 + sign * kick; b.wx = -b.wx * 0.4; b.wy += sign * kick; }
  else { b.vy = -b.vy * E_RAIL; b.vx = b.vx * 0.96 - sign * kick; b.wy = -b.wy * 0.4; b.wx -= sign * kick; }
  b.side *= 0.5;
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
      const pi = pocketAt(b);
      if (pi >= 0) {
        const p = POCKETS[pi];
        const v = speedOf(b);
        b.down = true; b.fall = FALL_T;
        b.vx = (p.x - b.x) / FALL_T + b.vx * 0.04; b.vy = (p.y - b.y) / FALL_T + b.vy * 0.04;
        b.wx = 0; b.wy = 0; b.side = 0;
        ev.push({ kind: 'pocket', n: b.n, p: pi, v });
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
      if (b.side) b.side = Math.abs(b.side) < 1e-3 ? 0 : b.side * (1 - SIDE_DECAY * h);
      if (Math.abs(b.vx) + Math.abs(b.vy) < STOP && Math.abs(b.wx) + Math.abs(b.wy) < STOP) { b.vx = b.vy = b.wx = b.wy = 0; b.side = 0; }
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

/**
 * Pocket called for the 8 on this aim: the one closest to the line the 8
 * leaves along when the cue hits it straight, else the pocket nearest the 8.
 */
export function calledPocket(balls: Ball[], angle: number): number | null {
  const e = balls.find((b) => b.n === 8 && !b.down);
  if (!e) return null;
  const near = () => POCKETS.reduce((bi, p, i) => (Math.hypot(p.x - e.x, p.y - e.y) < Math.hypot(POCKETS[bi].x - e.x, POCKETS[bi].y - e.y) ? i : bi), 0);
  const ray = aimRay(balls, angle);
  if (ray.hit !== e) return near();
  const L = Math.hypot(e.x - ray.x, e.y - ray.y) || 1;
  const ux = (e.x - ray.x) / L, uy = (e.y - ray.y) / L;
  let best = -1, off = Infinity;
  POCKETS.forEach((p, i) => {
    const along = (p.x - e.x) * ux + (p.y - e.y) * uy;
    const side = Math.abs((p.x - e.x) * uy - (p.y - e.y) * ux);
    if (along > 0 && side < off) { off = side; best = i; }
  });
  return best >= 0 ? best : near();
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

/**
 * Put the cue ball in motion. Vertical tip offset becomes top or back spin,
 * side offset becomes english and pushes the ball slightly the other way (squirt).
 */
export function strike(c: Ball, angle: number, power: number, spin: Spin = CENTER) {
  const v = speedFor(power);
  const a = angle - (spin.x / SPIN_MAX) * SQUIRT;
  c.vx = Math.cos(a) * v; c.vy = Math.sin(a) * v;
  c.wx = c.vx * spin.y * SPIN_K; c.wy = c.vy * spin.y * SPIN_K;
  c.side = spin.x;
}

/** Play a shot on a copy of the table; returns the balls sunk in order. */
export function simulate(balls: Ball[], angle: number, power: number, spin: Spin = CENTER, maxT = 9): number[] {
  const copy = balls.map((b) => ({ ...b }));
  strike(copy[0], angle, power, spin);
  const ev: PhysEvent[] = [];
  for (let t = 0; t < maxT && moving(copy); t += 1 / 30) physicsStep(copy, 1 / 30, ev);
  return ev.filter((e): e is Extract<PhysEvent, { kind: 'pocket' }> => e.kind === 'pocket').map((e) => e.n);
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

/** What happened during one shot, collected from the physics events. */
export interface Shot {
  brk: boolean;
  /** First ball the cue ball touched. */
  first: number | null;
  /** Some ball touched a cushion after that first contact. */
  railAfter: boolean;
  /** Object balls that touched a cushion (break rule). */
  railBalls: number[];
  /** Balls sunk, in order. */
  pocketed: number[];
  /** Pocket index the 8 dropped in, and the one called for it. */
  eightPocket: number | null;
  called: number | null;
}
export const newShot = (brk = false): Shot => ({ brk, first: null, railAfter: false, railBalls: [], pocketed: [], eightPocket: null, called: null });
export type Foul = 'cue' | 'none' | 'wrong' | 'eight' | 'rail' | 'break';
export interface Outcome {
  foul: Foul | null;
  keep: boolean;
  assigned: Group | null;
  /** The 8 went down: 'break' = respot and play on, the rest end the game. */
  eight: 'win' | 'early' | 'foul' | 'pocket' | 'break' | null;
}
const offTable = (b: Ball) => !b.down && (b.x < TABLE.x0 || b.x > TABLE.x1 || b.y < TABLE.y0 || b.y > TABLE.y1);

/**
 * Eight ball rules, applied once the balls stop. Mutates `rules` (turn,
 * groups, winner). `balls` is the state after the shot.
 */
export function resolveShot(rules: Rules, shot: Shot, balls: Ball[]): Outcome {
  const s = rules.turn;
  const o = (1 - s) as 0 | 1;
  const { pocketed, first } = shot;
  const gr = rules.groups[s];
  // cleared before this shot: balls sunk on it still count as on the table
  const cleared = !!gr && balls.every((b) => groupOf(b.n) !== gr || (b.down && !pocketed.includes(b.n)));
  const objs = pocketed.filter((n) => n !== 0 && n !== 8);
  let foul: Foul | null = null;
  if (pocketed.includes(0) || offTable(balls[0])) foul = 'cue';
  else if (first === null) foul = 'none';
  else if (shot.brk) { if (!pocketed.length && shot.railBalls.length < 4) foul = 'break'; }
  else if (first === 8 && !cleared) foul = 'eight';
  else if (gr && (cleared ? first !== 8 : groupOf(first) !== gr)) foul = 'wrong';
  else if (!shot.railAfter && !pocketed.length) foul = 'rail';
  let eight: Outcome['eight'] = null;
  if (pocketed.includes(8)) {
    if (shot.brk) eight = 'break';
    else {
      eight = !cleared ? 'early' : foul ? 'foul' : shot.eightPocket !== shot.called ? 'pocket' : 'win';
      rules.winner = eight === 'win' ? s : o;
      return { foul, keep: false, assigned: null, eight };
    }
  }
  let assigned: Group | null = null;
  // the table stays open after the break; the first legal pot picks the groups
  if (!foul && !shot.brk && !gr && objs.length) {
    assigned = groupOf(objs[0])!;
    rules.groups[s] = assigned;
    rules.groups[o] = other(assigned);
  }
  const mine = rules.groups[s];
  const keep = !foul && (shot.brk ? pocketed.length > 0 : !!mine && objs.some((n) => groupOf(n) === mine));
  if (!keep) rules.turn = o;
  return { foul, keep, assigned, eight };
}

/** A legal ball in hand spot: on the cloth, out of the pocket mouths, touching no ball. */
export function handOk(balls: Ball[], x: number, y: number, behind: boolean): boolean {
  const { x0, y0, x1, y1 } = TABLE;
  if (x < x0 + R || x > (behind ? HEAD.x : x1 - R) || y < y0 + R || y > y1 - R) return false;
  if (POCKETS.some((p) => Math.hypot(x - p.x, y - p.y) < p.r + R)) return false;
  return balls.every((b) => b.n === 0 || b.down || Math.hypot(b.x - x, b.y - y) >= 2 * R);
}

/** Computer's ball in hand: the grid point that leaves the easiest pot. */
export function bestSpot(balls: Ball[], targets: number[], behind: boolean): { x: number; y: number } | null {
  const { x0, y0, x1, y1 } = TABLE;
  let best: { x: number; y: number } | null = null;
  let top = -Infinity;
  for (let x = x0 + R + 6; x <= (behind ? HEAD.x : x1 - R); x += 22) {
    for (let y = y0 + R + 6; y <= y1 - R; y += 22) {
      if (!handOk(balls, x, y, behind)) continue;
      const c = candidates([{ ...balls[0], x, y, down: false }, ...balls.slice(1)], targets)[0];
      const sc = c ? c.score : -1;
      if (sc > top) { top = sc; best = { x, y }; }
    }
  }
  return best;
}

/** Cue back on the table at the head spot, or the nearest free spot behind it. */
export function respotCue(balls: Ball[]) {
  const c = balls[0];
  c.down = false; c.fall = 0; c.vx = c.vy = c.wx = c.wy = 0; c.side = 0;
  const free = (x: number, y: number) => balls.every((b) => b === c || b.down || Math.hypot(b.x - x, b.y - y) >= 2 * R + 1);
  for (let k = 0; k < 40; k++) {
    const dy = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (2 * R + 2);
    const dx = -Math.floor(k / 12) * (2 * R + 2);
    if (free(HEAD.x + dx, HEAD.y + dy)) { c.x = HEAD.x + dx; c.y = HEAD.y + dy; return; }
  }
  c.x = HEAD.x; c.y = HEAD.y;
}

/** 8 sunk on the break: back on the foot spot, or the nearest free point on the long string. */
export function respotEight(balls: Ball[]) {
  const e = balls.find((b) => b.n === 8)!;
  e.down = false; e.fall = 0; e.vx = e.vy = e.wx = e.wy = 0; e.side = 0;
  const free = (x: number) => balls.every((b) => b === e || b.down || Math.hypot(b.x - x, b.y - FOOT.y) >= 2 * R);
  for (let k = 0; k < TABLE.x1 - TABLE.x0; k++) {
    for (const x of [FOOT.x + k, FOOT.x - k]) {
      if (x > TABLE.x0 + R && x < TABLE.x1 - R && free(x)) { e.x = x; e.y = FOOT.y; return; }
    }
  }
}

const COL = ['#fbf6ea', '#e8b923', '#2f5fa8', '#c23b2b', '#6a3f9a', '#e07a2b', '#2f7d4a', '#7d2a2a', '#1b1b1b'];
const ballColor = (n: number) => COL[n <= 8 ? n : n - 8];
/** HUD names for the spin dot, [vertical][horizontal] with bawah/tengah/atas and kiri/tengah/kanan. */
const SPIN_NAMES = [
  ['Efek: bawah kiri', 'Efek: bawah', 'Efek: bawah kanan'],
  ['Efek: kiri', 'Efek: tengah', 'Efek: kanan'],
  ['Efek: atas kiri', 'Efek: atas', 'Efek: atas kanan'],
];
export const spinName = (sp: Spin) => SPIN_NAMES[(sp.y > 0.15 ? 1 : sp.y < -0.15 ? -1 : 0) + 1][(sp.x > 0.15 ? 1 : sp.x < -0.15 ? -1 : 0) + 1];

const meta: GameModule['meta'] = {
  id: 'biliar', title: 'Biliar 8-Ball', place: 'billiard_table', music: 'lounge',
  blurb: '8-ball tampak atas melawan rekan tim. Masukkan semua bolamu, lalu bola 8.',
  tutorial: [
    'Putar bidikan dengan {lr} (tahan = makin cepat), {ud} untuk putar halus.',
    'Tekan {a}: meter tenaga berayun. Tekan {a} lagi untuk pukul.',
    'Tahan {y} lalu {arah} untuk geser titik efek. Ketuk {y}: efek ke tengah.',
  ],
  legend: [['lr', 'Bidik'], ['ud', 'Bidik halus'], ['a', 'Tenaga / pukul'], ['x', 'Pukul sedang'], ['y', 'Atur efek'], ['b', 'Batal']],
  // DualSense: analog aim tuned for the pad, trigger for power, Y + stick for spin.
  padTutorial: [
    'Arahkan {ls} ke tujuan untuk bidik kasar, lalu {rs} kiri/kanan untuk bidik halus.',
    'Tahan {l2}: {rs} 8 kali lebih pelan. Tahan {y} lalu geser {rs} untuk efek.',
    'Tarik {r2}: makin dalam makin kuat, lepas untuk pukul. Atau {a} untuk meter tenaga.',
  ],
  padLegend: [['ls', 'Bidik'], ['rs', 'Bidik halus'], ['l2', 'Presisi'], ['r2', 'Tarik lalu lepas'], ['a', 'Meter tenaga'], ['y', 'Atur efek'], ['b', 'Batal']],
  padActions: {
    ls: 'Tunjuk arah bidikan. Bola di tangan: geser bola putih',
    rs: 'Putar bidikan halus. Saat tombol efek ditahan: geser titik efek',
    l2: 'Tahan: bidik presisi, 8 kali lebih pelan',
    r2: 'Tarik untuk tenaga, lepas untuk pukul',
  },
  actions: {
    left: 'Putar bidikan ke kiri (tahan = cepat)',
    right: 'Putar bidikan ke kanan (tahan = cepat)',
    up: 'Putar halus',
    down: 'Putar halus arah sebaliknya',
    a: 'Meter tenaga, pukul, atau taruh bola putih',
    b: 'Batal pukul',
    x: 'Pukul tenaga sedang',
    y: 'Tahan lalu arah: geser titik efek. Ketuk: efek ke tengah',
  },
  pointerHint: 'Ketuk satu titik untuk membidik ke situ. Seret menjauhi arah tembak untuk menarik tongkat, lepas untuk pukul. Ketuk bola putih kecil di bawah untuk efek.',
  view: { w: 640, h: 400 }, score: { unit: 'poin', higherIsBetter: true },
  touch: ['left', 'right', 'up', 'down', 'a', 'b', 'x', 'y'],
  players: 2,
  playersHint: 'Bareng: 2 pemain bergantian. Tanpa Pemain 2 lawannya komputer.',
  hotseat: true,
};

interface Spark { x: number; y: number; vx: number; vy: number; t: number; life: number; c: string }
interface Float { x: number; y: number; t: number; s: string; c: string }

function create(ctx: GameCtx): GameInstance {
  const { g, w, h } = ctx;
  // Two humans share the table; Pemain 2 reads input.players[1] (the same object on one device).
  const versus = ctx.players >= 2;
  const me = ctx.cast.find((c) => c.id === ctx.playerId) ?? ctx.cast[0];
  const pool = ctx.cast.filter((c) => c.id !== 'CH-CEO');
  const foe: CastMember = pool[Math.floor(ctx.rand() * pool.length)] ?? me;
  const skill = 0.008 + ctx.rand() * 0.016;
  const balls = rack(ctx.rand);
  const rules: Rules = { turn: 0, groups: [null, null], winner: null };
  let phase: 'aim' | 'place' | 'roll' | 'pause' | 'over' = 'aim';
  let aim = 0;
  let power = 0;
  let powerDir = 1;
  let charging = false;
  let latched = false;
  let holdA = false;
  let chargeT = 0;
  let turnHold = 0;
  // each seat keeps its own tip position between turns
  const spins: Spin[] = [{ ...CENTER }, { ...CENTER }];
  let yHold: { t: number; moved: boolean } | null = null;
  let spinDrag = false;
  let handDrag = false;
  let hand: { behind: boolean } | null = null;
  let cpuPlace: { x: number; y: number; t: number } | null = null;
  let aBuf = 0;
  let drag: { sx: number; sy: number; maxL: number } | null = null;
  // R2 shot: power follows the trigger; releasing shoots with the strongest
  // pull of the last moment, so easing off on the way out does not weaken it.
  let trig = { on: false, peak: 0, hist: [] as number[], cancel: false };
  let prevPtrDown = false;
  let sameDevice = true;
  let cpu = { angle: 0, power: 0.5, t: 0 };
  let hint = { angle: 0, power: 1 };
  let shots = 0;
  let time = 0;
  let pauseT = 0;
  let overT = 0;
  let ended = false;
  let shot: Shot = newShot(true);
  let lastFoul: Foul | null = null;
  let msg = '';
  let banner = '';
  let notice = { s: '', t: 0 };
  const gap: Record<string, number> = {};
  let fouls = 0;
  let shake = 0;
  let stroke: { x: number; y: number; a: number; pull: number; t: number } | null = null;
  const sparks: Spark[] = [];
  const floats: Float[] = [];
  let result: GameResult = { score: 0, summary: '', won: false };
  const cpuTurn = () => !versus && rules.turn === 1;
  const nameOf = (s: 0 | 1) => (versus ? (s === 0 ? ctx.t('Pemain 1') : ctx.t('Pemain 2')) : s === 0 ? ctx.t('Kamu') : foe.name);
  // Pemain 2 on a pad of their own sees pad glyphs; on one shared device the key of that device
  const key = (k: LegendKey) => ctx.key(k, versus && rules.turn === 1 && !sameDevice);
  const downOf = (gr: Group | null) => (gr ? balls.filter((b) => b.down && groupOf(b.n) === gr).length : 0);
  const onEight = (s: 0 | 1) => { const gr = rules.groups[s]; return !!gr && balls.every((b) => groupOf(b.n) !== gr || b.down); };
  const hud = () => ctx.setHud(ctx.t('{p1} {a} · {p2} {b} · Giliran {n}/40', { p1: nameOf(0), a: downOf(rules.groups[0]), p2: nameOf(1), b: downOf(rules.groups[1]), n: Math.min(MAX_SHOTS, shots + 1) }));

  /** Impact sounds: louder and brighter with speed, at most one of each name per 30 ms. */
  const sound = (name: string, v: number) => {
    if ((gap[name] ?? 0) > 0) return;
    gap[name] = 0.03;
    const k = Math.min(1, v / 900);
    ctx.sfx(name, { gain: 0.2 + 0.8 * k, rate: 0.9 + 0.25 * k });
  };

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

  const beginAim = () => {
    phase = 'aim';
    const p = shotPlan(rules.turn);
    hint = { angle: p.angle, power: p.power };
    if (cpuTurn()) {
      const errA = (ctx.rand() + ctx.rand() - 1) * skill * 2;
      cpu = { angle: p.angle + errA, power: clamp(p.power * (0.94 + ctx.rand() * 0.14), 0.15, 1), t: 0 };
      msg = ctx.t('{name} membidik...', { name: foe.name });
    } else {
      if (!msg) msg = versus ? ctx.t('Giliran {name}.', { name: nameOf(rules.turn) }) : ctx.t('Giliranmu. Bidik lalu pukul.');
      // A pressed just before the turn opened: start the swinging meter right away
      if (aBuf > 0) { charging = true; latched = true; powerDir = 1; aBuf = 0; }
    }
    hud();
  };

  const startTurn = () => {
    power = 0; charging = false; latched = false; holdA = false; chargeT = 0; drag = null; yHold = null; spinDrag = false; handDrag = false;
    // R2 counts only after it was seen released this turn: a trigger still
    // held from the last shot (or pulled during the roll) never fires at once
    trig = { on: false, peak: 0, hist: [], cancel: true };
    if (!hand) { beginAim(); return; }
    phase = 'place';
    if (cpuTurn()) {
      const spot = bestSpot(balls, targetsFor(rules, 1, balls), hand.behind) ?? { x: balls[0].x, y: balls[0].y };
      cpuPlace = { ...spot, t: 0 };
      msg = ctx.t('{name} menaruh bola putih...', { name: foe.name });
    } else msg = ctx.t('{name}: bola di tangan. Geser, lalu {a}.', { name: nameOf(rules.turn), a: key('a') });
    hud();
  };

  /** Ball in hand confirmed: only on a legal spot. */
  const confirmPlace = (): boolean => {
    const c = balls[0];
    if (!hand || !handOk(balls, c.x, c.y, hand.behind)) { msg = ctx.t('Tidak bisa ditaruh di sini.'); ctx.sfx('wrong'); return false; }
    hand = null;
    msg = '';
    ctx.sfx('click');
    beginAim();
    return true;
  };

  const shoot = (angle: number, p: number) => {
    const c = balls[0];
    const pw = clamp(p, 0.02, 1);
    const human = !cpuTurn();
    shot = newShot(shots === 0);
    shot.called = onEight(rules.turn) ? calledPocket(balls, angle) : null;
    strike(c, angle, pw, human ? spins[rules.turn] : CENTER);
    stroke = { x: c.x, y: c.y, a: angle, pull: 8 + pw * 46, t: 0 };
    aim = angle;
    shots++;
    phase = 'roll';
    charging = false; latched = false; holdA = false; drag = null; yHold = null;
    power = pw;
    msg = '';
    ctx.sfx('clack', { gain: 0.35 + pw * 0.65, rate: 0.9 + pw * 0.25 });
    gap.clack = 0.03;
    burst(c.x - Math.cos(angle) * R, c.y - Math.sin(angle) * R, 5, '#9fc6e8', 50);
    if (pw > 0.85 && !ctx.reducedMotion) shake = 0.12;
    // rumble reaches Pemain 1's pad only, which Pemain 2 also holds on one device
    if (human && (rules.turn === 0 || sameDevice)) ctx.rumble(0.25 + pw * 0.75, 70 + pw * 90);
  };

  const finish = (won: boolean | null, reason: string) => {
    const a = downOf(rules.groups[0]), b = downOf(rules.groups[1]);
    if (versus) {
      const summary = won === null ? ctx.t('Seri. Bola masuk {a} lawan {b}.', { a, b })
        : ctx.t('{name} menang. Bola masuk {a} lawan {b}.', { name: nameOf(won ? 0 : 1), a, b });
      result = { score: 0, versus: true, won: !!won, summary };
    } else {
      const summary = won ? ctx.t('Menang melawan {name}! {n} bola masuk.', { name: foe.name, n: a })
        : won === null ? ctx.t('Seri melawan {name}. {n} bola masuk.', { name: foe.name, n: a })
          : ctx.t('Kalah dari {name}. {n} bola masuk.', { name: foe.name, n: a });
      result = { score: a * 100 + (won ? 1000 : 0), summary, won: !!won };
    }
    banner = reason;
    msg = result.summary ?? '';
    phase = 'over';
    overT = 1.8;
    ctx.sfx(won || versus ? 'win' : 'lose');
    hud();
  };

  const judge = () => {
    const a = downOf(rules.groups[0]), b = downOf(rules.groups[1]);
    finish(a > b ? true : a < b ? false : null, ctx.t('Batas tercapai: dinilai dari sisa bola'));
  };

  const foulText = (f: Foul) => (f === 'cue' ? ctx.t('Foul: bola putih masuk.')
    : f === 'none' ? ctx.t('Foul: tidak ada bola yang kena.')
      : f === 'wrong' ? ctx.t('Foul: bola lawan kena duluan.')
        : f === 'eight' ? ctx.t('Foul: bola 8 kena duluan.')
          : f === 'rail' ? ctx.t('Foul: tidak ada bola menyentuh bantalan.')
            : ctx.t('Foul: break kurang dari 4 bola ke bantalan.'));

  const resolve = () => {
    const s = rules.turn;
    const out = resolveShot(rules, shot, balls);
    lastFoul = out.foul;
    if (rules.winner !== null) {
      const name = nameOf(s);
      const why = out.eight === 'win' ? ctx.t('{name} memasukkan bola 8 dan menang.', { name })
        : out.eight === 'early' ? ctx.t('{name} memasukkan bola 8 terlalu awal', { name })
          : out.eight === 'foul' ? ctx.t('{name} foul saat bola 8 masuk', { name })
            : ctx.t('{name}: bola 8 masuk lubang lain', { name });
      if (out.foul) notice = { s: foulText(out.foul), t: 2.4 };
      finish(rules.winner === 0, why);
      return;
    }
    if (out.eight === 'break') respotEight(balls);
    if (out.foul) {
      fouls++;
      const behind = shot.brk;
      if (balls[0].down || !handOk(balls, balls[0].x, balls[0].y, behind)) respotCue(balls);
      hand = { behind };
      notice = { s: foulText(out.foul), t: 2.4 };
      msg = ctx.t('{name} dapat bola di tangan.', { name: nameOf(rules.turn) });
      ctx.sfx('wrong');
    } else if (out.assigned) {
      msg = out.assigned === 'solid' ? ctx.t('{name} main bola penuh (1-7).', { name: nameOf(s) }) : ctx.t('{name} main bola belang (9-15).', { name: nameOf(s) });
      ctx.sfx('right');
    } else if (out.eight === 'break') msg = ctx.t('Bola 8 masuk saat break, ditaruh lagi. {name} lanjut.', { name: nameOf(s) });
    else if (out.keep) msg = ctx.t('Masuk! {name} lanjut.', { name: nameOf(s) });
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
    notice.t = Math.max(0, notice.t - dt);
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

  // a little larger than the drawing for fingers, but clear of the table frame above it
  const onWidget = (x: number, y: number) => Math.hypot(x - SPIN_UI.x, y - SPIN_UI.y) < SPIN_UI.r * 1.5;
  const spinAt = (x: number, y: number) => { spins[rules.turn] = clampSpin((x - SPIN_UI.x) / SPIN_UI.r, -(y - SPIN_UI.y) / SPIN_UI.r); };

  /**
   * Y held: the arrows or the camera stick move the tip, speed by tilt, and
   * the aim stays put. A short tap with no movement puts the tip back in the
   * centre. Returns true while Y is held.
   */
  const spinInput = (dt: number, inp: InputState): boolean => {
    if (!inp.down.y) {
      if (yHold && yHold.t < 0.25 && !yHold.moved) { spins[rules.turn] = { ...CENTER }; ctx.sfx('click'); }
      yHold = null;
      return false;
    }
    if (!yHold) {
      yHold = { t: 0, moved: false };
      // a trigger pull in progress must not fire once Y is let go
      if (trig.on) { trig = { on: false, peak: 0, hist: [], cancel: true }; power = 0; }
    }
    yHold.t += dt;
    let dx = (inp.down.right ? 1 : 0) - (inp.down.left ? 1 : 0);
    let dy = (inp.down.up ? 1 : 0) - (inp.down.down ? 1 : 0);
    if (inp.pad) {
      const [rx, ry] = stick(inp.pad.look[0], inp.pad.look[1], inp.pad.dead);
      dx = clamp(dx + rx, -1, 1); dy = clamp(dy - ry, -1, 1);
    }
    if (dx || dy) {
      const sp = spins[rules.turn];
      spins[rules.turn] = clampSpin(sp.x + dx * SPIN_RATE * dt, sp.y + dy * SPIN_RATE * dt);
      yHold.moved = true;
    }
    return true;
  };

  /** Ball in hand: arrows or the stick slide the cue ball, a pointer drags it; A or release confirms. */
  const placeInput = (dt: number, inp: InputState) => {
    const c = balls[0];
    const { x0, y0, x1, y1 } = TABLE;
    const maxX = hand!.behind ? HEAD.x : x1 - R;
    const put = (x: number, y: number) => { c.x = clamp(x, x0 + R, maxX); c.y = clamp(y, y0 + R, y1 - R); };
    const near = (y: number) => y > y0 - 20 && y < y1 + 20;
    // ax/ay already merge arrows, D-pad and the walking stick
    const ax = Math.abs(inp.ax) > 0.2 ? inp.ax : 0, ay = Math.abs(inp.ay) > 0.2 ? inp.ay : 0;
    if (ax || ay) put(c.x + ax * HAND_SPEED * dt, c.y + ay * HAND_SPEED * dt);
    const ptr = inp.ptr ?? null;
    let release = false;
    // only a press that started on the table drags the ball; letting go places it
    if (ptr?.down && !prevPtrDown && near(ptr.y)) handDrag = true;
    if (ptr?.down && handDrag) put(ptr.x, ptr.y);
    if (handDrag && !ptr?.down) { handDrag = false; release = true; }
    prevPtrDown = !!ptr?.down;
    if (inp.tap && !ptr?.down && near(inp.tap.y)) { put(inp.tap.x, inp.tap.y); release = true; }
    if (inp.hit.a || release) confirmPlace();
  };

  const cpuPlaceStep = (dt: number) => {
    const c = balls[0], p = cpuPlace!;
    p.t += dt;
    const k = Math.min(1, dt * 8);
    c.x += (p.x - c.x) * k; c.y += (p.y - c.y) * k;
    if (p.t < 0.7) return;
    c.x = p.x; c.y = p.y;
    cpuPlace = null;
    if (!confirmPlace()) { respotCue(balls); hand = null; msg = ''; beginAim(); }
  };

  /**
   * Gamepad aim. Walking stick: point at the target, coarse. Camera stick:
   * turn the cue, rate rising with the square of the tilt so a small push
   * moves a fraction of a degree; L2 held slows it eight times more. Dead
   * zones come from the controller profile; pad.aim carries the profile and
   * the user's speed setting. The D-pad still turns like the arrow keys.
   */
  const padAim = (dt: number, inp: InputState) => {
    const pad = inp.pad!;
    const [mx, my] = stick(pad.move[0], pad.move[1], pad.dead);
    const mm = Math.hypot(mx, my);
    const fine = pad.l2 > 0.3 ? 1 / PAD_FINE : 1;
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
      msg = ctx.t('Lepas {r2} untuk memukul.', { r2: key('r2') });
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
    if (spinInput(dt, inp)) return;
    // pointer: drag away from the shot to pull the cue back, release to strike; a plain tap aims there.
    // A press on the spin widget moves the tip instead.
    const ptr = inp.ptr ?? null;
    let spinEnd = false;
    if (ptr) {
      if (ptr.down && !prevPtrDown) { if (onWidget(ptr.x, ptr.y)) spinDrag = true; else drag = { sx: ptr.x, sy: ptr.y, maxL: 0 }; }
      if (spinDrag) { if (ptr.down) spinAt(ptr.x, ptr.y); else { spinDrag = false; spinEnd = true; } }
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
      spinDrag = false;
      prevPtrDown = false;
    }
    // a tap that started and ended between two frames never shows ptr.down
    if (inp.tap && !drag && !spinDrag && !spinEnd && !(ptr && ptr.down)) {
      if (onWidget(inp.tap.x, inp.tap.y)) { spinAt(inp.tap.x, inp.tap.y); ctx.sfx('click'); } else aimAt(inp.tap.x, inp.tap.y);
    }
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
      if (inp.hit.a) { charging = true; holdA = true; latched = false; chargeT = 0; power = 0; powerDir = 1; ctx.sfx('tick'); msg = ctx.t('Tekan {a} lagi untuk memukul.', { a: key('a') }); }
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

  const roll = (dt: number) => {
    const ev: PhysEvent[] = [];
    physicsStep(balls, dt, ev);
    for (const e of ev) {
      if (e.kind === 'pocket') {
        shot.pocketed.push(e.n);
        if (e.n === 8) shot.eightPocket = e.p;
        sound('pocket', e.v);
        ctx.rumble(e.n === 0 ? 0.6 : 0.3, e.n === 0 ? 160 : 60);
        const b = balls.find((q) => q.n === e.n)!;
        if (e.n !== 0) floats.push({ x: b.x, y: b.y - 10, t: 0, s: e.n === 8 ? '8!' : '+1', c: PAL.gold });
        burst(b.x, b.y, 8, e.n === 0 ? '#ffffff' : ballColor(e.n), 70);
      } else if (e.kind === 'hit') {
        if (shot.first === null && (e.a === 0 || e.b === 0)) shot.first = e.a === 0 ? e.b : e.a;
        if (e.v > 20) sound('clack', e.v);
      } else {
        if (shot.first !== null) shot.railAfter = true;
        if (e.n !== 0 && !shot.railBalls.includes(e.n)) shot.railBalls.push(e.n);
        if (e.v > 60) sound('thud', e.v);
      }
    }
    if (!moving(balls)) resolve();
  };

  const update = (dt: number, inp: InputState) => {
    tickFx(dt);
    if (phase === 'over') {
      overT -= dt;
      if (overT <= 0 && !ended) { ended = true; ctx.end(result); }
      return;
    }
    time += dt;
    for (const k in gap) gap[k] = Math.max(0, gap[k] - dt);
    sameDevice = !inp.players || inp.players[1] === inp.players[0];
    // whoever is at the table reads their own input
    const pin = versus ? (inp.players?.[rules.turn] ?? inp) : inp;
    aBuf = Math.max(0, aBuf - dt);
    if (!versus && (phase === 'roll' || phase === 'pause') && inp.hit.a) aBuf = 0.15;
    if ((phase === 'aim' || phase === 'place') && time >= TIME_LIMIT) { judge(); return; }
    if (phase === 'pause') {
      pauseT -= dt;
      if (pauseT <= 0) startTurn();
      return;
    }
    if (phase === 'roll') { roll(dt); return; }
    if (phase === 'place') {
      if (cpuTurn()) cpuPlaceStep(dt);
      else placeInput(dt, pin);
      return;
    }
    if (cpuTurn()) {
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
    playerAim(dt, pin);
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
    text(g, nameOf(s), x + 46, 21, 16, PAL.ink, 'left');
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
    const mine = !cpuTurn();
    const sp = spins[rules.turn];
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
      const k = mine ? sp.y * SPIN_K : 0;
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
    // the pocket called for the 8
    if (onEight(rules.turn)) {
      const cp = calledPocket(balls, aim);
      if (cp !== null) {
        const p = POCKETS[cp];
        g.strokeStyle = PAL.gold;
        g.lineWidth = 2.5;
        g.beginPath(); g.arc(p.x, p.y, p.r + 4, 0, Math.PI * 2); g.stroke();
      }
    }
  };

  const drawSpin = () => {
    const { x, y, r } = SPIN_UI;
    const sp = spins[rules.turn];
    g.fillStyle = '#fbf6ea';
    g.strokeStyle = PAL.ink2;
    g.lineWidth = 1;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke();
    // legal tip area and cross hair
    g.strokeStyle = 'rgba(75,90,81,0.35)';
    g.beginPath(); g.arc(x, y, r * SPIN_MAX, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(x - r, y); g.lineTo(x + r, y); g.moveTo(x, y - r); g.lineTo(x, y + r); g.stroke();
    g.fillStyle = PAL.red;
    g.beginPath(); g.arc(x + sp.x * r, y - sp.y * r, 2.8, 0, Math.PI * 2); g.fill();
    if (yHold || spinDrag) { g.strokeStyle = PAL.gold; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r + 2.5, 0, Math.PI * 2); g.stroke(); }
    text(g, ctx.t(spinName(sp)), x + r + 6, y, 12, PAL.ink2, 'left', 600);
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
    if (phase === 'place' && hand) {
      // where the cue ball may go
      const { x0, y0, x1, y1 } = TABLE;
      g.fillStyle = 'rgba(255,250,240,0.08)';
      g.fillRect(x0, y0, (hand.behind ? HEAD.x : x1) - x0, y1 - y0);
    }
    for (const b of balls) {
      if (!b.down || b.fall <= 0) continue;
      const k = b.fall / FALL_T;
      g.globalAlpha = 0.25 + 0.75 * k;
      drawBall(b, R * (0.4 + 0.6 * k), false);
      g.globalAlpha = 1;
    }
    for (const b of balls) if (!b.down) drawBall(b);
    const c = balls[0];
    if (phase === 'place' && !c.down) {
      const ok = !!hand && handOk(balls, c.x, c.y, hand.behind);
      g.strokeStyle = ok ? PAL.gold : PAL.red;
      g.lineWidth = 2;
      g.setLineDash([3, 3]);
      g.beginPath(); g.arc(c.x, c.y, R + 4, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
    }
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
    if (notice.t > 0) {
      g.fillStyle = 'rgba(184,69,46,0.92)';
      roundRect(g, 170, 66, 300, 22, 8);
      fit(notice.s, w / 2, 77, 13, 290, '#fffaf0');
    }
    // footer: power meter, english, message
    g.fillStyle = PAL.surface;
    roundRect(g, 8, 362, 624, 32, 10);
    text(g, ctx.t('Tenaga'), 20, 378, 14, PAL.ink, 'left');
    g.fillStyle = PAL.sand;
    roundRect(g, 72, 371, 120, 14, 7);
    if (power > 0) {
      const pg = g.createLinearGradient(72, 0, 192, 0);
      pg.addColorStop(0, PAL.green); pg.addColorStop(0.55, PAL.gold); pg.addColorStop(1, PAL.red);
      g.fillStyle = pg;
      roundRect(g, 72, 371, Math.max(14, 120 * power), 14, 7);
    }
    g.fillStyle = 'rgba(29,42,35,0.4)';
    g.fillRect(72 + 120 * MEDIUM - 0.5, 369, 1, 18);
    drawSpin();
    if (msg) fit(msg, 490, 378, 14, 270, phase === 'over' ? PAL.accent : PAL.ink);
    if (phase === 'over') {
      g.fillStyle = 'rgba(29,42,35,0.82)';
      roundRect(g, 130, 168, 380, 84, 14);
      fit(banner, w / 2, 196, 18, 350, '#fffaf0');
      if (versus) fit(result.summary ?? '', w / 2, 226, 16, 350, PAL.gold);
      else text(g, ctx.t('Skor: {n} poin', { n: result.score }), w / 2, 226, 16, PAL.gold);
    }
  };

  return {
    update,
    render,
    snapshot: () => ({
      phase, turn: rules.turn, shots, time: Math.round(time * 100) / 100, groups: [...rules.groups], winner: rules.winner, versus,
      aim, power, powerDir, charging, latched, dragging: !!drag, trigger: trig.on, spin: { ...spins[rules.turn] }, spinHeld: !!yHold,
      hint: { ...hint }, foe: foe.name, fouls, foul: lastFoul, notice: notice.t > 0 ? notice.s : '', hand: hand ? { ...hand } : null,
      called: phase === 'aim' && onEight(rules.turn) ? calledPocket(balls, aim) : null,
      cue: { x: balls[0].x, y: balls[0].y, vx: balls[0].vx, vy: balls[0].vy },
      mine: downOf(rules.groups[0]), theirs: downOf(rules.groups[1]),
      down: balls.filter((b) => b.down).map((b) => b.n), score: result.score,
    }),
  };
}

export default { meta, create } satisfies GameModule;
