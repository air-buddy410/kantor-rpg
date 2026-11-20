// Bola Meja (Game Station slot 6). Top-down 2 vs 2 futsal on a walled court:
// Oranye (Pemain 1 and 3) attack the right goal, Biru (Pemain 2 and 4) the
// left one. Three minutes or first to five goals; level at the whistle is a
// draw. Seats without a human are CPU players, so solo is Budi plus a CPU
// teammate against two CPU rivals.
import type { CastMember, GameCtx, GameInstance, GameModule, InputState } from '../types';
import { PLAYER_COLORS } from '../local-players';
import { PAL, drawToken, roundRect, seatTag, text } from '../cast';

export const FW = 960;
export const FH = 600;
const TOP = 40;
/** Goal line distance from the court edge; the nets sit in this strip. */
export const MX = 40;
export const GOAL_W = 170;
export const GY0 = (FH - GOAL_W) / 2;
export const GY1 = GY0 + GOAL_W;
const GD = 34;
export const PR = 18;
export const BR = 10;
/** Ball centre within this distance of a player's centre can be kicked. */
export const KICK_R = PR + BR + 14;
export const CIRCLE = 90;
export const MATCH_T = 180;
export const WIN_GOALS = 5;
export const INTRO_T = 1.5;
export const GOAL_PAUSE = 1.5;
export const MAX_CHARGE = 0.6;
/** Charge fraction from which a kick counts as a hard shot (sound, no pass assist). */
const STRONG = 0.5;
/** Rivals stay out of the centre circle at kickoff until the ball moves or this runs out. */
const HOLD_T = 3;
const PASS_V = 430;
const SHOT_V = 920;
const BALL_MAX = 950;
const BALL_DRAG = 0.85;
/** Rolling resistance (units/s²) on top of drag, so a dribble touch does not roll the length of the court. */
const ROLL = 140;
const RUN_V = 190;
const SPRINT_V = 285;
/** CPU players run a little slower than humans so they stay beatable. */
const CPU_K = 0.9;
const ACCEL = 12;
const SPRINT_T = 1.8;
const REFILL_T = 3.5;
const WALL_E = 0.72;
const BODY_E = 0.1;
const SHOOT_D = 340;
const POSTS: [number, number][] = [[MX, GY0], [MX, GY1], [FW - MX, GY0], [FW - MX, GY1]];
/** Cut corners (distance from the corner along the diagonal): a ball can never get wedged where no foot reaches. */
export const CHAMFER = 60;
const CORNERS: [number, number][] = [[MX, 0], [MX, FH], [FW - MX, 0], [FW - MX, FH]];
/** Push a circle of radius r out of the four cut corners; returns the inward normal when it touched one. */
function unCorner(o: { x: number; y: number }, r: number): [number, number] | null {
  for (const [cx, cy] of CORNERS) {
    const nx = (cx === MX ? 1 : -1) * Math.SQRT1_2, ny = (cy === 0 ? 1 : -1) * Math.SQRT1_2;
    const d = (o.x - cx) * nx + (o.y - cy) * ny - CHAMFER - r;
    if (d < 0) { o.x -= nx * d; o.y -= ny * d; return [nx, ny]; }
  }
  return null;
}
const TEAM = ['#e8822e', '#2f6fb0'];
const TEAM_DARK = ['#a8521a', '#1d4878'];

const meta: GameModule['meta'] = {
  id: 'bola-meja', title: 'Bola Meja', place: 'arcade', music: 'race',
  blurb: 'Futsal tampak atas 2 lawan 2. Cetak 5 gol atau unggul saat waktu habis.',
  view: { w: FW, h: FH + TOP }, score: { unit: 'poin', higherIsBetter: true },
  touch: ['left', 'up', 'down', 'right', 'a', 'b'],
  tutorial: [
    'Gerak dengan {arah}. Tahan {b} untuk lari. Tenaga terisi lagi saat tidak lari.',
    'Tekan {a} untuk operan. Tahan {a} lalu lepas untuk tembakan keras.',
    'Oranye menyerang ke kanan. Cetak 5 gol atau unggul saat 3 menit habis.',
  ],
  legend: [['arah', 'Gerak'], ['a', 'Tendang'], ['b', 'Lari']],
  actions: { arah: 'Gerak dan arah tendangan', a: 'Tendang (tahan untuk tembakan keras)', b: 'Lari cepat (pakai tenaga)' },
  players: 4,
  playersHint: 'Bareng: sampai 4 pemain. Pemain 1 dan 3 tim Oranye, Pemain 2 dan 4 tim Biru.',
};

const NO_INPUT: InputState = {
  down: { left: false, right: false, up: false, down: false, a: false, b: false, x: false, y: false },
  hit: { left: false, right: false, up: false, down: false, a: false, b: false, x: false, y: false },
  ax: 0, ay: 0, tap: null,
};

type Plan = 'hold' | 'dribble' | 'shoot' | 'pass' | 'clear';
interface Pl {
  seat: number; team: 0 | 1; c: CastMember; look: CastMember; cpu: boolean;
  x: number; y: number; vx: number; vy: number; fx: number; fy: number;
  stamina: number; tired: boolean;
  charging: boolean; charge: number; kickCd: number; pendT: number; pendPow: number;
  think: number; plan: Plan; aimY: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r1 = (v: number) => Math.round(v * 10) / 10;

function create(ctx: GameCtx): GameInstance {
  const { g, w, h } = ctx;
  const me = ctx.cast.find((c) => c.id === ctx.playerId) ?? ctx.cast[0];
  const pool = ctx.cast.filter((c) => c.id !== me.id);
  const cast = [me];
  for (let i = 0; i < 3; i++) cast.push(pool.length ? pool.splice(Math.floor(ctx.rand() * pool.length), 1)[0] : me);
  const humans = Math.max(1, Math.min(4, ctx.players));
  const versus = humans > 1;
  // seat i is Pemain i+1; even seats are Oranye, so with two humans they face each other
  const P: Pl[] = cast.map((c, seat) => {
    const team = (seat % 2) as 0 | 1;
    return {
      seat, team, c, look: { ...c, main: TEAM[team], accent: TEAM_DARK[team] }, cpu: seat >= humans,
      x: 0, y: 0, vx: 0, vy: 0, fx: 1, fy: 0, stamina: 1, tired: false,
      charging: false, charge: 0, kickCd: 0, pendT: 0, pendPow: 0, think: 0, plan: 'hold', aimY: FH / 2,
    };
  });
  /** ghost: the kicker's seat, whose body the ball passes through for ghostT s (a poke off a wall can go through the poker). */
  const ball = { x: FW / 2, y: FH / 2, vx: 0, vy: 0, rot: 0, dir: 0, ghost: -1, ghostT: 0 };
  const score = [0, 0];
  /** Seat of each team's attacker; the other one guards the goal. */
  const atk = [0, 1];
  let phase: 'intro' | 'play' | 'goal' | 'over' = 'intro';
  let phaseT = INTRO_T;
  let timeLeft = MATCH_T;
  let kickTeam: 0 | 1 = 0;
  let nextKick: 0 | 1 = 0;
  let holdT = HOLD_T;
  /** Seconds the ball has barely moved: a wedge between bodies and walls that a CPU must break. */
  let still = 0;
  let touched = false;
  let lastScorer = 0;
  let lastTouch = -1;
  let kicks = 0;
  let time = 0;
  let shake = 0;
  let goT = 0;
  let hudText = '';

  const team = (k: number) => (k === 0 ? ctx.t('Oranye') : ctx.t('Biru'));
  const clock = () => { const c = Math.ceil(timeLeft); return `${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}`; };
  const hud = () => {
    const s = ctx.t('Oranye {a} - {b} Biru · {t}', { a: score[0], b: score[1], t: clock() });
    if (s !== hudText) { hudText = s; ctx.setHud(s); }
  };

  function reset(kt: 0 | 1) {
    kickTeam = kt;
    Object.assign(ball, { x: FW / 2, y: FH / 2, vx: 0, vy: 0, ghostT: 0 });
    for (const p of P) {
      const side = p.team === 0 ? -1 : 1;
      p.x = p.seat < 2 ? FW / 2 + side * (p.team === kt ? PR + BR + 6 : CIRCLE + PR + 12) : p.team === 0 ? MX + 150 : FW - MX - 150;
      p.y = FH / 2;
      Object.assign(p, { vx: 0, vy: 0, fx: -side, fy: 0, charging: false, charge: 0, pendT: 0, kickCd: 0 });
      p.think = 0.25 + ctx.rand() * 0.2;
      p.plan = p.seat < 2 ? 'dribble' : 'hold';
    }
    atk[0] = 0; atk[1] = 1;
    holdT = HOLD_T;
    touched = false;
    still = 0;
  }
  reset(0);
  hud();

  function startPlay() {
    phase = 'play';
    goT = 0.8;
    ctx.sfx('start');
    hud();
  }

  function applyMove(p: Pl, dx: number, dy: number, mag: number, sprint: boolean, dt: number) {
    const want = sprint && mag > 0.2 && !p.tired && phase === 'play';
    if (want) { p.stamina = Math.max(0, p.stamina - dt / SPRINT_T); if (p.stamina === 0) p.tired = true; }
    else { p.stamina = Math.min(1, p.stamina + dt / REFILL_T); if (p.tired && p.stamina >= 0.35) p.tired = false; }
    const sp = (want ? SPRINT_V : RUN_V) * (p.cpu ? CPU_K : 1) * mag;
    const k = Math.min(1, ACCEL * dt);
    p.vx += (dx * sp - p.vx) * k;
    p.vy += (dy * sp - p.vy) * k;
    if (mag > 0.2) { p.fx = dx; p.fy = dy; }
    p.kickCd = Math.max(0, p.kickCd - dt);
  }

  function kick(p: Pl, dx: number, dy: number, power: number, strong: boolean, through = false): boolean {
    const bx = ball.x - p.x, by = ball.y - p.y, d = Math.hypot(bx, by);
    if (d > KICK_R || p.kickCd > 0) return false;
    const L = Math.hypot(dx, dy) || 1;
    dx /= L; dy /= L;
    // a ball behind the kicker pops away from the body instead of passing through it
    if (!through && d > 1e-6 && (dx * bx + dy * by) / d < -0.2) { dx = bx / d; dy = by / d; power *= 0.6; }
    ball.vx = dx * power;
    ball.vy = dy * power;
    ball.ghost = p.seat;
    ball.ghostT = through ? 0.25 : 0.1;
    p.kickCd = 0.25;
    kicks++;
    touched = true;
    lastTouch = p.seat;
    ctx.sfx(strong ? 'whoosh' : 'ball', { pan: (ball.x / FW) * 2 - 1, rate: 0.9 + (power / SHOT_V) * 0.3, gain: p.cpu ? 0.7 : 1 });
    if (strong && !ctx.reducedMotion) shake = Math.max(shake, 0.12);
    if (p.seat === 0 && !p.cpu) ctx.rumble(strong ? 0.5 : 0.2, strong ? 90 : 40);
    return true;
  }

  /** Human kick: k is the charge fraction 0..1. A tap toward a teammate becomes a pass to their feet. */
  function humanKick(p: Pl, dx: number, dy: number, k: number): boolean {
    let power = PASS_V + (SHOT_V - PASS_V) * k;
    if (k < STRONG) {
      const mt = P[p.seat ^ 2];
      const mx = mt.x + mt.vx * 0.25 - ball.x, my = mt.y + mt.vy * 0.25 - ball.y, md = Math.hypot(mx, my);
      if (md > 60 && md < 560 && (mx * dx + my * dy) / md > 0.82) { dx = mx; dy = my; power = Math.min(680, 220 + md * 0.9); }
    }
    return kick(p, dx, dy, power, k >= STRONG);
  }

  function humanStep(p: Pl, inp: InputState, dt: number) {
    const m = Math.hypot(inp.ax, inp.ay);
    const mag = m < 0.15 ? 0 : Math.min(1, m);
    const ax = mag ? inp.ax / m : 0, ay = mag ? inp.ay / m : 0;
    if (inp.hit.a && !p.charging) { p.charging = true; p.charge = 0; }
    if (p.charging) {
      if (inp.down.a) p.charge = Math.min(MAX_CHARGE, p.charge + dt);
      else { p.charging = false; p.pendT = 0.15; p.pendPow = p.charge / MAX_CHARGE; }
    }
    // a release just before the ball arrives still kicks once it is in reach
    if (p.pendT > 0) {
      p.pendT -= dt;
      if (humanKick(p, mag ? ax : p.fx, mag ? ay : p.fy, p.pendPow)) p.pendT = 0;
    }
    applyMove(p, ax, ay, mag, inp.down.b, dt);
  }

  function laneClear(x0: number, y0: number, x1: number, y1: number, tm: number) {
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1;
    return P.every((q) => {
      if (q.team === tm) return true;
      const s = clamp(((q.x - x0) * dx + (q.y - y0) * dy) / L2, 0, 1);
      return Math.hypot(x0 + dx * s - q.x, y0 + dy * s - q.y) > PR + BR + 8;
    });
  }

  /** Whoever of a team is clearly closer to the ball attacks; the margin stops the roles flickering. */
  function assignRoles() {
    for (const tm of [0, 1]) {
      const cur = atk[tm], other = cur === tm ? tm + 2 : tm;
      const d = (s: number) => Math.hypot(P[s].x - ball.x, P[s].y - ball.y);
      if (d(other) < d(cur) - 40) atk[tm] = other;
    }
  }

  function cpuStep(p: Pl, dt: number) {
    const dir = p.team === 0 ? 1 : -1;
    const goalX = p.team === 0 ? FW - MX : MX, ownX = FW - goalX;
    const mate = P[p.seat ^ 2];
    const toBall = Math.hypot(ball.x - p.x, ball.y - p.y);
    const ownHalf = (ball.x - FW / 2) * dir < 0;
    const press = atk[p.team] === p.seat || (ownHalf && toBall < 150 && Math.abs(ball.x - ownX) < 330);
    // decisions only every 0.14 to 0.28 s: a reaction delay a human can beat
    p.think -= dt;
    if (p.think <= 0) {
      p.think = 0.14 + ctx.rand() * 0.14;
      p.aimY = FH / 2 + (ctx.rand() * 2 - 1) * (GOAL_W / 2 - 16);
      const dGoal = Math.hypot(goalX - ball.x, FH / 2 - ball.y);
      const mateAhead = (mate.x - ball.x) * dir > 80 && laneClear(ball.x, ball.y, mate.x, mate.y, p.team);
      if (!press) p.plan = 'hold';
      else if (atk[p.team] !== p.seat) p.plan = 'clear';
      else if (dGoal < SHOOT_D) p.plan = 'shoot';
      else if (mateAhead && ctx.rand() < 0.5) p.plan = 'pass';
      else p.plan = ctx.rand() < 0.08 ? 'shoot' : 'dribble';
    }
    let tx: number, ty: number;
    if (p.plan !== 'hold') {
      const aimX = p.plan === 'pass' ? mate.x + mate.vx * 0.3 : goalX;
      const aimY = p.plan === 'pass' ? mate.y + mate.vy * 0.3 : p.plan === 'clear' ? FH / 2 : p.aimY;
      let gx = aimX - ball.x, gy = aimY - ball.y;
      const gl = Math.hypot(gx, gy) || 1;
      gx /= gl; gy /= gl;
      const rx = p.x - ball.x, ry = p.y - ball.y;
      if (rx * gx + ry * gy > -PR * 0.6) {
        // wrong side of the ball: loop round it instead of pushing it back, on the side that stays on court
        let s = rx * -gy + ry * gx >= 0 ? 1 : -1;
        const side = (k: number) => ball.y + gx * k * (PR + BR + 14) - gy * (PR + BR + 26);
        if (side(s) > FH - PR || side(s) < PR) s = -s;
        tx = ball.x - gx * (PR + BR + 26) - gy * s * (PR + BR + 14);
        ty = side(s);
      } else { tx = ball.x + gx * 14; ty = ball.y + gy * 14; }
      const onWall = ball.y < BR + 30 || ball.y > FH - BR - 30;
      if (still > 0.6 && toBall < KICK_R) {
        // pinned on a wall or in a shoving match: poke it away from the closest other body, back into the court
        let ox = 0, oy = 0, od = Infinity;
        for (const q of P) {
          const qd = q === p ? Infinity : Math.hypot(ball.x - q.x, ball.y - q.y);
          if (qd < od) { od = qd; ox = ball.x - q.x; oy = ball.y - q.y; }
        }
        const ol = Math.hypot(ox, oy) || 1;
        const ky = oy / ol + (onWall ? (ball.y < FH / 2 ? 1 : -1) * 0.8 : 0) + (ctx.rand() - 0.5) * 0.4;
        kick(p, ox / ol + dir * 0.3, ky, 480 + ctx.rand() * 200, false, true);
      } else if (p.plan !== 'dribble' && toBall < KICK_R && (ball.x - p.x) * gx + (ball.y - p.y) * gy > 0.55 * toBall) {
        const power = p.plan === 'shoot' ? 640 + ctx.rand() * 280 : p.plan === 'pass' ? Math.min(680, 220 + gl * 0.9) : 600 + ctx.rand() * 200;
        kick(p, gx, gy, power, power > 700);
      }
    } else {
      // guard: on the line from own goal to the ball, never past the halfway line
      tx = ownX + (ball.x - ownX) * 0.32;
      ty = FH / 2 + (ball.y - FH / 2) * 0.32;
      if ((tx - ownX) * dir < 70) tx = ownX + dir * 70;
      if ((tx - FW / 2) * dir > -60) tx = FW / 2 - dir * 60;
      if (toBall < KICK_R && (ball.x - p.x) * dir > 0) kick(p, dir, (FH / 2 - ball.y) * 0.002, 720, true);
    }
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
    const sprint = p.plan === 'hold' ? d > 220 : toBall > 170;
    if (d > 1e-6) applyMove(p, dx / d, dy / d, Math.min(1, d / 30), sprint, dt);
    else applyMove(p, 0, 0, 0, false, dt);
  }

  function walls() {
    const b = ball;
    const sp = Math.hypot(b.vx, b.vy);
    const bump = () => { if (sp > 260) ctx.sfx('thud', { pan: (b.x / FW) * 2 - 1, gain: 0.4 }); };
    if (b.y < BR) { b.y = BR; b.vy = Math.abs(b.vy) * WALL_E; bump(); }
    if (b.y > FH - BR) { b.y = FH - BR; b.vy = -Math.abs(b.vy) * WALL_E; bump(); }
    for (const side of [0, 1]) {
      const line = side ? FW - MX : MX, out = side ? 1 : -1;
      const past = (b.x - line) * out;
      if (past > 0) {
        // inside the net: side netting and the back soak up the ball
        if (b.y < GY0 + BR) { b.y = GY0 + BR; b.vy = Math.abs(b.vy) * 0.3; }
        if (b.y > GY1 - BR) { b.y = GY1 - BR; b.vy = -Math.abs(b.vy) * 0.3; }
        if (past > GD - BR) { b.x = line + out * (GD - BR); b.vx = -out * Math.abs(b.vx) * 0.2; }
      } else if ((b.y < GY0 || b.y > GY1) && past > -BR) {
        b.x = line - out * BR;
        b.vx = -out * Math.abs(b.vx) * WALL_E;
        bump();
      }
    }
    if (b.x > MX && b.x < FW - MX) {
      const n = unCorner(b, BR);
      const vn = n ? b.vx * n[0] + b.vy * n[1] : 0;
      if (n && vn < 0) { b.vx -= (1 + WALL_E) * vn * n[0]; b.vy -= (1 + WALL_E) * vn * n[1]; if (-vn > 260) ctx.sfx('thud', { pan: (b.x / FW) * 2 - 1, gain: 0.4 }); }
    }
    for (const [px, py] of POSTS) {
      const dx = b.x - px, dy = b.y - py, d = Math.hypot(dx, dy), R = BR + 4;
      if (d >= R || d < 1e-6) continue;
      const nx = dx / d, ny = dy / d;
      b.x = px + nx * R; b.y = py + ny * R;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        b.vx -= 1.6 * vn * nx; b.vy -= 1.6 * vn * ny;
        if (-vn > 120) ctx.sfx('clack', { pan: (px / FW) * 2 - 1 });
      }
    }
  }

  function physics(dt: number) {
    for (const p of P) {
      p.x = clamp(p.x + p.vx * dt, MX + PR, FW - MX - PR);
      p.y = clamp(p.y + p.vy * dt, PR, FH - PR);
      unCorner(p, PR);
      if (phase === 'play' && holdT > 0 && !touched && p.team !== kickTeam) {
        const cx = p.x - FW / 2, cy = p.y - FH / 2, d = Math.hypot(cx, cy), R = CIRCLE + PR;
        if (d < R) { if (d > 1e-6) { p.x = FW / 2 + (cx * R) / d; p.y = FH / 2 + (cy * R) / d; } else p.x = FW / 2 + (p.team === 0 ? -R : R); }
      }
    }
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      const a = P[i], b = P[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d >= 2 * PR || d < 1e-6) continue;
      const o = (2 * PR - d) / 2, nx = dx / d, ny = dy / d;
      a.x -= nx * o; a.y -= ny * o; b.x += nx * o; b.y += ny * o;
    }
    const ox = ball.x, oy = ball.y;
    let s = Math.hypot(ball.vx, ball.vy);
    const k = s > 0 ? Math.max(0, s * Math.exp(-BALL_DRAG * dt) - ROLL * dt) / s : 0;
    ball.vx *= k; ball.vy *= k;
    s *= k;
    if (s > BALL_MAX) { ball.vx *= BALL_MAX / s; ball.vy *= BALL_MAX / s; s = BALL_MAX; }
    if (s < 6) { ball.vx = 0; ball.vy = 0; s = 0; }
    if (s > 0) ball.dir = Math.atan2(ball.vy, ball.vx);
    ball.rot += (s * dt) / BR;
    ball.ghostT -= dt;
    // substeps keep a hard shot (16 units a frame) from skipping a post or a body
    const n = Math.max(1, Math.ceil((s * dt) / (BR * 0.8)));
    for (let i = 0; i < n; i++) {
      ball.x += (ball.vx * dt) / n; ball.y += (ball.vy * dt) / n;
      // bodies are immovable for the ball: running into it pushes it ahead (dribble)
      for (const p of P) {
        const dx = ball.x - p.x, dy = ball.y - p.y, d = Math.hypot(dx, dy);
        if (d >= PR + BR || (p.seat === ball.ghost && ball.ghostT > 0)) continue;
        const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0;
        ball.x = p.x + nx * (PR + BR); ball.y = p.y + ny * (PR + BR);
        const vn = (ball.vx - p.vx) * nx + (ball.vy - p.vy) * ny;
        if (vn < 0) { ball.vx -= (1 + BODY_E) * vn * nx; ball.vy -= (1 + BODY_E) * vn * ny; }
        touched = true;
        lastTouch = p.seat;
      }
      walls();
    }
    const contact = P.some((p) => Math.hypot(ball.x - p.x, ball.y - p.y) < PR + BR + 3);
    still = contact && Math.hypot(ball.x - ox, ball.y - oy) < 40 * dt ? still + dt : 0;
    // a wall can push the ball back into a body; then the body gives way so nothing overlaps
    for (const p of P) {
      const dx = p.x - ball.x, dy = p.y - ball.y, d = Math.hypot(dx, dy);
      if (d >= PR + BR || d < 1e-6 || (p.seat === ball.ghost && ball.ghostT > 0)) continue;
      p.x = clamp(ball.x + (dx / d) * (PR + BR), MX + PR, FW - MX - PR);
      p.y = clamp(ball.y + (dy / d) * (PR + BR), PR, FH - PR);
    }
  }

  function goal(tm: 0 | 1) {
    score[tm]++;
    lastScorer = tm;
    nextKick = (1 - tm) as 0 | 1;
    phase = 'goal';
    phaseT = GOAL_PAUSE;
    for (const p of P) { p.charging = false; p.pendT = 0; }
    // solo: the big cheer only for Budi's team
    ctx.sfx(versus || tm === 0 ? 'win' : 'coin');
    if (tm === 0) ctx.rumble(0.6, 200);
    if (!ctx.reducedMotion) shake = 0.3;
    hud();
  }

  function finish() {
    phase = 'over';
    const [o, b] = score;
    ctx.sfx('beep');
    hud();
    if (versus) {
      const summary = o > b ? ctx.t('Oranye menang {a}-{b}', { a: o, b }) : b > o ? ctx.t('Biru menang {a}-{b}', { a: b, b: o }) : ctx.t('Seri {a}-{b}', { a: o, b });
      ctx.end({ score: 0, versus: true, won: o > b, summary });
      return;
    }
    const won = o > b;
    const summary = won ? ctx.t('Menang {a}-{b} lawan Biru', { a: o, b }) : o === b ? ctx.t('Seri {a}-{b}', { a: o, b }) : ctx.t('Kalah {a}-{b} lawan Biru', { a: o, b });
    ctx.end({ score: o * 100 + Math.max(0, o - b) * 50 + (won ? 300 : 0), won, summary });
  }

  return {
    update(dt, inp) {
      time += dt;
      shake = Math.max(0, shake - dt);
      goT = Math.max(0, goT - dt);
      if (phase === 'over') return;
      if (phase === 'intro') {
        phaseT -= dt;
        if (phaseT <= 0) startPlay();
        return;
      }
      if (phase === 'goal') {
        phaseT -= dt;
        for (const p of P) applyMove(p, 0, 0, 0, false, dt);
        physics(dt);
        if (phaseT > 0) return;
        if (Math.max(...score) >= WIN_GOALS) finish();
        else { reset(nextKick); startPlay(); }
        return;
      }
      const before = Math.ceil(timeLeft);
      timeLeft = Math.max(0, timeLeft - dt);
      const now = Math.ceil(timeLeft);
      if (now !== before && now <= 10 && now > 0) ctx.sfx('tick', { gain: 0.6 });
      holdT -= dt;
      const ins: InputState[] = inp.players ?? [inp];
      assignRoles();
      for (const p of P) {
        if (p.cpu) cpuStep(p, dt);
        else humanStep(p, ins[p.seat] ?? NO_INPUT, dt);
      }
      physics(dt);
      if (ball.x < MX - BR) goal(1);
      else if (ball.x > FW - MX + BR) goal(0);
      else if (timeLeft <= 0) finish();
      hud();
    },

    render() {
      g.save();
      if (shake > 0 && !ctx.reducedMotion) g.translate(Math.sin(time * 80) * shake * 10, Math.cos(time * 67) * shake * 7);
      g.fillStyle = PAL.surface;
      g.fillRect(-12, -12, w + 24, h + 24);
      topBar();
      g.save();
      g.translate(0, TOP);
      court();
      const order = [0, 1, 2, 3].sort((a, b) => P[a].y - P[b].y);
      for (const i of order) drawPlayer(P[i]);
      drawBall();
      g.restore();
      banners();
      g.restore();
    },

    snapshot: () => ({
      phase, versus, humans, kickTeam, kicks, lastTouch,
      timeLeft: Math.round(timeLeft * 100) / 100,
      score: [...score],
      ball: { x: r1(ball.x), y: r1(ball.y), vx: r1(ball.vx), vy: r1(ball.vy) },
      players: P.map((p) => ({
        seat: p.seat, id: p.c.id, team: p.team === 0 ? 'oranye' : 'biru', cpu: p.cpu, x: r1(p.x), y: r1(p.y),
        stamina: Math.round(p.stamina * 100) / 100, charging: p.charging, attacker: atk[p.team] === p.seat,
      })),
    }),
  };

  function label(p: Pl) {
    return p.cpu ? p.c.name : versus ? `P${p.seat + 1}` : ctx.t('Kamu');
  }

  function topBar() {
    for (const tm of [0, 1]) {
      const x = tm ? w - 318 : 8;
      g.fillStyle = TEAM[tm];
      roundRect(g, x, 5, 310, 30, 10);
      const names = `${label(P[tm])} · ${label(P[tm + 2])}`;
      if (tm === 0) {
        text(g, `${team(0)} ${score[0]}`, x + 12, 20, 19, '#fffaf0', 'left');
        text(g, names, x + 298, 20, 12, '#fffaf0', 'right', 600);
      } else {
        text(g, `${score[1]} ${team(1)}`, x + 298, 20, 19, '#fffaf0', 'right');
        text(g, names, x + 12, 20, 12, '#fffaf0', 'left', 600);
      }
    }
    text(g, clock(), w / 2, 20, 22, phase === 'play' && timeLeft <= 10 ? PAL.red : PAL.ink);
  }

  function court() {
    g.fillStyle = '#3f6b3c';
    g.fillRect(0, 0, FW, FH);
    const band = (FW - 2 * MX) / 11;
    for (let i = 0; i < 11; i++) { g.fillStyle = i % 2 ? '#5a9150' : '#62995a'; g.fillRect(MX + i * band, 0, band + 1, FH); }
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 3;
    g.strokeRect(MX, 2, FW - 2 * MX, FH - 4);
    g.beginPath(); g.moveTo(FW / 2, 2); g.lineTo(FW / 2, FH - 2); g.stroke();
    g.beginPath(); g.arc(FW / 2, FH / 2, CIRCLE, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(MX, FH / 2, 120, -Math.PI / 2, Math.PI / 2); g.stroke();
    g.beginPath(); g.arc(FW - MX, FH / 2, 120, Math.PI / 2, Math.PI * 1.5); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath(); g.arc(FW / 2, FH / 2, 4, 0, Math.PI * 2); g.fill();
    for (const side of [0, 1]) {
      const x0 = side ? FW - MX : MX - GD;
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.fillRect(x0, GY0, GD, GOAL_W);
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 1;
      g.beginPath();
      for (let y = GY0 + 10; y < GY1; y += 10) { g.moveTo(x0, y); g.lineTo(x0 + GD, y); }
      for (let x = x0 + 8; x < x0 + GD; x += 8) { g.moveTo(x, GY0); g.lineTo(x, GY1); }
      g.stroke();
      // colour strip: whose goal this is (Oranye defends the left)
      g.fillStyle = TEAM[side];
      g.fillRect(side ? FW - MX + GD - 5 : MX - GD, GY0, 5, GOAL_W);
    }
    g.fillStyle = '#3f6b3c';
    for (const [cx, cy] of CORNERS) {
      const sx = cx === MX ? 1 : -1, sy = cy === 0 ? 1 : -1, c = CHAMFER * Math.SQRT2;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + sx * c, cy); g.lineTo(cx, cy + sy * c); g.closePath(); g.fill();
    }
    g.fillStyle = '#fffaf0';
    for (const [px, py] of POSTS) { g.beginPath(); g.arc(px, py, 5, 0, Math.PI * 2); g.fill(); }
  }

  function drawPlayer(p: Pl) {
    g.globalAlpha = 0.45;
    g.fillStyle = TEAM[p.team];
    g.beginPath(); g.arc(p.x, p.y, PR, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
    if (!p.cpu) {
      g.strokeStyle = 'rgba(29,42,35,0.6)';
      g.lineWidth = 7;
      g.beginPath(); g.arc(p.x, p.y, PR + 4, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = PLAYER_COLORS[p.seat];
      g.lineWidth = 4;
      g.beginPath(); g.arc(p.x, p.y, PR + 4, 0, Math.PI * 2); g.stroke();
    }
    // facing tick: where a kick goes when no direction is held
    const tx = p.x + p.fx * (PR + 8), ty = p.y + p.fy * (PR + 8);
    g.fillStyle = p.cpu ? 'rgba(255,255,255,0.6)' : PLAYER_COLORS[p.seat];
    g.beginPath();
    g.moveTo(tx + p.fx * 6, ty + p.fy * 6); g.lineTo(tx - p.fy * 5, ty + p.fx * 5); g.lineTo(tx + p.fy * 5, ty - p.fx * 5);
    g.closePath(); g.fill();
    if (p.charging) {
      const k = p.charge / MAX_CHARGE, a0 = Math.atan2(p.fy, p.fx), sw = 0.35 + k * 1.1;
      g.strokeStyle = k >= STRONG ? PAL.red : PAL.gold;
      g.lineWidth = 5;
      g.beginPath(); g.arc(p.x, p.y, PR + 11, a0 - sw, a0 + sw); g.stroke();
    }
    drawToken(g, p.look, p.x, p.y - 6, 16, time + p.seat, Math.hypot(p.vx, p.vy) > 30);
    if (p.cpu) return;
    // name tag in the seat colour: the same pill every multiplayer game uses
    seatTag(g, label(p), p.x, p.y - PR - 22, PLAYER_COLORS[p.seat]);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    roundRect(g, p.x - 16, p.y + PR + 6, 32, 5, 2);
    g.fillStyle = p.tired ? PAL.red : '#f2d16b';
    if (p.stamina > 0.02) roundRect(g, p.x - 16, p.y + PR + 6, 32 * p.stamina, 5, 2);
  }

  function drawBall() {
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath(); g.ellipse(ball.x + 3, ball.y + 5, BR, BR * 0.5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fffaf0';
    g.beginPath(); g.arc(ball.x, ball.y, BR, 0, Math.PI * 2); g.fill();
    // two patches sliding along the travel direction read as rolling
    const cx = Math.cos(ball.dir), cy = Math.sin(ball.dir);
    g.fillStyle = '#2b2b2b';
    for (const ph of [0, Math.PI]) {
      const o = Math.sin(ball.rot + ph) * 5;
      if (Math.cos(ball.rot + ph) < 0) continue;
      g.beginPath(); g.arc(ball.x + cx * o, ball.y + cy * o, 3.2, 0, Math.PI * 2); g.fill();
    }
  }

  function card(title: string, sub: string, color: string) {
    const cy = TOP + FH / 2;
    g.fillStyle = 'rgba(255,250,240,0.92)';
    roundRect(g, w / 2 - 210, cy - 48, 420, 96, 16);
    text(g, title, w / 2, cy - 14, 32, color);
    text(g, sub, w / 2, cy + 22, 17, PAL.ink2);
  }

  function banners() {
    const line = ctx.t('Oranye {a} - {b} Biru', { a: score[0], b: score[1] });
    if (phase === 'intro') card(ctx.t('Sepak mula'), ctx.t('Oranye menyerang ke kanan, Biru ke kiri'), PAL.green);
    else if (phase === 'goal') card(lastScorer === 0 ? ctx.t('Gol Oranye!') : ctx.t('Gol Biru!'), line, TEAM[lastScorer]);
    else if (phase === 'over') card(timeLeft <= 0 ? ctx.t('Waktu habis') : ctx.t('Pertandingan selesai'), line, PAL.green);
    else if (goT > 0) {
      g.globalAlpha = Math.min(1, goT / 0.3);
      text(g, ctx.t('Mulai!'), w / 2, TOP + FH / 2 - 70, 40, '#fffaf0');
      g.globalAlpha = 1;
    }
  }
}

export default { meta, create } satisfies GameModule;
