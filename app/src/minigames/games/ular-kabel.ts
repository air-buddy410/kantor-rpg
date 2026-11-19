// Ular Kabel (Game Station slot 7). Light-cycle rounds on a 64x40 grid: every
// player drags a fibre cable behind them and touching any cable or the wall
// ends their round. Last one running wins the round, first to 3 rounds wins.
// Up to four local players take the corners; empty corners are CPU.
import type { CastMember, GameCtx, GameInstance, GameModule, InputState } from '../types';
import { PLAYER_COLORS } from '../local-players';
import { PAL, drawToken, roundRect, text } from '../cast';

export const GW = 64;
export const GH = 40;
const T = 14;
const TOP = 44;
/** Cells per second; a boost doubles it. */
export const SPEED = 9;
export const BOOST_T = 1;
export const BOOSTS = 3;
export const WIN_ROUNDS = 3;
/** Draw rounds can repeat; this caps the match so it always ends. */
const MAX_ROUNDS = 12;
export const COUNT_T = 3;
const END_T = 2.2;
/** Seconds before the border starts closing, then one cell every SHRINK_EVERY s. */
export const SHRINK_AT = 40;
export const SHRINK_EVERY = 2;
/** Simulation speed-up once every human is out, so CPU-only endings do not drag. */
const FAST = 3;
/** Flood fill stops counting here: past this much room every choice is equally safe. */
const CAP = 220;
/** 0 up, 1 right, 2 down, 3 left. */
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
/** Corner starts [x, y, dir]: P1 and P2 opposite, all turning the same way round so nobody meets head-on. */
export const STARTS: [number, number, number][] = [[10, 8, 1], [GW - 11, GH - 9, 3], [GW - 11, 8, 2], [10, GH - 9, 0]];

const meta: GameModule['meta'] = {
  id: 'ular-kabel', title: 'Ular Kabel', place: 'arcade', music: 'race',
  blurb: 'Tarik kabel fiber, jangan menabrak. Yang terakhir bertahan menang ronde.',
  view: { w: GW * T, h: GH * T + TOP }, score: { unit: 'poin', higherIsBetter: true },
  touch: ['left', 'up', 'down', 'right', 'a'],
  tutorial: [
    'Belok dengan {arah}. Kabelmu memanjang di belakang.',
    'Tabrak kabel atau dinding, kamu keluar. Tekan {a} untuk ngebut, 3 kali per ronde.',
    'Yang terakhir bertahan menang ronde. Menang 3 ronde menang pertandingan.',
  ],
  legend: [['arah', 'Belok'], ['a', 'Ngebut']],
  actions: { arah: 'Belok (tidak bisa putar balik)', a: 'Ngebut 1 detik, 3 kali per ronde' },
  players: 4,
  playersHint: 'Bareng: sampai 4 pemain, sudut yang kosong diisi komputer.',
};

const NO_INPUT: InputState = {
  down: { left: false, right: false, up: false, down: false, a: false, b: false, x: false, y: false },
  hit: { left: false, right: false, up: false, down: false, a: false, b: false, x: false, y: false },
  ax: 0, ay: 0, tap: null,
};

interface Rider {
  c: CastMember; cpu: boolean; x: number; y: number; dir: number; alive: boolean;
  acc: number; boostT: number; boosts: number;
  /** Next turn plus one buffered turn, so two quick presses inside one cell both happen. */
  queue: number[];
  trail: number[];
  /** Stick direction last frame, to turn a held stick into one press. */
  axis: number;
  deadT: number; hitX: number; hitY: number;
}

/** Direction of a stick or held keys, -1 in the dead zone. With both axes held the previous one sticks. */
function stickDir(ax: number, ay: number, prev: number): number {
  const hx = Math.abs(ax) > 0.5, vy = Math.abs(ay) > 0.5;
  if (!hx && !vy) return -1;
  const dh = ax > 0 ? 1 : 3, dv = ay > 0 ? 2 : 0;
  if (hx && vy) return prev === dh || prev === dv ? prev : Math.abs(ax) >= Math.abs(ay) ? dh : dv;
  return hx ? dh : dv;
}

/** Queue a turn unless it repeats or reverses the heading it would follow. */
function queueTurn(q: number[], dir: number, d: number) {
  const ref = q.length ? q[q.length - 1] : dir;
  if (q.length >= 2 || d === ref || d === (ref + 2) % 4) return;
  q.push(d);
}

function create(ctx: GameCtx): GameInstance {
  const { g, w, h } = ctx;
  const me = ctx.cast.find((c) => c.id === ctx.playerId) ?? ctx.cast[0];
  const pool = ctx.cast.filter((c) => c.id !== me.id);
  const cast: CastMember[] = [me];
  while (cast.length < 4 && pool.length) cast.push(pool.splice(Math.floor(ctx.rand() * pool.length), 1)[0]);
  while (cast.length < 4) cast.push(me);
  const humans = Math.max(1, Math.min(4, ctx.players));
  const versus = humans > 1;
  const winsBy = [0, 0, 0, 0];
  const grid = new Uint8Array(GW * GH);
  const seen = new Int32Array(GW * GH);
  const fifo = new Int32Array(GW * GH);
  let stamp = 0;
  let riders: Rider[] = [];
  let round = 0;
  let phase: 'count' | 'play' | 'roundEnd' | 'over' = 'count';
  let phaseT = COUNT_T;
  let roundT = 0;
  let inset = 0;
  let survT = 0;
  let time = 0;
  let goT = 0;
  let roundWinner = -1;
  let matchWon = false;

  const score = () => winsBy[0] * 300 + Math.round(survT * 5) + (matchWon ? 500 : 0);
  const tag = (i: number) => (i < humans ? (versus ? `P${i + 1}` : ctx.t('Kamu')) : cast[i].name);
  const hud = () => ctx.setHud(versus
    ? ctx.t('Ronde {r} · {list}', { r: round, list: winsBy.map((n, i) => `${tag(i)} ${n}`).join(' · ') })
    : ctx.t('Ronde {r} · Kamu {a} · Rival {b}', { r: round, a: winsBy[0], b: Math.max(...winsBy.slice(1)) }));

  const out = (x: number, y: number) => x < inset || y < inset || x >= GW - inset || y >= GH - inset;
  const blocked = (x: number, y: number) => out(x, y) || grid[y * GW + x] !== 0;

  function newRound() {
    round++;
    grid.fill(0);
    inset = 0;
    roundT = 0;
    roundWinner = -1;
    riders = STARTS.map(([x, y, dir], i) => {
      grid[y * GW + x] = i + 1;
      return { c: cast[i], cpu: i >= humans, x, y, dir, alive: true, acc: 0, boostT: 0, boosts: BOOSTS, queue: [], trail: [y * GW + x], axis: -1, deadT: 0, hitX: x, hitY: y };
    });
    phase = 'count';
    phaseT = COUNT_T;
    ctx.sfx('tick');
    hud();
  }
  newRound();

  /** Free cells reachable from (sx, sy), counted up to CAP. */
  function flood(sx: number, sy: number): number {
    stamp++;
    let head = 0, tail = 0;
    const s0 = sy * GW + sx;
    seen[s0] = stamp;
    fifo[tail++] = s0;
    while (head < tail && tail < CAP) {
      const c = fifo[head++], x = c % GW, y = (c - x) / GW;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (blocked(nx, ny)) continue;
        const n = ny * GW + nx;
        if (seen[n] === stamp) continue;
        seen[n] = stamp;
        fifo[tail++] = n;
      }
    }
    return Math.min(tail, CAP);
  }

  function corridor(x: number, y: number, d: number): number {
    let n = 0;
    while (n < 20 && !blocked(x + DX[d] * (n + 1), y + DY[d] * (n + 1))) n++;
    return n;
  }

  /**
   * CPU plan for its next cell: straight, left or right by free room behind it,
   * with a small bias to go straight and some noise so CPUs differ. A cell next
   * to another head is risky (both may take it on the same step).
   */
  function think(i: number) {
    const r = riders[i];
    const opts = [r.dir, (r.dir + 3) % 4, (r.dir + 1) % 4];
    // now and then fancy a turn, so CPUs do not all hug the walls
    const fancy = ctx.rand() < 0.05 ? 1 + Math.floor(ctx.rand() * 2) : -1;
    let best = r.dir, bestS = -Infinity, bestRoom = 0;
    opts.forEach((d, k) => {
      const x = r.x + DX[d], y = r.y + DY[d];
      if (blocked(x, y)) return;
      const room = flood(x, y);
      let s = room + (k === 0 ? 4 : 0) + (k === fancy ? 8 : 0) + ctx.rand() * 3;
      if (riders.some((q, j) => j !== i && q.alive && Math.abs(q.x - x) + Math.abs(q.y - y) === 1)) s -= 60;
      if (s > bestS) { bestS = s; best = d; bestRoom = room; }
    });
    r.dir = best;
    if (r.boosts > 0 && r.boostT <= 0 && bestRoom >= CAP && corridor(r.x, r.y, best) >= 14 && ctx.rand() < 0.1) {
      r.boosts--;
      r.boostT = BOOST_T;
      ctx.sfx('turbo', { pan: (r.x / GW) * 2 - 1, gain: 0.5 });
    }
  }

  function crash(i: number, x: number, y: number) {
    const r = riders[i];
    r.alive = false;
    r.deadT = 0;
    r.queue = [];
    // spark on the edge between the head and what it hit
    r.hitX = Math.max(-0.5, Math.min(GW - 0.5, (r.x + x) / 2));
    r.hitY = Math.max(-0.5, Math.min(GH - 0.5, (r.y + y) / 2));
    ctx.sfx('crash', { pan: (r.x / GW) * 2 - 1, gain: i < humans ? 1 : 0.7 });
    if (i === 0) ctx.rumble(0.7, 220);
  }

  /** Move every rider whose accumulator is full by one cell, all at once so nobody gets first move. */
  function advance(): boolean {
    const movers = riders.map((r, i) => (r.alive && r.acc >= 1 ? i : -1)).filter((i) => i >= 0);
    if (!movers.length) return false;
    for (const i of movers) {
      const r = riders[i];
      if (!r.cpu) { if (r.queue.length) r.dir = r.queue.shift()!; }
      // the CPU planned this step after its last one; replan only if the way got shut since
      else if (blocked(r.x + DX[r.dir], r.y + DY[r.dir])) think(i);
    }
    const to = movers.map((i) => [riders[i].x + DX[riders[i].dir], riders[i].y + DY[riders[i].dir]]);
    const bad = to.map(([x, y], k) => blocked(x, y) || to.some(([x2, y2], j) => j !== k && x2 === x && y2 === y));
    movers.forEach((i, k) => {
      const r = riders[i];
      r.acc -= 1;
      const [x, y] = to[k];
      if (bad[k]) { crash(i, x, y); return; }
      r.x = x;
      r.y = y;
      grid[y * GW + x] = i + 1;
      r.trail.push(y * GW + x);
    });
    // plan after moving so the head can be drawn gliding toward its real next cell
    for (const i of movers) if (riders[i].cpu && riders[i].alive) think(i);
    return true;
  }

  function endRound(win: number) {
    roundWinner = win;
    if (win >= 0) winsBy[win]++;
    phase = 'roundEnd';
    phaseT = END_T;
    ctx.sfx(win < 0 ? 'wrong' : win < humans ? 'win' : 'lose');
    hud();
  }

  function tick(dt: number) {
    roundT += dt;
    const closes = roundT >= SHRINK_AT ? Math.min(GH / 2, Math.floor((roundT - SHRINK_AT) / SHRINK_EVERY) + 1) : 0;
    while (inset < closes) {
      inset++;
      ctx.sfx(inset === 1 ? 'alarm' : 'thud', { gain: 0.5 });
      riders.forEach((r, i) => { if (r.alive && out(r.x, r.y)) crash(i, r.x, r.y); });
    }
    for (const r of riders) {
      if (!r.alive) continue;
      r.acc += SPEED * (r.boostT > 0 ? 2 : 1) * dt;
      r.boostT = Math.max(0, r.boostT - dt);
    }
    for (let guard = 0; guard < 4 && advance(); guard++);
    if (!versus && riders[0].alive) survT += dt;
    const alive = riders.map((r, i) => (r.alive ? i : -1)).filter((i) => i >= 0);
    if (alive.length <= 1) endRound(alive.length === 1 ? alive[0] : -1);
  }

  function finish() {
    phase = 'over';
    const best = Math.max(...winsBy);
    const top = winsBy.map((n, i) => (n === best && best > 0 ? i : -1)).filter((i) => i >= 0);
    const champ = top.length === 1 ? top[0] : -1;
    if (versus) {
      const summary = champ < 0 ? ctx.t('Seri, tidak ada pemenang')
        : champ < humans ? ctx.t('Pemain {n} ({name}) menang {w} ronde', { n: champ + 1, name: cast[champ].name, w: best })
          : ctx.t('{name} (komputer) menang {w} ronde', { name: cast[champ].name, w: best });
      ctx.end({ score: 0, versus: true, won: champ === 0, summary });
      return;
    }
    matchWon = champ === 0;
    ctx.end({ score: score(), won: matchWon, summary: ctx.t('Ronde menang {w}, bertahan {s} detik', { w: winsBy[0], s: Math.round(survT) }) });
  }

  function steer(i: number, inp: InputState, live: boolean) {
    const r = riders[i];
    const want: number[] = [];
    if (inp.hit.up) want.push(0);
    if (inp.hit.right) want.push(1);
    if (inp.hit.down) want.push(2);
    if (inp.hit.left) want.push(3);
    const ad = stickDir(inp.ax, inp.ay, r.axis);
    if (ad >= 0 && ad !== r.axis) want.push(ad);
    r.axis = ad;
    for (const d of want) queueTurn(r.queue, r.dir, d);
    if (live && inp.hit.a && r.boosts > 0 && r.boostT <= 0) {
      r.boosts--;
      r.boostT = BOOST_T;
      ctx.sfx('turbo', { pan: (r.x / GW) * 2 - 1, gain: i === 0 ? 1 : 0.8 });
    }
  }

  /** Head position for drawing: glides toward the cell it will enter next. */
  function headAt(r: Rider): [number, number] {
    if (!r.alive || phase !== 'play') return [r.x, r.y];
    const d = r.cpu ? r.dir : r.queue[0] ?? r.dir;
    const f = Math.min(1, r.acc);
    return [r.x + DX[d] * f, r.y + DY[d] * f];
  }

  return {
    update(dt0, inp) {
      const dt = Math.min(dt0, 0.05);
      time += dt;
      goT = Math.max(0, goT - dt);
      for (const r of riders) if (!r.alive) r.deadT += dt;
      if (phase === 'over') return;
      if (phase === 'roundEnd') {
        phaseT -= dt;
        if (phaseT <= 0) {
          if (Math.max(...winsBy) >= WIN_ROUNDS || round >= MAX_ROUNDS) finish();
          else newRound();
        }
        return;
      }
      const ins: InputState[] = inp.players ?? [inp];
      // turns pressed during the countdown are kept, so a player can pick a first heading
      for (let i = 0; i < humans; i++) if (riders[i].alive) steer(i, ins[i] ?? NO_INPUT, phase === 'play');
      if (phase === 'count') {
        const before = Math.ceil(phaseT);
        phaseT -= dt;
        if (phaseT <= 1e-9) { phase = 'play'; goT = 0.7; ctx.sfx('start'); }
        else if (Math.ceil(phaseT) !== before) ctx.sfx('tick');
        return;
      }
      const reps = riders.some((r, i) => i < humans && r.alive) ? 1 : FAST;
      for (let k = 0; k < reps && phase === 'play'; k++) tick(dt);
    },

    render() {
      g.fillStyle = PAL.bg;
      g.fillRect(0, 0, w, h);
      riders.forEach((r, i) => {
        const x = 6 + i * 186;
        g.fillStyle = r.alive ? PAL.surface : '#e6dccb';
        roundRect(g, x, 5, 180, 34, 8);
        g.fillStyle = PLAYER_COLORS[i];
        roundRect(g, x, 5, 6, 34, 3);
        g.globalAlpha = r.alive ? 1 : 0.45;
        drawToken(g, r.c, x + 22, 20, 10, time, false);
        g.globalAlpha = 1;
        text(g, versus && i < humans ? `P${i + 1} ${r.c.name}` : i === 0 ? ctx.t('Kamu') : r.c.name, x + 38, 15, 13, r.alive ? PAL.ink : PAL.ink2, 'left');
        for (let k = 0; k < BOOSTS; k++) {
          g.fillStyle = k < r.boosts ? PLAYER_COLORS[i] : '#d8cfbf';
          g.beginPath(); g.arc(x + 42 + k * 11, 30, 3.5, 0, Math.PI * 2); g.fill();
        }
        for (let k = 0; k < WIN_ROUNDS; k++) {
          g.fillStyle = k < winsBy[i] ? PAL.gold : '#e2d8c6';
          roundRect(g, x + 128 + k * 16, 24, 12, 10, 3);
        }
      });
      const left = Math.ceil(SHRINK_AT - roundT);
      text(g, ctx.t('Ronde {r}', { r: round }), w - 70, 14, 14, PAL.ink);
      text(g, left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : ctx.t('Menyempit!'), w - 70, 31, 13, left > 0 ? PAL.ink2 : PAL.red);

      g.save();
      g.translate(0, TOP);
      g.fillStyle = '#fbf4e6';
      g.fillRect(0, 0, GW * T, GH * T);
      g.strokeStyle = 'rgba(80,64,40,0.07)';
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x <= GW; x++) { g.moveTo(x * T + 0.5, 0); g.lineTo(x * T + 0.5, GH * T); }
      for (let y = 0; y <= GH; y++) { g.moveTo(0, y * T + 0.5); g.lineTo(GW * T, y * T + 0.5); }
      g.stroke();
      g.lineCap = 'round';
      g.lineJoin = 'round';
      riders.forEach((r, i) => {
        const [hx, hy] = headAt(r);
        // dead cables stay solid obstacles, so they only fade a little
        g.globalAlpha = r.alive ? 1 : 0.6;
        g.beginPath();
        r.trail.forEach((c, k) => {
          const px = ((c % GW) + 0.5) * T, py = (Math.floor(c / GW) + 0.5) * T;
          if (k) g.lineTo(px, py); else g.moveTo(px, py);
        });
        g.lineTo((hx + 0.5) * T, (hy + 0.5) * T);
        g.strokeStyle = PLAYER_COLORS[i];
        g.lineWidth = T * 0.56;
        g.stroke();
        // light core reads as a fibre strand
        g.strokeStyle = 'rgba(255,255,255,0.4)';
        g.lineWidth = 2;
        g.stroke();
        g.globalAlpha = 1;
      });
      if (inset > 0) {
        const k = inset * T, bw = GW * T, bh = GH * T;
        g.fillStyle = '#2f4a3d';
        g.fillRect(0, 0, bw, k); g.fillRect(0, bh - k, bw, k);
        g.fillRect(0, k, k, bh - 2 * k); g.fillRect(bw - k, k, k, bh - 2 * k);
      }
      riders.forEach((r, i) => {
        if (!r.alive) {
          // the mark stays so everyone sees where the cable broke
          const sx = (r.hitX + 0.5) * T, sy = (r.hitY + 0.5) * T;
          g.strokeStyle = PLAYER_COLORS[i];
          g.lineWidth = 3;
          g.beginPath(); g.moveTo(sx - 5, sy - 5); g.lineTo(sx + 5, sy + 5); g.moveTo(sx + 5, sy - 5); g.lineTo(sx - 5, sy + 5); g.stroke();
          if (!ctx.reducedMotion && r.deadT < 0.6) {
            const f = r.deadT / 0.6;
            g.globalAlpha = 1 - f;
            for (let k = 0; k < 10; k++) {
              const a = (k / 10) * Math.PI * 2 + i, d = 4 + f * (14 + (k % 3) * 5);
              g.fillStyle = k % 2 ? PAL.gold : '#f08a24';
              g.fillRect(sx + Math.cos(a) * d - 1.5, sy + Math.sin(a) * d - 1.5, 3, 3);
            }
            g.globalAlpha = 1;
          }
          return;
        }
        const [hx, hy] = headAt(r);
        const cx = (hx + 0.5) * T, cy = (hy + 0.5) * T;
        g.fillStyle = PLAYER_COLORS[i];
        g.beginPath(); g.arc(cx, cy, r.boostT > 0 ? 11.5 : 9, 0, Math.PI * 2); g.fill();
        drawToken(g, r.c, cx, cy - 1, 7.5, time, phase === 'play' && !ctx.reducedMotion);
        if (phase === 'count') {
          // heading arrow, plus a name tag on human seats so each player finds their corner
          const d = r.queue[0] ?? r.dir;
          const tx = cx + DX[d] * T * 1.9, ty = cy + DY[d] * T * 1.9;
          g.fillStyle = PLAYER_COLORS[i];
          g.beginPath();
          g.moveTo(tx, ty);
          g.lineTo(tx - DX[d] * 9 - DY[d] * 6, ty - DY[d] * 9 + DX[d] * 6);
          g.lineTo(tx - DX[d] * 9 + DY[d] * 6, ty - DY[d] * 9 - DX[d] * 6);
          g.closePath(); g.fill();
          if (i < humans) text(g, tag(i), cx, cy + (r.y < GH / 2 ? 22 : -22), 13, PLAYER_COLORS[i]);
        }
      });
      g.restore();

      const my = TOP + (GH * T) / 2;
      if (phase === 'count') {
        g.fillStyle = 'rgba(255,250,240,0.88)';
        roundRect(g, w / 2 - 110, my - 60, 220, 120, 18);
        text(g, ctx.t('Ronde {r}', { r: round }), w / 2, my - 32, 22, PAL.green);
        text(g, String(Math.max(1, Math.ceil(phaseT))), w / 2, my + 16, 54, PAL.accent);
      } else if (phase === 'play' && goT > 0) {
        g.globalAlpha = Math.min(1, goT / 0.3);
        text(g, ctx.t('Mulai!'), w / 2, my, 40, PAL.green);
        g.globalAlpha = 1;
      } else if (phase === 'roundEnd' || phase === 'over') {
        const msg = roundWinner < 0 ? ctx.t('Seri')
          : !versus && roundWinner === 0 ? ctx.t('Kamu menang ronde!')
            : roundWinner < humans ? ctx.t('Pemain {n} menang ronde!', { n: roundWinner + 1 })
              : ctx.t('{name} menang ronde', { name: cast[roundWinner].name });
        g.fillStyle = 'rgba(255,250,240,0.92)';
        roundRect(g, w / 2 - 200, my - 46, 400, 92, 16);
        text(g, msg, w / 2, my - 14, 24, roundWinner >= 0 ? PLAYER_COLORS[roundWinner] : PAL.ink2);
        text(g, winsBy.map((n, i) => `${tag(i)} ${n}`).join('   '), w / 2, my + 20, 16, PAL.ink2);
      }
    },

    snapshot: () => ({
      phase, round, versus, humans, winsBy: [...winsBy], score: score(),
      survT: Math.round(survT * 100) / 100, roundT: Math.round(roundT * 100) / 100, inset,
      alive: riders.map((r) => r.alive), heads: riders.map((r) => ({ x: r.x, y: r.y })), dirs: riders.map((r) => r.dir),
      boosts: riders.map((r) => r.boosts), boosting: riders.map((r) => r.boostT > 0), cpu: riders.map((r) => r.cpu),
      trail: riders.map((r) => r.trail.length),
    }),
  };
}

export default { meta, create } satisfies GameModule;
