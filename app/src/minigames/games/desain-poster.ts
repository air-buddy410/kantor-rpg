// Desain Poster (easel, Studio Kevin). The player builds a poster for a short
// brief by cycling five properties. The poster is graded on text contrast
// (WCAG relative luminance), fit with the brief and type hierarchy, and Kevin
// comments on each criterion. Three briefs per session.
import type { GameCtx, GameInstance, GameModule } from '../types';
import { PAL, drawChar, roundRect, text } from '../cast';

type Tone = 'warm' | 'cool' | 'neutral';
type Mood = 'formal' | 'casual' | 'both';
export type Icon = 'wifi' | 'calendar' | 'coffee' | 'server' | 'star' | 'leaf' | 'dumbbell';

export const BGS: { id: string; hex: string; tone: Tone }[] = [
  { id: 'Krem', hex: '#f4ecdc', tone: 'neutral' },
  { id: 'Oranye', hex: '#e07a3a', tone: 'warm' },
  { id: 'Merah bata', hex: '#a34a27', tone: 'warm' },
  { id: 'Kuning', hex: '#f2c14e', tone: 'warm' },
  { id: 'Biru tua', hex: '#1f3a5f', tone: 'cool' },
  { id: 'Biru muda', hex: '#bfe0e6', tone: 'cool' },
  { id: 'Hijau tua', hex: '#1f4d3a', tone: 'cool' },
  { id: 'Putih', hex: '#ffffff', tone: 'neutral' },
  { id: 'Hitam', hex: '#1d1d1d', tone: 'neutral' },
];
export const INKS: { id: string; hex: string }[] = [
  { id: 'Hitam', hex: '#111111' },
  { id: 'Putih', hex: '#ffffff' },
  { id: 'Krem', hex: '#fffaf0' },
  { id: 'Kuning', hex: '#f2c14e' },
  { id: 'Abu-abu', hex: '#9a9a9a' },
  { id: 'Hijau tua', hex: '#1f4d3a' },
  { id: 'Biru tua', hex: '#1f3a5f' },
  { id: 'Oranye', hex: '#e07a3a' },
];
export const STYLES: { id: string; size: number; big: 0 | 1 | 2; mood: Mood; font: string }[] = [
  { id: 'Besar tebal', size: 34, big: 2, mood: 'both', font: "800 {s}px 'Alegreya Sans', system-ui, sans-serif" },
  { id: 'Besar serif', size: 32, big: 2, mood: 'formal', font: '700 {s}px Georgia, serif' },
  { id: 'Besar miring santai', size: 32, big: 2, mood: 'casual', font: "italic 800 {s}px 'Alegreya Sans', system-ui, sans-serif" },
  { id: 'Sedang', size: 22, big: 1, mood: 'both', font: "700 {s}px 'Alegreya Sans', system-ui, sans-serif" },
  { id: 'Kecil', size: 15, big: 0, mood: 'both', font: "400 {s}px 'Alegreya Sans', system-ui, sans-serif" },
];
export const ICONS: Icon[] = ['wifi', 'calendar', 'coffee', 'server', 'star', 'leaf', 'dumbbell'];
export const LAYOUTS = ['atas', 'tengah', 'bawah'] as const;

export interface Brief { id: number; tone: Tone | 'any'; mood: 'formal' | 'casual'; icon: Icon }
// Text for each brief lives in create() so the i18n scanner sees literal t() calls.
export const BRIEFS: Brief[] = [
  { id: 0, tone: 'warm', mood: 'casual', icon: 'wifi' },
  { id: 1, tone: 'any', mood: 'formal', icon: 'calendar' },
  { id: 2, tone: 'warm', mood: 'casual', icon: 'coffee' },
  { id: 3, tone: 'cool', mood: 'formal', icon: 'server' },
  { id: 4, tone: 'warm', mood: 'casual', icon: 'star' },
  { id: 5, tone: 'cool', mood: 'casual', icon: 'dumbbell' },
  { id: 6, tone: 'cool', mood: 'formal', icon: 'star' },
  { id: 7, tone: 'cool', mood: 'casual', icon: 'leaf' },
];

export interface Choice { bg: number; style: number; icon: number; layout: number; ink: number }

function lum(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG 2 contrast ratio, 1..21. */
export function contrast(a: string, b: string) {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export interface Grade { ratio: number; contrast: number; tone: number; mood: number; icon: number; hierarchy: number; total: number }

/** Max 100: contrast 40, brief fit 40 (tone 15, mood 15, icon 10), hierarchy 20. */
export function grade(b: Brief, c: Choice): Grade {
  const ratio = contrast(BGS[c.bg].hex, INKS[c.ink].hex);
  const con = ratio >= 4.5 ? 40 : ratio >= 3 ? 20 : Math.round(Math.max(0, ratio - 1) * 5);
  const bt = BGS[c.bg].tone;
  const tone = b.tone === 'any' ? (bt === 'neutral' ? 15 : 8) : bt === b.tone ? 15 : bt === 'neutral' ? 6 : 0;
  const sm = STYLES[c.style].mood;
  const mood = sm === b.mood ? 15 : sm === 'both' ? 10 : 0;
  const icon = ICONS[c.icon] === b.icon ? 10 : 0;
  const hb = STYLES[c.style].big;
  const hierarchy = (hb === 2 ? 15 : hb === 1 ? 8 : 0) + (LAYOUTS[c.layout] === 'atas' ? 5 : LAYOUTS[c.layout] === 'tengah' ? 3 : 0);
  return { ratio, contrast: con, tone, mood, icon, hierarchy, total: con + tone + mood + icon + hierarchy };
}

export const MIN_START_CONTRAST = 1.5;
const SESSION_BRIEFS = 3;
const BRIEF_TIME = 45;
const REVIEW_TIME = 7;
const ROWS = 5;
/** Seconds the review card ignores A, so a double press on submit does not skip Kevin's notes. */
const REVIEW_GUARD = 0.35;

const meta: GameModule['meta'] = {
  id: 'desain-poster', title: 'Desain Poster', place: 'easel', music: 'lounge',
  blurb: 'Susun poster sesuai brief. Kevin menilai kontras, kecocokan brief dan hierarki judul.',
  view: { w: 640, h: 400 }, score: { unit: 'poin', higherIsBetter: true }, touch: ['left', 'right', 'up', 'down', 'a'],
  tutorial: [
    'Baca brief di atas poster.',
    'Pilih baris dengan {ud}, ganti nilainya dengan {lr}.',
    'Tekan {a} kalau sudah pas. Kevin menilai kontras, brief, dan judul.',
  ],
  legend: [['ud', 'Pilih baris'], ['lr', 'Ganti nilai'], ['a', 'Minta penilaian']],
  actions: { up: 'Properti sebelumnya', down: 'Properti berikutnya', left: 'Nilai sebelumnya', right: 'Nilai berikutnya', a: 'Selesai, minta penilaian / lanjut' },
  pointerHint: 'Ketuk ◀ atau ▶ di tiap baris untuk ganti nilai, seret judul di poster ke atas atau bawah untuk tata letak',
};

function create(ctx: GameCtx): GameInstance {
  const { g, w, h } = ctx;
  const t = ctx.t;
  const briefText = (id: number) => [
    t('Poster promo WiFi kantor, warna hangat, judul besar'),
    t('Pengumuman rapat Senin, rapi dan formal'),
    t('Ajakan ngopi bareng di lounge, santai dan hangat'),
    t('Info pemeliharaan server, warna dingin, formal'),
    t('Lomba biliar Jumat sore, ceria dan hangat'),
    t('Ajakan olahraga pagi di gym, segar dan warna dingin'),
    t('Pameran karya tim di galeri, warna dingin, elegan dan formal'),
    t('Kampanye hemat energi, warna dingin, santai'),
  ][id];
  const headline = (id: number) => [t('WiFi Kencang!'), t('Rapat Senin'), t('Ngopi Yuk'), t('Pemeliharaan Server'), t('Lomba Biliar'), t('Olahraga Pagi'), t('Pameran Karya'), t('Hemat Energi')][id];
  const bgName = (i: number) => [t('Krem'), t('Oranye'), t('Merah bata'), t('Kuning'), t('Biru tua'), t('Biru muda'), t('Hijau tua'), t('Putih'), t('Hitam')][i];
  const inkName = (i: number) => [t('Hitam'), t('Putih'), t('Krem'), t('Kuning'), t('Abu-abu'), t('Hijau tua'), t('Biru tua'), t('Oranye')][i];
  const styleName = (i: number) => [t('Besar tebal'), t('Besar serif'), t('Besar miring santai'), t('Sedang'), t('Kecil')][i];
  const iconName = (i: number) => [t('WiFi'), t('Kalender'), t('Kopi'), t('Server'), t('Bintang'), t('Daun'), t('Dumbel')][i];
  const layoutName = (i: number) => [t('Atas'), t('Tengah'), t('Bawah')][i];
  const rowName = (i: number) => [t('Latar'), t('Judul'), t('Ilustrasi'), t('Tata letak'), t('Warna teks')][i];

  const order: Brief[] = [];
  {
    const bag = [...BRIEFS];
    for (let i = 0; i < SESSION_BRIEFS; i++) order.push(bag.splice(Math.floor(ctx.rand() * bag.length), 1)[0]);
  }
  const counts = [BGS.length, STYLES.length, ICONS.length, LAYOUTS.length, INKS.length];
  const keys: (keyof Choice)[] = ['bg', 'style', 'icon', 'layout', 'ink'];
  let idx = 0;
  let choice: Choice = { bg: 0, style: 0, icon: 0, layout: 0, ink: 0 };
  let row = 0;
  let phase: 'edit' | 'review' = 'edit';
  let left = BRIEF_TIME;
  let reviewT = 0;
  let last: Grade | null = null;
  let total = 0;
  const grades: number[] = [];
  let ended = false;
  let anim = 0;
  let bump = 0;
  let rowFlash = 0;
  let flashDir = 0;
  let revealK = 0;
  let dragY: number | null = null;
  const sparks: { x: number; y: number; vx: number; vy: number; life: number; col: string }[] = [];
  const kevin = ctx.cast.find((c) => c.id === 'CH-VISUAL') ?? ctx.cast[0];

  const randomChoice = (): Choice => {
    const c: Choice = {
      bg: Math.floor(ctx.rand() * BGS.length), style: Math.floor(ctx.rand() * STYLES.length), icon: Math.floor(ctx.rand() * ICONS.length),
      layout: Math.floor(ctx.rand() * LAYOUTS.length), ink: Math.floor(ctx.rand() * INKS.length),
    };
    // a start with ink equal to the paper looks like a blank poster; keep it weak but visible
    while (contrast(BGS[c.bg].hex, INKS[c.ink].hex) < MIN_START_CONTRAST) c.ink = (c.ink + 1) % INKS.length;
    return c;
  };
  const hud = () => ctx.setHud(ctx.t('Brief {n}/{m} · {p} poin', { n: Math.min(idx + 1, SESSION_BRIEFS), m: SESSION_BRIEFS, p: total }));
  const startBrief = () => { choice = randomChoice(); row = 0; phase = 'edit'; left = BRIEF_TIME; hud(); };

  function submit() {
    last = grade(order[idx], choice);
    total += last.total;
    grades.push(last.total);
    phase = 'review';
    reviewT = REVIEW_TIME;
    revealK = 0;
    dragY = null;
    bump = 1;
    ctx.sfx('stamp');
    ctx.sfx(last.total >= 70 ? 'right' : last.total >= 40 ? 'confirm' : 'wrong');
    if (last.total >= 70 && !ctx.reducedMotion) {
      for (let k = 0; k < 18; k++) {
        const a = (k / 18) * Math.PI * 2;
        sparks.push({ x: 140, y: 188, vx: Math.cos(a) * (90 + (k % 3) * 40), vy: Math.sin(a) * (90 + (k % 3) * 40) - 40, life: 0.8, col: k % 2 ? PAL.gold : PAL.accent });
      }
    }
    hud();
  }

  function advance() {
    idx++;
    if (idx >= SESSION_BRIEFS) {
      ended = true;
      ctx.end({ score: total, won: total >= 210, summary: ctx.t('Nilai poster: {a}, {b}, {c}', { a: grades[0], b: grades[1], c: grades[2] }) });
      return;
    }
    ctx.sfx('page');
    startBrief();
  }

  function cycle(d: number) {
    const k = keys[row];
    choice = { ...choice, [k]: (choice[k] + d + counts[row]) % counts[row] };
    ctx.sfx('rotate', { rate: 1 + row * 0.08 });
    bump = 1;
    rowFlash = 1;
    flashDir = d;
  }

  // right panel geometry
  const PX = 300, PW = 326, RY = 132, RH = 40;
  // poster geometry, also the drag target for the headline
  const QX = 36, QY = 40, QW = 208, QH = 296;
  const VX = PX + 124, VC = (PX + 156 + PX + PW - 34) / 2;
  const layoutY = (i: number) => (i === 0 ? QY + 50 : i === 1 ? QY + QH / 2 + 30 : QY + QH - 70);

  startBrief();

  return {
    update(dt, inp) {
      if (ended) return;
      anim += dt;
      bump = Math.max(0, bump - dt * 4);
      rowFlash = Math.max(0, rowFlash - dt * 5);
      for (const s of sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 200 * dt; s.life -= dt; }
      for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life <= 0) sparks.splice(i, 1);
      if (phase === 'review') {
        reviewT -= dt;
        revealK = Math.min(1, revealK + dt * 1.6);
        if (reviewT <= 0 || (reviewT < REVIEW_TIME - REVIEW_GUARD && (inp.hit.a || inp.tap))) advance();
        return;
      }
      left -= dt;
      if (left <= 0) { left = 0; submit(); return; }
      if (inp.tap) {
        const { x, y } = inp.tap;
        const r = Math.floor((y - RY) / RH);
        if (x >= PX && x <= PX + PW && r >= 0 && r < ROWS) {
          if (r !== row) ctx.sfx('tick');
          row = r;
          // label column only selects; the value area has a back half and a forward half
          if (x >= VX) cycle(x < VC ? -1 : 1);
        } else if (x >= PX && x <= PX + PW && y >= RY + ROWS * RH + 2 && y <= RY + ROWS * RH + 50) submit();
        else if (x >= QX && x <= QX + QW && y >= QY && y <= QY + QH) {
          dragY = y;
          row = 3;
        }
        return;
      }
      if (dragY !== null) {
        if (inp.ptr && inp.ptr.down) {
          dragY = inp.ptr.y;
          let bestI = choice.layout, bestD = Infinity;
          for (let i = 0; i < LAYOUTS.length; i++) { const d = Math.abs(layoutY(i) - dragY); if (d < bestD) { bestD = d; bestI = i; } }
          if (bestI !== choice.layout) { choice = { ...choice, layout: bestI }; ctx.sfx('rotate', { rate: 1.24 }); bump = 1; rowFlash = 1; flashDir = 0; }
        } else dragY = null;
      }
      if (inp.hit.up) { row = (row - 1 + ROWS) % ROWS; ctx.sfx('tick'); }
      if (inp.hit.down) { row = (row + 1) % ROWS; ctx.sfx('tick'); }
      if (inp.hit.left) cycle(-1);
      if (inp.hit.right) cycle(1);
      if (inp.hit.a) submit();
    },
    render() {
      g.fillStyle = PAL.bg;
      g.fillRect(0, 0, w, h);
      // easel
      g.strokeStyle = '#8a6d3b';
      g.lineWidth = 8;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(80, 390); g.lineTo(140, 30);
      g.moveTo(200, 390); g.lineTo(140, 30);
      g.moveTo(140, 330); g.lineTo(140, 392);
      g.stroke();
      g.fillStyle = '#6b522b';
      g.fillRect(36, 338, 208, 10);
      {
        // poster squashes a touch on every change so the edit reads instantly
        const sq = ctx.reducedMotion ? 0 : Math.sin(bump * Math.PI) * 0.03;
        g.save();
        g.translate(QX + QW / 2, QY + QH);
        g.scale(1 + sq, 1 - sq);
        g.translate(-(QX + QW / 2), -(QY + QH));
        drawPoster(QX, QY, QW, QH);
        g.restore();
        if (dragY !== null) {
          g.strokeStyle = PAL.gold; g.lineWidth = 2; g.setLineDash([5, 4]);
          g.strokeRect(QX + 4, Math.max(QY + 4, Math.min(QY + QH - 40, dragY - 20)), QW - 8, 40);
          g.setLineDash([]);
        }
      }
      for (const sp of sparks) { g.globalAlpha = Math.max(0, sp.life / 0.8); g.fillStyle = sp.col; g.fillRect(sp.x - 2.5, sp.y - 2.5, 5, 5); }
      g.globalAlpha = 1;

      // brief + rows
      const b = order[Math.min(idx, SESSION_BRIEFS - 1)];
      g.fillStyle = PAL.surface;
      roundRect(g, PX, 12, PW, 106, 10);
      text(g, ctx.t('Brief {n}/{m}', { n: Math.min(idx + 1, SESSION_BRIEFS), m: SESSION_BRIEFS }), PX + 14, 30, 15, PAL.accent, 'left');
      if (phase === 'edit') text(g, ctx.t('{s} dtk', { s: Math.ceil(left) }), PX + PW - 14, 30, 15, left < 10 ? PAL.red : PAL.ink2, 'right');
      wrap(briefText(b.id), PX + 14, 54, PW - 28, 17, 20, PAL.ink);
      if (phase === 'edit') {
        const r = contrast(BGS[choice.bg].hex, INKS[choice.ink].hex);
        text(g, ctx.t('Kontras teks {r}:1', { r: r.toFixed(1) }), PX + 14, 104, 13, r >= 4.5 ? PAL.green : PAL.red, 'left');
      }
      drawChar(g, kevin, PX + PW - 26, 116, 44, -1, phase === 'review' && last && last.total >= 70 ? 'win' : 'idle', anim);

      if (phase === 'edit') {
        for (let i = 0; i < ROWS; i++) {
          const y = RY + i * RH;
          const on = i === row;
          g.fillStyle = on ? '#fff3d6' : PAL.surface;
          roundRect(g, PX, y, PW, RH - 6, 8);
          if (on) { g.strokeStyle = PAL.gold; g.lineWidth = 2; g.strokeRect(PX + 1, y + 1, PW - 2, RH - 8); }
          fitLine(rowName(i), PX + 12, y + 17, 84, 14, PAL.ink2, 'left');
          if (i === 0 || i === 4) {
            g.fillStyle = i === 0 ? BGS[choice.bg].hex : INKS[choice.ink].hex;
            g.fillRect(PX + 100, y + 8, 18, 18);
            g.strokeStyle = PAL.ink2; g.lineWidth = 1; g.strokeRect(PX + 100.5, y + 8.5, 17, 17);
          }
          const v = i === 0 ? bgName(choice.bg) : i === 1 ? styleName(choice.style) : i === 2 ? iconName(choice.icon) : i === 3 ? layoutName(choice.layout) : inkName(choice.ink);
          const fl = on ? rowFlash : 0;
          const slide = ctx.reducedMotion ? 0 : fl * flashDir * 8;
          // arrow chips: the pressed side pops
          for (const [cx, d] of [[PX + 140, -1], [PX + PW - 18, 1]] as const) {
            const pop = !ctx.reducedMotion && flashDir === d ? fl * 3 : 0;
            g.fillStyle = on ? '#f4dfae' : '#efe6d2';
            roundRect(g, cx - 13 - pop, y + 4 - pop, 26 + pop * 2, RH - 14 + pop * 2, 6);
            text(g, d < 0 ? '◀' : '▶', cx, y + 17, 13, PAL.ink);
          }
          fitLine(v, VC + slide, y + 17, PW - 194, 15, PAL.ink, 'center');
        }
        const by = RY + ROWS * RH + 6;
        g.fillStyle = PAL.green;
        roundRect(g, PX, by, PW, 40, 10);
        fitLine(ctx.t('{a}: Selesai, minta penilaian', { a: ctx.key('a') }), PX + PW / 2, by + 20, PW - 20, 16, '#ffffff', 'center');

      } else if (last) {
        g.fillStyle = PAL.surface;
        roundRect(g, PX, RY, PW, 252, 10);
        text(g, ctx.t('Penilaian Kevin: {p}/100', { p: last.total }), PX + 14, RY + 20, 17, PAL.ink, 'left');
        const ratio = last.ratio.toFixed(1);
        const lines: [string, number, number][] = [
          [last.contrast === 40 ? t('Kontras {r}:1, teks jelas terbaca', { r: ratio }) : last.contrast >= 20 ? t('Kontras {r}:1, kurang. Minimal 4,5:1', { r: ratio }) : t('Kontras {r}:1, teks hampir tak terbaca', { r: ratio }), last.contrast, 40],
          [b.tone === 'any' ? (last.tone === 15 ? t('Latar netral, pas untuk pengumuman') : t('Latar netral lebih cocok di sini')) : last.tone === 15 ? t('Nuansa warna sesuai brief') : b.tone === 'warm' ? t('Brief minta warna hangat') : t('Brief minta warna dingin'), last.tone, 15],
          [last.mood === 15 ? t('Gaya judul cocok dengan suasana') : last.mood > 0 ? t('Gaya judul aman, bisa lebih khas') : b.mood === 'formal' ? t('Terlalu santai untuk brief formal') : t('Terlalu kaku untuk brief santai'), last.mood, 15],
          [last.icon === 10 ? t('Ilustrasi nyambung dengan pesan') : t('Ilustrasi kurang nyambung'), last.icon, 10],
          [last.hierarchy >= 18 ? t('Hierarki jelas, judul menonjol') : last.hierarchy >= 10 ? t('Judul bisa lebih besar atau lebih ke atas') : t('Judul tenggelam, perbesar'), last.hierarchy, 20],
        ];
        lines.forEach(([s, v, max], i) => {
          const y = RY + 52 + i * 38;
          // bars fill one after another; ease out so each lands softly
          const k = ctx.reducedMotion ? 1 : Math.max(0, Math.min(1, revealK * 5 - i * 0.6));
          const e = 1 - Math.pow(1 - k, 3);
          g.globalAlpha = ctx.reducedMotion ? 1 : Math.min(1, 0.25 + k);
          fitLine(s, PX + 14, y, PW - 28, 13, PAL.ink, 'left');
          g.fillStyle = 'rgba(29,42,35,0.12)';
          g.fillRect(PX + 14, y + 12, PW - 80, 6);
          g.fillStyle = v / max >= 0.75 ? PAL.green : v / max >= 0.4 ? PAL.gold : PAL.red;
          g.fillRect(PX + 14, y + 12, (PW - 80) * (v / max) * e, 6);
          text(g, `${Math.round(v * e)}/${max}`, PX + PW - 14, y + 14, 12, PAL.ink2, 'right');
          g.globalAlpha = 1;
        });
        text(g, reviewT < REVIEW_TIME - REVIEW_GUARD ? (idx + 1 < SESSION_BRIEFS ? ctx.t('{a} atau ketuk: brief berikutnya', { a: ctx.key('a') }) : ctx.t('{a} atau ketuk: lihat hasil', { a: ctx.key('a') })) : '', PX + PW / 2, RY + 240, 13, PAL.ink2);
        // stamp with the total, squashes in on submit
        const sc = ctx.reducedMotion ? 1 : 1 + bump * 0.5;
        g.save();
        g.translate(QX + QW - 34, QY + 30);
        g.rotate(-0.18);
        g.scale(sc, 2 - sc);
        const col = last.total >= 70 ? PAL.green : last.total >= 40 ? PAL.gold : PAL.red;
        g.fillStyle = 'rgba(255,250,240,0.92)';
        g.beginPath(); g.arc(0, 0, 28, 0, Math.PI * 2); g.fill();
        g.strokeStyle = col; g.lineWidth = 3; g.stroke();
        text(g, String(last.total), 0, 1, 20, col);
        g.restore();
      }
    },
    snapshot: () => ({
      brief: idx, briefIds: order.map((o) => o.id), phase, row, dragging: dragY !== null, choice: { ...choice }, left: Math.round(left * 100) / 100,
      total, grades: [...grades], last: last ? { ...last, ratio: Math.round(last.ratio * 100) / 100 } : null, ended,
    }),
  };

  function fitLine(s: string, x: number, y: number, maxW: number, size: number, color: string, align: CanvasTextAlign) {
    let sz = size;
    for (; sz > 9; sz--) { g.font = `700 ${sz}px 'Alegreya Sans', system-ui, sans-serif`; if (g.measureText(s).width <= maxW) break; }
    text(g, s, x, y, sz, color, align);
  }

  function wrap(s: string, x: number, y: number, maxW: number, size: number, lh: number, color: string) {
    g.font = `700 ${size}px 'Alegreya Sans', system-ui, sans-serif`;
    const words = s.split(' ');
    let line = '';
    let yy = y;
    for (const wd of words) {
      const tt = line ? `${line} ${wd}` : wd;
      if (g.measureText(tt).width > maxW - 40 && line) { text(g, line, x, yy, size, color, 'left'); line = wd; yy += lh; } else line = tt;
    }
    if (line) text(g, line, x, yy, size, color, 'left');
  }

  function drawPoster(x: number, y: number, pw: number, ph: number) {
    const bg = BGS[choice.bg].hex, ink = INKS[choice.ink].hex;
    const st = STYLES[choice.style];
    const b = order[Math.min(idx, SESSION_BRIEFS - 1)];
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(x + 5, y + 6, pw, ph);
    g.fillStyle = bg;
    g.fillRect(x, y, pw, ph);
    const lay = LAYOUTS[choice.layout];
    const ty = layoutY(choice.layout) - QY + y;
    const iy = lay === 'atas' ? y + 170 : lay === 'tengah' ? y + 90 : y + 110;
    drawIcon(ICONS[choice.icon], x + pw / 2, iy, 46, ink);
    // headline, wrapped to the poster width
    let size = st.size;
    const words = headline(b.id).split(' ');
    let lines: string[] = [];
    for (; size >= 12; size -= 2) {
      g.font = st.font.replace('{s}', String(size));
      lines = [];
      let cur = '';
      for (const wd of words) { const tt = cur ? `${cur} ${wd}` : wd; if (g.measureText(tt).width > pw - 24 && cur) { lines.push(cur); cur = wd; } else cur = tt; }
      lines.push(cur);
      if (lines.every((l) => g.measureText(l).width <= pw - 24)) break;
    }
    g.fillStyle = ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((l, i) => g.fillText(l, x + pw / 2, ty + (i - (lines.length - 1) / 2) * size * 1.05));
    const sub = ty + ((lines.length + 1) / 2) * size * 1.05 + 10;
    g.font = "400 12px 'Alegreya Sans', system-ui, sans-serif";
    g.fillText(ctx.t('Info internal kantor'), x + pw / 2, Math.min(y + ph - 14, sub));
  }

  function drawIcon(ic: Icon, cx: number, cy: number, s: number, col: string) {
    g.save();
    g.translate(cx, cy);
    g.strokeStyle = col;
    g.fillStyle = col;
    g.lineWidth = s * 0.09;
    g.lineCap = 'round';
    const r = s / 2;
    if (ic === 'wifi') {
      for (let k = 1; k <= 3; k++) { g.beginPath(); g.arc(0, r * 0.6, r * 0.33 * k, Math.PI * 1.25, Math.PI * 1.75); g.stroke(); }
      g.beginPath(); g.arc(0, r * 0.6, s * 0.07, 0, Math.PI * 2); g.fill();
    } else if (ic === 'calendar') {
      g.strokeRect(-r * 0.8, -r * 0.6, r * 1.6, r * 1.4);
      g.fillRect(-r * 0.8, -r * 0.6, r * 1.6, r * 0.35);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) g.fillRect(-r * 0.55 + i * r * 0.45, -r * 0.05 + j * r * 0.38, r * 0.2, r * 0.2);
    } else if (ic === 'coffee') {
      g.beginPath(); g.moveTo(-r * 0.6, -r * 0.3); g.lineTo(r * 0.45, -r * 0.3); g.lineTo(r * 0.35, r * 0.6); g.lineTo(-r * 0.5, r * 0.6); g.closePath(); g.stroke();
      g.beginPath(); g.arc(r * 0.55, r * 0.1, r * 0.22, -Math.PI / 2, Math.PI / 2); g.stroke();
      g.beginPath(); g.moveTo(-r * 0.2, -r * 0.5); g.quadraticCurveTo(-r * 0.05, -r * 0.75, -r * 0.2, -r * 0.95); g.moveTo(r * 0.1, -r * 0.5); g.quadraticCurveTo(r * 0.25, -r * 0.75, r * 0.1, -r * 0.95); g.stroke();
    } else if (ic === 'server') {
      for (let k = 0; k < 3; k++) { g.strokeRect(-r * 0.7, -r * 0.8 + k * r * 0.55, r * 1.4, r * 0.42); g.beginPath(); g.arc(r * 0.45, -r * 0.59 + k * r * 0.55, s * 0.05, 0, Math.PI * 2); g.fill(); }
    } else if (ic === 'star') {
      g.beginPath();
      for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5; const rr = k % 2 ? r * 0.42 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      g.closePath(); g.fill();
    } else if (ic === 'leaf') {
      g.beginPath(); g.moveTo(-r * 0.7, r * 0.7); g.quadraticCurveTo(-r * 0.8, -r * 0.8, r * 0.8, -r * 0.8); g.quadraticCurveTo(r * 0.7, r * 0.7, -r * 0.7, r * 0.7); g.fill();
      g.strokeStyle = BGS[choice.bg].hex; g.beginPath(); g.moveTo(-r * 0.6, r * 0.6); g.lineTo(r * 0.5, -r * 0.5); g.stroke();
    } else {
      g.fillRect(-r * 0.6, -r * 0.08, r * 1.2, r * 0.16);
      g.fillRect(-r * 0.85, -r * 0.45, r * 0.25, r * 0.9);
      g.fillRect(r * 0.6, -r * 0.45, r * 0.25, r * 0.9);
    }
    g.restore();
  }
}

export default { meta, create } satisfies GameModule;
