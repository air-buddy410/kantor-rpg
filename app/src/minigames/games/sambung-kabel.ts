// Sambung Kabel (Game Station slot 4). Rotate fiber tiles until every house is
// fed from the OLT. Levels come from a random spanning tree rooted at the OLT,
// pruned to the paths that reach the houses, then every tile is spun at random,
// so each level is solvable by construction (rotation 0 is the stored solution).
import type { GameCtx, GameInstance, GameModule } from '../types';
import { PAL, roundRect, text } from '../cast';

// Direction index 0 N, 1 E, 2 S, 3 W; a tile mask has bit (1 << dir) per open side.
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
export const LEVELS = 20;

export type Kind = 'empty' | 'cable' | 'olt' | 'house';
export interface Level {
  level: number;
  size: number;
  kind: Kind[];
  /** Mask in the solved orientation. */
  sol: number[];
  /** Clockwise quarter turns applied on top of sol; all zero = solved. */
  rot: number[];
  /** True for tiles on the solution tree (distractor tiles are false). */
  tree: boolean[];
  olt: number;
  houses: number[];
}

export function rotCW(m: number, k = 1): number {
  let r = m;
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) r = ((r << 1) | (r >> 3)) & 15;
  return r;
}

export const sizeFor = (level: number) => Math.min(8, 4 + Math.floor((level - 1) / 3));
export const housesFor = (level: number) => Math.min(10, 2 + Math.floor((level - 1) / 2));
export const timeFor = (level: number) => 60 + (sizeFor(level) - 4) * 10;

export const maskOf = (L: Level, i: number) => rotCW(L.sol[i], L.rot[i]);

export function generateLevel(level: number, rand: () => number): Level {
  const n = sizeFor(level);
  const cells = n * n;
  const olt = Math.floor(rand() * n) * n;
  const inTree: boolean[] = new Array(cells).fill(false);
  const full: number[] = new Array(cells).fill(0);
  const parent: number[] = new Array(cells).fill(-1);
  const frontier: [number, number][] = [];
  const pushEdges = (a: number) => {
    const x = a % n, y = Math.floor(a / n);
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      if (nx >= 0 && ny >= 0 && nx < n && ny < n && !inTree[ny * n + nx]) frontier.push([a, d]);
    }
  };
  inTree[olt] = true;
  pushEdges(olt);
  // Randomized Prim: picks from the whole frontier, which gives many leaves (house spots).
  while (frontier.length) {
    const k = Math.floor(rand() * frontier.length);
    const [a, d] = frontier[k];
    frontier[k] = frontier[frontier.length - 1];
    frontier.pop();
    const b = (Math.floor(a / n) + DY[d]) * n + (a % n) + DX[d];
    if (inTree[b]) continue;
    inTree[b] = true;
    parent[b] = a;
    full[a] |= 1 << d;
    full[b] |= 1 << ((d + 2) % 4);
    pushEdges(b);
  }
  const bits = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
  const leaves: number[] = [];
  for (let i = 0; i < cells; i++) if (i !== olt && bits(full[i]) === 1) leaves.push(i);
  for (let i = leaves.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [leaves[i], leaves[j]] = [leaves[j], leaves[i]];
  }
  const houses = leaves.slice(0, Math.min(housesFor(level), leaves.length)).sort((a, b) => a - b);
  const keep: boolean[] = new Array(cells).fill(false);
  keep[olt] = true;
  for (const h of houses) for (let c = h; c !== -1 && !keep[c]; c = parent[c]) keep[c] = true;
  const kind: Kind[] = new Array(cells).fill('empty');
  const sol: number[] = new Array(cells).fill(0);
  const tree: boolean[] = new Array(cells).fill(false);
  for (let i = 0; i < cells; i++) {
    if (keep[i]) {
      let m = 0;
      const x = i % n, y = Math.floor(i / n);
      for (let d = 0; d < 4; d++) {
        if (!(full[i] & (1 << d))) continue;
        if (keep[(y + DY[d]) * n + x + DX[d]]) m |= 1 << d;
      }
      sol[i] = m;
      tree[i] = true;
      kind[i] = i === olt ? 'olt' : houses.includes(i) ? 'house' : 'cable';
    } else if (rand() < 0.6) {
      // distractor: straight, bend or tee
      const shapes = [5, 3, 7];
      sol[i] = shapes[Math.floor(rand() * shapes.length)];
      kind[i] = 'cable';
    }
  }
  const rot: number[] = kind.map((k) => (k === 'cable' || k === 'house' ? Math.floor(rand() * 4) : 0));
  const L: Level = { level, size: n, kind, sol, rot, tree, olt, houses };
  for (let guard = 0; solved(L) && guard < 8; guard++) {
    const h = houses[Math.floor(rand() * houses.length)];
    L.rot[h] = (L.rot[h] + 1) % 4;
  }
  return L;
}

export function litCells(L: Level): boolean[] {
  const n = L.size;
  const lit: boolean[] = new Array(n * n).fill(false);
  const q = [L.olt];
  lit[L.olt] = true;
  while (q.length) {
    const a = q.pop()!;
    const m = maskOf(L, a);
    const x = a % n, y = Math.floor(a / n);
    for (let d = 0; d < 4; d++) {
      if (!(m & (1 << d))) continue;
      const nx = x + DX[d], ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const b = ny * n + nx;
      if (lit[b] || L.kind[b] === 'empty') continue;
      if (maskOf(L, b) & (1 << ((d + 2) % 4))) { lit[b] = true; q.push(b); }
    }
  }
  return lit;
}

export function solved(L: Level): boolean {
  const lit = litCells(L);
  return L.houses.every((h) => lit[h]);
}

/** Clockwise turns that bring tile i back to its solution shape (symmetry aware). */
export function turnsNeeded(L: Level, i: number): number {
  if (!L.tree[i] || L.kind[i] === 'olt') return 0;
  const cur = maskOf(L, i);
  for (let k = 0; k < 4; k++) if (rotCW(cur, k) === L.sol[i]) return k;
  return 0;
}

const meta: GameModule['meta'] = {
  id: 'sambung-kabel', title: 'Sambung Kabel', place: 'arcade', music: 'puzzle',
  blurb: 'Putar ubin, sambungkan OLT ke setiap rumah.',
  view: { w: 640, h: 480 }, score: { unit: 'poin', higherIsBetter: true }, touch: ['left', 'up', 'down', 'right', 'a', 'b'],
  tutorial: [
    'Pilih ubin dengan {arah}.',
    'Tekan {a} untuk memutar searah jarum jam, {b} untuk berlawanan.',
    'Sambungkan kabel dari OLT sampai semua rumah menyala sebelum waktu habis.',
  ],
  legend: [['arah', 'Pilih ubin'], ['a', 'Putar kanan'], ['b', 'Putar kiri']],
  actions: { arah: 'Pilih ubin', a: 'Putar searah jarum jam', b: 'Putar berlawanan arah' },
  pointerHint: 'Ketuk ubin untuk memutarnya searah jarum jam',
};

/** Spin animation length; short so fast tapping never lags behind the logic. */
export const SPIN_T = 0.1;

const CABLE = '#e39a2d';
const CABLE_EDGE = '#8a5317';
const LIT = '#3fbf62';
const LIT_EDGE = '#1f5d36';

function create(ctx: GameCtx): GameInstance {
  const { g, w, h } = ctx;
  let level = 1;
  let L = generateLevel(level, ctx.rand);
  let lit = litCells(L);
  let timeLeft = timeFor(level);
  let score = 0;
  let phase: 'play' | 'clear' | 'over' = 'play';
  let phaseT = 0;
  let lastBonus = 0;
  let cursor = L.olt + 1;
  // per tile: remaining angle to unwind (radians) and the time left on the spin
  let anim: number[] = new Array(L.size * L.size).fill(0);
  let animT: number[] = new Array(L.size * L.size).fill(0);
  let glow: number[] = new Array(L.size * L.size).fill(0);
  let time = 0;
  let moves = 0;
  let lastPtr: { x: number; y: number } | null = null;
  const tileAt = (x: number, y: number) => {
    const G = geom();
    const tx = Math.floor((x - G.ox) / G.cell), ty = Math.floor((y - G.oy) / G.cell);
    return tx >= 0 && ty >= 0 && tx < G.n && ty < G.n ? ty * G.n + tx : -1;
  };

  const geom = () => {
    const n = L.size;
    const cell = Math.min(84, Math.floor(420 / n));
    const gw = cell * n;
    return { n, cell, ox: 196 + Math.floor((432 - gw) / 2), oy: Math.floor((h - gw) / 2) };
  };
  const housesLit = () => L.houses.filter((x) => lit[x]).length;
  const hud = () => ctx.setHud(ctx.t('Level {n}/20 · Skor {s}', { n: level, s: score }));
  hud();

  const startLevel = (lv: number) => {
    level = lv;
    L = generateLevel(level, ctx.rand);
    lit = litCells(L);
    timeLeft = timeFor(level);
    cursor = L.olt + 1;
    anim = new Array(L.size * L.size).fill(0);
    animT = new Array(L.size * L.size).fill(0);
    glow = new Array(L.size * L.size).fill(0);
    phase = 'play';
    hud();
    ctx.sfx('start');
  };

  const rotate = (i: number, k: number) => {
    const kd = L.kind[i];
    if (kd === 'empty' || kd === 'olt') { ctx.sfx('click', { gain: 0.5 }); return; }
    const before = lit;
    const beforeN = housesLit();
    L.rot[i] = (L.rot[i] + k) % 4;
    // stack on any spin still running so double taps read as two quarter turns,
    // capped so a burst of taps never leaves a long unwind behind
    if (!ctx.reducedMotion) {
      const add = (k === 1 ? -1 : 1) * Math.PI / 2;
      anim[i] = Math.max(-Math.PI, Math.min(Math.PI, (animT[i] > 0 ? anim[i] * (animT[i] / SPIN_T) ** 2 : 0) + add));
      animT[i] = SPIN_T;
    }
    moves++;
    lit = litCells(L);
    for (let c = 0; c < lit.length; c++) if (lit[c] && !before[c]) glow[c] = 0.35;
    ctx.sfx('rotate', { rate: k === 1 ? 1 : 0.9 });
    if (housesLit() > beforeN) ctx.sfx('connect');
    if (solved(L)) {
      lastBonus = Math.floor(timeLeft);
      score += 100 + lastBonus;
      phase = 'clear';
      phaseT = 1.6;
      ctx.sfx(level === LEVELS ? 'win' : 'right');
      hud();
    }
  };

  return {
    update(dt, inp) {
      time += dt;
      for (let i = 0; i < animT.length; i++) {
        if (animT[i] > 0) { animT[i] = Math.max(0, animT[i] - dt); if (!animT[i]) anim[i] = 0; }
        if (glow[i] > 0) glow[i] = Math.max(0, glow[i] - dt);
      }
      if (phase === 'over') return;
      if (phase === 'clear') {
        phaseT -= dt;
        if (phaseT <= 0) {
          if (level >= LEVELS) {
            phase = 'over';
            ctx.end({ score, summary: ctx.t('Semua 20 level selesai, {s} poin', { s: score }), won: true });
          } else startLevel(level + 1);
        }
        return;
      }
      timeLeft -= dt;
      if (timeLeft <= 0) {
        timeLeft = 0;
        phase = 'over';
        ctx.sfx('lose');
        ctx.end({ score, summary: ctx.t('Waktu habis di level {n}', { n: level }), won: false });
        return;
      }
      if (timeLeft < 10 && Math.floor(timeLeft + dt) !== Math.floor(timeLeft)) ctx.sfx('tick');
      const n = L.size;
      let cx = cursor % n, cy = Math.floor(cursor / n);
      if (inp.hit.left) cx = Math.max(0, cx - 1);
      if (inp.hit.right) cx = Math.min(n - 1, cx + 1);
      if (inp.hit.up) cy = Math.max(0, cy - 1);
      if (inp.hit.down) cy = Math.min(n - 1, cy + 1);
      if (cy * n + cx !== cursor) { cursor = cy * n + cx; ctx.sfx('ui', { gain: 0.4 }); }
      // a moving mouse/finger drives the cursor, but only when it moves, so arrows keep working
      if (inp.ptr) {
        if (!lastPtr || Math.abs(inp.ptr.x - lastPtr.x) + Math.abs(inp.ptr.y - lastPtr.y) > 2) {
          const t = tileAt(inp.ptr.x, inp.ptr.y);
          if (t >= 0) cursor = t;
          lastPtr = { x: inp.ptr.x, y: inp.ptr.y };
        }
      } else lastPtr = null;
      const tapped = inp.tap ? tileAt(inp.tap.x, inp.tap.y) : -1;
      if (tapped >= 0) { cursor = tapped; rotate(cursor, 1); }
      else if (inp.hit.a) rotate(cursor, 1);
      else if (inp.hit.b) rotate(cursor, 3);
    },

    render() {
      g.fillStyle = PAL.bg;
      g.fillRect(0, 0, w, h);
      const G = geom();
      // side panel
      g.fillStyle = PAL.surface;
      roundRect(g, 12, 12, 168, h - 24, 14);
      text(g, ctx.t('Sambung Kabel'), 96, 40, 20, PAL.green);
      text(g, ctx.t('Level {n}/20', { n: level }), 96, 74, 18, PAL.ink);
      text(g, ctx.t('Waktu'), 96, 110, 16, PAL.ink2);
      const tl = Math.ceil(timeLeft);
      text(g, `${tl}`, 96, 138, 32, timeLeft < 10 ? PAL.red : PAL.ink);
      g.fillStyle = 'rgba(29,42,35,0.12)';
      roundRect(g, 30, 162, 132, 10, 5);
      g.fillStyle = timeLeft < 10 ? PAL.red : PAL.green;
      roundRect(g, 30, 162, Math.max(10, 132 * (timeLeft / timeFor(level))), 10, 5);
      text(g, ctx.t('Rumah menyala'), 96, 200, 16, PAL.ink2);
      text(g, `${housesLit()}/${L.houses.length}`, 96, 226, 26, PAL.ink);
      text(g, ctx.t('Skor'), 96, 262, 16, PAL.ink2);
      text(g, `${score}`, 96, 288, 26, PAL.accent);
      text(g, ctx.t('{a} atau ketuk: putar kanan', { a: ctx.key('a') }), 96, h - 82, 15, PAL.ink2);
      text(g, ctx.t('{b}: putar kiri', { b: ctx.key('b') }), 96, h - 58, 15, PAL.ink2);
      text(g, ctx.t('Panah: pindah ubin'), 96, h - 34, 15, PAL.ink2);

      // trunk from the panel to the OLT
      const oltY = G.oy + Math.floor(L.olt / G.n) * G.cell + G.cell / 2;
      g.lineCap = 'butt';
      g.strokeStyle = LIT_EDGE;
      g.lineWidth = 8;
      g.beginPath(); g.moveTo(180, oltY); g.lineTo(G.ox + 4, oltY); g.stroke();
      g.strokeStyle = LIT;
      g.lineWidth = 4;
      g.beginPath(); g.moveTo(180, oltY); g.lineTo(G.ox + 4, oltY); g.stroke();

      g.fillStyle = '#d9c8a6';
      roundRect(g, G.ox - 6, G.oy - 6, G.cell * G.n + 12, G.cell * G.n + 12, 12);
      for (let i = 0; i < G.n * G.n; i++) {
        const x = G.ox + (i % G.n) * G.cell, y = G.oy + Math.floor(i / G.n) * G.cell;
        drawTile(i, x, y, G.cell);
      }
      if (phase === 'play') {
        const x = G.ox + (cursor % G.n) * G.cell, y = G.oy + Math.floor(cursor / G.n) * G.cell;
        g.strokeStyle = PAL.blue;
        g.lineWidth = 3;
        g.strokeRect(x + 2.5, y + 2.5, G.cell - 5, G.cell - 5);
      }
      if (phase === 'clear' || (phase === 'over' && timeLeft <= 0)) {
        const cx = G.ox + (G.cell * G.n) / 2, cy = G.oy + (G.cell * G.n) / 2;
        g.fillStyle = 'rgba(255,250,240,0.94)';
        roundRect(g, cx - 170, cy - 46, 340, 92, 16);
        if (phase === 'clear') {
          text(g, ctx.t('Semua rumah tersambung!'), cx, cy - 14, 22, PAL.green);
          text(g, ctx.t('Bonus waktu +{s}', { s: lastBonus }), cx, cy + 18, 17, PAL.accent);
        } else {
          text(g, ctx.t('Waktu habis'), cx, cy, 26, PAL.red);
        }
      }
    },
    snapshot: () => {
      const G = geom();
      return {
        level, size: L.size, phase, score, timeLeft: Math.round(timeLeft * 100) / 100, cursor, moves,
        spinning: animT.filter((v) => v > 0).length,
        houses: L.houses.length, housesLit: housesLit(), rot: [...L.rot],
        need: L.kind.map((_, i) => turnsNeeded(L, i)),
        geom: { ox: G.ox, oy: G.oy, cell: G.cell },
      };
    },
  };

  function drawTile(i: number, x: number, y: number, c: number) {
    const kd = L.kind[i];
    g.fillStyle = kd === 'empty' ? '#e6d7b8' : glow[i] > 0 ? '#e3f4dc' : '#f6eddc';
    roundRect(g, x + 2, y + 2, c - 4, c - 4, Math.max(4, c * 0.12));
    if (kd === 'empty') return;
    const on = lit[i];
    const m = maskOf(L, i);
    g.save();
    g.beginPath();
    g.rect(x, y, c, c);
    g.clip();
    g.translate(x + c / 2, y + c / 2);
    if (animT[i] > 0) {
      const u = animT[i] / SPIN_T;
      // ease-out: most of the turn happens at once, then it settles
      g.rotate(anim[i] * u * u);
      const sq = 1 - 0.1 * Math.sin(Math.PI * u);
      g.scale(sq, sq);
    }
    g.lineCap = 'round';
    for (const pass of [0, 1]) {
      g.strokeStyle = pass === 0 ? (on ? LIT_EDGE : CABLE_EDGE) : on ? LIT : CABLE;
      g.lineWidth = c * (pass === 0 ? 0.24 : 0.15);
      g.beginPath();
      for (let d = 0; d < 4; d++) {
        if (!(m & (1 << d))) continue;
        g.moveTo(0, 0);
        g.lineTo((DX[d] * c) / 2, (DY[d] * c) / 2);
      }
      g.stroke();
    }
    g.restore();
    const cx = x + c / 2, cy = y + c / 2;
    if (kd === 'olt') {
      const s = c * 0.62;
      g.fillStyle = '#2f3b35';
      roundRect(g, cx - s / 2, cy - s / 2, s, s, 5);
      for (let k = 0; k < 3; k++) {
        const blink = ctx.reducedMotion || Math.sin(time * 6 + k * 2) > -0.3;
        g.fillStyle = blink ? LIT : '#1d4a2c';
        g.fillRect(cx - s / 2 + s * 0.16 + k * (s * 0.26), cy + s / 2 - s * 0.2, s * 0.14, s * 0.08);
      }
      text(g, ctx.t('OLT'), cx, cy - s * 0.08, Math.max(10, c * 0.2), '#fffaf0');
    } else if (kd === 'house') {
      const pop = glow[i] > 0 && !ctx.reducedMotion ? 1 + 0.25 * Math.sin((glow[i] / 0.35) * Math.PI) : 1;
      const s = c * 0.48 * pop;
      g.fillStyle = PAL.surface;
      g.strokeStyle = PAL.ink2;
      g.lineWidth = 1.5;
      g.fillRect(cx - s / 2, cy - s * 0.15, s, s * 0.62);
      g.strokeRect(cx - s / 2, cy - s * 0.15, s, s * 0.62);
      g.fillStyle = on ? PAL.green : PAL.accent;
      g.beginPath();
      g.moveTo(cx - s * 0.66, cy - s * 0.1);
      g.lineTo(cx, cy - s * 0.62);
      g.lineTo(cx + s * 0.66, cy - s * 0.1);
      g.closePath();
      g.fill();
      g.fillStyle = on ? '#ffd75e' : '#8b968f';
      g.fillRect(cx - s * 0.14, cy + s * 0.04, s * 0.28, s * 0.24);
    }
  }
}

export default { meta, create } satisfies GameModule;
