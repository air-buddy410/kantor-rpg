// Lomba 17-an (Game Station slot 9). Three Independence Day contests in a row
// on a red and white field: balap karung (alternate left/right to hop), makan
// kerupuk (bite when the swinging cracker hangs over the mouth) and tarik
// tambang (pull on the beat, Merah = seats 1 and 3, Putih = seats 2 and 4).
// Places score 3/2/1/0; the tug winners score 3 each. Most points after three
// events is juara umum. Up to four local players; empty seats are CPU.
import type { CastMember, GameCtx, GameInstance, GameModule, InputState } from '../types';
import { PLAYER_COLORS } from '../local-players';
import { PAL, drawChar, roundRect, text, type Pose } from '../cast';

export const TITLE_T = 2;
export const COUNT_T = 3;
const RESULT_T = 3;
const PODIUM_T = 4.5;
export const PLACE_PTS = [3, 2, 1, 0];

// balap karung
export const TRACK = 24;
/** Airtime of one hop; presses in the air are ignored except in the last HOP_BUFFER. */
export const HOP_T = 0.24;
export const HOP_D = 0.9;
/** A-button hop for one-button play: no alternation needed, shorter. */
export const SLOW_HOP_D = 0.6;
export const STUMBLE_T = 0.4;
const HOP_BUFFER = 0.12;
const KARUNG_MAX = 30;

// makan kerupuk
export const BITES = 8;
/** |swing| below this is "over the mouth". */
export const ZONE = 0.28;
/** More presses than this inside one second chokes you. */
export const MASH_MAX = 6;
export const CHOKE_T = 1;
const CHEW_T = 0.3;
/** A bite at thin air also closes the mouth for a moment, so spamming loses to timing. */
const MISS_T = 0.35;
const KERUPUK_MAX = 40;
export const swingPeriod = (bites: number) => 1.7 - bites * 0.06;

// tarik tambang
export const TUG_T = 30;
export const BEAT = 0.6;
export const ON_BEAT = 0.1;
export const STRONG = 1;
export const WEAK = 0.35;
/** Rope travel per unit of pull; the flag crossing 1 (a team's line) ends the tug. */
export const STEP = 0.1;

export const EVENTS = [
  { id: 'karung', name: 'Balap Karung' },
  { id: 'kerupuk', name: 'Makan Kerupuk' },
  { id: 'tambang', name: 'Tarik Tambang' },
] as const;

/** 0 = Merah (Pemain 1 and 3), 1 = Putih (Pemain 2 and 4). */
export const team = (i: number) => i % 2;
export const beatSlot = (t: number) => Math.round(t / BEAT);
/** Signed seconds from the nearest beat. */
export const beatDist = (t: number) => t - beatSlot(t) * BEAT;

const meta: GameModule['meta'] = {
  id: 'lomba-17an', title: 'Lomba 17-an', place: 'arcade', music: 'gym',
  blurb: 'Balap karung, makan kerupuk, tarik tambang. Kumpulkan poin, jadi juara umum.',
  view: { w: 640, h: 400 }, score: { unit: 'poin', higherIsBetter: true }, touch: ['left', 'right', 'a'],
  tutorial: [
    'Balap karung: {left} dan {right} bergantian untuk melompat. Tombol sama dua kali bikin jatuh.',
    'Makan kerupuk: tekan {a} saat kerupuk di atas mulut. Terlalu sering bikin tersedak.',
    'Tarik tambang: tekan {a} tepat pada ketukan untuk tarikan kuat.',
  ],
  legend: [[['left', 'right'], 'Lompat (gantian)'], ['a', 'Gigit / tarik']],
  actions: { left: 'Lompat, gantian dengan kanan', right: 'Lompat, gantian dengan kiri', a: 'Lompat pelan, gigit kerupuk, tarik tambang' },
  players: 4,
  playersHint: 'Bareng: sampai 4 pemain. Tarik tambang: Pemain 1 dan 3 tim Merah, 2 dan 4 tim Putih.',
};

const NO_INPUT: InputState = {
  down: { left: false, right: false, up: false, down: false, a: false, b: false, x: false, y: false },
  hit: { left: false, right: false, up: false, down: false, a: false, b: false, x: false, y: false },
  ax: 0, ay: 0, tap: null,
};

type Key = 'L' | 'R' | 'A';
type Phase = 'title' | 'count' | 'play' | 'result' | 'podium' | 'over';

interface Seat {
  c: CastMember; cpu: boolean; skill: number;
  doneT: number; cpuT: number; planned: boolean; msg: string; msgT: number; msgCol: string;
  x: number; hopT: number; hopD: number; stumble: number; lastKey: Key | null; queued: Key | null; stumbles: number;
  bites: number; theta: number; chew: number; choke: number; presses: number[]; misses: number; chokes: number;
  slot: number; pulls: number; strong: number; pullT: number;
}

const RED = '#c8102e';
const WHITE = '#fbfbf7';
const SACK = '#b8935f';
const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** Count a timer down; float residue from 1/60 steps must not keep a timer alive for an extra frame. */
const dec = (v: number, dt: number) => (v - dt > 1e-6 ? v - dt : 0);

function create(ctx: GameCtx): GameInstance {
  const { g, w, h } = ctx;
  const rm = ctx.reducedMotion;
  const me = ctx.cast.find((c) => c.id === ctx.playerId) ?? ctx.cast[0];
  const pool = ctx.cast.filter((c) => c.id !== me.id);
  const rivals: CastMember[] = [];
  while (rivals.length < 3 && pool.length) rivals.push(pool.splice(Math.floor(ctx.rand() * pool.length), 1)[0]);
  const humans = Math.max(1, Math.min(4, ctx.players));
  const versus = humans > 1;
  const seats: Seat[] = [me, ...rivals].map((c, i) => ({
    c, cpu: i >= humans, skill: 0.3 + ctx.rand() * 0.6,
    doneT: -1, cpuT: 0, planned: false, msg: '', msgT: 0, msgCol: PAL.ink,
    x: 0, hopT: 0, hopD: HOP_D, stumble: 0, lastKey: null, queued: null, stumbles: 0,
    bites: 0, theta: 0, chew: 0, choke: 0, presses: [], misses: 0, chokes: 0,
    slot: -99, pulls: 0, strong: 0, pullT: 0,
  }));
  const points = [0, 0, 0, 0];
  const bonus = [0, 0, 0, 0];
  let ev = 0;
  let phase: Phase = 'title';
  let phaseT = 0;
  let playT = 0;
  let time = 0;
  let goT = 0;
  let endT = -1;
  let rope = 0;
  let ropeShow = 0;
  let beatTick = -1;
  let last: { order: number[]; pts: number[]; win: number } | null = null;

  const total = (i: number) => points[i] * 100 + bonus[i];
  const standings = () => [0, 1, 2, 3].sort((a, b) => total(b) - total(a) || a - b);
  const label = (i: number) => (versus ? (i < humans ? `P${i + 1} ${seats[i].c.name}` : seats[i].c.name) : i === 0 ? ctx.t('Kamu') : seats[i].c.name);
  const colorOf = (i: number) => (versus ? (i < humans ? PLAYER_COLORS[i] : PAL.ink2) : i === 0 ? PAL.accent : PAL.ink2);
  const hud = () => ctx.setHud(versus
    ? ctx.t('Lomba {n}/3 · {list}', { n: ev + 1, list: points.slice(0, humans).map((p, i) => `P${i + 1} ${p}`).join(' · ') })
    : ctx.t('Lomba {n}/3 · Poin {p}', { n: ev + 1, p: points[0] }));
  const say = (i: number, name: string, rate = 1) => ctx.sfx(name, { gain: seats[i].cpu ? 0.35 : 1, rate, pan: (i - 1.5) / 3 });
  const note = (i: number, s: string, col: string) => { const p = seats[i]; p.msg = s; p.msgT = 0.9; p.msgCol = col; };
  /** Place among finishers so far (1-based), for the "Juara n" badge. */
  const placeOf = (i: number) => seats.filter((s, k) => s.doneT >= 0 && (s.doneT < seats[i].doneT || (s.doneT === seats[i].doneT && k < i))).length + 1;

  function startEvent() {
    for (const s of seats) {
      Object.assign(s, {
        doneT: -1, cpuT: 0.12 + ctx.rand() * 0.15, planned: false, msgT: 0,
        x: 0, hopT: 0, stumble: 0, lastKey: null, queued: null,
        bites: 0, theta: ctx.rand() * Math.PI * 2, chew: 0, choke: 0, presses: [],
        slot: -99, pullT: 0,
      });
    }
    rope = 0; ropeShow = 0; playT = 0; endT = -1; beatTick = -1;
    phase = 'title'; phaseT = 0;
    hud();
  }
  startEvent();

  // balap karung
  function hop(i: number, k: Key) {
    const s = seats[i];
    if (s.doneT >= 0 || s.stumble > 0) return;
    if (s.hopT > 0) { if (s.hopT <= HOP_BUFFER) s.queued = k; return; }
    launch(i, k);
  }
  function launch(i: number, k: Key) {
    const s = seats[i];
    if (k !== 'A' && k === s.lastKey) {
      s.stumble = STUMBLE_T; s.lastKey = null; s.stumbles++;
      say(i, 'hurt');
      note(i, ctx.t('Jatuh!'), PAL.red);
      if (i === 0) ctx.rumble(0.4, 120);
      return;
    }
    s.hopT = HOP_T;
    s.hopD = k === 'A' ? SLOW_HOP_D : HOP_D;
    s.lastKey = k === 'A' ? null : k;
    say(i, 'jump', k === 'L' ? 0.95 : 1.05);
  }
  function karung(dt: number, inOf: (i: number) => InputState) {
    seats.forEach((s, i) => {
      if (!s.cpu) {
        const p = inOf(i);
        if (p.hit.left) hop(i, 'L');
        if (p.hit.right) hop(i, 'R');
        if (p.hit.a) hop(i, 'A');
      } else if (s.doneT < 0) {
        s.cpuT -= dt;
        if (s.cpuT <= 0 && s.hopT <= 0 && s.stumble <= 0) {
          const slip = ctx.rand() < 0.03 + 0.07 * (1 - s.skill);
          launch(i, slip ? s.lastKey ?? 'L' : s.lastKey === 'L' ? 'R' : 'L');
          s.cpuT = HOP_T + 0.03 + ctx.rand() * (0.05 + 0.1 * (1 - s.skill));
        }
      }
    });
    seats.forEach((s, i) => {
      s.stumble = dec(s.stumble, dt);
      if (s.hopT <= 0) return;
      s.x += s.hopD * Math.min(dt, s.hopT) / HOP_T;
      s.hopT -= dt;
      if (s.doneT < 0 && s.x >= TRACK) { s.doneT = playT; finished(i); }
      if (s.hopT > 1e-9) return;
      s.hopT = 0;
      const q = s.queued;
      s.queued = null;
      if (q && s.doneT < 0) launch(i, q);
    });
  }
  function finished(i: number) {
    const n = placeOf(i);
    note(i, ctx.t('Juara {n}', { n }), n === 1 ? RED : PAL.green);
    if (!seats[i].cpu) ctx.sfx(n === 1 ? 'coin' : 'confirm');
  }

  // makan kerupuk
  function bite(i: number) {
    const s = seats[i];
    if (s.doneT >= 0 || s.choke > 0) return;
    s.presses = s.presses.filter((t) => playT - t < 1);
    s.presses.push(playT);
    if (s.presses.length > MASH_MAX) {
      s.choke = CHOKE_T; s.presses = []; s.chokes++;
      say(i, 'breath');
      note(i, ctx.t('Tersedak!'), PAL.red);
      if (i === 0) ctx.rumble(0.5, 200);
      return;
    }
    if (s.chew > 0) return;
    if (Math.abs(Math.sin(s.theta)) < ZONE) {
      s.bites++;
      s.chew = CHEW_T;
      say(i, 'pop', 0.9 + s.bites * 0.04);
      if (s.bites >= BITES) { s.doneT = playT; finished(i); }
    } else {
      s.misses++;
      s.chew = MISS_T;
      say(i, 'whoosh', 1.3);
      if (!s.cpu) note(i, ctx.t('Meleset'), PAL.ink2);
    }
  }
  function kerupuk(dt: number, inOf: (i: number) => InputState) {
    seats.forEach((s, i) => {
      if (!s.cpu) { if (inOf(i).hit.a) bite(i); return; }
      if (s.doneT >= 0 || s.chew > 0 || s.choke > 0) return;
      if (!s.planned) {
        // aim at the next time the cracker passes the mouth, with a timing error
        const om = (2 * Math.PI) / swingPeriod(s.bites);
        const m = ((s.theta % Math.PI) + Math.PI) % Math.PI;
        let tc = (Math.PI - m) / om;
        const err = (ctx.rand() * 2 - 1) * (0.08 + 0.1 * (1 - s.skill));
        if (tc + err < 0.05) tc += Math.PI / om;
        s.cpuT = tc + err;
        s.planned = true;
        return;
      }
      s.cpuT -= dt;
      if (s.cpuT <= 0) { s.planned = false; bite(i); }
    });
    for (const s of seats) {
      s.theta += ((2 * Math.PI) / swingPeriod(s.bites)) * dt;
      s.chew = dec(s.chew, dt);
      s.choke = dec(s.choke, dt);
    }
  }

  // tarik tambang
  function pull(i: number) {
    const s = seats[i];
    const k = beatSlot(playT);
    if (k === s.slot) return;
    s.slot = k;
    const on = Math.abs(beatDist(playT)) <= ON_BEAT;
    rope += (team(i) === 0 ? 1 : -1) * (on ? STRONG : WEAK) * STEP;
    s.pulls++;
    if (on) s.strong++;
    s.pullT = on ? 0.3 : 0.15;
    say(i, on ? 'right' : 'wrong');
    if (!s.cpu) note(i, on ? ctx.t('Kuat!') : ctx.t('Lemah'), on ? PAL.green : PAL.ink2);
  }
  function tambang(dt: number, inOf: (i: number) => InputState) {
    // audible beat: the music tempo does not match BEAT
    const b = Math.floor(playT / BEAT + 1e-9);
    if (b !== beatTick) { beatTick = b; ctx.sfx('tick', { gain: 0.35 }); }
    seats.forEach((s, i) => {
      if (!s.cpu) { if (inOf(i).hit.a) pull(i); return; }
      if (!s.planned) {
        const k = Math.max(s.slot + 1, Math.ceil(playT / BEAT - 1e-9));
        const err = (ctx.rand() * 2 - 1) * (0.12 + 0.1 * (1 - s.skill));
        s.cpuT = Math.max(0, k * BEAT + err - playT);
        s.planned = true;
        return;
      }
      s.cpuT -= dt;
      if (s.cpuT <= 0) { s.planned = false; pull(i); }
    });
    for (const s of seats) s.pullT = dec(s.pullT, dt);
  }

  function finishEvent() {
    const pts = [0, 0, 0, 0];
    let order: number[];
    let win = -1;
    if (ev < 2) {
      const at = (i: number) => (seats[i].doneT >= 0 ? seats[i].doneT : Infinity);
      const prog = (i: number) => (ev === 0 ? seats[i].x : seats[i].bites);
      // finishers by time (same frame: seat order, like placeOf), the rest by progress
      order = [0, 1, 2, 3].sort((a, b) => at(a) - at(b) || (seats[a].doneT >= 0 ? 0 : prog(b) - prog(a)) || a - b);
      order.forEach((i, place) => { pts[i] = PLACE_PTS[place]; });
      // faster finishes earn a small bonus so solo scores differ; 40 + 38 + 20 keeps it under one point (100)
      for (const i of order) if (seats[i].doneT >= 0) bonus[i] += Math.round(Math.max(0, (ev === 0 ? 20 : 25) - seats[i].doneT) * (ev === 0 ? 2 : 1.5));
    } else {
      win = rope > 0 ? 0 : rope < 0 ? 1 : -1;
      order = [0, 1, 2, 3].sort((a, b) => Number(team(a) !== win) - Number(team(b) !== win) || a - b);
      for (let i = 0; i < 4; i++) {
        pts[i] = win < 0 ? 1 : team(i) === win ? 3 : 0;
        if (team(i) === win) bonus[i] += Math.round(Math.min(1, Math.abs(rope)) * 20);
      }
    }
    for (let i = 0; i < 4; i++) points[i] += pts[i];
    last = { order, pts, win };
    const humanWon = versus ? order[0] < humans && pts[order[0]] === 3 : pts[0] === 3;
    ctx.sfx(humanWon ? 'win' : 'confirm');
    phase = 'result';
    phaseT = 0;
    hud();
  }

  function finishGame() {
    phase = 'over';
    const st = standings();
    const ch = st[0];
    const name = seats[ch].c.name;
    if (versus) {
      const summary = ch < humans ? ctx.t('Juara umum: Pemain {n} ({name})', { n: ch + 1, name }) : ctx.t('Juara umum: {name} (komputer)', { name });
      ctx.end({ score: 0, versus: true, won: ch === 0, summary });
      return;
    }
    const summary = ch === 0
      ? ctx.t('Juara umum! {p} poin dari 3 lomba', { p: points[0] })
      : ctx.t('Peringkat {r} dari 4, {p} poin. Juara umum: {name}', { r: st.indexOf(0) + 1, p: points[0], name });
    ctx.end({ score: total(0), won: ch === 0, summary });
  }

  return {
    update(dt, inp) {
      time += dt;
      for (const s of seats) s.msgT = Math.max(0, s.msgT - dt);
      if (phase === 'over') return;
      const prevT = phaseT;
      phaseT += dt;
      if (phase === 'title') {
        if (phaseT >= TITLE_T) { phase = 'count'; phaseT = 0; ctx.sfx('tick'); }
        return;
      }
      if (phase === 'count') {
        if (phaseT >= COUNT_T) { phase = 'play'; phaseT = 0; goT = 0.8; ctx.sfx('start'); }
        else if (Math.floor(phaseT) !== Math.floor(prevT)) ctx.sfx('tick');
        return;
      }
      if (phase === 'result') {
        if (phaseT < RESULT_T) return;
        if (ev < 2) { ev++; startEvent(); return; }
        phase = 'podium';
        phaseT = 0;
        const ch = standings()[0];
        ctx.sfx(ch < humans ? 'win' : 'confirm');
        return;
      }
      if (phase === 'podium') {
        if (phaseT >= PODIUM_T) finishGame();
        return;
      }
      goT = Math.max(0, goT - dt);
      const ins: InputState[] = inp.players ?? [inp];
      const inOf = (i: number): InputState => ins[i] ?? NO_INPUT;
      // inputs are judged against the state the player saw, then time moves on
      if (ev === 0) karung(dt, inOf);
      else if (ev === 1) kerupuk(dt, inOf);
      else tambang(dt, inOf);
      ropeShow += (rope - ropeShow) * Math.min(1, dt * 10);
      playT += dt;
      if (ev < 2) {
        if (seats.filter((s) => s.doneT >= 0).length >= 3 && endT < 0) endT = playT + 1; // let the third finisher land on screen
        if ((endT >= 0 && playT >= endT) || playT >= (ev === 0 ? KARUNG_MAX : KERUPUK_MAX)) finishEvent();
      } else if (Math.abs(rope) >= 1 || playT >= TUG_T) finishEvent();
    },

    render() {
      g.save();
      backdrop();
      if (phase === 'podium' || phase === 'over') podium();
      else if (ev === 0) drawKarung();
      else if (ev === 1) drawKerupuk();
      else drawTambang();
      tags();
      if (phase === 'title') titleCard();
      if (phase === 'count') {
        const n = Math.max(1, 3 - Math.floor(phaseT));
        const pop = rm ? 1 : 1 + Math.max(0, 0.3 - (phaseT % 1)) * 1.2;
        bigText(String(n), w / 2, 220, 76 * pop, RED);
      }
      if (phase === 'play' && goT > 0) {
        g.globalAlpha = Math.min(1, goT / 0.3);
        bigText(ctx.t('Mulai!'), w / 2, 220, 48, PAL.green);
        g.globalAlpha = 1;
      }
      if (phase === 'result') resultCard();
      g.restore();
    },

    snapshot: () => ({
      phase, ev, event: EVENTS[ev].id, phaseT: r3(phaseT), playT: r3(playT), humans, versus,
      points: [...points], bonus: [...bonus], standings: standings(),
      rope: r3(rope), beatDist: r3(beatDist(playT)), beatSlot: beatSlot(playT),
      lastOrder: last ? [...last.order] : [], lastPts: last ? [...last.pts] : [], tugWinner: last?.win ?? -1,
      players: seats.map((s) => ({
        id: s.c.id, cpu: s.cpu, doneT: r3(s.doneT),
        x: r3(s.x), hopT: r3(s.hopT), stumble: r3(s.stumble), lastKey: s.lastKey, stumbles: s.stumbles,
        bites: s.bites, swing: r3(Math.sin(s.theta)), chew: r3(s.chew), choke: r3(s.choke), misses: s.misses, chokes: s.chokes,
        slot: s.slot, pulls: s.pulls, strong: s.strong,
      })),
    }),
  };

  // drawing

  function backdrop() {
    g.fillStyle = '#d6ecf0';
    g.fillRect(0, 0, w, h);
    g.fillStyle = ev === 1 && phase !== 'podium' && phase !== 'over' ? '#e8dcc0' : PAL.grass;
    g.fillRect(0, 66, w, h - 66);
    bunting(6, 0);
  }

  function bunting(y: number, off: number) {
    const sag = (x: number) => y + 28 * (x / w) * (1 - x / w);
    g.strokeStyle = '#6b5a48';
    g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, y); g.quadraticCurveTo(w / 2, y + 14, w, y); g.stroke();
    for (let k = 0; k * 26 < w; k++) {
      const x = k * 26 + 4 + off;
      const sway = rm ? 0 : Math.sin(time * 2.2 + k * 0.9) * 2;
      g.fillStyle = k % 2 ? WHITE : RED;
      g.strokeStyle = 'rgba(0,0,0,0.12)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, sag(x)); g.lineTo(x + 22, sag(x + 22)); g.lineTo(x + 11 + sway, sag(x + 11) + 20);
      g.closePath(); g.fill(); g.stroke();
    }
  }

  function tags() {
    seats.forEach((_s, i) => {
      const x = 7 + i * 158;
      const tug = ev === 2 && phase !== 'podium' && phase !== 'over';
      g.fillStyle = 'rgba(255,250,240,0.95)';
      roundRect(g, x, 36, 152, 26, 8);
      g.fillStyle = tug ? (team(i) === 0 ? RED : '#d9d4c8') : colorOf(i);
      roundRect(g, x, 36, 6, 26, 3);
      text(g, label(i), x + 12, 49, 13, i < humans ? PAL.ink : PAL.ink2, 'left', 800);
      text(g, ctx.t('{n} poin', { n: points[i] }), x + 146, 49, 12, PAL.ink2, 'right', 700);
    });
  }

  function badge(i: number, x: number, y: number) {
    const s = seats[i];
    if (s.msgT > 0) {
      g.globalAlpha = Math.min(1, s.msgT / 0.3);
      outlined(s.msg, x, y - (rm ? 0 : (0.9 - s.msgT) * 16), 16, s.msgCol);
      g.globalAlpha = 1;
    } else if (s.doneT >= 0 && ev < 2) {
      const n = placeOf(i);
      outlined(ctx.t('Juara {n}', { n }), x, y, 14, n === 1 ? RED : PAL.green);
    }
  }

  function drawKarung() {
    const START = 110, FIN = 590;
    for (let i = 0; i < 4; i++) {
      const top = 68 + i * 82;
      g.fillStyle = i % 2 ? '#7ea765' : '#76a05e';
      g.fillRect(0, top, w, 82);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillRect(0, top, w, 2);
      for (let m = 6; m < TRACK; m += 6) g.fillRect(START + (m / TRACK) * (FIN - START), top + 66, 2, 10);
    }
    g.fillStyle = WHITE;
    g.fillRect(START - 2, 68, 4, 328);
    for (let r = 0; r < 41; r++) for (let c = 0; c < 2; c++) {
      g.fillStyle = (r + c) % 2 ? RED : WHITE;
      g.fillRect(FIN + c * 8, 68 + r * 8, 8, 8);
    }
    seats.forEach((s, i) => {
      const feet = 68 + i * 82 + 74;
      const px = START + (Math.min(s.x, TRACK + 1.5) / TRACK) * (FIN - START);
      const air = s.hopT > 0 ? Math.sin(Math.PI * (1 - s.hopT / HOP_T)) * (s.hopD === HOP_D ? 16 : 10) : 0;
      text(g, label(i), 8, feet - 60, 12, colorOf(i), 'left', 800);
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.beginPath(); g.ellipse(px + 2, feet + 1, 16 - air * 0.4, 4, 0, 0, Math.PI * 2); g.fill();
      const pose: Pose = s.stumble > 0 ? 'hurt' : s.doneT >= 0 && s.hopT <= 0 ? 'win' : s.hopT > 0 ? 'jump' : 'idle';
      g.save();
      g.translate(px, feet - air);
      if (s.stumble > 0) g.rotate(0.35);
      drawChar(g, s.c, 0, 0, 60, 1, pose, time);
      // the sack covers legs and hips
      g.fillStyle = SACK;
      roundRect(g, -13, -30, 28, 32, 5);
      g.fillStyle = '#9c7a4a';
      g.fillRect(-13, -27, 28, 2);
      g.fillRect(-13, -14, 28, 1.5);
      g.restore();
      if (!s.cpu || versus) {
        g.fillStyle = colorOf(i);
        g.beginPath(); g.moveTo(px - 5, feet - air - 72); g.lineTo(px + 5, feet - air - 72); g.lineTo(px, feet - air - 66); g.closePath(); g.fill();
      }
      badge(i, Math.min(px, FIN - 40), feet - air - 82);
    });
  }

  function drawKerupuk() {
    const POLE = 92, FEET = 372, AMP = 48, LEN = 184;
    g.fillStyle = '#8a6a3c';
    g.fillRect(14, POLE - 4, 6, FEET - POLE + 4);
    g.fillRect(w - 20, POLE - 4, 6, FEET - POLE + 4);
    g.fillStyle = '#c9a466';
    roundRect(g, 10, POLE - 6, w - 20, 8, 4);
    seats.forEach((s, i) => {
      const cx = 80 + i * 160;
      const mx = cx + 13;
      const sw = Math.sin(s.theta);
      const inZone = Math.abs(sw) < ZONE;
      const kx = mx + sw * AMP;
      const ky = POLE + Math.sqrt(LEN * LEN - (sw * AMP) ** 2);
      // target zone: bite while the cracker sits inside it
      g.fillStyle = inZone && s.doneT < 0 ? 'rgba(217,164,65,0.55)' : 'rgba(217,164,65,0.22)';
      roundRect(g, mx - ZONE * AMP - 3, POLE + LEN - 34, ZONE * AMP * 2 + 6, 66, 8);
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.beginPath(); g.ellipse(cx + 2, FEET + 1, 26, 5, 0, 0, Math.PI * 2); g.fill();
      drawChar(g, s.c, cx, FEET, 118, 1, s.choke > 0 ? 'hurt' : s.doneT >= 0 ? 'win' : 'idle', time);
      g.strokeStyle = '#6b5a48';
      g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(mx, POLE); g.lineTo(kx, ky); g.stroke();
      if (s.bites < BITES) {
        const r = 8 + 20 * (1 - s.bites / BITES);
        g.fillStyle = '#f2e2b3';
        g.beginPath();
        for (let k = 0; k <= 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const rr = r * (k % 2 ? 0.92 : 1);
          if (k === 0) g.moveTo(kx + Math.cos(a) * rr, ky + Math.sin(a) * rr); else g.lineTo(kx + Math.cos(a) * rr, ky + Math.sin(a) * rr);
        }
        g.closePath(); g.fill();
        g.fillStyle = '#d8c08a';
        for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(kx + Math.cos(k * 1.7) * r * 0.5, ky + Math.sin(k * 1.7) * r * 0.5, 1.8, 0, Math.PI * 2); g.fill(); }
      }
      text(g, `${s.bites}/${BITES}`, cx, FEET + 16, 13, colorOf(i), 'center', 800);
      if (s.choke > 0) {
        g.fillStyle = 'rgba(184,69,46,0.25)';
        roundRect(g, cx - 36, POLE + 16, 72, 6, 3);
        g.fillStyle = PAL.red;
        roundRect(g, cx - 36, POLE + 16, 72 * (s.choke / CHOKE_T), 6, 3);
      }
      badge(i, cx, POLE + 40);
    });
  }

  function drawTambang() {
    const FEET = 340, LINE = 140, CX = w / 2;
    const ropeY = FEET - 58;
    const fx = CX - Math.max(-1.1, Math.min(1.1, ropeShow)) * LINE;
    g.fillStyle = '#7a5a3a';
    g.beginPath(); g.ellipse(CX, FEET + 6, 46, 9, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.6)';
    for (let y = 290; y < 360; y += 12) g.fillRect(CX - 1, y, 2, 6);
    g.fillStyle = RED; g.fillRect(CX - LINE - 2, 300, 4, 50);
    g.fillStyle = WHITE; g.fillRect(CX + LINE - 2, 300, 4, 50);
    // team badges
    g.fillStyle = RED; roundRect(g, 40, 76, 96, 26, 8);
    text(g, ctx.t('Merah'), 88, 89, 15, WHITE, 'center', 800);
    g.fillStyle = WHITE; roundRect(g, w - 136, 76, 96, 26, 8);
    text(g, ctx.t('Putih'), w - 88, 89, 15, RED, 'center', 800);
    seats.forEach((s, i) => {
      const t = team(i);
      const face: 1 | -1 = t === 0 ? 1 : -1;
      const x = fx + (t === 0 ? -1 : 1) * (80 + (i >> 1) * 62);
      g.fillStyle = 'rgba(0,0,0,0.2)';
      g.beginPath(); g.ellipse(x, FEET + 1, 18, 4, 0, 0, Math.PI * 2); g.fill();
      g.save();
      g.translate(x, FEET);
      g.rotate(-face * (0.22 + (s.pullT > 0 ? 0.2 * (s.pullT / 0.3) : 0)));
      drawChar(g, s.c, 0, 0, 96, face, 'punch', time);
      g.restore();
      if (!s.cpu || versus) {
        g.fillStyle = colorOf(i);
        g.beginPath(); g.moveTo(x - 5, FEET - 118); g.lineTo(x + 5, FEET - 118); g.lineTo(x, FEET - 112); g.closePath(); g.fill();
      }
      badge(i, x, FEET - 128);
    });
    g.strokeStyle = SACK;
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(fx - 200, ropeY); g.lineTo(fx + 200, ropeY); g.stroke();
    g.fillStyle = '#5b4126';
    g.fillRect(fx - 1, ropeY, 2, 24);
    g.fillStyle = RED; g.fillRect(fx + 1, ropeY + 4, 20, 8);
    g.fillStyle = WHITE; g.fillRect(fx + 1, ropeY + 12, 20, 8);
    // beat marker: the ring closes on the beat, the core lights up inside the window
    const frac = ((playT / BEAT) % 1 + 1) % 1;
    const on = phase === 'play' && Math.abs(beatDist(playT)) <= ON_BEAT;
    const by = 140;
    g.fillStyle = 'rgba(255,250,240,0.92)';
    roundRect(g, CX - 62, by - 48, 124, 108, 14);
    const core = 16 + (!rm && phase === 'play' && frac < 0.15 ? (0.15 - frac) * 40 : 0);
    g.fillStyle = on ? PAL.green : 'rgba(31,77,58,0.2)';
    g.beginPath(); g.arc(CX, by, core, 0, Math.PI * 2); g.fill();
    if (phase === 'play') {
      g.strokeStyle = on ? PAL.green : PAL.gold;
      g.lineWidth = 4;
      g.beginPath(); g.arc(CX, by, 16 + 26 * (1 - frac), 0, Math.PI * 2); g.stroke();
    }
    text(g, ctx.t('Ketukan'), CX, by + 50, 12, PAL.ink2, 'center', 700);
    text(g, `${Math.max(0, Math.ceil(TUG_T - playT - 1e-9))}`, CX + 46, by - 34, 13, PAL.ink, 'right', 800);
  }

  function podium() {
    const st = standings();
    text(g, ctx.t('Juara Umum'), w / 2, 92, 28, RED, 'center', 800);
    const spots = [[w / 2, 100], [w / 2 - 150, 70], [w / 2 + 150, 46]] as const;
    const base = 352;
    if (!rm) {
      for (let k = 0; k < 36; k++) {
        g.fillStyle = k % 2 ? RED : WHITE;
        const x = (k * 97 + time * 30 * ((k % 3) + 1)) % w;
        const y = 66 + ((k * 53 + time * (50 + (k % 5) * 14)) % (h - 66));
        g.fillRect(x, y, 5, 8);
      }
    }
    spots.forEach(([x, hh], place) => {
      const i = st[place];
      g.fillStyle = place === 0 ? RED : WHITE;
      roundRect(g, x - 60, base - hh, 120, hh + 48, 8);
      text(g, String(place + 1), x, base - hh + 22, 24, place === 0 ? WHITE : RED, 'center', 800);
      drawChar(g, seats[i].c, x, base - hh, 84, 1, place === 0 ? 'win' : 'idle', time);
      text(g, label(i), x, base - hh + 46, 14, place === 0 ? WHITE : PAL.ink, 'center', 800);
      text(g, ctx.t('{n} poin', { n: points[i] }), x, base - hh + 64, 13, place === 0 ? WHITE : PAL.ink2, 'center', 700);
    });
    const i4 = st[3];
    text(g, `4. ${label(i4)} · ${ctx.t('{n} poin', { n: points[i4] })}`, w / 2, 120, 14, PAL.ink, 'center', 700);
  }

  function titleCard() {
    const a = ctx.key('a'), l = ctx.key('left'), r = ctx.key('right');
    const lines = ev === 0
      ? [ctx.t('{l} dan {r} bergantian untuk melompat.', { l, r }), ctx.t('Tombol sama dua kali: jatuh. {a}: lompat pelan.', { a })]
      : ev === 1
        ? [ctx.t('Tekan {a} saat kerupuk di atas mulut.', { a }), ctx.t('Terlalu sering menekan bikin tersedak.')]
        : [ctx.t('Tekan {a} tepat pada ketukan: tarikan kuat.', { a }),
          versus ? ctx.t('Merah: Pemain 1 dan 3. Putih: Pemain 2 dan 4.') : ctx.t('Kamu tim Merah bersama {name}.', { name: seats[2].c.name })];
    g.fillStyle = 'rgba(255,250,240,0.96)';
    roundRect(g, w / 2 - 210, 118, 420, 156, 16);
    g.fillStyle = RED;
    roundRect(g, w / 2 - 210, 118, 420, 8, 4);
    text(g, ctx.t('Lomba {n}/3', { n: ev + 1 }), w / 2, 146, 15, PAL.ink2, 'center', 700);
    text(g, ctx.t(EVENTS[ev].name), w / 2, 182, 32, RED, 'center', 800);
    text(g, lines[0], w / 2, 220, 15, PAL.ink, 'center', 700);
    text(g, lines[1], w / 2, 246, 14, PAL.ink2, 'center', 600);
  }

  function resultCard() {
    if (!last) return;
    g.fillStyle = 'rgba(255,250,240,0.96)';
    roundRect(g, w / 2 - 200, 92, 400, 262, 16);
    g.fillStyle = RED;
    roundRect(g, w / 2 - 200, 92, 400, 8, 4);
    text(g, ctx.t('Hasil {name}', { name: ctx.t(EVENTS[ev].name) }), w / 2, 122, 22, RED, 'center', 800);
    if (ev === 2) {
      const msg = last.win === 0 ? ctx.t('Tim Merah menang!') : last.win === 1 ? ctx.t('Tim Putih menang!') : ctx.t('Seri');
      text(g, msg, w / 2, 148, 15, PAL.ink, 'center', 800);
    }
    last.order.forEach((i, k) => {
      const y = 182 + k * 42;
      g.fillStyle = k % 2 ? 'rgba(29,42,35,0.04)' : 'rgba(29,42,35,0.08)';
      roundRect(g, w / 2 - 184, y - 18, 368, 36, 8);
      text(g, ev === 2 ? (team(i) === 0 ? ctx.t('Merah') : ctx.t('Putih')) : `${k + 1}`, w / 2 - 168, y, 15, ev === 2 && team(i) === 0 ? RED : PAL.ink, 'left', 800);
      text(g, label(i), w / 2 - 110, y, 15, colorOf(i) === PAL.ink2 ? PAL.ink : colorOf(i), 'left', 800);
      text(g, ctx.t('+{n} poin', { n: last!.pts[i] }), w / 2 + 70, y, 15, last!.pts[i] ? PAL.green : PAL.ink2, 'right', 800);
      text(g, ctx.t('Total {n}', { n: points[i] }), w / 2 + 172, y, 13, PAL.ink2, 'right', 700);
    });
  }

  function outlined(s: string, x: number, y: number, size: number, col: string) {
    g.font = `800 ${size}px 'Alegreya Sans', system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 4;
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(255,250,240,0.95)';
    g.strokeText(s, x, y);
    text(g, s, x, y, size, col, 'center', 800);
  }

  function bigText(s: string, x: number, y: number, size: number, col: string) {
    g.font = `800 ${size}px 'Alegreya Sans', system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 8;
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(255,250,240,0.95)';
    g.strokeText(s, x, y);
    text(g, s, x, y, size, col, 'center', 800);
  }
}

export default { meta, create } satisfies GameModule;
