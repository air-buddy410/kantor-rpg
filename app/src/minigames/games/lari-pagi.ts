// Lari Pagi (treadmill and exercise bike, L2-GYM). Rhythm runner: step on the
// beat with alternating feet. Left/right pick the foot; A, B or a tap on the
// canvas step with whichever foot is next, so one button (or one thumb) is
// enough. A step close to the target interval raises the speed toward the cap
// of the current segment; off-beat steps, the same foot twice or standing
// still lower it. Mashing faster than the beat, or holding a very high speed,
// drains stamina; at zero the runner is winded for a moment. A long on-beat
// streak gives a small distance bonus.
import type { CastMember, GameCtx, GameInstance, GameModule } from '../types';
import { PAL, roundRect, text } from '../cast';

export const DURATION = 60;
const FRAMES = DURATION * 60;

/** Tempo plan: step interval (s) and the speed cap it allows (km/h). */
export const SEGMENTS = [
  { until: 10, beat: 0.5, cap: 10, name: 'Pemanasan' },
  { until: 25, beat: 0.4, cap: 14, name: 'Lari' },
  { until: 38, beat: 0.34, cap: 18, name: 'Sprint' },
  { until: 50, beat: 0.4, cap: 14, name: 'Lari' },
  { until: 60, beat: 0.32, cap: 19, name: 'Sprint akhir' },
];
export const PERFECT = 0.14;
export const GOOD = 0.3;
const TOO_FAST = 0.65;
const WIN_METERS = 200;
/** On-beat streak that switches on the distance bonus, and the bonus itself. */
export const FLOW_AT = 8;
export const FLOW_BONUS = 1.1;

const meta: GameModule['meta'] = {
  id: 'lari-pagi', title: 'Lari Pagi', place: 'treadmill', music: 'gym',
  blurb: 'Lari 60 detik di treadmill. Melangkah mengikuti ketukan, kiri dan kanan bergantian.',
  view: { w: 640, h: 400 }, score: { unit: 'meter', higherIsBetter: true }, touch: ['left', 'right', 'a'],
  tutorial: [
    'Tekan {left} dan {right} bergantian mengikuti ketukan.',
    'Atau tekan {a} saja: kaki berganti otomatis.',
    'Langkah tepat ketukan menambah kecepatan. Terlalu cepat menguras stamina.',
  ],
  legend: [['left', 'Kaki kiri'], ['right', 'Kaki kanan'], ['a', 'Langkah']],
  actions: { left: 'Langkah kaki kiri', right: 'Langkah kaki kanan', a: 'Langkah (kaki berikutnya)', b: 'Langkah (kaki berikutnya)' },
  pointerHint: 'Ketuk layar mengikuti ketukan untuk melangkah; kaki bergantian otomatis',
};

type Grade = 'pas' | 'bagus' | 'meleset' | 'cepat' | 'salah';
const FEEDBACK: Record<Grade, string> = { pas: 'PAS!', bagus: 'BAGUS', meleset: 'MELESET', cepat: 'Terlalu cepat', salah: 'Kaki salah' };

export const segmentAt = (t: number) => SEGMENTS.find((s) => t < s.until) ?? SEGMENTS[SEGMENTS.length - 1];

interface Floater { s: string; x: number; y: number; t: number; col: string; size: number }
interface Bit { x: number; y: number; vx: number; vy: number; life: number; max: number; col: string; r: number }

function create(ctx: GameCtx): GameInstance {
  const { g, w, h } = ctx;
  const me = ctx.cast.find((c) => c.id === ctx.playerId) ?? ctx.cast[0];
  const rm = ctx.reducedMotion;
  let frame = 0;
  let time = 0;
  let speed = 0;
  let dist = 0;
  let stamina = 100;
  let winded = 0;
  let lastFoot: 'L' | 'R' | null = null;
  let sinceStep = 9;
  let combo = 0;
  let bestCombo = 0;
  const counts: Record<Grade, number> = { pas: 0, bagus: 0, meleset: 0, cepat: 0, salah: 0 };
  let segName = SEGMENTS[0].name;
  let ended = false;
  // animation only
  let stride = 0, strideTarget = 0;
  let squash = 0, squashV = 0;
  let scroll = 0;
  let shake = 0;
  let ringPop = 0;
  let padPop: 'L' | 'R' | null = null, padPopT = 0;
  let segBanner = 0;
  const floaters: Floater[] = [];
  const bits: Bit[] = [];

  const flow = () => combo >= FLOW_AT;
  const hud = () => ctx.setHud(ctx.t('{m} m · {v} km/jam · {s} detik', { m: Math.floor(dist), v: speed.toFixed(1), s: Math.ceil(DURATION - time) }));
  hud();

  const RX = 300, FEET = 292;

  function float(s: string, col: string, size = 22) {
    floaters.push({ s, x: RX, y: FEET - 186, t: 0, col, size });
    if (floaters.length > 4) floaters.shift();
  }
  function dust(foot: 'L' | 'R', n: number) {
    if (rm) return;
    const x = RX + (foot === 'L' ? -6 : 8);
    for (let i = 0; i < n; i++) {
      const a = Math.PI + 0.2 + (i / Math.max(1, n - 1)) * 0.9;
      const sp = 50 + ((i * 29) % 40) + speed * 3;
      bits.push({ x, y: FEET - 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6, life: 0.45, max: 0.45, col: '#c9b48e', r: 2 + (i % 2) });
    }
  }
  function sweat() {
    if (rm) return;
    for (let i = 0; i < 2; i++) bits.push({ x: RX + 4, y: FEET - 150, vx: -40 - i * 25, vy: -50 + i * 20, life: 0.6, max: 0.6, col: '#7fc4e8', r: 2.5 });
  }

  const grade = (gr: Grade) => {
    counts[gr]++;
    if (gr === 'pas' || gr === 'bagus') {
      combo++;
      bestCombo = Math.max(bestCombo, combo);
    } else combo = 0;
    const col = gr === 'pas' ? '#3f8a50' : gr === 'bagus' ? PAL.blue : PAL.red;
    float(ctx.t(FEEDBACK[gr]), col, gr === 'pas' ? 26 : 22);
    if (gr === 'pas' && combo > 0 && combo % 8 === 0) { float(ctx.t('Ritme x{n}', { n: combo }), PAL.accent, 20); ctx.sfx('beep', { rate: 1.4, gain: 0.5 }); }
  };

  const step = (foot: 'L' | 'R') => {
    const seg = segmentAt(time);
    if (winded > 0) { ctx.sfx('breath', { gain: 0.5 }); padPop = foot; padPopT = 0.12; return; }
    padPop = foot; padPopT = 0.15;
    if (foot === lastFoot) {
      grade('salah');
      speed = Math.max(0, speed - 1.2);
      ctx.sfx('wrong', { gain: 0.5 });
      sinceStep = 0;
      shake = rm ? 0 : 3;
      return;
    }
    const ratio = sinceStep / seg.beat;
    const first = lastFoot === null || sinceStep > seg.beat * 2.5;
    lastFoot = foot;
    sinceStep = 0;
    // body reacts on this frame: plant the foot, squash, kick up dust
    strideTarget += Math.PI;
    squashV = -2.2 - Math.min(2, speed / 8);
    ringPop = 1;
    ctx.sfx('step', { rate: foot === 'L' ? 0.9 : 1.1 });
    if (first) { speed = Math.min(seg.cap, speed + 0.6); dust(foot, 3); return; }
    if (ratio < TOO_FAST) {
      grade('cepat');
      speed = Math.min(seg.cap + 2, speed + 0.25);
      stamina -= 7;
      sweat();
      dust(foot, 2);
      return;
    }
    const off = Math.abs(ratio - 1);
    if (off <= PERFECT) {
      grade('pas');
      speed = Math.min(seg.cap, speed + 0.5 + Math.max(0, seg.cap - speed) * 0.18);
      dust(foot, 6);
      shake = rm ? 0 : 1.6;
    } else if (off <= GOOD) {
      grade('bagus');
      // near-misses hold a jog; only on-beat steps reach the segment cap
      const jog = seg.cap * 0.75;
      speed = speed < jog ? Math.min(jog, speed + 0.25 + (jog - speed) * 0.08) : Math.max(jog, speed - 0.15);
      dust(foot, 4);
    } else {
      grade('meleset');
      speed = speed > 5 ? Math.max(5, speed - 0.9) : Math.min(5, speed + 0.3);
      dust(foot, 2);
    }
  };

  const finish = () => {
    if (ended) return;
    ended = true;
    const m = Math.round(dist);
    ctx.sfx(m >= WIN_METERS ? 'win' : 'confirm');
    ctx.end({ score: m, won: m >= WIN_METERS, summary: ctx.t('{m} meter, rata-rata {v} km/jam, ritme pas {p} kali', { m, v: (dist / DURATION * 3.6).toFixed(1), p: counts.pas }) });
  };

  return {
    update(dt, inp) {
      if (ended) return;
      frame++;
      time = frame / 60;
      const seg = segmentAt(time);
      if (seg.name !== segName) { segName = seg.name; segBanner = 1.4; ctx.sfx('alarm', { gain: 0.4 }); }
      sinceStep += dt;
      // Step input is read first so the press lands on this frame.
      const want: 'L' | 'R' = lastFoot === 'L' ? 'R' : 'L';
      const L = inp.hit.left, R = inp.hit.right;
      const auto = inp.hit.a || inp.hit.b || !!inp.tap;
      if (L && !R) step('L');
      else if (R && !L) step('R');
      else if (auto) step(want);

      if (winded > 0) {
        winded = Math.max(0, winded - dt);
        speed = Math.max(4, speed - 6 * dt);
        stamina = Math.min(100, stamina + 14 * dt);
      } else {
        if (sinceStep > seg.beat * 1.6) speed = Math.max(0, speed - 4 * dt);
        if (speed > seg.cap) speed = Math.max(seg.cap, speed - 2.5 * dt);
        speed = Math.max(0, speed - 0.25 * dt);
        stamina -= Math.max(0, speed - 16) * 0.8 * dt;
        if (speed < 12) stamina += (speed < 6 ? 9 : 5) * dt;
        stamina = Math.min(100, stamina);
        if (stamina <= 0) { stamina = 0; winded = 3; combo = 0; ctx.sfx('hurt'); float(ctx.t('Kelelahan!'), PAL.red, 24); shake = rm ? 0 : 5; }
      }
      dist += (speed / 3.6) * dt * (flow() ? FLOW_BONUS : 1);

      // animation
      const idleStride = speed > 0.8 && sinceStep > seg.beat * 1.2 ? speed * 0.35 * dt : 0;
      strideTarget += idleStride;
      stride += (strideTarget - stride) * Math.min(1, dt * 22);
      squashV += (-squash * 200 - squashV * 16) * dt;
      squash += squashV * dt;
      scroll += speed * dt;
      shake = Math.max(0, shake - dt * 25);
      ringPop = Math.max(0, ringPop - dt * 5);
      padPopT = Math.max(0, padPopT - dt);
      segBanner = Math.max(0, segBanner - dt);
      for (const f of floaters) f.t += dt;
      while (floaters.length && floaters[0].t > 0.8) floaters.shift();
      for (const b of bits) { b.life -= dt; b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 200 * dt; }
      for (let i = bits.length - 1; i >= 0; i--) if (bits[i].life <= 0) bits.splice(i, 1);

      if (frame % 6 === 0) hud();
      if (frame >= FRAMES) { hud(); finish(); }
    },

    render() {
      const seg = segmentAt(time);
      g.save();
      if (shake > 0) g.translate(Math.sin(time * 67) * shake, Math.cos(time * 49) * shake * 0.5);
      g.fillStyle = PAL.sand;
      g.fillRect(-10, -10, w + 20, h + 20);
      renderWindow();
      g.fillStyle = '#d7c7a6';
      g.fillRect(-10, 300, w + 20, 110);
      // treadmill
      g.fillStyle = '#3a3a38';
      roundRect(g, 150, 286, 300, 30, 12);
      g.fillStyle = PAL.road;
      g.fillRect(166, 290, 268, 14);
      g.fillStyle = 'rgba(255,250,240,0.28)';
      const belt = (scroll * 22) % 40;
      for (let x = 166 - belt; x < 434; x += 40) if (x >= 166) g.fillRect(x, 292, 6, 10);
      g.fillStyle = '#5b5b58';
      g.fillRect(412, 196, 10, 92);
      roundRect(g, 386, 184, 62, 22, 6);
      g.fillStyle = flow() ? PAL.gold : PAL.blue;
      g.fillRect(392, 189, 50, 12);
      // speed lines when fast
      if (!rm && speed > 12) {
        g.strokeStyle = `rgba(29,42,35,${Math.min(0.25, (speed - 12) / 30)})`;
        g.lineWidth = 2;
        for (let i = 0; i < 5; i++) {
          const y = 160 + i * 24;
          const x = 220 - ((scroll * 40 + i * 53) % 90);
          g.beginPath(); g.moveTo(x, y); g.lineTo(x - 26 - speed, y); g.stroke();
        }
      }
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.beginPath(); g.ellipse(RX + 2, FEET + 2, 34, 6, 0, 0, Math.PI * 2); g.fill();
      drawRunner(g, me, RX, FEET, 150, stride, speed, squash, winded > 0, stamina, time, rm);
      for (const b of bits) { g.globalAlpha = Math.max(0, b.life / b.max); g.fillStyle = b.col; g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2); g.fill(); }
      g.globalAlpha = 1;

      // stats panel
      g.fillStyle = 'rgba(255,250,240,0.95)';
      roundRect(g, 14, 14, 168, 112, 12);
      text(g, ctx.t('Jarak'), 26, 32, 14, PAL.ink2, 'left');
      text(g, ctx.t('{m} m', { m: Math.floor(dist) }), 26, 56, 28, PAL.ink, 'left', 800);
      text(g, ctx.t('Kecepatan'), 26, 84, 14, PAL.ink2, 'left');
      text(g, ctx.t('{v} km/jam', { v: speed.toFixed(1) }), 26, 106, 22, PAL.accent, 'left', 800);
      // time and segment panel
      g.fillStyle = 'rgba(255,250,240,0.95)';
      roundRect(g, w - 182, 14, 168, 112, 12);
      text(g, ctx.t('Sisa waktu'), w - 170, 32, 14, PAL.ink2, 'left');
      text(g, `${Math.ceil(DURATION - time - 1e-9)}`, w - 170, 58, 28, PAL.ink, 'left', 800);
      text(g, ctx.t(seg.name), w - 170, 86, 18, PAL.green, 'left', 800);
      text(g, ctx.t('Batas {v} km/jam', { v: seg.cap }), w - 170, 108, 14, PAL.ink2, 'left');
      // stamina bar
      const sx = w - 182, sy = 138;
      text(g, winded > 0 ? ctx.t('Kelelahan!') : ctx.t('Stamina'), sx + 2, sy + 8, 14, winded > 0 ? PAL.red : PAL.ink2, 'left');
      g.fillStyle = 'rgba(29,42,35,0.15)';
      roundRect(g, sx, sy + 20, 168, 14, 7);
      g.fillStyle = stamina < 25 ? PAL.red : stamina < 50 ? PAL.gold : PAL.green;
      if (stamina > 1) roundRect(g, sx, sy + 20, 168 * stamina / 100, 14, 7);
      if (flow()) {
        g.fillStyle = PAL.gold;
        roundRect(g, 14, 136, 168, 28, 10);
        text(g, ctx.t('Ritme x{n} · jarak +10%', { n: combo }), 98, 150, 14, PAL.ink, 'center', 800);
      }

      for (const f of floaters) {
        const p = f.t / 0.8;
        const pop = p < 0.12 ? 0.6 + (p / 0.12) * 0.6 : 1.2 - Math.min(0.2, (p - 0.12));
        g.save();
        g.globalAlpha = p > 0.65 ? Math.max(0, (1 - p) / 0.35) : 1;
        g.translate(f.x, f.y - (rm ? 0 : p * 30));
        g.scale(pop, pop);
        g.lineWidth = 5; g.strokeStyle = 'rgba(255,250,240,0.92)'; g.lineJoin = 'round';
        g.font = `800 ${f.size}px 'Alegreya Sans', system-ui, sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.strokeText(f.s, 0, 0);
        text(g, f.s, 0, 0, f.size, f.col, 'center', 800);
        g.restore();
      }
      if (segBanner > 0) {
        const a = Math.min(1, segBanner * 3);
        g.globalAlpha = a;
        g.fillStyle = PAL.green;
        roundRect(g, w / 2 - 110, 186, 220, 36, 12);
        text(g, ctx.t(seg.name), w / 2, 204, 20, PAL.surface, 'center', 800);
        g.globalAlpha = 1;
      }
      renderRhythm(seg.beat);
      g.restore();
    },

    snapshot: () => ({
      time: Math.round(time * 1000) / 1000, frame, speed: Math.round(speed * 100) / 100, dist: Math.round(dist * 100) / 100,
      stamina: Math.round(stamina * 10) / 10, winded: winded > 0, lastFoot, seg: segName, beat: segmentAt(time).beat, sinceStep, counts: { ...counts }, combo, bestCombo,
    }),
  };

  function renderWindow() {
    // a wide window onto a park; three layers scroll at different speeds
    const x0 = 196, y0 = 34, ww = 248, wh = 132;
    g.save();
    g.beginPath(); g.rect(x0, y0, ww, wh); g.clip();
    g.fillStyle = PAL.sky;
    g.fillRect(x0, y0, ww, wh);
    g.fillStyle = '#f6d58a';
    g.beginPath(); g.arc(x0 + 54, y0 + 50, 20, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 3; i++) {
      const cx = x0 + ((i * 110 - scroll * 0.6) % 330 + 330) % 330 - 40;
      g.beginPath(); g.ellipse(cx, y0 + 26 + i * 12, 24, 8, 0, 0, Math.PI * 2); g.ellipse(cx + 14, y0 + 21 + i * 12, 14, 8, 0, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#9cc28a';
    for (let i = 0; i < 3; i++) {
      const hx = x0 + ((i * 140 - scroll * 2.2) % 420 + 420) % 420 - 70;
      g.beginPath(); g.ellipse(hx, y0 + wh + 6, 110, 46, 0, Math.PI, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#c9b48e';
    g.fillRect(x0, y0 + wh - 16, ww, 16);
    for (let i = 0; i < 6; i++) {
      const tx = x0 + ((i * 64 - scroll * 9) % 384 + 384) % 384 - 50;
      g.fillStyle = '#7a5a3a';
      g.fillRect(tx - 2, y0 + wh - 38, 5, 24);
      g.fillStyle = i % 2 ? '#5f8f4c' : '#6f9a58';
      g.beginPath(); g.arc(tx, y0 + wh - 44, 14, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    g.strokeStyle = PAL.surface; g.lineWidth = 6;
    g.strokeRect(x0, y0, ww, wh);
    g.beginPath(); g.moveTo(x0 + ww / 2, y0); g.lineTo(x0 + ww / 2, y0 + wh); g.stroke();
  }

  function renderRhythm(beat: number) {
    const cx = w / 2, cy = 352;
    g.fillStyle = 'rgba(255,250,240,0.96)';
    roundRect(g, cx - 220, cy - 36, 440, 72, 14);
    const want = lastFoot === 'L' ? 'R' : 'L';
    const frac = Math.min(1.6, sinceStep / beat);
    const ready = Math.abs(frac - 1) <= PERFECT;
    const pad = (x: number, label: string, foot: 'L' | 'R') => {
      const on = want === foot;
      const pop = padPop === foot && padPopT > 0 ? 0.9 : on && ready && !rm ? 1.06 : 1;
      g.save();
      g.translate(x, cy);
      g.scale(pop, pop);
      g.fillStyle = on ? (ready ? '#3f8a50' : PAL.green) : 'rgba(29,42,35,0.12)';
      roundRect(g, -40, -24, 80, 48, 11);
      text(g, label, 0, 0, 16, on ? '#fffaf0' : PAL.ink2, 'center', 800);
      g.restore();
    };
    pad(cx - 172, ctx.t('◀ Kiri'), 'L');
    pad(cx + 172, ctx.t('Kanan ▶'), 'R');
    // ring fills from the last step; the gold band is the on-beat window
    const r = 24 + ringPop * 4;
    g.lineWidth = 8;
    g.strokeStyle = 'rgba(29,42,35,0.12)';
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = PAL.gold;
    g.lineWidth = 12;
    g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2 - PERFECT * Math.PI * 2, -Math.PI / 2 + PERFECT * Math.PI * 2); g.stroke();
    g.strokeStyle = ready ? '#3f8a50' : frac < TOO_FAST ? PAL.red : PAL.blue;
    g.lineWidth = 6;
    g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.min(1, frac) * Math.PI * 2); g.stroke();
    if (ready) { g.fillStyle = '#3f8a50'; g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.fill(); }
    text(g, ctx.t('Ketukan'), cx - 88, cy, 14, PAL.ink2, 'center', 700);
    text(g, combo >= 2 ? ctx.t('Ritme x{n}', { n: combo }) : '', cx + 88, cy, 15, PAL.accent, 'center', 800);
  }
}

/**
 * Side-view runner in the cast style with a real stride: legs and arms swing
 * opposite each other on `phase` (one step = half a cycle), the swing grows
 * with speed and the body leans forward. `sq` is the squash spring.
 */
function drawRunner(g: CanvasRenderingContext2D, c: CastMember, x: number, y: number, hgt: number, phase: number, speed: number, sq: number, tired: boolean, stamina: number, t: number, rm: boolean) {
  const u = hgt / 100;
  const amp = Math.min(1, 0.15 + speed / 14);
  const sw = Math.sin(phase);
  const s = Math.max(-0.1, Math.min(0.1, sq * 0.02));
  const lean = Math.min(0.2, speed / 70) * (tired ? 0.4 : 1);
  const bob = Math.abs(Math.cos(phase)) * 3 * u * amp;
  g.save();
  g.translate(x, y);
  g.scale(1 - s * 0.6, 1 + s);
  const leg = (dx: number, a: number, back: boolean) => {
    // thigh then shin; the shin folds back when the leg swings behind
    const hipX = dx * u, hipY = -34 * u - bob;
    const kx = hipX + Math.sin(a) * 15 * u, ky = hipY + Math.cos(a) * 15 * u;
    const bend = Math.max(0, -a) * 1.4 + 0.15;
    const fx = kx + Math.sin(a - bend) * 15 * u, fy = ky + Math.cos(a - bend) * 15 * u;
    g.lineCap = 'round';
    g.strokeStyle = back ? shadeCol(c.bottom) : c.bottom;
    g.lineWidth = 9.5 * u;
    g.beginPath(); g.moveTo(hipX, hipY); g.lineTo(kx, ky); g.lineTo(fx, fy); g.stroke();
    g.fillStyle = back ? shadeCol(c.shoes) : c.shoes;
    g.save(); g.translate(fx, fy); g.rotate(-(a - bend) * 0.3);
    roundRect(g, -5 * u, -2 * u, 14 * u, 6 * u, 2 * u);
    g.restore();
  };
  leg(-2, -sw * 0.75 * amp, true);
  g.translate(0, -bob);
  g.rotate(lean);
  g.translate(0, bob);
  const arm = (a: number, back: boolean) => {
    const sx = 0, sy = -60 * u - bob;
    const ex = sx + Math.sin(a) * 12 * u, ey = sy + Math.cos(a) * 12 * u;
    const fa = a + 1.6 * amp + 0.3;
    const hx = ex + Math.sin(fa) * 11 * u, hy = ey + Math.cos(fa) * 11 * u;
    g.lineCap = 'round';
    g.strokeStyle = back ? shadeCol(c.main) : c.main;
    g.lineWidth = 8 * u;
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(ex, ey); g.stroke();
    g.strokeStyle = back ? shadeCol(c.skin) : c.skin;
    g.lineWidth = 6.5 * u;
    g.beginPath(); g.moveTo(ex, ey); g.lineTo(hx, hy); g.stroke();
  };
  arm(sw * 0.9 * amp, true);
  g.translate(0, -bob);
  g.fillStyle = c.main;
  roundRect(g, -14 * u, -64 * u, 28 * u, 32 * u, 6 * u);
  g.fillStyle = c.inner;
  g.fillRect(-4 * u, -62 * u, 8 * u, 14 * u);
  g.fillStyle = c.accent;
  g.fillRect(-14 * u, -36 * u, 28 * u, 4 * u);
  const hy = -84 * u;
  g.fillStyle = c.skin;
  g.beginPath(); g.ellipse(2 * u, hy, 20 * u, 21 * u, 0, 0, Math.PI * 2); g.fill();
  const flush = Math.max(0, (100 - stamina) / 100);
  if (flush > 0.3 || tired) {
    g.fillStyle = `rgba(214,92,70,${tired ? 0.5 : flush * 0.45})`;
    g.beginPath(); g.ellipse(9 * u, hy + 6 * u, 7 * u, 4.5 * u, 0, 0, Math.PI * 2); g.fill();
  }
  drawHair(g, c, u, hy, rm ? 0 : Math.sin(phase * 2) * speed * 0.03);
  g.fillStyle = '#2b211c';
  g.strokeStyle = '#2b211c';
  if (tired) {
    g.lineWidth = 2 * u;
    g.beginPath(); g.moveTo(8 * u, hy); g.lineTo(14 * u, hy); g.stroke();
    g.fillStyle = '#7a2e22';
    g.beginPath(); g.ellipse(12 * u, hy + 10 * u, 3.5 * u, 4 * u, 0, 0, Math.PI * 2); g.fill();
  } else {
    g.beginPath(); g.ellipse(11 * u, hy, 2.6 * u, (speed > 14 ? 3.2 : 4) * u, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#b5523b';
    if (speed > 14) { g.beginPath(); g.arc(12 * u, hy + 9 * u, 3.5 * u, 0, Math.PI); g.fill(); }
    else g.fillRect(9 * u, hy + 9 * u, 5 * u, 2 * u);
  }
  if ((flush > 0.5 || speed > 15) && !rm) {
    g.fillStyle = '#7fc4e8';
    const dy = ((t * 24) % 14) * u;
    g.beginPath(); g.ellipse(-6 * u, hy - 6 * u + dy, 2.2 * u, 3.2 * u, 0, 0, Math.PI * 2); g.fill();
  }
  g.translate(0, bob);
  g.rotate(-lean);
  g.translate(0, -bob);
  g.restore();
  // front limbs drawn after the body, with the same transform
  g.save();
  g.translate(x, y);
  g.scale(1 - s * 0.6, 1 + s);
  leg(4, sw * 0.75 * amp, false);
  g.translate(0, -bob);
  g.rotate(lean);
  g.translate(0, bob);
  arm(-sw * 0.9 * amp, false);
  g.restore();
}

function shadeCol(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (v: number) => Math.round(v * 0.78);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// Same silhouette as the private drawHair in cast.ts, plus a little flutter.
function drawHair(g: CanvasRenderingContext2D, c: CastMember, u: number, hy: number, flutter: number) {
  g.fillStyle = c.hair;
  const s = c.hairStyle;
  g.beginPath();
  g.ellipse(0, hy - 7 * u, 21 * u, 16 * u, 0, Math.PI, Math.PI * 2);
  g.fill();
  g.fillRect(-21 * u, hy - 8 * u, 10 * u, 12 * u);
  if (/long|bob|ponytail|bun/.test(s)) g.fillRect(-21 * u, hy - 4 * u, 12 * u, (/long/.test(s) ? 30 : 18) * u);
  if (/ponytail/.test(s)) { g.beginPath(); g.ellipse(-24 * u, hy + 4 * u, 6 * u, 14 * u, 0.3 + flutter, 0, Math.PI * 2); g.fill(); }
  if (/bun/.test(s)) { g.beginPath(); g.arc(-6 * u, hy - 24 * u, 8 * u, 0, Math.PI * 2); g.fill(); }
  if (/tuft|spike|messy/.test(s)) { g.beginPath(); g.moveTo(-2 * u, hy - 20 * u); g.lineTo((6 - flutter * 10) * u, hy - 32 * u); g.lineTo(10 * u, hy - 18 * u); g.fill(); }
}

export default { meta, create } satisfies GameModule;
