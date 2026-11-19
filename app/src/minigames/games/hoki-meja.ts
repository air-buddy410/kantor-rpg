// Hoki Meja (Game Station slot 10). Top-down air hockey, one on one: Pemain 1
// holds the left half, Pemain 2 or the computer the right. First to 7 goals.
// Physics: mallets are kinematic (the hand behind them outweighs the puck), so
// a contact reflects the puck's velocity relative to the mallet with
// restitution E_HIT and the mallet's own speed carries into the shot. Each
// frame is split into sub-steps of at most half a puck radius of relative
// travel, so a fast puck never tunnels through a mallet or a rail.
import type { CastMember, GameCtx, GameInstance, GameModule } from '../types';
import { PLAYER_COLORS } from '../local-players';
import { PAL, drawToken, roundRect, text } from '../cast';

export const TABLE = { x0: 40, y0: 64, x1: 920, y1: 544 };
export const MIDX = (TABLE.x0 + TABLE.x1) / 2;
export const CY = (TABLE.y0 + TABLE.y1) / 2;
export const GOAL_HALF = 88;
export const R_PUCK = 16;
export const R_MALLET = 30;
/** Mallet top speed from the stick or keys, and during a dash (units/s). */
export const MAX_SPEED = 900;
export const DASH_SPEED = 1400;
export const DASH_T = 0.15;
export const DASH_CD = 1.2;
/** High acceleration (and twice that to brake) so arrow keys start and stop within a few frames. */
const ACC = 16000;
/** Pointer drag: fraction of the gap closed per second (capped by the top speed). */
const FOLLOW = 30;
export const PUCK_MAX = 1800;
export const E_HIT = 0.9;
export const E_WALL = 0.88;
/** Speed a puck squeezed between both mallets leaves sideways with. */
const SQUIRT = 420;
/** Air table drag per second, small so a shot keeps most of its pace across. */
const FRICTION = 0.3;
export const WIN_GOALS = 7;
export const READY_T = 1.2;
export const GOAL_PAUSE = 1;
export const END_T = 1.8;
/** Faceoff spot: this far from the centre line, in front of the player who conceded. */
export const FACE_DX = 170;
/** Air hockey's possession rule: a puck left this long in one half goes to the other player. */
export const POSSESS_T = 7;
// One fair computer: a bit slower than a human, sees the puck REACT_F frames late, aims with error.
const CPU_MAX = 760;
const REACT_F = 8;
const AIM_ERR = 60;
/** Blocking error per incoming shot: still a save most times, but the rebound angle varies and edges slip by. */
const DEF_ERR = 30;
const DEF_X = TABLE.x1 - 95;

const meta: GameModule['meta'] = {
  id: 'hoki-meja', title: 'Hoki Meja', place: 'arcade', music: 'arcade',
  blurb: 'Air hockey satu lawan satu. Yang pertama 7 gol menang.',
  view: { w: 960, h: 560 }, score: { unit: 'poin', higherIsBetter: true },
  touch: ['left', 'up', 'down', 'right', 'a'],
  tutorial: [
    'Gerakkan pemukul dengan {arah}. Pemukul tetap di separuh mejamu.',
    'Tekan {a} untuk sentakan: pemukul melesat dan pukulan lebih keras.',
    'Masukkan keping ke gawang lawan. Yang pertama 7 gol menang.',
  ],
  legend: [['arah', 'Gerak'], ['a', 'Sentak']],
  actions: { arah: 'Gerakkan pemukul', a: 'Sentak (pukulan keras, jeda 1,2 detik)' },
  pointerHint: 'Geser jari di mejamu untuk menggerakkan pemukul.',
  players: 2,
  playersHint: 'Bareng: 2 pemain, kiri lawan kanan. Tanpa Pemain 2 lawannya komputer.',
};

export interface Disc { x: number; y: number; vx: number; vy: number }
export interface Mallet extends Disc { side: 0 | 1; dashT: number; cd: number }
export type PhysEvent = { kind: 'hit'; side: 0 | 1; j: number; x: number } | { kind: 'wall'; v: number; x: number } | { kind: 'goal'; scorer: 0 | 1 };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Where a mallet centre may go: its own half, inside the rails. */
export function bounds(side: 0 | 1) {
  return {
    x0: side === 0 ? TABLE.x0 + R_MALLET : MIDX + R_MALLET,
    x1: side === 0 ? MIDX - R_MALLET : TABLE.x1 - R_MALLET,
    y0: TABLE.y0 + R_MALLET, y1: TABLE.y1 - R_MALLET,
  };
}
export const home = (side: 0 | 1) => ({ x: side === 0 ? TABLE.x0 + 100 : TABLE.x1 - 100, y: CY });
export function makeMallet(side: 0 | 1): Mallet { return { ...home(side), vx: 0, vy: 0, side, dashT: 0, cd: 0 }; }

/** Pemain 1's leaderboard points for a solo match. */
export const soloScore = (mine: number, theirs: number) => mine * 100 + Math.max(0, mine - theirs) * 50 + (mine >= WIN_GOALS ? 400 : 0);

/** Keep a mallet in its half; the rail stops the velocity part pointing into it, so shots use the real speed. */
export function clampMallet(m: Mallet) {
  const b = bounds(m.side);
  if (m.x < b.x0) { m.x = b.x0; if (m.vx < 0) m.vx = 0; }
  if (m.x > b.x1) { m.x = b.x1; if (m.vx > 0) m.vx = 0; }
  if (m.y < b.y0) { m.y = b.y0; if (m.vy < 0) m.vy = 0; }
  if (m.y > b.y1) { m.y = b.y1; if (m.vy > 0) m.vy = 0; }
}

/** Puck against a kinematic mallet; returns the impulse (0 = no impact). */
export function hitMallet(p: Disc, m: Mallet, e = E_HIT): number {
  const R = R_PUCK + R_MALLET;
  const dx = p.x - m.x, dy = p.y - m.y, d = Math.hypot(dx, dy);
  if (d >= R) return 0;
  const nx = d > 0 ? dx / d : m.side === 0 ? 1 : -1, ny = d > 0 ? dy / d : 0;
  p.x = m.x + nx * R; p.y = m.y + ny * R;
  const vrel = (p.vx - m.vx) * nx + (p.vy - m.vy) * ny;
  if (vrel >= 0) return 0;
  const j = -(1 + e) * vrel;
  p.vx += j * nx; p.vy += j * ny;
  return j;
}

function post(p: Disc, px: number, py: number, ev: PhysEvent[]) {
  const dx = p.x - px, dy = p.y - py, d = Math.hypot(dx, dy);
  if (d >= R_PUCK || d === 0) return;
  const nx = dx / d, ny = dy / d;
  p.x = px + nx * R_PUCK; p.y = py + ny * R_PUCK;
  const vn = p.vx * nx + p.vy * ny;
  if (vn >= 0) return;
  ev.push({ kind: 'wall', v: -vn, x: p.x });
  p.vx -= (1 + E_WALL) * vn * nx; p.vy -= (1 + E_WALL) * vn * ny;
}

/** Rails and goal posts; returns the scorer once the puck centre crosses a goal line, else -1. */
function rails(p: Disc, ev: PhysEvent[]): -1 | 0 | 1 {
  const { x0, y0, x1, y1 } = TABLE, r = R_PUCK;
  if (p.y < y0 + r) { p.y = y0 + r; if (p.vy < 0) { ev.push({ kind: 'wall', v: -p.vy, x: p.x }); p.vy = -p.vy * E_WALL; p.vx *= 0.98; } }
  if (p.y > y1 - r) { p.y = y1 - r; if (p.vy > 0) { ev.push({ kind: 'wall', v: p.vy, x: p.x }); p.vy = -p.vy * E_WALL; p.vx *= 0.98; } }
  // posts first: their push can move the puck out of the mouth band, where the end rails take over
  for (const gx of [x0, x1]) { post(p, gx, CY - GOAL_HALF, ev); post(p, gx, CY + GOAL_HALF, ev); }
  if (Math.abs(p.y - CY) >= GOAL_HALF) {
    if (p.x < x0 + r) { p.x = x0 + r; if (p.vx < 0) { ev.push({ kind: 'wall', v: -p.vx, x: p.x }); p.vx = -p.vx * E_WALL; p.vy *= 0.98; } }
    if (p.x > x1 - r) { p.x = x1 - r; if (p.vx > 0) { ev.push({ kind: 'wall', v: p.vx, x: p.x }); p.vx = -p.vx * E_WALL; p.vy *= 0.98; } }
  }
  return p.x < x0 ? 1 : p.x > x1 ? 0 : -1;
}

/**
 * Both mallets closing on the puck across the centre line: instead of buzzing
 * between them at full speed it squirts out sideways, the way a real puck does.
 */
function pinch(p: Disc, ms: Mallet[]): boolean {
  if (ms.length < 2) return false;
  const [a, b] = ms;
  const R = R_PUCK + R_MALLET + 0.5;
  if (Math.hypot(p.x - a.x, p.y - a.y) >= R || Math.hypot(p.x - b.x, p.y - b.y) >= R) return false;
  const ul = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const nx = -(b.y - a.y) / ul, ny = (b.x - a.x) / ul;
  const off = (p.x - a.x) * nx + (p.y - a.y) * ny;
  // already off centre: keep going that way; dead centre: toward the roomier side of the table
  const sg = Math.abs(off) > 0.5 ? Math.sign(off) : Math.sign(ny * (CY - p.y)) || 1;
  p.vx = nx * sg * SQUIRT; p.vy = ny * sg * SQUIRT;
  p.x += nx * sg; p.y += ny * sg;
  return true;
}

/** Advance puck and mallets by dt; returns the scorer if a goal went in, else -1. */
export function physicsStep(p: Disc, ms: Mallet[], dt: number, ev: PhysEvent[] = []): -1 | 0 | 1 {
  let mv = 0;
  for (const m of ms) mv = Math.max(mv, Math.hypot(m.vx, m.vy));
  const n = clamp(Math.ceil(((Math.hypot(p.vx, p.vy) + mv) * dt) / (R_PUCK * 0.5)), 2, 48);
  const h = dt / n;
  const drag = 1 - FRICTION * h;
  const R = R_PUCK + R_MALLET;
  for (let s = 0; s < n; s++) {
    for (const m of ms) { m.x += m.vx * h; m.y += m.vy * h; clampMallet(m); }
    p.x += p.vx * h; p.y += p.vy * h;
    p.vx *= drag; p.vy *= drag;
    let goal = rails(p, ev);
    if (goal < 0) {
      if (!pinch(p, ms)) for (const m of ms) { const j = hitMallet(p, m); if (j > 0) ev.push({ kind: 'hit', side: m.side, j, x: p.x }); }
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > PUCK_MAX) { p.vx *= PUCK_MAX / sp; p.vy *= PUCK_MAX / sp; }
      goal = rails(p, ev);
    }
    if (goal !== -1) { ev.push({ kind: 'goal', scorer: goal }); return goal; }
    // a puck pinned against a rail cannot give way, so the mallet does; dropping its push
    // toward the puck stops a pinned puck from being pumped with energy every sub-step
    for (const m of ms) {
      const dx = m.x - p.x, dy = m.y - p.y, d = Math.hypot(dx, dy);
      if (d > 0 && d < R - 0.01) {
        const nx = dx / d, ny = dy / d;
        m.x = p.x + nx * R; m.y = p.y + ny * R; clampMallet(m);
        const vn = m.vx * nx + m.vy * ny;
        if (vn < 0) { m.vx -= vn * nx; m.vy -= vn * ny; }
      }
    }
  }
  return -1;
}

type Ptr = { x: number; y: number; down: boolean } | null | undefined;

function create(ctx: GameCtx): GameInstance {
  const { g, w, h } = ctx;
  const versus = ctx.players >= 2;
  const humans = versus ? 2 : 1;
  const me = ctx.cast.find((c) => c.id === ctx.playerId) ?? ctx.cast[0];
  const others = ctx.cast.filter((c) => c.id !== me.id);
  const rival: CastMember = !others.length ? me : versus ? others[0] : others[Math.floor(ctx.rand() * others.length)];
  const who = [me, rival];
  const mallets: Mallet[] = [makeMallet(0), makeMallet(1)];
  const puck: Disc = { x: MIDX, y: CY, vx: 0, vy: 0 };
  const score = [0, 0];
  let phase: 'ready' | 'play' | 'goal' | 'foul' | 'end' | 'over' = 'ready';
  let timer = READY_T;
  let lastScorer: -1 | 0 | 1 = -1;
  /** Who gets the next faceoff, and how long the puck has sat in its current half. */
  let nextFace: 0 | 1 = 0;
  let held = 0;
  let heldSide: 0 | 1 = 0;
  let clackT = 0;
  let time = 0;
  let shake = 0;
  let hits = 0;
  /** Glow on each goal slot after a goal, index 0 = left goal. */
  const flash = [0, 0];
  const trail: { x: number; y: number }[] = [];
  const dashDir = [{ x: 1, y: 0 }, { x: -1, y: 0 }];
  const ai = { hist: [] as Disc[], attacking: false, aimY: CY, bank: 0, dash: false, stuck: 0, incoming: false, defErr: 0 };

  const label = (k: number) => (versus ? ctx.t('Pemain {n}', { n: k + 1 }) : k === 0 ? ctx.t('Kamu') : ctx.t('Lawan'));
  const hud = () => ctx.setHud(versus
    ? ctx.t('Pemain 1 {a} - {b} Pemain 2', { a: score[0], b: score[1] })
    : ctx.t('Kamu {a} - {b} Lawan', { a: score[0], b: score[1] }));

  function faceoff(side: 0 | 1) {
    puck.x = side === 0 ? MIDX - FACE_DX : MIDX + FACE_DX; puck.y = CY; puck.vx = 0; puck.vy = 0;
    mallets[0] = makeMallet(0); mallets[1] = makeMallet(1);
    ai.hist.length = 0; ai.attacking = false; ai.stuck = 0;
    trail.length = 0;
    held = 0; heldSide = side;
  }
  faceoff(ctx.rand() < 0.5 ? 0 : 1);
  hud();

  function control(m: Mallet, axIn: number, ayIn: number, ptr: Ptr, dash: boolean, dt: number) {
    m.cd = Math.max(0, m.cd - dt);
    m.dashT = Math.max(0, m.dashT - dt);
    let ax = axIn, ay = ayIn;
    const len = Math.hypot(ax, ay);
    if (len > 1) { ax /= len; ay /= len; }
    const b = bounds(m.side);
    const follow = ptr?.down ? { x: clamp(ptr.x, b.x0, b.x1), y: clamp(ptr.y, b.y0, b.y1) } : null;
    const k = m.side;
    if (dash && m.cd <= 0) {
      // burst along the stick, else toward the finger, else straight at the puck
      let dx = ax, dy = ay;
      if (Math.hypot(dx, dy) < 0.2) { const t = follow ?? puck; dx = t.x - m.x; dy = t.y - m.y; }
      const l = Math.hypot(dx, dy) || 1;
      dashDir[k] = { x: dx / l, y: dy / l };
      m.dashT = DASH_T; m.cd = DASH_CD;
      m.vx = dashDir[k].x * DASH_SPEED; m.vy = dashDir[k].y * DASH_SPEED;
      ctx.sfx('whoosh', { gain: 0.35, rate: 1.4, pan: (m.x / w) * 2 - 1 });
      return;
    }
    const cap = m.dashT > 0 ? DASH_SPEED : MAX_SPEED;
    if (follow) {
      let vx = (follow.x - m.x) * FOLLOW, vy = (follow.y - m.y) * FOLLOW;
      const l = Math.hypot(vx, vy);
      if (l > cap) { vx *= cap / l; vy *= cap / l; }
      m.vx = vx; m.vy = vy;
      return;
    }
    let tx = ax * cap, ty = ay * cap;
    if (m.dashT > 0 && len < 0.2) { tx = dashDir[k].x * cap; ty = dashDir[k].y * cap; }
    const dvx = tx - m.vx, dvy = ty - m.vy, dl = Math.hypot(dvx, dvy);
    const braking = tx * m.vx + ty * m.vy < m.vx * m.vx + m.vy * m.vy;
    const step = ACC * dt * (braking ? 2 : 1) * (m.dashT > 0 ? 2 : 1);
    if (dl <= step) { m.vx = tx; m.vy = ty; } else { m.vx += (dvx / dl) * step; m.vy += (dvy / dl) * step; }
  }

  function roll() {
    ai.aimY = CY + (ctx.rand() * 2 - 1) * AIM_ERR;
    const r = ctx.rand();
    ai.bank = r < 0.15 ? -1 : r < 0.3 ? 1 : 0;
    ai.dash = ctx.rand() < 0.55;
    ai.stuck = 0;
  }

  /** Fold a straight-line y back inside the rails, so the CPU reads bank shots. */
  const fold = (y: number) => {
    const a = TABLE.y0 + R_PUCK, span = TABLE.y1 - R_PUCK - a;
    let t = (y - a) % (2 * span);
    if (t < 0) t += 2 * span;
    return a + (t <= span ? t : 2 * span - t);
  };

  // The computer reacts to where the puck was REACT_F frames ago, like a person would.
  function aiInput(m: Mallet, dt: number) {
    ai.hist.push({ ...puck });
    if (ai.hist.length > REACT_F) ai.hist.shift();
    // it extrapolates the stale sighting in a straight line, so a hit or bank it has not seen yet fools it
    const lag = (ai.hist.length - 1) / 60;
    const s0 = ai.hist[0];
    const o = { x: s0.x + s0.vx * lag, y: fold(s0.y + s0.vy * lag), vx: s0.vx, vy: s0.vy };
    const sp = Math.hypot(o.vx, o.vy);
    const reach = o.x > MIDX - R_PUCK;
    const RR = R_PUCK + R_MALLET;
    let tx: number, ty: number, dash = false;
    if (reach && sp < 480) {
      if (!ai.attacking) roll();
      ai.attacking = true;
      ai.stuck += dt;
      if (ai.stuck > 2.5) roll();
      const ay = ai.bank === 0 ? ai.aimY : ai.bank < 0 ? 2 * (TABLE.y0 + R_PUCK) - ai.aimY : 2 * (TABLE.y1 - R_PUCK) - ai.aimY;
      let dx = TABLE.x0 - o.x, dy = ay - o.y;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl; dy /= dl;
      const rx = m.x - o.x, ry = m.y - o.y;
      const along = rx * dx + ry * dy;
      const side = -rx * dy + ry * dx;
      if (along < -RR * 0.6 && Math.abs(side) < 14) {
        // lined up behind the puck: drive through it toward the aim point
        tx = o.x + dx * 60; ty = o.y + dy * 60;
        dash = ai.dash && -along < RR + 70;
      } else if (along > -RR * 0.3) {
        // in front of the puck: step round it instead of knocking it home
        const s = Math.sign(side) || 1;
        tx = o.x - dx * (RR + 20) - dy * s * (RR + 24);
        ty = o.y - dy * (RR + 20) + dx * s * (RR + 24);
      } else {
        tx = o.x - dx * (RR + 16); ty = o.y - dy * (RR + 16);
      }
    } else if (o.x > m.x - R_MALLET * 0.5) {
      // puck got behind the mallet: slip past it on the goal side, never push it in
      ai.attacking = false;
      ai.stuck = 0;
      const up = o.y > CY;
      ty = up ? Math.min(o.y - RR - 8, CY + GOAL_HALF) : Math.max(o.y + RR + 8, CY - GOAL_HALF);
      tx = Math.abs(m.y - o.y) < RR + 4 && (up ? m.y > ty : m.y < ty) ? m.x : TABLE.x1 - R_MALLET - 2;
    } else {
      ai.attacking = false;
      ai.stuck = 0;
      if (o.vx > 40 && !ai.incoming) ai.defErr = (ctx.rand() * 2 - 1) * DEF_ERR;
      ai.incoming = o.vx > 40;
      let y = CY + (o.y - CY) * 0.45;
      if (o.vx > 40) { const t = (DEF_X - o.x) / o.vx; y = (t > 0 ? fold(o.y + o.vy * t) : o.y) + ai.defErr; }
      tx = reach || o.vx > 40 ? DEF_X : DEF_X - 40;
      ty = clamp(y, CY - GOAL_HALF - 12, CY + GOAL_HALF + 12);
    }
    let vx = (tx - m.x) * 9, vy = (ty - m.y) * 9;
    const l = Math.hypot(vx, vy);
    if (l > CPU_MAX) { vx *= CPU_MAX / l; vy *= CPU_MAX / l; }
    return { ax: vx / MAX_SPEED, ay: vy / MAX_SPEED, dash };
  }

  function feedback(ev: PhysEvent[]) {
    const hitJ = [0, 0];
    let hitX = 0, wallV = 0, wallX = 0;
    for (const e of ev) {
      if (e.kind === 'hit') {
        if (e.j > hitJ[e.side]) { hitJ[e.side] = e.j; hitX = e.x; }
        if (e.side === 1 && !versus) ai.attacking = false;
      } else if (e.kind === 'wall' && e.v > wallV) { wallV = e.v; wallX = e.x; }
    }
    hits += (hitJ[0] > 0 ? 1 : 0) + (hitJ[1] > 0 ? 1 : 0);
    const j = Math.max(hitJ[0], hitJ[1]);
    // soft pushes repeat every sub-step while dribbling; rate-limit them, never a real shot
    if (j > 30 && (clackT <= 0 || j > 600)) {
      clackT = 0.08;
      ctx.sfx('clack', { gain: clamp(j / 1500, 0.15, 1), rate: 0.85 + Math.min(0.35, j / 5000), pan: (hitX / w) * 2 - 1 });
    }
    if (hitJ[0] > 1200) ctx.rumble(Math.min(1, hitJ[0] / 2200), 60);
    if (j > 1700 && !ctx.reducedMotion) shake = Math.max(shake, 0.12);
    if (wallV > 80) ctx.sfx('thud', { gain: clamp(wallV / 1600, 0.12, 0.7), pan: (wallX / w) * 2 - 1 });
  }

  function scoreGoal(scorer: 0 | 1) {
    score[scorer]++;
    lastScorer = scorer;
    flash[scorer === 0 ? 1 : 0] = 1;
    nextFace = scorer === 0 ? 1 : 0;
    for (const m of mallets) { m.vx = 0; m.vy = 0; }
    ctx.sfx('coin', { pan: scorer === 0 ? 0.8 : -0.8 });
    if (!ctx.reducedMotion) shake = 0.25;
    hud();
    if (score[scorer] >= WIN_GOALS) {
      phase = 'end';
      timer = END_T;
      ctx.sfx(versus || scorer === 0 ? 'win' : 'lose');
    } else {
      phase = 'goal';
      timer = GOAL_PAUSE;
    }
  }

  function finish() {
    phase = 'over';
    const [a, b] = score;
    if (versus) {
      ctx.end({ score: 0, versus: true, won: a > b, summary: ctx.t('Pemain {n} menang {a}-{b}', { n: a > b ? 1 : 2, a: Math.max(a, b), b: Math.min(a, b) }) });
      return;
    }
    const won = a > b;
    ctx.end({ score: soloScore(a, b), won, summary: won ? ctx.t('Kamu menang {a}-{b}', { a, b }) : ctx.t('Kamu kalah {a}-{b}', { a, b }) });
  }

  const r1 = (v: number) => Math.round(v * 10) / 10;

  return {
    update(dt, inp) {
      time += dt;
      shake = Math.max(0, shake - dt);
      flash[0] = Math.max(0, flash[0] - dt); flash[1] = Math.max(0, flash[1] - dt);
      clackT -= dt;
      if (phase === 'over') return;
      if (phase !== 'play') {
        timer -= dt;
        if (timer > 0) return;
        if (phase === 'end') { finish(); return; }
        if (phase === 'goal' || phase === 'foul') faceoff(nextFace);
        phase = 'play';
        ctx.sfx('start');
        return;
      }
      control(mallets[0], inp.ax, inp.ay, inp.ptr, inp.hit.a, dt);
      if (versus) {
        const p2 = inp.players?.[1];
        control(mallets[1], p2?.ax ?? 0, p2?.ay ?? 0, p2?.ptr, !!p2?.hit.a, dt);
      } else {
        const c = aiInput(mallets[1], dt);
        control(mallets[1], c.ax, c.ay, null, c.dash, dt);
      }
      const ev: PhysEvent[] = [];
      const goal = physicsStep(puck, mallets, dt, ev);
      feedback(ev);
      if (!ctx.reducedMotion) { trail.push({ x: puck.x, y: puck.y }); if (trail.length > 7) trail.shift(); }
      if (goal !== -1) { scoreGoal(goal); return; }
      const side: 0 | 1 = puck.x < MIDX ? 0 : 1;
      if (side !== heldSide) { heldSide = side; held = 0; }
      held += dt;
      if (held >= POSSESS_T) {
        nextFace = side === 0 ? 1 : 0;
        phase = 'foul';
        timer = GOAL_PAUSE;
        for (const m of mallets) { m.vx = 0; m.vy = 0; }
        ctx.sfx('beep');
      }
    },
    render() {
      g.save();
      if (shake > 0 && !ctx.reducedMotion) {
        const k = shake / 0.25;
        g.translate(Math.sin(time * 87) * 5 * k, Math.cos(time * 71) * 3 * k);
      }
      g.fillStyle = PAL.ink;
      g.fillRect(-10, -10, w + 20, h + 20);
      drawTable();
      for (let i = 0; i < trail.length; i++) {
        g.globalAlpha = ((i + 1) / trail.length) * 0.18;
        g.fillStyle = '#22302a';
        g.beginPath(); g.arc(trail[i].x, trail[i].y, R_PUCK * (0.6 + 0.4 * (i / trail.length)), 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
      drawMallet(mallets[0]);
      drawMallet(mallets[1]);
      drawPuck();
      g.restore();
      drawScoreboard();
      drawBanner();
    },
    snapshot: () => ({
      phase, versus, humans, score: [...score], points: versus ? 0 : soloScore(score[0], score[1]), hits, lastScorer, nextFace,
      held: Math.round(held * 100) / 100,
      timer: Math.round(timer * 100) / 100,
      puck: { x: r1(puck.x), y: r1(puck.y), vx: r1(puck.vx), vy: r1(puck.vy) },
      mallets: mallets.map((m) => ({ x: r1(m.x), y: r1(m.y), vx: r1(m.vx), vy: r1(m.vy), dash: m.dashT > 0, cd: Math.round(m.cd * 100) / 100 })),
      cpu: versus ? null : { attacking: ai.attacking },
    }),
  };

  // ---- drawing ----
  function circle(x: number, y: number, r: number, fill: string) {
    g.fillStyle = fill;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }

  function drawTable() {
    const { x0, y0, x1, y1 } = TABLE, W = x1 - x0, H = y1 - y0;
    g.fillStyle = '#5b3d26';
    roundRect(g, x0 - 16, y0 - 16, W + 32, H + 32, 24);
    g.fillStyle = '#80593a';
    roundRect(g, x0 - 10, y0 - 10, W + 20, H + 20, 18);
    for (const k of [0, 1]) {
      const gx = k === 0 ? x0 - 16 : x1;
      g.fillStyle = '#121a16';
      g.fillRect(gx, CY - GOAL_HALF, 16, GOAL_HALF * 2);
      if (flash[k] > 0) {
        g.globalAlpha = flash[k];
        g.fillStyle = PAL.gold;
        g.fillRect(gx, CY - GOAL_HALF, 16, GOAL_HALF * 2);
        g.globalAlpha = 1;
      }
    }
    g.fillStyle = '#eaf4f6';
    roundRect(g, x0, y0, W, H, 10);
    g.globalAlpha = 0.07;
    g.fillStyle = PLAYER_COLORS[0]; g.fillRect(x0, y0, W / 2, H);
    g.fillStyle = PLAYER_COLORS[1]; g.fillRect(MIDX, y0, W / 2, H);
    g.globalAlpha = 1;
    // air holes
    g.fillStyle = 'rgba(47,90,120,0.16)';
    for (let x = x0 + 20; x < x1; x += 28) for (let y = y0 + 20; y < y1; y += 28) g.fillRect(x - 1, y - 1, 2, 2);
    g.strokeStyle = PAL.red;
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(MIDX, y0); g.lineTo(MIDX, y1); g.stroke();
    g.lineWidth = 3;
    g.beginPath(); g.arc(MIDX, CY, 70, 0, Math.PI * 2); g.stroke();
    for (const k of [0, 1] as const) {
      const gx = k === 0 ? x0 : x1;
      g.strokeStyle = PLAYER_COLORS[k];
      g.globalAlpha = 0.6;
      g.lineWidth = 3;
      g.beginPath(); g.arc(gx, CY, 104, k === 0 ? -Math.PI / 2 : Math.PI / 2, k === 0 ? Math.PI / 2 : Math.PI * 1.5); g.stroke();
      g.globalAlpha = 1;
      // face-off spot of this half, in the side's colour
      g.globalAlpha = 0.5;
      circle(k === 0 ? MIDX - FACE_DX : MIDX + FACE_DX, CY, 4, PLAYER_COLORS[k]);
      g.globalAlpha = 1;
    }
  }

  function drawMallet(m: Mallet) {
    const col = PLAYER_COLORS[m.side];
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.beginPath(); g.ellipse(m.x + 4, m.y + 6, R_MALLET, R_MALLET * 0.9, 0, 0, Math.PI * 2); g.fill();
    if (m.dashT > 0 && !ctx.reducedMotion) {
      const v = Math.hypot(m.vx, m.vy) || 1;
      g.globalAlpha = 0.3;
      circle(m.x - (m.vx / v) * 18, m.y - (m.vy / v) * 18, R_MALLET * 0.95, col);
      g.globalAlpha = 1;
    }
    circle(m.x, m.y, R_MALLET, col);
    circle(m.x, m.y, R_MALLET * 0.78, 'rgba(255,255,255,0.22)');
    circle(m.x, m.y, R_MALLET * 0.5, 'rgba(0,0,0,0.28)');
    circle(m.x, m.y, R_MALLET * 0.38, col);
    circle(m.x - 3, m.y - 4, R_MALLET * 0.14, 'rgba(255,255,255,0.55)');
    // dash ring fills back up while the cooldown runs
    g.strokeStyle = m.cd > 0 ? 'rgba(29,42,35,0.35)' : 'rgba(255,250,240,0.9)';
    g.lineWidth = 3;
    g.beginPath(); g.arc(m.x, m.y, R_MALLET + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - m.cd / DASH_CD)); g.stroke();
    if (versus) text(g, String(m.side + 1), m.x, m.y + 1, 13, PAL.surface, 'center', 800);
  }

  function drawPuck() {
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.beginPath(); g.ellipse(puck.x + 3, puck.y + 4, R_PUCK, R_PUCK * 0.9, 0, 0, Math.PI * 2); g.fill();
    circle(puck.x, puck.y, R_PUCK, '#22302a');
    circle(puck.x, puck.y, R_PUCK * 0.7, '#3a4c43');
    circle(puck.x - 4, puck.y - 5, R_PUCK * 0.22, 'rgba(255,255,255,0.35)');
  }

  function drawScoreboard() {
    for (const k of [0, 1] as const) {
      const left = k === 0;
      const tx = left ? 30 : w - 30;
      drawToken(g, who[k], tx, 24, 13, time, false);
      text(g, label(k), left ? 52 : w - 52, 16, 15, PLAYER_COLORS[k], left ? 'left' : 'right', 800);
      text(g, who[k].name, left ? 52 : w - 52, 34, 13, PAL.sand, left ? 'left' : 'right', 600);
    }
    text(g, String(score[0]), w / 2 - 32, 26, 32, PLAYER_COLORS[0], 'center', 800);
    text(g, ':', w / 2, 24, 28, PAL.sand, 'center', 800);
    text(g, String(score[1]), w / 2 + 32, 26, 32, PLAYER_COLORS[1], 'center', 800);
  }

  function drawBanner() {
    let big = '', small = '';
    if (phase === 'ready') big = timer > 0.45 ? ctx.t('Siap...') : ctx.t('Mulai!');
    else if (phase === 'goal') {
      big = ctx.t('Gol!');
      small = versus ? ctx.t('Pemain {n} mencetak gol', { n: lastScorer + 1 }) : lastScorer === 0 ? ctx.t('Kamu mencetak gol') : ctx.t('Lawan mencetak gol');
    } else if (phase === 'foul') {
      big = ctx.t('Lebih dari 7 detik');
      small = ctx.t('Keping pindah ke {n}', { n: label(nextFace) });
    } else if (phase === 'end' || phase === 'over') {
      const p1 = score[0] > score[1];
      big = versus ? ctx.t('Pemain {n} menang!', { n: p1 ? 1 : 2 }) : p1 ? ctx.t('Kamu menang!') : ctx.t('Kamu kalah');
      small = versus ? `${score[0]} - ${score[1]}` : ctx.t('{s} poin', { s: soloScore(score[0], score[1]) });
    }
    if (!big) return;
    g.fillStyle = 'rgba(29,42,35,0.82)';
    roundRect(g, w / 2 - 200, CY - 46, 400, small ? 92 : 64, 14);
    text(g, big, w / 2, CY - 14, 30, PAL.surface, 'center', 800);
    if (small) text(g, small, w / 2, CY + 24, 17, PAL.gold, 'center', 700);
  }
}

export default { meta, create } satisfies GameModule;
