// Balap Drone (Game Station slot 1). Top-down racer: a drone camera follows the
// player's car and the world does not rotate (left/right turns the car relative
// to its nose). Three laps against three CPU drivers from the team. A lap only
// counts after every checkpoint gate was crossed in order, so cutting across
// the grass gains nothing.
import type { CastMember, GameCtx, GameInstance, GameModule } from '../types';
import { PAL, drawToken, roundRect, text } from '../cast';

export interface Track { name: string; hw: number; pts: [number, number][] }

/** Control points double as checkpoint gates; index 0 is the start/finish line. */
export const TRACKS: Track[] = [
  { name: 'Sirkuit Parkiran', hw: 64, pts: [[500, 300], [1000, 260], [1500, 300], [1820, 560], [1760, 960], [1400, 1160], [900, 1160], [450, 1060], [240, 720], [280, 420]] },
  { name: 'Jalur Taman', hw: 62, pts: [[600, 320], [1100, 300], [1600, 360], [2000, 560], [2040, 1000], [1660, 1220], [1260, 1000], [940, 1160], [1000, 1560], [600, 1720], [260, 1380], [240, 820], [340, 460]] },
  { name: 'Putaran Gudang', hw: 60, pts: [[700, 300], [1300, 260], [1760, 560], [2200, 380], [2560, 780], [2380, 1380], [1800, 1520], [1500, 1140], [1120, 1440], [620, 1520], [300, 1140], [320, 560]] },
];
export const LAPS = 3;
export const LIMIT = 240;
export const SUB = 16;
export const V_ROAD = 270;
export const V_GRASS = 115;
const V_TURBO = 390;
const V_REV = -90;
const ACC = 230;
const BRAKE = 380;
const TURN = 2.7;
const CAR_R = 15;
const TURBO_TIME = 1.6;
const GATE_R = 20;
/** Lateral grip per second: high grip snaps the slide back, drift lets it run. */
const GRIP = 14;
const DRIFT_GRIP = 2.6;
const DRIFT_TURN = 1.2;
/** Drift charge (seconds) needed for each mini boost tier. */
export const DRIFT_TIERS = [0.45, 1.1];
const MINI_BOOST = [0.45, 0.9];
/** Steering follows the stick at this rate per second (digital keys ease in, never jump). */
const STEER_RATE = 9;
/** Extra margin of grass around the track before the outer fence. */
const FENCE = 260;
const CPU_IDS = ['CH-SUPERVISOR', 'CH-NETINSTALL', 'CH-ICTSPEC'];

const meta: GameModule['meta'] = {
  id: 'balap-drone', title: 'Balap Drone', place: 'arcade', music: 'race',
  blurb: 'Balap tampak atas di sirkuit sekitar kantor. 3 putaran.',
  view: { w: 640, h: 400 }, score: { unit: 'detik', higherIsBetter: false, time: true }, touch: ['left', 'right', 'a', 'b', 'x', 'y'],
  tutorial: [
    'Tahan {a} untuk gas, {lr} untuk setir, {b} untuk rem.',
    'Tahan {b} sambil belok kencang untuk drift, lepas untuk boost.',
    'Lewati gerbang emas berurutan. {x}: turbo (3 kali), {y}: gas otomatis.',
  ],
  legend: [['lr', 'Setir'], ['a', 'Gas'], ['b', 'Rem / drift'], ['x', 'Turbo'], ['y', 'Gas otomatis']],
  actions: {
    left: 'Setir kiri',
    right: 'Setir kanan',
    a: 'Gas',
    b: 'Rem / mundur; sambil belok: drift',
    x: 'Turbo (3 kali)',
    y: 'Gas otomatis nyala/mati',
  },
  pointerHint: 'Tahan jari ke arah tujuan: mobil menyetir ke sana dan ngegas. Ketuk sisi kiri/kanan untuk ganti lintasan',
};

interface Car {
  c: CastMember; cpu: boolean; skill: number;
  x: number; y: number; ang: number; v: number;
  lap: number; next: number; done: boolean; finishT: number; place: number;
  turbos: number; turbo: number; onRoad: boolean; bump: number;
  /** Sideways speed (positive = to the car's right). */
  slip: number; steer: number; drift: number; driftCharge: number; boostFlash: number;
}

interface Mark { x: number; y: number; ang: number; t: number }
interface Puff { x: number; y: number; vx: number; vy: number; t: number; life: number; c: string; r: number }

const wrap = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Closed Catmull-Rom loop through the control points; sample i*SUB is control point i. */
export function buildPath(pts: [number, number][]): [number, number][] {
  const n = pts.length;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let s = 0; s < SUB; s++) {
      const u = s / SUB, u2 = u * u, u3 = u2 * u;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}

function segDist(px: number, py: number, a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1;
  const u = clamp(((px - a[0]) * dx + (py - a[1]) * dy) / l2, 0, 1);
  return Math.hypot(px - a[0] - u * dx, py - a[1] - u * dy);
}

export function distToRoad(path: [number, number][], x: number, y: number) {
  let bd = Infinity;
  for (let i = 0; i < path.length; i++) bd = Math.min(bd, segDist(x, y, path[i], path[(i + 1) % path.length]));
  return bd;
}

function create(ctx: GameCtx): GameInstance {
  const { g, w, h } = ctx;
  const castOf = (id: string) => ctx.cast.find((c) => c.id === id) ?? ctx.cast[0];
  const paths = TRACKS.map((tr) => buildPath(tr.pts));
  let phase: 'select' | 'count' | 'race' | 'done' = 'select';
  let sel = 0;
  let lastAx = 0;
  let count = 3;
  let raceT = 0;
  let doneT = 0;
  let clock = 0;
  let finished = 0;
  let engineT = 0;
  let crashCd = 0;
  let cars: Car[] = [];
  let tr = TRACKS[0];
  let path = paths[0];
  let ended = false;
  let msg = '';
  let msgT = 0;
  let camX = 0, camY = 0;
  let cruise = false;
  let bounds = { x0: 0, y0: 0, x1: 0, y1: 0 };
  let wallHits = 0;
  const marks: Mark[] = [];
  const puffs: Puff[] = [];

  const setup = () => {
    tr = TRACKS[sel];
    path = paths[sel];
    const [x0, y0] = tr.pts[0], [x1, y1] = tr.pts[1];
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const fx = Math.cos(ang), fy = Math.sin(ang);
    const skills = [0.9, 0.93, 0.955].map((s) => s + ctx.rand() * 0.02);
    // grid: the player starts last, so the race opens with overtaking
    const order = [...CPU_IDS.map((id, i) => ({ id, cpu: true, skill: skills[i] })), { id: ctx.playerId, cpu: false, skill: 1 }];
    cars = order.map((o, i) => {
      const back = 50 + i * 42, side = (i % 2 ? 1 : -1) * 26;
      return {
        c: castOf(o.id), cpu: o.cpu, skill: o.skill,
        x: x0 - fx * back - fy * side, y: y0 - fy * back + fx * side, ang, v: 0,
        lap: 0, next: 1, done: false, finishT: 0, place: 0, turbos: 3, turbo: 0, onRoad: true, bump: 0,
        slip: 0, steer: 0, drift: 0, driftCharge: 0, boostFlash: 0,
      };
    });
    const xs = tr.pts.map((q) => q[0]), ys = tr.pts.map((q) => q[1]);
    bounds = { x0: Math.min(...xs) - tr.hw - FENCE, y0: Math.min(...ys) - tr.hw - FENCE, x1: Math.max(...xs) + tr.hw + FENCE, y1: Math.max(...ys) + tr.hw + FENCE };
    const p = cars[cars.length - 1];
    camX = p.x; camY = p.y;
    marks.length = 0; puffs.length = 0;
    phase = 'count';
    count = 3;
    ctx.sfx('beep');
  };

  const player = () => cars[cars.length - 1];
  const progress = (k: Car) => {
    const n = tr.pts.length;
    const passed = k.lap * n + ((k.next - 1 + n) % n);
    const [tx, ty] = tr.pts[k.next];
    return passed - Math.hypot(k.x - tx, k.y - ty) / 100000;
  };
  const ranking = () => [...cars].sort((a, b) => (a.done && b.done ? a.place - b.place : a.done ? -1 : b.done ? 1 : progress(b) - progress(a)));
  const posOf = (k: Car) => ranking().indexOf(k) + 1;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

  const hud = () => {
    if (!cars.length) { ctx.setHud(ctx.t('Pilih lintasan')); return; }
    const p = player();
    ctx.setHud(ctx.t('Putaran {l}/{n} · Posisi {p}/4 · {s}', { l: Math.min(p.lap + 1, LAPS), n: LAPS, p: p.done ? p.place : posOf(p), s: fmt(raceT) }));
  };
  hud();

  /** Nearest path sample, searched only around the current gate pair (cheap and never jumps across the infield). */
  const nearWindow = (k: Car) => {
    const M = path.length;
    const from = ((k.next - 1) * SUB - SUB / 2 + M) % M;
    let best = 0, bd = Infinity;
    for (let j = 0; j < SUB * 2; j++) {
      const i = (from + j) % M;
      const d = Math.hypot(k.x - path[i][0], k.y - path[i][1]);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };

  const startTurbo = (k: Car, time: number, big: boolean) => {
    k.turbo = Math.max(k.turbo, time);
    // a turbo is felt on the very frame it fires, not after the car spools up
    if (k.onRoad) k.v = Math.max(k.v, big ? V_ROAD + 40 : k.v + 50);
    k.boostFlash = 0.35;
  };

  const drive = (k: Car, dt: number, steerIn: number, gas: boolean, brake: boolean, turboHit: boolean) => {
    if (turboHit && k.turbos > 0 && k.turbo <= 0.5) {
      k.turbos--; startTurbo(k, TURBO_TIME, true);
      if (!k.cpu) { ctx.sfx('turbo'); flash(ctx.t('Turbo!')); }
    }
    k.turbo = Math.max(0, k.turbo - dt);
    k.boostFlash = Math.max(0, k.boostFlash - dt);
    k.onRoad = distToRoad(path, k.x, k.y) <= tr.hw;
    const target = clamp(steerIn, -1, 1);
    if (k.cpu) k.steer = target;
    else {
      const d = target - k.steer;
      // letting go recentres faster than turning in, so the car never keeps curling
      const rate = (target === 0 || Math.sign(target) !== Math.sign(k.steer) ? STEER_RATE * 1.6 : STEER_RATE) * dt;
      k.steer = Math.abs(d) <= rate ? target : k.steer + Math.sign(d) * rate;
    }
    // drift: hold brake while steering hard at speed; release to cash in the charge
    const wantDrift = !k.cpu && brake && Math.abs(k.steer) > 0.35 && k.v > 140 && k.onRoad;
    if (wantDrift && k.drift === 0) { k.drift = Math.sign(k.steer); k.driftCharge = 0; ctx.sfx('crash', { gain: 0.25 }); }
    else if (k.drift !== 0 && (!brake || k.v < 90)) {
      const tier = k.driftCharge >= DRIFT_TIERS[1] ? 1 : k.driftCharge >= DRIFT_TIERS[0] ? 0 : -1;
      if (tier >= 0 && k.onRoad && k.v >= 90) { startTurbo(k, MINI_BOOST[tier], false); ctx.sfx('turbo'); flash(tier ? ctx.t('Boost besar!') : ctx.t('Boost!')); }
      k.drift = 0; k.driftCharge = 0;
    }
    const drifting = k.drift !== 0;
    if (drifting && k.onRoad) k.driftCharge += dt * (Math.sign(k.steer) === k.drift ? 1 : 0.7);
    const vmax = k.cpu ? V_ROAD * k.skill : V_ROAD;
    const cap = k.turbo > 0 && k.onRoad ? V_TURBO : k.onRoad ? vmax : V_GRASS;
    if (k.turbo > 0) k.v += ACC * 1.6 * dt;
    else if (drifting) k.v -= 40 * dt;
    else if (gas) k.v += ACC * dt;
    else if (brake) k.v -= (k.v > 0 ? BRAKE : ACC * 0.6) * dt;
    else k.v -= Math.sign(k.v) * Math.min(Math.abs(k.v), 90 * dt);
    if (drifting && gas) k.v += ACC * 0.25 * dt;
    if (k.v > cap) k.v = Math.max(cap, k.v - 520 * dt);
    if (k.v < V_REV) k.v = V_REV;
    // steering authority builds up with speed and eases off a little near top speed
    const auth = clamp(Math.abs(k.v) / 90, 0, 1) * (1 - 0.18 * clamp((Math.abs(k.v) - 200) / 190, 0, 1));
    // the slide holds its own line; the stick only tightens or widens it
    const st = drifting ? clamp(k.drift * 0.65 + k.steer * 0.35, -1, 1) * DRIFT_TURN : k.steer;
    const turn = st * TURN * auth * Math.sign(k.v) * dt;
    // velocity keeps its world direction while the nose turns, which is what lets the tail slide
    const vx0 = Math.cos(k.ang) * k.v - Math.sin(k.ang) * k.slip;
    const vy0 = Math.sin(k.ang) * k.v + Math.cos(k.ang) * k.slip;
    k.ang = wrap(k.ang + turn);
    const c = Math.cos(k.ang), sn = Math.sin(k.ang);
    const fwd = vx0 * c + vy0 * sn;
    const lat = -vx0 * sn + vy0 * c;
    // most of the lost lateral speed is turned back into forward speed so turning stays snappy
    const keep = Math.exp(-(drifting ? DRIFT_GRIP : GRIP) * dt);
    const shed = lat * (1 - keep);
    k.slip = lat * keep;
    k.v = clamp(fwd + Math.abs(shed) * (drifting ? 0.35 : 0.85) * Math.sign(fwd || 1), V_REV, V_TURBO + 40);
    k.x += (c * k.v - sn * k.slip) * dt;
    k.y += (sn * k.v + c * k.slip) * dt;
    fence(k);
    k.bump = Math.max(0, k.bump - dt);
    if (!k.cpu && !ctx.reducedMotion && (drifting || Math.abs(k.slip) > 40) && Math.abs(k.v) > 60) {
      for (const sd of [-1, 1]) marks.push({ x: k.x - c * 14 - sn * 9 * sd, y: k.y - sn * 14 + c * 9 * sd, ang: k.ang, t: 0 });
      if (marks.length > 240) marks.splice(0, marks.length - 240);
      if (ctx.rand() < 0.5) puffs.push({ x: k.x - c * 18, y: k.y - sn * 18, vx: -c * 30 + (ctx.rand() - 0.5) * 30, vy: -sn * 30 + (ctx.rand() - 0.5) * 30, t: 0, life: 0.5, c: k.driftCharge >= DRIFT_TIERS[1] ? '#f0a54a' : k.driftCharge >= DRIFT_TIERS[0] ? '#7fb3e0' : 'rgba(240,236,226,0.9)', r: 6 });
    }
    if (!k.cpu && !ctx.reducedMotion && k.turbo > 0 && ctx.rand() < 0.6) puffs.push({ x: k.x - c * 24, y: k.y - sn * 24, vx: -c * 80, vy: -sn * 80, t: 0, life: 0.3, c: 'rgba(217,164,65,0.9)', r: 4 });
    const [cx, cy] = tr.pts[k.next];
    if (!k.done && Math.hypot(k.x - cx, k.y - cy) < tr.hw + GATE_R) {
      if (k.next === 0) {
        k.lap++;
        if (k.lap >= LAPS) {
          k.done = true; k.finishT = raceT; k.place = ++finished;
          if (!k.cpu) ctx.sfx(k.place === 1 ? 'win' : 'confirm');
        } else if (!k.cpu) { ctx.sfx('coin'); msg = ctx.t('Putaran {l}/{n}', { l: k.lap + 1, n: LAPS }); msgT = 0; }
      } else if (!k.cpu) ctx.sfx('tick');
      k.next = (k.next + 1) % tr.pts.length;
    }
  };

  /** Outer fence: remove only the speed going into the fence so the car slides along it instead of sticking. */
  function fence(k: Car) {
    let nx = 0, ny = 0;
    if (k.x < bounds.x0 + CAR_R) { k.x = bounds.x0 + CAR_R; nx = 1; }
    else if (k.x > bounds.x1 - CAR_R) { k.x = bounds.x1 - CAR_R; nx = -1; }
    if (k.y < bounds.y0 + CAR_R) { k.y = bounds.y0 + CAR_R; ny = 1; }
    else if (k.y > bounds.y1 - CAR_R) { k.y = bounds.y1 - CAR_R; ny = -1; }
    if (!nx && !ny) return;
    const c = Math.cos(k.ang), sn = Math.sin(k.ang);
    let vx = c * k.v - sn * k.slip, vy = sn * k.v + c * k.slip;
    const into = vx * nx + vy * ny;
    if (into < 0) {
      vx -= into * nx * 1.25; vy -= into * ny * 1.25;
      if (!k.cpu) { wallHits++; if (crashCd <= 0 && -into > 60) { ctx.sfx('crash', { gain: 0.5 }); crashCd = 0.4; k.bump = 0.2; } }
    }
    // glance: swing the nose toward the fence line so grip carries the car along it
    const tl = Math.hypot(nx, ny);
    const ux = -ny / tl, uy = nx / tl;
    const sgn = (c * ux + sn * uy) >= 0 ? 1 : -1;
    const along = Math.atan2(uy * sgn, ux * sgn);
    const facingIn = c * nx + sn * ny < -0.05;
    if (facingIn) k.ang = wrap(k.ang + wrap(along - k.ang) * 0.3);
    const c2 = Math.cos(k.ang), s2 = Math.sin(k.ang);
    k.v = (vx * c2 + vy * s2) * 0.995;
    k.slip = -vx * s2 + vy * c2;
  }

  function flash(s: string) { msg = s; msgT = 0; }

  const cpuControl = (k: Car, dt: number) => {
    const near = nearWindow(k);
    const [tx, ty] = path[(near + 5) % path.length];
    const diff = wrap(Math.atan2(ty - k.y, tx - k.x) - k.ang);
    const ad = Math.abs(diff);
    const gas = ad < 0.5 || k.v < 140;
    const brake = ad > 0.9 && k.v > 150;
    const turboHit = !k.done && ad < 0.08 && k.onRoad && raceT > 6 && ctx.rand() < 0.004;
    drive(k, dt, diff * 2.6, gas, brake, turboHit);
  };

  // Cars push apart and trade only the approaching part of their speed, so
  // they bounce off each other instead of gluing together.
  const collide = () => {
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d > 0 && d < CAR_R * 2) {
        const push = (CAR_R * 2 - d) / 2, nx = dx / d, ny = dy / d;
        a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
        const va = vel(a), vb = vel(b);
        const rel = (vb[0] - va[0]) * nx + (vb[1] - va[1]) * ny;
        if (rel < 0) {
          const jn = -rel * 0.6;
          setVel(a, va[0] - nx * jn, va[1] - ny * jn);
          setVel(b, vb[0] + nx * jn, vb[1] + ny * jn);
          if ((!a.cpu || !b.cpu) && crashCd <= 0 && -rel > 25) { ctx.sfx('crash', { gain: 0.6 }); crashCd = 0.4; a.bump = b.bump = 0.25; }
        }
      }
    }
  };
  function vel(k: Car): [number, number] {
    const c = Math.cos(k.ang), sn = Math.sin(k.ang);
    return [c * k.v - sn * k.slip, sn * k.v + c * k.slip];
  }
  function setVel(k: Car, vx: number, vy: number) {
    const c = Math.cos(k.ang), sn = Math.sin(k.ang);
    k.v = vx * c + vy * sn;
    k.slip = -vx * sn + vy * c;
  }

  const finish = () => {
    if (ended) return;
    ended = true;
    const p = player();
    if (p.done) {
      ctx.end({ score: Math.round(p.finishT * 10) / 10, won: p.place === 1, summary: ctx.t('Finis posisi {p} dari 4 di {track}, waktu {s}', { p: p.place, track: ctx.t(tr.name), s: fmt(p.finishT) }) });
    } else {
      ctx.end({ score: 0, won: false, summary: ctx.t('Tidak finis dalam {n} detik', { n: LIMIT }) });
    }
  };

  return {
    update(dt, inp) {
      clock += dt;
      crashCd = Math.max(0, crashCd - dt);
      if (phase === 'select') {
        const edge = inp.ax > 0.5 && lastAx <= 0.5 ? 1 : inp.ax < -0.5 && lastAx >= -0.5 ? -1 : 0;
        lastAx = inp.ax;
        let d = inp.hit.right ? 1 : inp.hit.left ? -1 : edge;
        let go = inp.hit.a;
        if (inp.tap) {
          if (inp.tap.x < w * 0.25) d = -1;
          else if (inp.tap.x > w * 0.75) d = 1;
          else go = true;
        }
        if (d) { sel = (sel + d + TRACKS.length) % TRACKS.length; ctx.sfx('ui'); }
        if (go) { ctx.sfx('confirm'); setup(); hud(); }
        return;
      }
      ageFx(dt);
      if (inp.hit.y && phase !== 'done') { cruise = !cruise; ctx.sfx('ui'); flash(cruise ? ctx.t('Gas otomatis nyala') : ctx.t('Gas otomatis mati')); }
      if (phase === 'count') {
        const before = Math.ceil(count);
        count -= dt;
        if (count <= 0) { phase = 'race'; msg = ctx.t('Jalan!'); msgT = 0; ctx.sfx('start'); }
        else if (Math.ceil(count) !== before) ctx.sfx('beep');
        return;
      }
      raceT += dt;
      msgT += dt;
      doneT += dt;
      const p = player();
      for (const k of cars) {
        if (k.cpu) cpuControl(k, dt);
        else if (phase === 'race') {
          let steer = inp.ax;
          let gas = inp.down.a || inp.down.up || cruise;
          const brake = inp.down.b || inp.down.down;
          // touch/mouse: hold toward where you want to go
          if (inp.ptr?.down && !inp.down.left && !inp.down.right && Math.abs(inp.ax) < 0.2) {
            const sx = k.x - camX + w / 2, sy = k.y - camY + h / 2;
            const dx = inp.ptr.x - sx, dy = inp.ptr.y - sy;
            if (Math.hypot(dx, dy) > 24) { steer = clamp(wrap(Math.atan2(dy, dx) - k.ang) * 2.2, -1, 1); gas = true; }
          }
          drive(k, dt, steer, gas, brake, inp.hit.x);
        }
        else drive(k, dt, 0, false, true, false);
      }
      collide();
      followCam(dt);
      engineT -= dt;
      if (engineT <= 0 && phase === 'race') { engineT = 0.22; ctx.sfx('engine', { rate: 0.8 + Math.abs(p.v) / V_ROAD, gain: 0.5 }); }
      if (phase === 'race') {
        if (p.done) { phase = 'done'; doneT = 0; msg = ctx.t('Finis! Posisi {p}', { p: p.place }); }
        else if (raceT >= LIMIT) { phase = 'done'; doneT = 0; msg = ctx.t('Waktu habis'); ctx.sfx('lose'); }
      } else if (phase === 'done' && doneT > 1.8) finish();
      hud();
    },

    render() {
      if (phase === 'select') { renderSelect(); return; }
      const p = player();
      const shake = !ctx.reducedMotion && p.bump > 0 ? Math.sin(clock * 80) * 3 : 0;
      const ox = Math.round(w / 2 - camX + shake), oy = Math.round(h / 2 - camY);
      g.fillStyle = PAL.grass;
      g.fillRect(0, 0, w, h);
      const T = 80;
      const i0 = Math.floor((camX - w / 2) / T), j0 = Math.floor((camY - h / 2) / T);
      for (let i = i0; i <= i0 + Math.ceil(w / T) + 1; i++) for (let j = j0; j <= j0 + Math.ceil(h / T) + 1; j++) {
        const sx = i * T + ox, sy = j * T + oy;
        if ((i + j) & 1) { g.fillStyle = '#6a9453'; g.fillRect(sx, sy, T, T); }
        const hsh = Math.abs(((i * 73856093) ^ (j * 19349663)) % 97);
        if (hsh < 9) {
          const tx = i * T + 20 + (hsh * 7) % 40, ty = j * T + 20 + (hsh * 13) % 40;
          if (distToRoad(path, tx, ty) > tr.hw + 40) drawTree(tx + ox, ty + oy, 14 + (hsh % 4) * 3);
        }
      }
      g.save();
      g.translate(ox, oy);
      g.lineJoin = 'round';
      g.lineCap = 'round';
      const loop = () => { g.beginPath(); g.moveTo(path[0][0], path[0][1]); for (const q of path) g.lineTo(q[0], q[1]); g.closePath(); };
      loop(); g.strokeStyle = '#e9dfc9'; g.lineWidth = tr.hw * 2 + 12; g.stroke();
      loop(); g.strokeStyle = PAL.road; g.lineWidth = tr.hw * 2; g.stroke();
      loop(); g.setLineDash([22, 22]); g.strokeStyle = 'rgba(255,250,240,0.45)'; g.lineWidth = 3; g.stroke(); g.setLineDash([]);
      for (const m of marks) {
        g.globalAlpha = Math.max(0, 0.35 * (1 - m.t / 3));
        g.save(); g.translate(m.x, m.y); g.rotate(m.ang);
        g.fillStyle = '#1d1d1d'; g.fillRect(-3, -1.5, 6, 3);
        g.restore();
      }
      g.globalAlpha = 1;
      gate(0, true);
      if (!p.done) gate(p.next, false);
      for (const q of puffs) {
        g.globalAlpha = Math.max(0, 1 - q.t / q.life);
        g.fillStyle = q.c;
        g.beginPath(); g.arc(q.x, q.y, q.r * (1 + q.t / q.life), 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
      for (const k of [...cars].sort((a, b) => a.y - b.y)) drawCar(k);
      g.restore();
      if (!p.done && phase === 'race') gateArrow(p, ox, oy);
      renderHud(p);
    },

    snapshot: () => {
      const p = cars.length ? player() : null;
      return {
        phase, sel, track: tr.name, raceT: Math.round(raceT * 100) / 100,
        player: p ? { x: p.x, y: p.y, ang: p.ang, v: p.v, lap: p.lap, next: p.next, done: p.done, place: p.place, onRoad: p.onRoad, turbos: p.turbos, turbo: p.turbo, pos: p.done ? p.place : posOf(p), steer: p.steer, slip: p.slip, drift: p.drift, driftCharge: p.driftCharge } : null,
        cruise, wallHits, bounds,
        cpus: cars.filter((k) => k.cpu).map((k) => ({ id: k.c.id, lap: k.lap, next: k.next, done: k.done, finishT: Math.round(k.finishT * 100) / 100, place: k.place })),
      };
    },
  };

  function ageFx(dt: number) {
    for (const m of marks) m.t += dt;
    while (marks.length && marks[0].t > 3) marks.shift();
    for (let i = puffs.length - 1; i >= 0; i--) {
      const q = puffs[i];
      q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.t >= q.life) puffs.splice(i, 1);
    }
  }

  // Camera eases toward a point ahead of the car, so speed changes and drifts
  // do not jerk the view.
  function followCam(dt: number) {
    const p = player();
    const [vx, vy] = vel(p);
    const tx = p.x + vx * 0.32, ty = p.y + vy * 0.32;
    const k = 1 - Math.exp(-6 * dt);
    camX += (tx - camX) * k; camY += (ty - camY) * k;
  }

  /** Edge arrow pointing at the next gate when it is off screen. */
  function gateArrow(p: Car, ox: number, oy: number) {
    const [gx, gy] = tr.pts[p.next];
    const sx = gx + ox, sy = gy + oy;
    if (sx > 30 && sx < w - 30 && sy > 110 && sy < h - 50) return;
    const cx = w / 2, cy = h / 2;
    const a = Math.atan2(sy - cy, sx - cx);
    const rx = w / 2 - 34, ry = h / 2 - 60;
    const t = Math.min(rx / Math.abs(Math.cos(a) || 1e-6), ry / Math.abs(Math.sin(a) || 1e-6));
    const ax = cx + Math.cos(a) * t, ay = cy + 20 + Math.sin(a) * t;
    const pulse = ctx.reducedMotion ? 1 : 1 + Math.sin(clock * 8) * 0.08;
    g.save();
    g.translate(ax, ay); g.rotate(a); g.scale(pulse, pulse);
    g.fillStyle = 'rgba(29,42,35,0.75)';
    g.beginPath(); g.arc(0, 0, 17, 0, Math.PI * 2); g.fill();
    g.fillStyle = PAL.gold;
    g.beginPath(); g.moveTo(12, 0); g.lineTo(-7, -9); g.lineTo(-3, 0); g.lineTo(-7, 9); g.closePath(); g.fill();
    g.restore();
  }

  function gate(i: number, start: boolean) {
    const n = tr.pts.length;
    const [x, y] = tr.pts[i];
    const a = tr.pts[(i + 1) % n], b = tr.pts[(i - 1 + n) % n];
    g.save();
    g.translate(x, y);
    g.rotate(Math.atan2(a[1] - b[1], a[0] - b[0]));
    const hw = tr.hw;
    if (start) {
      const sq = 8;
      for (let r = -hw; r < hw; r += sq) for (let c = 0; c < 2; c++) {
        g.fillStyle = ((Math.round(r / sq) + c) & 1) ? '#1d2a23' : '#fffaf0';
        g.fillRect(-sq + c * sq, r, sq, sq);
      }
    } else {
      const pulse = ctx.reducedMotion ? 0.55 : 0.45 + Math.sin(clock * 6) * 0.2;
      g.fillStyle = `rgba(217,164,65,${pulse})`;
      g.fillRect(-3, -hw, 6, hw * 2);
      g.fillStyle = PAL.gold;
      for (const s of [-1, 1]) { g.beginPath(); g.arc(0, s * (hw + 8), 7, 0, Math.PI * 2); g.fill(); }
    }
    g.restore();
  }

  function drawCar(k: Car) {
    g.save();
    g.translate(k.x, k.y);
    g.rotate(k.ang);
    if (k.turbo > 0) {
      g.fillStyle = 'rgba(217,164,65,0.85)';
      g.beginPath(); g.moveTo(-20, -6); g.lineTo(-38 - (ctx.reducedMotion ? 0 : Math.sin(clock * 50) * 5), 0); g.lineTo(-20, 6); g.fill();
    }
    g.fillStyle = 'rgba(0,0,0,0.25)';
    roundRect(g, -19, -9, 42, 24, 7);
    g.fillStyle = '#2b2b2b';
    for (const [wx, wy] of [[-16, -14], [7, -14], [-16, 9], [7, 9]]) g.fillRect(wx, wy, 11, 5);
    g.fillStyle = k.c.main;
    roundRect(g, -21, -11, 42, 22, 7);
    g.fillStyle = k.c.accent;
    g.fillRect(-21, -2, 42, 4);
    g.fillStyle = 'rgba(191,224,230,0.9)';
    roundRect(g, 9, -8, 7, 16, 3);
    g.restore();
    drawToken(g, k.c, k.x - Math.cos(k.ang) * 3, k.y - Math.sin(k.ang) * 3, 9, clock, Math.abs(k.v) > 20);
    const label = k.cpu ? k.c.name : ctx.t('Kamu');
    g.font = "700 11px 'Alegreya Sans', system-ui, sans-serif";
    const tw = g.measureText(label).width + 10;
    g.fillStyle = k.cpu ? 'rgba(29,42,35,0.78)' : 'rgba(184,69,46,0.92)';
    roundRect(g, k.x - tw / 2, k.y - 38, tw, 15, 5);
    text(g, label, k.x, k.y - 30, 11, '#fffaf0');
  }

  function drawTree(x: number, y: number, r: number) {
    if (x < -r || y < -r || x > w + r || y > h + r) return;
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.beginPath(); g.ellipse(x + 4, y + 6, r, r * 0.7, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = PAL.green;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2f6a4e';
    g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.5, 0, Math.PI * 2); g.fill();
  }

  function renderHud(p: Car) {
    g.fillStyle = 'rgba(255,250,240,0.93)';
    roundRect(g, 10, 10, 196, 90, 10);
    text(g, ctx.t('Putaran {l}/{n}', { l: Math.min(p.lap + 1, LAPS), n: LAPS }), 22, 28, 17, PAL.ink, 'left');
    text(g, ctx.t('Posisi {p}/4', { p: p.done ? p.place : posOf(p) }), 22, 51, 17, PAL.accent, 'left');
    text(g, fmt(raceT), 22, 74, 17, PAL.ink2, 'left');
    // speed bar under the panel, coloured by drift charge or turbo
    const sp = clamp(p.v / V_TURBO, 0, 1);
    g.fillStyle = 'rgba(29,42,35,0.2)'; g.fillRect(22, 88, 172, 5);
    g.fillStyle = p.turbo > 0 ? PAL.gold : p.drift ? (p.driftCharge >= DRIFT_TIERS[1] ? '#f0a54a' : p.driftCharge >= DRIFT_TIERS[0] ? '#3c6e91' : '#9aa59c') : PAL.green;
    g.fillRect(22, 88, 172 * sp, 5);
    if (cruise) {
      g.fillStyle = 'rgba(31,77,58,0.9)'; roundRect(g, 10, 104, 120, 20, 8);
      text(g, ctx.t('Gas otomatis'), 70, 114, 12, PAL.surface, 'center', 800);
    }
    text(g, ctx.t('Turbo'), 172, 54, 12, PAL.ink2);
    for (let i = 0; i < 3; i++) {
      g.fillStyle = i < p.turbos ? PAL.gold : 'rgba(29,42,35,0.18)';
      g.beginPath(); g.moveTo(152 + i * 14, 64); g.lineTo(162 + i * 14, 72); g.lineTo(152 + i * 14, 80); g.closePath(); g.fill();
    }
    // minimap
    const xs = tr.pts.map((q) => q[0]), ys = tr.pts.map((q) => q[1]);
    const minX = Math.min(...xs) - 80, minY = Math.min(...ys) - 80;
    const sc = Math.min(120 / (Math.max(...xs) + 80 - minX), 84 / (Math.max(...ys) + 80 - minY));
    const mx = w - 140, my = 10;
    g.fillStyle = 'rgba(255,250,240,0.93)';
    roundRect(g, mx, my, 130, 94, 10);
    g.save();
    g.translate(mx + 5, my + 5);
    g.beginPath();
    path.forEach((q, i) => (i ? g.lineTo((q[0] - minX) * sc, (q[1] - minY) * sc) : g.moveTo((q[0] - minX) * sc, (q[1] - minY) * sc)));
    g.closePath();
    g.strokeStyle = PAL.road; g.lineWidth = 4; g.stroke();
    if (!p.done) { const [nx, ny] = tr.pts[p.next]; g.fillStyle = PAL.gold; g.beginPath(); g.arc((nx - minX) * sc, (ny - minY) * sc, 4, 0, Math.PI * 2); g.fill(); }
    for (const k of cars) {
      g.fillStyle = k.cpu ? k.c.main : PAL.red;
      g.beginPath(); g.arc((k.x - minX) * sc, (k.y - minY) * sc, k.cpu ? 3 : 4.5, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    if (phase === 'count') banner(String(Math.ceil(count)), 64);
    else if (phase === 'done') banner(msg, 34);
    else {
      if (msg && msgT < 1.2) banner(msg, 34);
      if (p.drift) bottom(p.driftCharge >= DRIFT_TIERS[1] ? ctx.t('Drift! Lepas {b}: boost besar', { b: ctx.key('b') }) : p.driftCharge >= DRIFT_TIERS[0] ? ctx.t('Drift! Lepas {b}: boost', { b: ctx.key('b') }) : ctx.t('Drift...'), PAL.blue);
      else if (!p.onRoad) bottom(ctx.t('Rumput! Kembali ke aspal'), PAL.red);
      else if (raceT < 8) bottom(ctx.t('Lewati gerbang emas berurutan'), PAL.ink);
      else if (LIMIT - raceT < 30) bottom(ctx.t('Sisa waktu {s} detik', { s: Math.ceil(LIMIT - raceT) }), PAL.red);
    }
  }

  function banner(s: string, size: number) {
    g.font = `800 ${size}px 'Alegreya Sans', system-ui, sans-serif`;
    const bw = g.measureText(s).width + 48;
    g.fillStyle = 'rgba(29,42,35,0.82)';
    roundRect(g, w / 2 - bw / 2, h / 2 - size * 0.9 - 40, bw, size * 1.8, 14);
    text(g, s, w / 2, h / 2 - 40, size, '#fffaf0', 'center', 800);
  }

  function bottom(s: string, color: string) {
    g.font = "700 16px 'Alegreya Sans', system-ui, sans-serif";
    const bw = g.measureText(s).width + 28;
    g.fillStyle = 'rgba(255,250,240,0.93)';
    roundRect(g, w / 2 - bw / 2, h - 44, bw, 30, 10);
    text(g, s, w / 2, h - 29, 16, color);
  }

  function renderSelect() {
    g.fillStyle = PAL.bg;
    g.fillRect(0, 0, w, h);
    text(g, ctx.t('Balap Drone'), w / 2, 30, 28, PAL.green, 'center', 800);
    text(g, ctx.t('Pilih lintasan'), w / 2, 58, 17, PAL.ink2);
    const t0 = TRACKS[sel], p0 = paths[sel];
    const xs = t0.pts.map((q) => q[0]), ys = t0.pts.map((q) => q[1]);
    const minX = Math.min(...xs) - 100, minY = Math.min(...ys) - 100;
    const spanX = Math.max(...xs) + 100 - minX, spanY = Math.max(...ys) + 100 - minY;
    const bw = 380, bh = 210, bx = w / 2 - bw / 2, by = 78;
    const sc = Math.min(bw / spanX, bh / spanY);
    g.fillStyle = PAL.grass;
    roundRect(g, bx - 10, by - 6, bw + 20, bh + 12, 14);
    g.save();
    g.translate(bx + (bw - spanX * sc) / 2, by + (bh - spanY * sc) / 2);
    g.beginPath();
    p0.forEach((q, i) => (i ? g.lineTo((q[0] - minX) * sc, (q[1] - minY) * sc) : g.moveTo((q[0] - minX) * sc, (q[1] - minY) * sc)));
    g.closePath();
    g.lineJoin = 'round';
    g.strokeStyle = '#e9dfc9'; g.lineWidth = t0.hw * 2 * sc + 4; g.stroke();
    g.strokeStyle = PAL.road; g.lineWidth = t0.hw * 2 * sc; g.stroke();
    t0.pts.forEach((q, i) => { g.fillStyle = i === 0 ? '#fffaf0' : PAL.gold; g.beginPath(); g.arc((q[0] - minX) * sc, (q[1] - minY) * sc, i === 0 ? 5 : 3, 0, Math.PI * 2); g.fill(); });
    g.restore();
    text(g, `◀  ${ctx.t(t0.name)}  ▶`, w / 2, by + bh + 30, 22, PAL.ink, 'center', 800);
    text(g, ctx.t('{n} gerbang · 3 putaran · {i}/{m}', { n: t0.pts.length, i: sel + 1, m: TRACKS.length }), w / 2, by + bh + 54, 15, PAL.ink2);
    text(g, ctx.t('{lr}: ganti lintasan · {a}: mulai', { lr: ctx.key('lr'), a: ctx.key('a') }), w / 2, h - 18, 15, PAL.accent);
  }
}

export default { meta, create } satisfies GameModule;
