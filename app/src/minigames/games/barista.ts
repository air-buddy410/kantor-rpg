// Barista (coffee bar, L2-LOUNGE). Five teammates order a drink; each drink is
// a short chain of timing steps (grind, extract, steam, pour, latte art), each
// scored 0..100. Stars per order come from the step average.
import type { Btn, CastMember, GameCtx, GameInstance, GameModule, InputState } from '../types';
import { PAL, drawChar, roundRect, text } from '../cast';

export type DrinkId = 'espresso' | 'americano' | 'latte' | 'cappuccino' | 'aren';
export type StepKind = 'grind' | 'extract' | 'steam' | 'water' | 'aren' | 'milk' | 'art';
export type Pattern = 'hati' | 'daun' | 'tulip';

export const DRINKS: Record<DrinkId, { steps: StepKind[] }> = {
  espresso: { steps: ['grind', 'extract'] },
  americano: { steps: ['grind', 'extract', 'water'] },
  latte: { steps: ['grind', 'extract', 'steam', 'art'] },
  cappuccino: { steps: ['grind', 'extract', 'steam', 'art'] },
  aren: { steps: ['grind', 'extract', 'aren', 'milk'] },
};

export const PATTERNS: Record<Pattern, Btn[]> = {
  hati: ['down', 'left', 'right', 'down', 'up'],
  daun: ['left', 'right', 'left', 'right', 'down'],
  tulip: ['down', 'up', 'down', 'up', 'right'],
};

/** Hold-to-fill gauges. `lo..hi` is the sweet spot; release ends the step. */
export interface Gauge { start: number; rate: number; lo: number; hi: number; max: number; per: number }
export const GAUGES: Record<'extract' | 'steam' | 'water' | 'aren' | 'milk', Gauge> = {
  extract: { start: 0, rate: 9, lo: 25, hi: 30, max: 45, per: 9 },
  steam: { start: 20, rate: 24, lo: 60, hi: 65, max: 85, per: 7 },
  water: { start: 0, rate: 38, lo: 70, hi: 80, max: 100, per: 4 },
  aren: { start: 0, rate: 30, lo: 40, hi: 50, max: 100, per: 4 },
  milk: { start: 0, rate: 34, lo: 75, hi: 85, max: 100, per: 4 },
};
export const CAPPU_STEAM = { lo: 65, hi: 70 };
export const GRIND = { lo: 17, hi: 19, max: 24, per: 45 };
export const ORDER_TIME = 40;
const ART_TIME = 7;

/** 100 inside the zone, falling linearly by `per` points per unit outside it. */
export function zoneScore(v: number, lo: number, hi: number, per: number): number {
  const off = v < lo ? lo - v : v > hi ? v - hi : 0;
  return Math.max(0, Math.round(100 - off * per));
}
export const starsFor = (avg: number) => (avg >= 85 ? 3 : avg >= 60 ? 2 : 1);

export interface Order { who: string; drink: DrinkId; pattern: Pattern }

/** Five orders from the seed: every drink once, in a shuffled order, each for a different teammate. */
export function makeOrders(rand: () => number, cast: CastMember[]): Order[] {
  const ids: DrinkId[] = ['espresso', 'americano', 'latte', 'cappuccino', 'aren'];
  const people = cast.filter((c) => c.id !== 'CH-CEO').map((c) => c.id);
  const shuffle = <T,>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  shuffle(ids);
  shuffle(people);
  const pats: Pattern[] = ['hati', 'daun', 'tulip'];
  return ids.map((drink, i) => ({ who: people[i % people.length], drink, pattern: pats[Math.floor(rand() * 3)] }));
}

const ARROW: Record<string, string> = { up: '▲', right: '▶', down: '▼', left: '◀' };
const DIRS: Btn[] = ['up', 'down', 'left', 'right'];

const meta: GameModule['meta'] = {
  id: 'barista', title: 'Barista', place: 'coffee_bar', music: 'cafe',
  blurb: 'Buat 5 pesanan kopi untuk rekan tim. Tepat waktu, tepat takaran.',
  view: { w: 640, h: 400 }, score: { unit: 'poin', higherIsBetter: true }, touch: ['left', 'up', 'down', 'right', 'a', 'b'],
  tutorial: [
    'Giling: tekan {a} berulang sampai takaran pas, lalu {b}.',
    'Ekstraksi, susu, air, gula aren: tahan {a}, lepas di zona hijau.',
    'Latte art: tekan arah panah yang muncul dengan {arah}.',
  ],
  legend: [['a', 'Giling / tuang'], ['b', 'Selesai giling'], ['arah', 'Latte art']],
  actions: { arah: 'Latte art: ikuti panah', a: 'Giling / tuang (tahan, atau ketuk mulai lalu ketuk stop)', b: 'Selesai menggiling' },
  pointerHint: 'Ketuk atau tahan meja kerja sebagai tombol A; latte art: ketuk sisi cangkir sesuai panah',
};

/** A press shorter than this starts a pour that keeps going until the next press. */
export const TAP_LATCH = 0.2;
/** Workstation panel; taps here act as the A button. */
const PANEL = { x: 226, y: 54, w: 404, h: 256 };
const DONE_BTN = { x: 510, y: 226, w: 104, h: 32 };
const ART_C = { x: 300, y: 210 };
const inRect = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }) => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h;

function create(ctx: GameCtx): GameInstance {
  const { g, w, h } = ctx;
  const orders = makeOrders(ctx.rand, ctx.cast);
  const person = (id: string) => ctx.cast.find((c) => c.id === id) ?? ctx.cast[0];
  const drinkName = (d: DrinkId) => (d === 'espresso' ? ctx.t('Espresso') : d === 'americano' ? ctx.t('Americano') : d === 'latte' ? ctx.t('Latte')
    : d === 'cappuccino' ? ctx.t('Cappuccino') : ctx.t('Kopi susu gula aren'));
  const patName = (p: Pattern) => (p === 'hati' ? ctx.t('hati') : p === 'daun' ? ctx.t('daun') : ctx.t('tulip'));
  const stepName = (k: StepKind) => (k === 'grind' ? ctx.t('Giling') : k === 'extract' ? ctx.t('Ekstraksi') : k === 'steam' ? ctx.t('Steam susu')
    : k === 'water' ? ctx.t('Air panas') : k === 'aren' ? ctx.t('Gula aren') : k === 'milk' ? ctx.t('Susu dingin') : ctx.t('Latte art'));

  let oi = 0;
  let si = 0;
  let phase: 'arrive' | 'step' | 'stepDone' | 'serve' | 'done' = 'arrive';
  let timer = 1.6;
  let orderT = ORDER_TIME;
  let value = 0;
  let started = false;
  // a hold step starts only on a fresh press, so A still held from the last step does not count
  let armed = true;
  let idle = 0;
  let artIdx = 0;
  let artHits = 0;
  let artT = 0;
  let artFlash: 'ok' | 'miss' | null = null;
  let artFlashT = 0;
  let lastScore = 0;
  // tap mode for hold gauges: pour keeps running after a short press
  let latched = false;
  let holdT = 0;
  let squish = 0;
  let pops: { x: number; y: number; t: number; s: string; c: string }[] = [];
  let total = 0;
  let late = false;
  let time = 0;
  let ended = false;
  const stepScores: number[][] = orders.map(() => []);
  const stars: number[] = orders.map(() => 0);

  const order = () => orders[Math.min(oi, orders.length - 1)];
  const steps = () => DRINKS[order().drink].steps;
  const kind = (): StepKind => steps()[Math.min(si, steps().length - 1)];
  const gauge = (k: StepKind): Gauge => {
    const base = GAUGES[k as keyof typeof GAUGES];
    return k === 'steam' && order().drink === 'cappuccino' ? { ...base, ...CAPPU_STEAM } : base;
  };
  const hud = () => ctx.setHud(ctx.t('Pesanan {i}/5 · {n} poin', { i: Math.min(oi + 1, 5), n: total }));

  const beginStep = () => {
    phase = 'step';
    started = false;
    idle = 0;
    const k = kind();
    value = k === 'grind' ? 0 : k === 'art' ? 0 : gauge(k).start;
    latched = false;
    holdT = 0;
    artIdx = 0; artHits = 0; artT = ART_TIME; artFlash = null;
  };

  const scoreStep = (s: number) => {
    armed = false;
    lastScore = s;
    stepScores[oi].push(s);
    total += s;
    phase = 'stepDone';
    timer = 0.75;
    latched = false;
    if (!ctx.reducedMotion) pops.push({ x: 428, y: 250, t: 0.8, s: `+${s}`, c: s >= 85 ? PAL.green : s >= 50 ? PAL.accent : PAL.red });
    ctx.sfx(s >= 85 ? 'right' : s >= 50 ? 'confirm' : 'wrong');
    hud();
  };

  const finishStep = () => {
    const k = kind();
    if (k === 'grind') scoreStep(zoneScore(value, GRIND.lo, GRIND.hi, GRIND.per));
    else if (k === 'art') scoreStep(Math.round((artHits / PATTERNS[order().pattern].length) * 100));
    else { const gg = gauge(k); scoreStep(zoneScore(value, gg.lo, gg.hi, gg.per)); }
  };

  const serve = () => {
    const sc = stepScores[oi];
    while (sc.length < steps().length) sc.push(0);
    const avg = sc.reduce((a, b) => a + b, 0) / sc.length;
    stars[oi] = starsFor(avg);
    phase = 'serve';
    timer = 2.2;
    ctx.sfx(stars[oi] === 3 ? 'coin' : stars[oi] === 2 ? 'pop' : 'wrong');
  };

  const next = () => {
    oi++;
    if (oi >= orders.length) {
      phase = 'done';
      timer = 1.6;
      ctx.sfx('win');
      return;
    }
    si = 0;
    late = false;
    orderT = ORDER_TIME;
    phase = 'arrive';
    timer = 1.4;
    hud();
  };

  hud();

  const update = (dt: number, inp: InputState) => {
    time += dt;
    squish = Math.max(0, squish - dt);
    pops = pops.filter((p) => (p.t -= dt) > 0);
    // pointer: a tap/press on the workstation is the A button, the Done chip is B
    const tap = inp.tap;
    const tapDone = !!tap && phase === 'step' && kind() === 'grind' && started && inRect(tap, DONE_BTN);
    const tapA = !!tap && !tapDone && inRect(tap, PANEL);
    const ptrA = !!inp.ptr?.down && inRect(inp.ptr, PANEL) && !(phase === 'step' && kind() === 'grind' && inRect(inp.ptr, DONE_BTN));
    const hitA = inp.hit.a || tapA;
    const downA = inp.down.a || ptrA;
    const hitB = inp.hit.b || tapDone;
    if (!downA) armed = true;
    artFlashT = Math.max(0, artFlashT - dt);
    if (phase === 'done') {
      timer -= dt;
      if (timer <= 0 && !ended) {
        ended = true;
        const s3 = stars.reduce((a, b) => a + b, 0);
        ctx.end({ score: total, summary: ctx.t('{s} dari 15 bintang, {n} poin.', { s: s3, n: total }), won: s3 >= 10 });
      }
      return;
    }
    // waits between steps can be skipped with A after a short grace, so the
    // press that ended a step does not also skip its result
    const skip = hitA && ((phase === 'stepDone' && timer < 0.55) || (phase === 'serve' && timer < 1.6) || (phase === 'arrive' && timer < 1.0));
    if (phase === 'arrive') { timer -= dt; if (timer <= 0 || skip) { ctx.sfx('coffee', { gain: 0.5 }); beginStep(); armed = skip; } return; }
    if (phase === 'serve') { timer -= dt; if (timer <= 0 || skip) { next(); if (skip) ctx.sfx('ui', { gain: 0.4 }); } return; }
    if (phase === 'stepDone') {
      timer -= dt;
      if (timer <= 0 || skip) { si++; if (si >= steps().length) serve(); else { beginStep(); if (skip) armed = true; } }
      return;
    }
    orderT -= dt;
    if (orderT <= 0) { late = true; serve(); return; }
    const k = kind();
    if (k === 'grind') {
      if (hitA) {
        value += 1.1 + ctx.rand() * 0.2;
        started = true;
        idle = 0;
        squish = 0.1;
        ctx.sfx('click', { rate: 0.7 + ctx.rand() * 0.3 });
        if (value >= GRIND.max) { value = GRIND.max; finishStep(); }
        return;
      }
      if (started) {
        idle += dt;
        if (hitB || idle >= 1.6) finishStep();
      }
      return;
    }
    if (k === 'art') {
      artT -= dt;
      const seq = PATTERNS[order().pattern];
      let pressed = DIRS.find((d) => inp.hit[d]);
      if (!pressed && tap) {
        // tap the side of the cup the arrow points to
        const dx = tap.x - ART_C.x, dy = tap.y - ART_C.y;
        if (Math.hypot(dx, dy) > 14 && Math.hypot(dx, dy) < 110) pressed = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      }
      if (pressed) {
        const ok = pressed === seq[artIdx];
        if (ok) artHits++;
        artFlash = ok ? 'ok' : 'miss';
        artFlashT = 0.25;
        artIdx++;
        ctx.sfx(ok ? 'pour' : 'wrong', { rate: 1 + artIdx * 0.08 });
      }
      if (artIdx >= seq.length || artT <= 0) finishStep();
      return;
    }
    const gg = gauge(k);
    if (!started) {
      if (!armed) return;
      if (downA || hitA) { started = true; holdT = 0; squish = 0.1; ctx.sfx(k === 'steam' ? 'breath' : 'pour'); }
      else return;
    }
    if (latched) {
      // tap mode: the next press stops the pour on this very frame
      if (hitA) { finishStep(); return; }
    } else if (!downA && !hitA) {
      if (holdT < TAP_LATCH) { latched = true; } else { finishStep(); return; }
    }
    holdT += dt;
    value = Math.min(gg.max, value + gg.rate * dt);
    if (value >= gg.max) finishStep();
  };

  // ---------- drawing ----------
  /** Left-aligned text that shrinks (down to 8 px) to fit `maxW`. */
  const fitText = (s: string, x: number, y: number, size: number, color: string, maxW: number) => {
    let sz = size;
    for (; sz > 8; sz--) { g.font = `600 ${sz}px 'Alegreya Sans', system-ui, sans-serif`; if (g.measureText(s).width <= maxW) break; }
    text(g, s, x, y, sz, color, 'left', 600);
  };
  const face = (x: number, y: number, r: number, mood: number) => {
    g.fillStyle = mood === 3 ? PAL.gold : mood === 2 ? '#e6c98a' : '#d8a48c';
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = PAL.ink;
    g.beginPath(); g.arc(x - r * 0.35, y - r * 0.2, r * 0.12, 0, Math.PI * 2); g.arc(x + r * 0.35, y - r * 0.2, r * 0.12, 0, Math.PI * 2); g.fill();
    g.strokeStyle = PAL.ink; g.lineWidth = 2;
    g.beginPath();
    if (mood === 3) g.arc(x, y + r * 0.05, r * 0.45, 0.2 * Math.PI, 0.8 * Math.PI);
    else if (mood === 2) { g.moveTo(x - r * 0.35, y + r * 0.35); g.lineTo(x + r * 0.35, y + r * 0.35); }
    else g.arc(x, y + r * 0.7, r * 0.4, 1.2 * Math.PI, 1.8 * Math.PI);
    g.stroke();
  };

  const starRow = (x: number, y: number, n: number, size: number) => {
    for (let i = 0; i < 3; i++) {
      g.fillStyle = i < n ? PAL.gold : 'rgba(29,42,35,0.18)';
      const cx = x + (i - 1) * size * 2.2;
      g.beginPath();
      for (let k = 0; k < 10; k++) {
        const r = k % 2 ? size * 0.45 : size;
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        g.lineTo(cx + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      g.closePath(); g.fill();
    }
  };

  const bubble = (x: number, y: number, bw: number, bh: number) => {
    g.fillStyle = PAL.surface;
    roundRect(g, x, y, bw, bh, 12);
    g.beginPath(); g.moveTo(x + 40, y + bh); g.lineTo(x + 56, y + bh + 14); g.lineTo(x + 64, y + bh); g.fill();
  };

  const cup = (x: number, y: number, fill: number, color: string, foam = 0) => {
    g.fillStyle = '#fffaf0';
    g.beginPath(); g.moveTo(x - 30, y - 60); g.lineTo(x + 30, y - 60); g.lineTo(x + 24, y); g.lineTo(x - 24, y); g.closePath(); g.fill();
    // outline so the white cup reads against the cream panel
    g.strokeStyle = '#c9b48f'; g.lineWidth = 2; g.stroke();
    const fh = Math.max(0, Math.min(1, fill)) * 54;
    if (fh > 0) {
      g.save();
      g.beginPath(); g.moveTo(x - 27, y - 57); g.lineTo(x + 27, y - 57); g.lineTo(x + 21.5, y - 3); g.lineTo(x - 21.5, y - 3); g.closePath(); g.clip();
      g.fillStyle = color; g.fillRect(x - 30, y - 3 - fh, 60, fh);
      if (foam > 0) { g.fillStyle = '#f3e6cf'; g.fillRect(x - 30, y - 3 - fh, 60, Math.min(fh, foam)); }
      g.restore();
    }
    g.strokeStyle = '#e1d3b8'; g.lineWidth = 3;
    g.beginPath(); g.arc(x + 32, y - 34, 11, -Math.PI / 2, Math.PI / 2); g.stroke();
  };

  const gaugeBar = (x: number, y: number, bw: number, v: number, lo: number, hi: number, min: number, max: number, label: string) => {
    const px = (q: number) => x + ((q - min) / (max - min)) * bw;
    g.fillStyle = PAL.sand; roundRect(g, x, y, bw, 22, 11);
    g.fillStyle = 'rgba(31,77,58,0.35)'; g.fillRect(px(lo), y, px(hi) - px(lo), 22);
    const fx = px(Math.max(min, Math.min(max, v)));
    if (fx > x + 2) {
      const inZone = v >= lo && v <= hi;
      g.fillStyle = inZone ? PAL.green : v > hi ? PAL.red : PAL.accent;
      roundRect(g, x, y + 4, Math.max(8, fx - x), 14, 7);
    }
    g.fillStyle = PAL.ink; g.fillRect(px(lo) - 1, y - 4, 2, 30); g.fillRect(px(hi) - 1, y - 4, 2, 30);
    text(g, label, x + bw / 2, y + 40, 15, PAL.ink);
  };

  const artDraw = (x: number, y: number, p: Pattern, prog: number) => {
    g.fillStyle = '#fffaf0'; g.beginPath(); g.arc(x, y, 56, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#8a5a34'; g.beginPath(); g.arc(x, y, 48, 0, Math.PI * 2); g.fill();
    if (prog <= 0) return;
    g.fillStyle = '#f6ead6';
    g.save();
    g.globalAlpha = 0.35 + 0.65 * prog;
    const s = 0.4 + 0.6 * prog;
    g.translate(x, y); g.scale(s, s);
    if (p === 'hati') {
      g.beginPath(); g.moveTo(0, 26); g.bezierCurveTo(-46, -4, -24, -36, 0, -14); g.bezierCurveTo(24, -36, 46, -4, 0, 26); g.fill();
    } else if (p === 'daun') {
      for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(0, -26 + i * 10, 26 - i * 3, 5, 0, 0, Math.PI * 2); g.fill(); }
      g.fillRect(-1.5, -32, 3, 64);
    } else {
      for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(0, 18 - i * 16, 24 - i * 5, 9, 0, 0, Math.PI * 2); g.fill(); }
      g.fillRect(-1.5, -20, 3, 44);
    }
    g.restore();
  };

  const render = () => {
    g.fillStyle = '#f1e2c6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e6d3ae'; for (let x = 0; x < w; x += 40) g.fillRect(x, 50, 2, 280);
    // tickets
    orders.forEach((o, i) => {
      const x = 8 + i * 126;
      const cur = i === oi && phase !== 'done';
      g.fillStyle = cur ? PAL.green : i < oi ? PAL.surface : 'rgba(255,250,240,0.6)';
      roundRect(g, x, 6, 118, 38, 8);
      const ink = cur ? '#fffaf0' : PAL.ink;
      text(g, person(o.who).name, x + 8, 17, 13, ink, 'left');
      fitText(drinkName(o.drink), x + 8, 33, 11, cur ? '#e8f0e8' : PAL.ink2, 104);
      if (stars[i]) starRow(x + 98, 17, stars[i], 4.5);
    });
    // counter
    g.fillStyle = '#9a6a43'; g.fillRect(0, 316, w, 84);
    g.fillStyle = '#b98557'; g.fillRect(0, 316, w, 10);
    for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#fffaf0' : PAL.blue; roundRect(g, 300 + i * 52, 348, 30, 26, 5); g.fillStyle = '#7a4c2c'; g.fillRect(296 + i * 52, 374, 38, 4); }
    const o = order();
    const c = person(o.who);
    const mood = phase === 'serve' ? stars[oi] : 0;
    const walkIn = phase === 'arrive' ? Math.max(0, timer - 0.6) * 160 : 0;
    drawChar(g, c, 100 - walkIn, 318, 150, 1, phase === 'arrive' && walkIn > 0 ? 'walk' : mood === 3 ? 'win' : 'idle', time);
    text(g, c.name, 100, 340, 15, '#fffaf0');
    if (phase !== 'done') {
      bubble(14, 54, 196, 58);
      if (phase === 'serve') {
        face(40, 83, 15, mood);
        const line = late ? ctx.t('Kelamaan, saya keburu rapat.') : mood === 3 ? ctx.t('Sempurna, makasih!') : mood === 2 ? ctx.t('Enak, lumayan.') : ctx.t('Hmm, kurang pas...');
        text(g, line, 62, 74, 13, PAL.ink, 'left');
        starRow(110, 96, mood, 6);
      } else {
        text(g, ctx.t('Saya pesan:'), 26, 70, 12, PAL.ink2, 'left', 600);
        text(g, drinkName(o.drink), 26, 92, 17, PAL.accent, 'left');
      }
    }
    // workstation panel
    g.fillStyle = PAL.surface; roundRect(g, 226, 54, 404, 256, 14);
    if (phase === 'done') {
      const s3 = stars.reduce((a, b) => a + b, 0);
      text(g, ctx.t('Shift selesai!'), 428, 130, 26, PAL.green);
      text(g, ctx.t('{s} dari 15 bintang', { s: s3 }), 428, 170, 18, PAL.ink);
      text(g, ctx.t('Total {n} poin', { n: total }), 428, 200, 18, PAL.accent);
      return;
    }
    const st = steps();
    // step chips
    st.forEach((k, i) => {
      const cw = 392 / st.length;
      const x = 232 + i * cw;
      const done = i < stepScores[oi].length;
      const cur = i === si && (phase === 'step' || phase === 'stepDone');
      g.fillStyle = cur ? PAL.gold : done ? '#dfe9dc' : PAL.sand;
      roundRect(g, x, 60, cw - 6, 30, 8);
      const label = done ? `${stepName(k)} ${stepScores[oi][i]}` : stepName(k);
      text(g, label, x + (cw - 6) / 2, 75, st.length > 3 ? 12 : 14, PAL.ink);
    });
    // order timer
    const tf = Math.max(0, orderT / ORDER_TIME);
    g.fillStyle = PAL.sand; roundRect(g, 232, 96, 392, 8, 4);
    g.fillStyle = tf < 0.25 ? PAL.red : PAL.green; roundRect(g, 232, 96, Math.max(8, 392 * tf), 8, 4);
    if (phase === 'arrive') {
      text(g, ctx.t('{name} datang', { name: c.name }), 428, 170, 22, PAL.ink);
      text(g, ctx.t('Pesanan: {d}', { d: drinkName(o.drink) }), 428, 202, 17, PAL.accent);
      if (o.drink === 'latte' || o.drink === 'cappuccino') text(g, ctx.t('Pola latte art: {p}', { p: patName(o.pattern) }), 428, 230, 15, PAL.ink2);
      return;
    }
    if (phase === 'serve') {
      const avg = stepScores[oi].reduce((a, b) => a + b, 0) / Math.max(1, stepScores[oi].length);
      text(g, ctx.t('Disajikan: {d}', { d: drinkName(o.drink) }), 428, 150, 20, PAL.ink);
      starRow(428, 192, stars[oi], 14);
      text(g, ctx.t('Rata-rata {n}', { n: Math.round(avg) }), 428, 232, 16, PAL.ink2);
      return;
    }
    const k = kind();
    const title = stepName(k);
    text(g, title, 428, 124, 20, PAL.ink);
    let hint = '';
    if (k === 'grind') {
      hint = started ? ctx.t('Tekan {a} lagi, atau {b} bila sudah pas', { a: ctx.key('a'), b: ctx.key('b') }) : ctx.t('Tekan {a} berulang untuk menggiling', { a: ctx.key('a') });
      const q = squish > 0 && !ctx.reducedMotion ? Math.sin((squish / 0.1) * Math.PI) * 0.08 : 0;
      g.save(); g.translate(285, 220); g.scale(1 + q, 1 - q); g.translate(-285, -220);
      g.fillStyle = '#3a2a20'; roundRect(g, 260, 150, 50, 70, 8);
      g.fillStyle = '#6b4a35'; g.beginPath(); g.moveTo(256, 150); g.lineTo(314, 150); g.lineTo(300, 130); g.lineTo(270, 130); g.fill();
      g.restore();
      if (started) {
        g.fillStyle = PAL.green; roundRect(g, DONE_BTN.x, DONE_BTN.y, DONE_BTN.w, DONE_BTN.h, 10);
        text(g, ctx.t('Selesai ({b})', { b: ctx.key('b') }), DONE_BTN.x + DONE_BTN.w / 2, DONE_BTN.y + DONE_BTN.h / 2 + 1, 14, '#fffaf0');
      }
      g.fillStyle = '#5a3a24'; g.beginPath(); g.ellipse(285, 230, 22, 6 + Math.min(1, value / GRIND.max) * 6, 0, 0, Math.PI * 2); g.fill();
      gaugeBar(340, 160, 260, value, GRIND.lo, GRIND.hi, 0, GRIND.max, ctx.t('Takaran {v} g (target 18 g)', { v: value.toFixed(1) }));
    } else if (k === 'art') {
      const seq = PATTERNS[o.pattern];
      hint = ctx.t('Ikuti panah: pola {p}', { p: patName(o.pattern) });
      artDraw(ART_C.x, ART_C.y, o.pattern, artHits / seq.length);
      if (artIdx < seq.length) {
        // pointer target: a faint arrow on the side of the cup to tap
        const d = seq[artIdx];
        const ox = d === 'left' ? -70 : d === 'right' ? 70 : 0, oy = d === 'up' ? -70 : d === 'down' ? 70 : 0;
        if (oy <= 0 || ART_C.y + oy < PANEL.y + PANEL.h - 8) text(g, ARROW[d], ART_C.x + ox, ART_C.y + Math.min(oy, PANEL.y + PANEL.h - 14 - ART_C.y), 16, 'rgba(29,42,35,0.45)');
      }
      seq.forEach((d, i) => {
        const x = 380 + i * 46, y = 196;
        g.fillStyle = i < artIdx ? '#dfe9dc' : i === artIdx ? PAL.gold : PAL.sand;
        roundRect(g, x - 19, y - 19, 38, 38, 8);
        text(g, ARROW[d], x, y + 1, 18, PAL.ink);
      });
      if (artFlashT > 0 && artFlash) text(g, artFlash === 'ok' ? ctx.t('Pas!') : ctx.t('Meleset'), 472, 240, 16, artFlash === 'ok' ? PAL.green : PAL.red);
      g.fillStyle = PAL.sand; roundRect(g, 362, 262, 220, 6, 3);
      g.fillStyle = PAL.accent; roundRect(g, 362, 262, Math.max(6, 220 * Math.max(0, artT / ART_TIME)), 6, 3);
    } else {
      const gg = gauge(k);
      hint = !started ? ctx.t('Tahan {a}, atau ketuk {a} untuk mulai', { a: ctx.key('a') }) : latched ? ctx.t('Ketuk {a} di zona hijau', { a: ctx.key('a') }) : ctx.t('Lepas {a} di zona hijau', { a: ctx.key('a') });
      const f = (value - gg.start) / (gg.max - gg.start);
      if (k === 'extract') {
        g.fillStyle = '#4b5a51'; roundRect(g, 262, 136, 76, 26, 6);
        g.fillStyle = '#2b211c'; g.fillRect(292, 162, 16, 10);
        if (started && phase === 'step') { g.fillStyle = '#6b3d1f'; g.fillRect(298, 172, 4, 76); }
        cup(300, 268, (value / gg.max) * 0.55, '#5a3416', value > 3 ? 4 : 0);
      } else if (k === 'steam') {
        g.fillStyle = '#c9ced1'; g.beginPath(); g.moveTo(272, 160); g.lineTo(328, 160); g.lineTo(334, 260); g.lineTo(266, 260); g.closePath(); g.fill();
        g.fillStyle = '#fbf6ea'; g.fillRect(270, 180, 60, 76);
        if (started && !ctx.reducedMotion) for (let i = 0; i < 3; i++) { g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.arc(290 + i * 12, 150 - ((time * 40 + i * 13) % 30), 5, 0, Math.PI * 2); g.fill(); }
      } else {
        const col = k === 'water' ? '#6e4426' : k === 'aren' ? '#5a2f12' : '#d9c3a3';
        const base = k === 'water' ? 0.35 : 0.3;
        cup(300, 268, base + f * 0.65, col, k === 'milk' ? 3 : 0);
        if (started && phase === 'step') { g.fillStyle = k === 'water' ? 'rgba(160,200,220,0.8)' : k === 'aren' ? '#7a3e14' : '#fbf6ea'; g.fillRect(297, 150, 6, 60); }
      }
      const unit = k === 'extract' ? ctx.t('{v} detik (zona {a}-{b})', { v: Math.round(value), a: gg.lo, b: gg.hi })
        : k === 'steam' ? ctx.t('{v}°C (zona {a}-{b})', { v: Math.round(value), a: gg.lo, b: gg.hi })
          : ctx.t('{v}% (zona {a}-{b})', { v: Math.round(value), a: gg.lo, b: gg.hi });
      gaugeBar(360, 170, 240, value, gg.lo, gg.hi, gg.start, gg.max, unit);
    }
    if (phase === 'stepDone') {
      g.fillStyle = 'rgba(29,42,35,0.85)'; roundRect(g, 340, 268, 176, 34, 10);
      text(g, ctx.t('Nilai {n}', { n: lastScore }), 428, 285, 18, lastScore >= 85 ? '#bfe8c4' : lastScore >= 50 ? PAL.gold : '#f2b3a3');
    } else text(g, hint, 428, 290, 15, PAL.ink2);
    for (const p of pops) {
      g.globalAlpha = Math.min(1, p.t / 0.3);
      text(g, p.s, p.x + 96, p.y - (0.8 - p.t) * 40, 20, p.c);
      g.globalAlpha = 1;
    }
  };

  return {
    update,
    render,
    snapshot: () => ({
      phase, order: oi, step: si, kind: phase === 'done' ? null : kind(), value, started, latched, artIdx,
      art: phase === 'done' ? [] : [...PATTERNS[order().pattern]],
      zone: phase !== 'done' && kind() !== 'grind' && kind() !== 'art' ? [gauge(kind()).lo, gauge(kind()).hi] : [GRIND.lo, GRIND.hi],
      orders: orders.map((q) => `${q.who}:${q.drink}:${q.pattern}`), stepScores: stepScores.map((s) => [...s]), stars: [...stars], total,
      time: Math.round(time * 100) / 100,
    }),
  };
}

export default { meta, create } satisfies GameModule;
