// Peregangan (exercise mat, L2-GYM). Follow-the-sequence: the coach shows a
// growing list of stretch directions, the player repeats it. Each round adds
// one move and the coach shows a little faster. Three mistakes end the
// session; repeating a 12-move sequence finishes it with a win. Presses made
// just before the player's turn opens are buffered, and the on-canvas pad
// accepts taps.
import type { Btn, CastMember, GameCtx, GameInstance, GameModule } from '../types';
import { PAL, text, roundRect } from '../cast';

const DIRS: Btn[] = ['up', 'right', 'down', 'left'];
const ARROW: Record<string, string> = { up: '▲', right: '▶', down: '▼', left: '◀' };
const LABEL: Record<string, string> = { up: 'Tangan ke atas', right: 'Condong kanan', down: 'Sentuh lutut', left: 'Condong kiri' };
export const MAX_LEN = 12;
export const MAX_MISTAKES = 3;
/** Presses this close before the player's turn are kept and applied when it opens. */
export const BUFFER = 0.15;
/** Seconds between moves while the coach shows the sequence (shrinks with length). */
export const showStep = (len: number) => Math.max(0.36, 0.62 - (len - 2) * 0.025);

const meta: GameModule['meta'] = {
  id: 'peregangan', title: 'Peregangan', place: 'exercise_mat', music: 'calm',
  blurb: 'Lihat urutan gerakan, lalu ulangi. Tiap ronde bertambah satu gerakan.',
  view: { w: 640, h: 400 }, score: { unit: 'gerakan', higherIsBetter: true }, touch: ['left', 'up', 'down', 'right'],
  tutorial: [
    'Perhatikan urutan gerakan pelatih.',
    'Saat giliranmu, ulangi urutannya dengan {arah}.',
    'Tiap ronde bertambah satu gerakan. Tiga kali salah, sesi selesai.',
  ],
  legend: [['arah', 'Ulangi gerakan']],
  actions: { arah: 'Ulangi gerakan pelatih' },
  pointerHint: 'Ketuk panah di tengah layar untuk mengulang gerakan',
};

interface Floater { s: string; x: number; y: number; t: number; col: string; size: number }
interface Bit { x: number; y: number; vx: number; vy: number; life: number; max: number; col: string; r: number }

const PAD_X = 320, PAD_Y = 214, PAD_R = 34;
const padPos = (d: Btn) => ({ x: PAD_X + (d === 'right' ? PAD_R : d === 'left' ? -PAD_R : 0), y: PAD_Y + (d === 'down' ? PAD_R : d === 'up' ? -PAD_R : 0) });

function create(ctx: GameCtx): GameInstance {
  const { g, w, h } = ctx;
  const rm = ctx.reducedMotion;
  const seq: Btn[] = [];
  let phase: 'show' | 'input' | 'feedback' | 'done' = 'show';
  let showIdx = 0;
  let timer = 0.6;
  let inputIdx = 0;
  let mistakes = 0;
  let best = 0;
  let streak = 0;
  let coachPose: Btn | null = null;
  let mePose: Btn | null = null;
  let ok = true;
  let time = 0;
  let buffered: Btn | null = null;
  let bufT = 0;
  // animation only
  let coachK = 0, meK = 0;
  let coachShown: Btn | null = null, meShown: Btn | null = null;
  let meSq = 0, meSqV = 0;
  let shake = 0, flash = 0;
  let padHit: Btn | null = null, padHitT = 0, padBad = false;
  const floaters: Floater[] = [];
  const bits: Bit[] = [];
  const me = ctx.cast.find((c) => c.id === ctx.playerId) ?? ctx.cast[0];
  const coach = ctx.cast.find((c) => c.id === 'CH-QA') ?? ctx.cast[1];

  const replay = (delay: number) => { phase = 'show'; showIdx = 0; timer = delay; inputIdx = 0; coachPose = null; };
  const grow = () => { seq.push(DIRS[Math.floor(ctx.rand() * 4)]); replay(0.55); };
  grow();
  grow();
  const hud = () => ctx.setHud(ctx.t('Ronde {n} · Salah {m}/3', { n: seq.length - 1, m: mistakes }));
  hud();

  function float(s: string, x: number, y: number, col: string, size = 22) {
    floaters.push({ s, x, y, t: 0, col, size });
    if (floaters.length > 5) floaters.shift();
  }
  function sparkle(x: number, y: number, n: number, col: string) {
    if (rm) return;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const sp = 70 + ((i * 31) % 50);
      bits.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0.7, max: 0.7, col, r: 2 + (i % 3) });
    }
  }

  function finish() {
    phase = 'done';
    const won = best >= MAX_LEN || best >= 5;
    ctx.sfx(best >= MAX_LEN ? 'win' : won ? 'confirm' : 'lose');
    ctx.end({ score: best, summary: ctx.t('Urutan terpanjang: {n} gerakan', { n: best }), won });
  }

  function press(d: Btn) {
    mePose = d;
    meShown = d;
    meK = 0.25;
    meSqV = d === 'down' ? 3 : -2.5;
    padHit = d; padHitT = 0.18;
    if (d === seq[inputIdx]) {
      padBad = false;
      ctx.sfx('beep', { rate: 1 + DIRS.indexOf(d) * 0.12 });
      inputIdx++;
      const p = padPos(d);
      sparkle(p.x, p.y, 5, PAL.gold);
      if (inputIdx === seq.length) {
        best = Math.max(best, seq.length);
        streak++;
        ok = true;
        phase = 'feedback';
        timer = 0.6;
        flash = 0.18;
        ctx.sfx('right');
        float(streak >= 2 ? ctx.t('SEMPURNA! x{n}', { n: streak }) : ctx.t('SEMPURNA!'), 450, 128, '#3f8a50', 26);
        sparkle(450, 200, 12, '#7fc4e8');
      }
    } else {
      padBad = true;
      mistakes++;
      streak = 0;
      ok = false;
      phase = 'feedback';
      timer = 0.85;
      shake = rm ? 0 : 6;
      ctx.sfx('wrong');
      float(ctx.t('SALAH'), 450, 128, PAL.red, 26);
      hud();
    }
  }

  function tapDir(tx: number, ty: number): Btn | null {
    const dx = tx - PAD_X, dy = ty - PAD_Y;
    if (Math.abs(dx) > PAD_R * 2 || Math.abs(dy) > PAD_R * 2) return null;
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return null;
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  }

  return {
    update(dt, inp) {
      time += dt;
      flash = Math.max(0, flash - dt);
      shake = Math.max(0, shake - dt * 30);
      padHitT = Math.max(0, padHitT - dt);
      // poses ease toward their target; a new target restarts from the current shape
      if (coachPose && coachPose !== coachShown) { coachShown = coachPose; coachK = 0; }
      coachK = coachPose ? Math.min(1, coachK + dt * 9) : Math.max(0, coachK - dt * 7);
      if (mePose) meShown = mePose;
      meK = mePose ? Math.min(1, meK + dt * 12) : Math.max(0, meK - dt * 6);
      meSqV += (-meSq * 200 - meSqV * 15) * dt;
      meSq += meSqV * dt;
      for (const f of floaters) f.t += dt;
      while (floaters.length && floaters[0].t > 0.9) floaters.shift();
      for (const b of bits) { b.life -= dt; b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 220 * dt; }
      for (let i = bits.length - 1; i >= 0; i--) if (bits[i].life <= 0) bits.splice(i, 1);
      if (phase === 'done') return;

      let pressed: Btn | null = DIRS.find((d) => inp.hit[d]) ?? null;
      if (!pressed && inp.tap) pressed = tapDir(inp.tap.x, inp.tap.y);
      bufT = Math.max(0, bufT - dt);
      if (bufT <= 0) buffered = null;

      if (phase === 'show') {
        timer -= dt;
        const last = showIdx >= seq.length;
        // early press near the end of the demo: keep it for the first input frame
        if (pressed && last && timer < BUFFER) { buffered = pressed; bufT = BUFFER + 0.05; }
        if (timer <= 0) {
          if (!last) {
            coachPose = seq[showIdx];
            ctx.sfx('beep', { rate: 1 + DIRS.indexOf(seq[showIdx]) * 0.12 });
            showIdx++;
            timer = showStep(seq.length) + (rm ? 0.2 : 0);
          } else {
            coachPose = null;
            phase = 'input';
            mePose = null;
            if (buffered) { const b = buffered; buffered = null; press(b); }
          }
        } else if (timer < 0.12) coachPose = null;
        return;
      }
      if (phase === 'feedback') {
        timer -= dt;
        if (timer <= 0) {
          mePose = null;
          if (mistakes >= MAX_MISTAKES || best >= MAX_LEN) { finish(); return; }
          if (ok) grow(); else replay(0.5);
          hud();
        }
        return;
      }
      if (pressed) press(pressed);
    },

    render() {
      g.save();
      if (shake > 0) g.translate(Math.sin(time * 70) * shake, Math.cos(time * 50) * shake * 0.5);
      g.fillStyle = PAL.sand;
      g.fillRect(-10, -10, w + 20, h + 20);
      // window light and plants for a calm room
      for (const wx of [24, w - 114]) {
        g.fillStyle = PAL.surface;
        roundRect(g, wx, 120, 90, 120, 8);
        g.fillStyle = PAL.sky;
        g.fillRect(wx + 6, 126, 78, 108);
        g.fillStyle = '#9cc28a';
        g.beginPath(); g.ellipse(wx + 45, 236, 52, 26, 0, Math.PI, Math.PI * 2); g.fill();
        g.fillStyle = PAL.surface;
        g.fillRect(wx + 43, 126, 4, 108);
      }
      g.fillStyle = '#d7c7a6';
      g.fillRect(-10, h - 70, w + 20, 80);
      g.fillStyle = PAL.green;
      roundRect(g, 100, h - 82, 440, 18, 9);
      drawStretch(g, coach, 160, h - 70, coachShown, coachK, 0, time, rm);
      drawStretch(g, me, 470, h - 70, meShown, meK, meSq, time, rm);
      text(g, ctx.t('Pelatih'), 160, h - 30, 16, PAL.ink2);
      text(g, ctx.t('Kamu'), 470, h - 30, 16, PAL.ink2);

      const msg = phase === 'show' ? ctx.t('Perhatikan...') : phase === 'input' ? ctx.t('Giliranmu: {i}/{n}', { i: inputIdx, n: seq.length }) : ok ? ctx.t('Tepat!') : ctx.t('Salah, ulangi dari awal');
      text(g, msg, w / 2, 32, 26, phase === 'feedback' && !ok ? PAL.red : phase === 'input' ? PAL.green : PAL.ink);
      const lbl = phase === 'show' ? coachPose : padHitT > 0 ? padHit : null;
      if (lbl) text(g, `${ARROW[lbl]} ${ctx.t(LABEL[lbl])}`, w / 2, 66, 20, PAL.accent);
      // progress dots
      for (let i = 0; i < seq.length; i++) {
        const done = phase !== 'show' && i < inputIdx;
        const showing = phase === 'show' && i === showIdx - 1 && coachPose;
        g.fillStyle = done ? PAL.green : showing ? PAL.accent : 'rgba(29,42,35,0.2)';
        g.beginPath(); g.arc(w / 2 - (seq.length - 1) * 9 + i * 18, 96, showing ? 7.5 : 6, 0, Math.PI * 2); g.fill();
      }
      renderPad();
      for (const b of bits) { g.globalAlpha = Math.max(0, b.life / b.max); g.fillStyle = b.col; g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2); g.fill(); }
      g.globalAlpha = 1;
      for (const f of floaters) {
        const p = f.t / 0.9;
        const pop = p < 0.12 ? 0.6 + (p / 0.12) * 0.6 : 1.2 - Math.min(0.2, p - 0.12);
        g.save();
        g.globalAlpha = p > 0.65 ? Math.max(0, (1 - p) / 0.35) : 1;
        g.translate(f.x, f.y - (rm ? 0 : p * 28));
        g.scale(pop, pop);
        g.lineWidth = 5; g.strokeStyle = 'rgba(255,250,240,0.92)'; g.lineJoin = 'round';
        g.font = `800 ${f.size}px 'Alegreya Sans', system-ui, sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.strokeText(f.s, 0, 0);
        text(g, f.s, 0, 0, f.size, f.col, 'center', 800);
        g.restore();
      }
      if (flash > 0 && !rm) { g.fillStyle = `rgba(255,250,240,${flash})`; g.fillRect(-10, -10, w + 20, h + 20); }
      g.restore();
    },
    snapshot: () => ({ seq: [...seq], phase, inputIdx, mistakes, best, streak, buffered }),
  };

  function renderPad() {
    g.fillStyle = 'rgba(255,250,240,0.85)';
    g.beginPath(); g.arc(PAD_X, PAD_Y, PAD_R * 1.9, 0, Math.PI * 2); g.fill();
    for (const d of DIRS) {
      const p = padPos(d);
      const lit = (phase === 'show' && coachPose === d) || (padHitT > 0 && padHit === d);
      const bad = lit && padBad && phase !== 'show';
      const sc = lit && !rm ? 1.12 : 1;
      g.save();
      g.translate(p.x, p.y);
      g.scale(sc, sc);
      g.fillStyle = bad ? PAL.red : lit ? (phase === 'show' ? PAL.accent : PAL.green) : phase === 'input' ? '#e7dcc4' : 'rgba(29,42,35,0.12)';
      roundRect(g, -22, -22, 44, 44, 10);
      text(g, ARROW[d], 0, 1, 20, lit ? PAL.surface : PAL.ink2);
      g.restore();
    }
  }
}

/**
 * Stretch figure in the cast style with jointed arms. k (0..1) blends from
 * standing to the pose; sq is a squash spring for the press reaction.
 */
function drawStretch(g: CanvasRenderingContext2D, c: CastMember, x: number, y: number, p: Btn | null, k: number, sq: number, t: number, rm: boolean) {
  const e = easeOutBack(k);
  const u = 170 / 100;
  const s = Math.max(-0.1, Math.min(0.1, sq * 0.02));
  const breathe = rm ? 0 : Math.sin(t * 2.2) * 0.8 * u;
  // pose targets: body lean, hip drop, arm angles (0 = down, PI = straight up)
  let lean = 0, drop = 0, aF = 0.12, aB = 0.12, bendF = 0, bendB = 0, smile = false;
  if (p === 'up') { aF = Math.PI + 0.32; aB = Math.PI - 0.2; smile = true; }
  if (p === 'left') { lean = -0.32; aF = Math.PI - 0.35; aB = Math.PI - 0.6; }
  if (p === 'right') { lean = 0.32; aF = Math.PI + 0.6; aB = Math.PI + 0.35; }
  if (p === 'down') { lean = 0.55; drop = 12; aF = 0.5; aB = 0.35; bendF = -0.3; bendB = -0.3; }
  lean *= e; drop *= Math.min(1, e);
  aF = 0.12 + (aF - 0.12) * e; aB = 0.12 + (aB - 0.12) * e;
  g.save();
  g.translate(x, y);
  g.scale(1 - s * 0.6, 1 + s);
  // legs, knees bend on 'down'
  const kneeBend = drop * u;
  for (const dx of [-7, 7]) {
    g.lineCap = 'round';
    g.strokeStyle = c.bottom;
    g.lineWidth = 10 * u;
    g.beginPath(); g.moveTo(dx * u, -34 * u + kneeBend); g.lineTo((dx + kneeBend * 0.25 / u) * u, -18 * u + kneeBend * 0.5); g.lineTo(dx * u, -4 * u); g.stroke();
    g.fillStyle = c.shoes;
    g.fillRect((dx - 6) * u, -6 * u, 14 * u, 6 * u);
  }
  g.translate(0, -34 * u + kneeBend + breathe);
  g.rotate(lean);
  g.translate(0, 34 * u);
  const arm = (sx: number, a: number, bend: number, back: boolean) => {
    // raised arms reach past the big chibi head, so they stretch as they rise
    const L = 1 + 0.85 * Math.max(0, -Math.cos(a));
    const ox = sx * u, oy = -60 * u;
    const ex = ox - Math.sin(a) * 13 * L * u, ey = oy + Math.cos(a) * 13 * L * u;
    const a2 = a + bend;
    const hx = ex - Math.sin(a2) * 12 * L * u, hy = ey + Math.cos(a2) * 12 * L * u;
    g.lineCap = 'round';
    g.strokeStyle = back ? shadeCol(c.main) : c.main;
    g.lineWidth = 8 * u;
    g.beginPath(); g.moveTo(ox, oy); g.lineTo(ex, ey); g.stroke();
    g.strokeStyle = back ? shadeCol(c.skin) : c.skin;
    g.lineWidth = 6.5 * u;
    g.beginPath(); g.moveTo(ex, ey); g.lineTo(hx, hy); g.stroke();
    g.fillStyle = back ? shadeCol(c.skin) : c.skin;
    g.beginPath(); g.arc(hx, hy, 4 * u, 0, Math.PI * 2); g.fill();
  };
  arm(-9, aB, bendB, true);
  g.fillStyle = c.main;
  roundRect(g, -14 * u, -64 * u, 28 * u, 32 * u, 6 * u);
  g.fillStyle = c.inner;
  g.fillRect(-4 * u, -62 * u, 8 * u, 14 * u);
  g.fillStyle = c.accent;
  g.fillRect(-14 * u, -36 * u, 28 * u, 4 * u);
  const hy = -84 * u;
  g.fillStyle = c.skin;
  g.beginPath(); g.ellipse(2 * u, hy, 20 * u, 21 * u, 0, 0, Math.PI * 2); g.fill();
  drawHair(g, c, u, hy);
  g.fillStyle = '#2b211c';
  g.strokeStyle = '#2b211c';
  if (p && k > 0.5 && p !== 'up') {
    // eyes closed, concentrating on the stretch
    g.lineWidth = 2 * u;
    g.beginPath(); g.arc(11 * u, hy - 1 * u, 3 * u, 0.1 * Math.PI, 0.9 * Math.PI); g.stroke();
  } else {
    g.beginPath(); g.ellipse(11 * u, hy, 2.6 * u, 4 * u, 0, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#b5523b';
  if (smile && k > 0.5) { g.beginPath(); g.arc(12 * u, hy + 8 * u, 4 * u, 0, Math.PI); g.fill(); }
  else g.fillRect(9 * u, hy + 9 * u, 5 * u, 2 * u);
  arm(9, aF, bendF, false);
  g.restore();
}

function easeOutBack(x: number) {
  const c1 = 1.5, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

function shadeCol(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (v: number) => Math.round(v * 0.78);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// Same silhouette as the private drawHair in cast.ts.
function drawHair(g: CanvasRenderingContext2D, c: CastMember, u: number, hy: number) {
  g.fillStyle = c.hair;
  const s = c.hairStyle;
  g.beginPath();
  g.ellipse(0, hy - 7 * u, 21 * u, 16 * u, 0, Math.PI, Math.PI * 2);
  g.fill();
  g.fillRect(-21 * u, hy - 8 * u, 10 * u, 12 * u);
  if (/long|bob|ponytail|bun/.test(s)) g.fillRect(-21 * u, hy - 4 * u, 12 * u, (/long/.test(s) ? 30 : 18) * u);
  if (/ponytail/.test(s)) { g.beginPath(); g.ellipse(-24 * u, hy + 4 * u, 6 * u, 14 * u, 0.3, 0, Math.PI * 2); g.fill(); }
  if (/bun/.test(s)) { g.beginPath(); g.arc(-6 * u, hy - 24 * u, 8 * u, 0, Math.PI * 2); g.fill(); }
  if (/tuft|spike|messy/.test(s)) { g.beginPath(); g.moveTo(-2 * u, hy - 20 * u); g.lineTo(6 * u, hy - 32 * u); g.lineTo(10 * u, hy - 18 * u); g.fill(); }
}

export default { meta, create } satisfies GameModule;
