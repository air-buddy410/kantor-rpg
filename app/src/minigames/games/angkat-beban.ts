// Angkat Beban (dumbbell rack, L2-GYM). Timing game: a marker swings along a
// vertical bar; press A while it sits in the green zone. Every rep has two
// presses: one to curl the dumbbells up and one to lower them under control.
// Ten reps, each with a smaller zone and a faster marker; from rep 7 the zone
// drifts. The marker never stops, so a press is judged on the frame it lands.
// The chosen weight multiplies the score but speeds the marker up. Clean
// presses in a row add a combo bonus.
import type { CastMember, GameCtx, GameInstance, GameModule } from '../types';
import { PAL, drawChar, text, roundRect } from '../cast';

export const REPS = 10;
export const WEIGHTS = [5, 10, 15];
const SPEED_MUL: Record<number, number> = { 5: 1, 10: 1.2, 15: 1.4 };
/** Points per press (two presses per rep) before the weight multiplier. */
export const PTS = { perfect: 8, full: 5, near: 2, far: 1, timeout: 0 };
/** Inner share of the green zone that counts as perfect. */
export const PERFECT_SHARE = 0.35;
const BASE_SPEED = 0.55; // bar lengths per second
/** Seconds per press before it counts as too slow. */
export const HALF_TIMEOUT = 4;
/** Guard after a press so one double tap cannot judge two halves. */
export const LOCK = 0.12;
const DRIFT_FROM = 6;
const END_DELAY = 0.7;

const meta: GameModule['meta'] = {
  id: 'angkat-beban', title: 'Angkat Beban', place: 'dumbbell_rack', music: 'gym',
  blurb: 'Tekan A saat penanda di zona hijau: sekali untuk angkat, sekali untuk turunkan. 10 repetisi.',
  view: { w: 640, h: 400 }, score: { unit: 'poin', higherIsBetter: true }, touch: ['left', 'right', 'a'],
  tutorial: [
    'Pilih berat dengan {lr}, lalu tekan {a} untuk mulai.',
    'Tekan {a} saat penanda ada di zona hijau: sekali untuk angkat, sekali untuk turunkan.',
    'Beban berat memberi skor lebih besar, tapi penanda bergerak lebih cepat.',
  ],
  legend: [['lr', 'Pilih berat'], ['a', 'Angkat / turunkan']],
  actions: { left: 'Beban lebih ringan', right: 'Beban lebih berat', a: 'Mulai / angkat / turunkan' },
  pointerHint: 'Ketuk kartu berat untuk memilih, lalu ketuk layar saat penanda di zona hijau',
};

export type Grade = 'perfect' | 'full' | 'near' | 'far' | 'timeout';
const ORDER: Grade[] = ['perfect', 'full', 'near', 'far', 'timeout'];
export const isClean = (g: Grade) => g === 'perfect' || g === 'full';
const worse = (a: Grade, b: Grade) => (ORDER.indexOf(a) > ORDER.indexOf(b) ? a : b);
const WORD: Record<Grade, string> = { perfect: 'SEMPURNA!', full: 'BAGUS!', near: 'Kurang pas', far: 'MELESET', timeout: 'Terlalu lama' };
/** How high the curl gets for each grade on the way up. */
const HEIGHT: Record<Grade, number> = { perfect: 1, full: 0.94, near: 0.62, far: 0.36, timeout: 0.2 };

export function zoneHalf(rep: number) { return 0.13 - (0.08 * rep) / (REPS - 1); }
export function markerSpeed(rep: number, kg: number) { return BASE_SPEED * SPEED_MUL[kg] * (1 + rep * 0.09); }
/** Bonus points for the n-th clean press in a row (n starts at 1). */
export function comboBonus(n: number) { return Math.min(5, Math.max(0, n - 1)); }

interface Floater { s: string; x: number; y: number; t: number; col: string; size: number }
interface Bit { x: number; y: number; vx: number; vy: number; life: number; max: number; col: string; r: number }

function create(ctx: GameCtx): GameInstance {
  const { g, w, h } = ctx;
  const me = ctx.cast.find((c) => c.id === ctx.playerId) ?? ctx.cast[0];
  const coach = ctx.cast.find((c) => c.id === 'CH-NETINSTALL') ?? ctx.cast[1];
  const rm = ctx.reducedMotion;

  let phase: 'pick' | 'swing' | 'done' = 'pick';
  let pick = 0;
  let kg = WEIGHTS[0];
  let rep = 0;
  let half: 0 | 1 = 0;
  let pos = 0.02, prevPos = 0.02, dir = 1;
  let zoneBase = 0.5, zoneC = 0.5;
  let halfTime = 0;
  let lockT = 0;
  let endT = 0;
  let ended = false;
  let points = 0;
  let streak = 0, bestStreak = 0;
  const halves: Grade[] = [];
  const grades: Grade[] = [];
  let time = 0, flash = 0, shake = 0;
  // animation only (never read by the rules)
  let armFrom = 0, armTo = 0, animT = 9;
  let squash = 0, squashV = 0;
  let coachCheer = 0;
  let pressPulse = 0;
  const floaters: Floater[] = [];
  const bits: Bit[] = [];

  const score = () => points * kg;
  const repShown = () => Math.min(REPS, rep + 1);
  const hud = () => ctx.setHud(phase === 'pick'
    ? ctx.t('Pilih berat')
    : ctx.t('Rep {r}/10 · {s} poin', { r: repShown(), s: score() }));

  const charX = 220, feet = h - 74, charH = 190;

  function float(s: string, x: number, y: number, col: string, size = 26) {
    floaters.push({ s, x, y, t: 0, col, size });
    if (floaters.length > 6) floaters.shift();
  }
  function burst(x: number, y: number, n: number, col: string, spread = 2.4, sp0 = 60) {
    if (rm) return;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / Math.max(1, n - 1) - 0.5) * spread;
      const sp = sp0 + ((i * 37) % 50);
      bits.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.6, max: 0.6, col, r: 2 + (i % 3) });
    }
  }

  function placeZone() {
    const hw = zoneHalf(rep);
    const drift = rep >= DRIFT_FROM ? 0.07 : 0;
    const lo = hw + drift + 0.04, hi = 1 - lo;
    let c = lo + ctx.rand() * (hi - lo);
    // never put the zone right on the marker: every press needs a fresh read
    if (Math.abs(c - pos) < 0.3) c = pos < 0.5 ? Math.min(hi, pos + 0.3 + (c - lo) * 0.3) : Math.max(lo, pos - 0.3 - (hi - c) * 0.3);
    zoneBase = c;
    zoneC = c;
    halfTime = 0;
  }

  function updateZone() {
    zoneC = rep >= DRIFT_FROM ? zoneBase + Math.sin(halfTime * 1.7) * 0.07 : zoneBase;
  }

  const curArm = () => armFrom + (armTo - armFrom) * armEase(animT);

  function judge(timeout: boolean) {
    const hw = zoneHalf(rep);
    // the screen shows last frame's marker; accept whichever of the two is closer
    const d = Math.min(Math.abs(pos - zoneC), Math.abs(prevPos - zoneC));
    const grade: Grade = timeout ? 'timeout' : d <= hw * PERFECT_SHARE ? 'perfect' : d <= hw ? 'full' : d <= hw * 2.5 ? 'near' : 'far';
    halves.push(grade);
    streak = isClean(grade) ? streak + 1 : 0;
    bestStreak = Math.max(bestStreak, streak);
    const gain = PTS[grade] + (isClean(grade) ? comboBonus(streak) : 0);
    points += gain;
    lockT = LOCK;

    // feedback on the same frame as the press
    armFrom = curArm();
    armTo = half === 0 ? HEIGHT[grade] : 0;
    animT = 0;
    squashV = half === 0 ? -3.4 : 2.4;
    pressPulse = 1;
    flash = isClean(grade) ? (grade === 'perfect' ? 0.3 : 0.16) : 0;
    shake = rm ? 0 : grade === 'perfect' ? 6 : grade === 'full' ? 3 : grade === 'near' ? 2 : 5;
    const col = grade === 'perfect' ? '#c98a1c' : grade === 'full' ? '#3f8a50' : grade === 'near' ? PAL.blue : PAL.red;
    float(ctx.t(WORD[grade]), charX, feet - charH - 22, col, grade === 'perfect' ? 32 : 26);
    if (gain > 0) float(`+${gain * kg}`, 476, 146, PAL.accent, 22);
    if (streak >= 3) coachCheer = 1;
    burst(charX + 6, feet - charH * 0.95, isClean(grade) ? 7 : 3, '#7fc4e8');
    if (half === 1) burst(charX, feet, 6, '#b9a98c', 2.8, 40);
    ctx.sfx(isClean(grade) ? 'clank' : grade === 'timeout' ? 'wrong' : 'thud', { rate: grade === 'perfect' ? 1.15 : isClean(grade) ? 1 : 0.8 });
    if (grade === 'perfect') ctx.sfx('coin', { gain: 0.45 });
    if (half === 1 && isClean(grade)) ctx.sfx('breath', { gain: 0.6 });

    if (half === 0) { half = 1; placeZone(); hud(); return; }
    grades.push(worse(halves[halves.length - 2], grade));
    rep++;
    half = 0;
    if (rep >= REPS) {
      phase = 'done';
      endT = END_DELAY;
      armFrom = 0; armTo = 1.6; animT = 0;
      hud();
      return;
    }
    placeZone();
    hud();
  }

  function tapPick(tx: number, ty: number) {
    for (let i = 0; i < WEIGHTS.length; i++) {
      const x = 210 + i * 110;
      if (Math.abs(tx - x) <= 46 && ty >= 118 && ty <= 210) {
        if (pick === i) return true;
        pick = i;
        ctx.sfx('ui');
        return false;
      }
    }
    return ty >= 236 && ty <= 276 && tx > 220 && tx < 420;
  }

  hud();

  return {
    update(dt, inp) {
      time += dt;
      flash = Math.max(0, flash - dt);
      shake = Math.max(0, shake - dt * 30);
      coachCheer = Math.max(0, coachCheer - dt);
      pressPulse = Math.max(0, pressPulse - dt * 5);
      animT += dt;
      squashV += (-squash * 180 - squashV * 14) * dt;
      squash += squashV * dt;
      for (const f of floaters) f.t += dt;
      while (floaters.length && floaters[0].t > 1) floaters.shift();
      for (const b of bits) { b.life -= dt; b.x += b.vx * dt; b.y += b.vy * dt; b.vy += 260 * dt; }
      for (let i = bits.length - 1; i >= 0; i--) if (bits[i].life <= 0) bits.splice(i, 1);

      if (phase === 'done') {
        endT -= dt;
        if (endT <= 0 && !ended) {
          ended = true;
          const clean = grades.filter(isClean).length;
          ctx.sfx(clean >= 7 ? 'win' : 'confirm');
          ctx.end({ score: score(), won: clean >= 7, summary: ctx.t('{f}/10 angkat penuh · {kg} kg', { f: clean, kg }) });
        }
        return;
      }
      if (phase === 'pick') {
        if (inp.hit.left && pick > 0) { pick--; ctx.sfx('ui'); }
        if (inp.hit.right && pick < WEIGHTS.length - 1) { pick++; ctx.sfx('ui'); }
        let go = inp.hit.a;
        if (inp.tap && tapPick(inp.tap.x, inp.tap.y)) go = true;
        kg = WEIGHTS[pick];
        if (go) { ctx.sfx('confirm'); phase = 'swing'; placeZone(); hud(); }
        return;
      }
      lockT = Math.max(0, lockT - dt);
      if (lockT <= 0 && (inp.hit.a || inp.tap)) { judge(false); return; }
      halfTime += dt;
      if (halfTime >= HALF_TIMEOUT) { judge(true); return; }
      updateZone();
      prevPos = pos;
      pos += dir * markerSpeed(rep, kg) * dt;
      if (pos >= 1) { pos = 2 - pos; dir = -1; }
      if (pos <= 0) { pos = -pos; dir = 1; }
    },

    render() {
      g.save();
      if (shake > 0) g.translate(Math.sin(time * 71) * shake, Math.cos(time * 53) * shake * 0.6);
      g.fillStyle = PAL.sand;
      g.fillRect(-10, -10, w + 20, h + 20);
      // gym wall: mirror strip and rubber floor
      g.fillStyle = '#dfe9ea';
      g.fillRect(30, 40, 360, 220);
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.beginPath(); g.moveTo(70, 40); g.lineTo(130, 40); g.lineTo(60, 260); g.lineTo(30, 260); g.closePath(); g.fill();
      g.strokeStyle = '#b9a98c'; g.lineWidth = 4; g.strokeRect(30, 40, 360, 220);
      g.fillStyle = '#3f4744';
      g.fillRect(-10, h - 70, w + 20, 80);
      g.fillStyle = '#4b5551';
      for (let x = 0; x < w; x += 80) g.fillRect(x, h - 70, 2, 70);
      drawRack(g, 404, h - 70);

      const k = curArm();
      const waitingUp = phase === 'swing' && half === 1;
      const tension = phase === 'swing' ? Math.min(1, halfTime / HALF_TIMEOUT) : 0;
      const effort = phase === 'pick' ? 0 : Math.max(waitingUp ? 0.9 : 0, animT < 0.35 ? 1 - animT / 0.35 : 0, Math.min(1, k) * 0.7);
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.beginPath(); g.ellipse(charX, feet + 2, 50, 8, 0, 0, Math.PI * 2); g.fill();
      if (phase === 'pick') drawChar(g, me, charX, feet, charH, 1, 'idle', time);
      else drawLifter(g, me, charX, feet, charH, k, squash, effort, tension, time, kg, rm, phase === 'done');
      text(g, ctx.t('Kamu'), charX, h - 40, 15, PAL.surface);
      drawChar(g, coach, 80, feet, 120, 1, coachCheer > 0 || phase === 'done' ? 'win' : 'idle', time);
      text(g, ctx.t('Pelatih'), 80, h - 40, 15, PAL.surface);
      if (coachCheer > 0.25 && phase !== 'pick') {
        g.fillStyle = PAL.surface;
        roundRect(g, 40, feet - 172, 110, 30, 10);
        text(g, ctx.t('Mantap!'), 95, feet - 157, 15, PAL.green);
      }

      for (const b of bits) { g.globalAlpha = Math.max(0, b.life / b.max); g.fillStyle = b.col; g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2); g.fill(); }
      g.globalAlpha = 1;

      if (phase === 'pick') { renderPick(); g.restore(); return; }

      // timing bar
      const bx = 572, by = 40, bh = 290, bw = 38;
      g.fillStyle = 'rgba(29,42,35,0.88)';
      roundRect(g, bx - bw / 2 - 8, by - 8, bw + 16, bh + 16, 12);
      g.fillStyle = '#e9e1cf';
      g.fillRect(bx - bw / 2, by, bw, bh);
      const show = zoneHalf(Math.min(rep, REPS - 1));
      const yOf = (p: number) => by + bh - p * bh;
      if (phase === 'swing') {
        const nearTop = Math.min(1, zoneC + show * 2.5), nearBot = Math.max(0, zoneC - show * 2.5);
        g.fillStyle = 'rgba(217,164,65,0.5)';
        g.fillRect(bx - bw / 2, yOf(nearTop), bw, (nearTop - nearBot) * bh);
        const inZone = Math.abs(pos - zoneC) <= show;
        g.fillStyle = inZone ? '#5fb46c' : '#4f9a5c';
        g.fillRect(bx - bw / 2, yOf(zoneC + show), bw, show * 2 * bh);
        g.fillStyle = 'rgba(255,250,240,0.6)';
        g.fillRect(bx - bw / 2, yOf(zoneC + show * PERFECT_SHARE), bw, show * 2 * PERFECT_SHARE * bh);
        if (inZone) { g.strokeStyle = 'rgba(95,180,108,0.85)'; g.lineWidth = 4; g.strokeRect(bx - bw / 2 - 5, by - 5, bw + 10, bh + 10); }
        const my = yOf(pos);
        if (!rm) for (let i = 1; i <= 4; i++) { g.fillStyle = `rgba(29,42,35,${0.16 - i * 0.03})`; g.fillRect(bx - bw / 2, my + dir * i * 6 - 2, bw, 4); }
        const pw = 1 + pressPulse * 0.5;
        g.fillStyle = PAL.red;
        g.beginPath(); g.moveTo(bx - bw / 2 - 16 * pw, my - 9 * pw); g.lineTo(bx - bw / 2 - 2, my); g.lineTo(bx - bw / 2 - 16 * pw, my + 9 * pw); g.fill();
        g.fillStyle = PAL.ink;
        g.fillRect(bx - bw / 2 - 2, my - 2.5, bw + 4, 5);
        // time left for this press
        g.fillStyle = 'rgba(255,250,240,0.25)';
        g.fillRect(bx - bw / 2, by + bh + 12, bw, 5);
        g.fillStyle = tension > 0.7 ? PAL.red : PAL.gold;
        g.fillRect(bx - bw / 2, by + bh + 12, bw * (1 - tension), 5);
      }
      text(g, ctx.t('{kg} kg', { kg }), bx, by + bh + 32, 16, PAL.surface);

      // rep pips
      for (let i = 0; i < REPS; i++) {
        const gr = grades[i];
        g.fillStyle = gr === 'perfect' ? PAL.gold : gr === 'full' ? '#4f9a5c' : gr === 'near' ? PAL.blue : gr ? PAL.red : i === rep && half === 1 ? 'rgba(79,154,92,0.5)' : 'rgba(29,42,35,0.2)';
        g.beginPath(); g.arc(250 + i * 22, 22, i === grades.length - 1 && animT < 0.2 ? 9 : 7, 0, Math.PI * 2); g.fill();
      }
      text(g, ctx.t('Rep {r}/10', { r: repShown() }), 236, 22, 16, PAL.ink, 'right');
      text(g, ctx.t('{s} poin', { s: score() }), 476, 112, 20, PAL.ink);
      if (streak >= 2) text(g, ctx.t('Combo x{n}', { n: streak }), 476, 84, 17, PAL.accent);

      if (phase === 'swing') {
        const cue = half === 0 ? ctx.t('{a}: ANGKAT!', { a: ctx.key('a') }) : ctx.t('{a}: TURUNKAN!', { a: ctx.key('a') });
        g.fillStyle = 'rgba(255,250,240,0.9)';
        roundRect(g, 140, 50, 160, 30, 10);
        text(g, cue, 220, 65, 17, half === 0 ? PAL.green : PAL.blue, 'center', 800);
      }

      for (const f of floaters) {
        const p = f.t;
        const pop = p < 0.1 ? 0.6 + (p / 0.1) * 0.6 : 1.2 - Math.min(0.2, (p - 0.1) * 0.8);
        g.save();
        g.globalAlpha = p > 0.7 ? Math.max(0, (1 - p) / 0.3) : 1;
        g.translate(f.x, f.y - (rm ? 0 : p * 34));
        g.scale(pop, pop);
        g.lineWidth = 5; g.strokeStyle = 'rgba(255,250,240,0.92)'; g.lineJoin = 'round';
        g.font = `800 ${f.size}px 'Alegreya Sans', system-ui, sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.strokeText(f.s, 0, 0);
        text(g, f.s, 0, 0, f.size, f.col, 'center', 800);
        g.restore();
      }
      g.globalAlpha = 1;
      if (flash > 0 && !rm) { g.fillStyle = `rgba(255,250,240,${flash})`; g.fillRect(-10, -10, w + 20, h + 20); }
      g.restore();
    },

    snapshot: () => ({
      phase, pick, kg, rep, half, locked: lockT > 0, pos: Math.round(pos * 10000) / 10000, zoneC: Math.round(zoneC * 10000) / 10000,
      zoneHalf: zoneHalf(Math.min(rep, REPS - 1)), speed: markerSpeed(Math.min(rep, REPS - 1), kg), points, score: score(),
      grades: [...grades], halves: [...halves], streak, bestStreak,
    }),
  };

  function renderPick() {
    g.fillStyle = 'rgba(255,250,240,0.96)';
    roundRect(g, 150, 64, 340, 220, 16);
    text(g, ctx.t('Pilih berat'), 320, 94, 24, PAL.ink);
    WEIGHTS.forEach((wk, i) => {
      const sel = i === pick;
      const x = 210 + i * 110;
      const lift = sel && !rm ? Math.sin(time * 6) * 2 - 3 : 0;
      g.fillStyle = sel ? PAL.green : '#e7dcc4';
      roundRect(g, x - 44, 120 + lift, 88, 86, 12);
      drawDumbbellIcon(g, x, 150 + lift, 0.7 + i * 0.15, sel ? '#f4ecdc' : '#4d4a46');
      text(g, ctx.t('{kg} kg', { kg: wk }), x, 186 + lift, 18, sel ? PAL.surface : PAL.ink);
    });
    text(g, ctx.t('Skor x{m}, penanda x{s}', { m: kg, s: SPEED_MUL[kg].toFixed(1) }), 320, 224, 15, PAL.ink2, 'center', 600);
    g.fillStyle = PAL.accent;
    roundRect(g, 230, 240, 180, 34, 10);
    text(g, ctx.t('{a} atau ketuk: mulai', { a: ctx.key('a') }), 320, 257, 16, PAL.surface);
  }
}

function armEase(t: number) {
  const x = Math.min(1, t / 0.17);
  // ease out with a small overshoot: snappy, then settles
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
}

/**
 * Side-view lifter in the cast style with jointed arms. k is the curl (0 arms
 * down, 1 hands at the shoulders, above 1 presses overhead); sq is the squash
 * spring; effort strains the face; tension makes the arms tremble.
 */
function drawLifter(g: CanvasRenderingContext2D, c: CastMember, x: number, y: number, hgt: number, k: number, sq: number, effort: number, tension: number, t: number, kg: number, rm: boolean, happy: boolean) {
  const u = hgt / 100;
  const s = Math.max(-0.12, Math.min(0.12, sq * 0.02));
  g.save();
  g.translate(x, y);
  g.scale(1 - s * 0.6, 1 + s);
  const knee = Math.max(0, -s) * 40 * u;
  for (const dx of [-7, 7]) {
    g.fillStyle = c.bottom;
    g.fillRect((dx - 5) * u, -34 * u + knee, 10 * u, 28 * u - knee * 0.6);
    g.fillStyle = c.shoes;
    g.fillRect((dx - 6) * u, -7 * u, 14 * u, 7 * u);
  }
  const breathe = rm ? 0 : Math.sin(t * 3) * 0.6 * u;
  g.translate(0, knee * 0.6 + breathe);
  g.fillStyle = c.main;
  roundRect(g, -15 * u, -64 * u, 30 * u, 32 * u, 7 * u);
  g.fillStyle = c.inner;
  g.fillRect(-4 * u, -62 * u, 8 * u, 14 * u);
  g.fillStyle = c.accent;
  g.fillRect(-15 * u, -36 * u, 30 * u, 4 * u);
  const tremble = rm ? 0 : Math.sin(t * 42) * (0.02 + tension * 0.06) * Math.min(1, k + 0.3);
  const press = Math.max(0, Math.min(1, (k - 1) / 0.6));
  const curl = Math.max(0, Math.min(1, k));
  const a1 = lerp(-(0.08 + 0.3 * curl), -3.0, press) + tremble;
  const a2 = lerp(a1 - 2.6 * curl, -3.1, press);
  const plate = (0.75 + (kg / 15) * 0.5) * u * 0.42;
  const arm = (sx: number, back: boolean) => {
    const ox = sx * u, oy = -60 * u;
    const ex = ox - Math.sin(a1) * 13 * u, ey = oy + Math.cos(a1) * 13 * u;
    const hx = ex - Math.sin(a2) * 12 * u, hy = ey + Math.cos(a2) * 12 * u;
    g.lineCap = 'round';
    g.lineWidth = 8.5 * u;
    g.strokeStyle = back ? shadeCol(c.main) : c.main;
    g.beginPath(); g.moveTo(ox, oy); g.lineTo(ex, ey); g.stroke();
    g.strokeStyle = back ? shadeCol(c.skin) : c.skin;
    g.lineWidth = 7 * u;
    g.beginPath(); g.moveTo(ex, ey); g.lineTo(hx, hy); g.stroke();
    drawDumbbellIcon(g, hx, hy, plate, '#2e3431');
  };
  arm(-9, true);
  const hy = -84 * u;
  g.fillStyle = c.skin;
  g.beginPath(); g.ellipse(2 * u, hy, 20 * u, 21 * u, 0, 0, Math.PI * 2); g.fill();
  if (effort > 0.3) {
    g.fillStyle = `rgba(214,92,70,${0.4 * effort})`;
    g.beginPath(); g.ellipse(9 * u, hy + 6 * u, 7 * u, 4.5 * u, 0, 0, Math.PI * 2); g.fill();
  }
  drawHair(g, c, u, hy);
  g.strokeStyle = '#2b211c';
  g.fillStyle = '#2b211c';
  if (happy) {
    g.lineWidth = 2.2 * u;
    g.beginPath(); g.arc(11 * u, hy + 1 * u, 3 * u, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    g.fillStyle = '#b5523b';
    g.beginPath(); g.arc(12 * u, hy + 9 * u, 4 * u, 0, Math.PI); g.fill();
  } else if (effort > 0.45) {
    // squeezed eye and gritted teeth
    g.lineWidth = 2.4 * u;
    g.beginPath(); g.moveTo(7 * u, hy - 3 * u); g.lineTo(14 * u, hy); g.lineTo(7 * u, hy + 2 * u); g.stroke();
    g.beginPath(); g.moveTo(6 * u, hy - 8 * u); g.lineTo(15 * u, hy - 5 * u); g.stroke();
    g.fillStyle = '#fffaf0';
    g.fillRect(7 * u, hy + 8 * u, 10 * u, 4 * u);
    g.strokeStyle = '#2b211c';
    g.lineWidth = 1.2 * u;
    g.strokeRect(7 * u, hy + 8 * u, 10 * u, 4 * u);
    g.beginPath(); g.moveTo(12 * u, hy + 8 * u); g.lineTo(12 * u, hy + 12 * u); g.stroke();
  } else {
    g.beginPath(); g.ellipse(11 * u, hy, 2.6 * u, (4 - tension * 1.5) * u, 0, 0, Math.PI * 2); g.fill();
    g.lineWidth = 2 * u;
    g.beginPath(); g.moveTo(7 * u, hy - 7 * u - tension * 2 * u); g.lineTo(15 * u, hy - 6 * u); g.stroke();
    g.fillStyle = '#b5523b';
    g.fillRect(9 * u, hy + 9 * u, 5 * u, 2 * u);
  }
  if (effort > 0.6 && !rm) {
    // sweat drop sliding down the temple
    g.fillStyle = '#7fc4e8';
    const dy = ((t * 26) % 14) * u;
    g.beginPath(); g.ellipse(-4 * u, hy - 6 * u + dy, 2.2 * u, 3.2 * u, 0, 0, Math.PI * 2); g.fill();
  }
  arm(9, false);
  g.restore();
}

function lerp(a: number, b: number, k: number) { return a + (b - a) * k; }
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

function drawDumbbellIcon(g: CanvasRenderingContext2D, x: number, y: number, s: number, c: string) {
  g.fillStyle = '#9aa19c';
  g.fillRect(x - 16 * s, y - 2 * s, 32 * s, 4 * s);
  g.fillStyle = c;
  roundRect(g, x - 20 * s, y - 11 * s, 8 * s, 22 * s, 2 * s);
  roundRect(g, x + 12 * s, y - 11 * s, 8 * s, 22 * s, 2 * s);
}

function drawRack(g: CanvasRenderingContext2D, x: number, floor: number) {
  g.fillStyle = '#2e3431';
  g.fillRect(x, floor - 110, 8, 110);
  g.fillRect(x + 112, floor - 110, 8, 110);
  g.fillRect(x, floor - 72, 120, 6);
  g.fillRect(x, floor - 30, 120, 6);
  for (let i = 0; i < 4; i++) {
    drawDumbbellIcon(g, x + 22 + i * 26, floor - 82, 0.55 + i * 0.06, i % 2 ? '#3c6e91' : '#a34a27');
    drawDumbbellIcon(g, x + 22 + i * 26, floor - 40, 0.75 + i * 0.05, '#1d2a23');
  }
}

export default { meta, create } satisfies GameModule;
