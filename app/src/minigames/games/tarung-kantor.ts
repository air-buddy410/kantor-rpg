// Tarung Kantor (Game Station slot 2). Side-view one-on-one fighter in arcade
// mode: pick a teammate, then beat three CPU rivals in a row, best of three
// rounds each. Losing a match ends the run with the points earned so far.
// With a second gamepad joined (local multiplayer) it is one match, Pemain 1
// against Pemain 2, best of three rounds.
import type { CastMember, GameCtx, GameInstance, GameModule, InputState } from '../types';
import { PLAYER_COLORS } from '../local-players';
import { PAL, drawChar, roundRect, text } from '../cast';

const meta: GameModule['meta'] = {
  id: 'tarung-kantor', title: 'Tarung Kantor', place: 'arcade', music: 'fight',
  blurb: 'Satu lawan satu dengan karakter tim. Kalahkan 3 lawan berturut-turut.',
  view: { w: 640, h: 360 }, score: { unit: 'poin', higherIsBetter: true },
  touch: ['left', 'right', 'up', 'down', 'a', 'b', 'x', 'y'],
  tutorial: [
    'Pilih karakter dengan {lr}, konfirmasi dengan {a}.',
    '{a}: pukul, {b}: tendang, {up}: lompat, {down}: jongkok.',
    'Tahan arah menjauhi lawan atau {y} untuk blok. Meter penuh: {x} untuk jurus khas.',
  ],
  legend: [['lr', 'Jalan'], ['a', 'Pukul'], ['b', 'Tendang'], ['y', 'Blok'], ['x', 'Jurus']],
  actions: {
    left: 'Jalan / blok bila menjauhi lawan',
    right: 'Jalan / blok bila menjauhi lawan',
    up: 'Lompat',
    down: 'Jongkok',
    a: 'Pukul (cepat)',
    b: 'Tendang (jauh, kuat)',
    x: 'Jurus khas saat meter penuh',
    y: 'Blok',
  },
  pointerHint: 'Ketuk kartu karakter untuk memilih, ketuk lagi untuk mulai',
  players: 2,
  playersHint: 'Berdua: Pemain 2 bertarung di sisi kanan dengan stik kedua. Satu pertandingan, menang 2 ronde.',
};

/** Controls from one player's input. */
function ctlOf(inp: InputState): Ctl {
  return {
    l: inp.down.left || inp.ax < -0.4, r: inp.down.right || inp.ax > 0.4,
    u: inp.down.up || inp.ay < -0.55, d: inp.down.down || inp.ay > 0.55,
    a: inp.hit.a, b: inp.hit.b, x: inp.hit.x, g: inp.down.y || inp.hit.y,
    speed: inp.down.left || inp.down.right ? 1 : Math.abs(inp.ax),
  };
}

const GROUND = 322;
const XMIN = 26;
const XMAX = 614;
const CH = 110;
const GRAV = 1500;
const ROUND_TIME = 60;
const BLOCK_FACTOR = 0.2;
const FRAME = 1 / 60;
/** Presses this early still count once the fighter can act again. */
export const BUFFER = 0.15;
/** Freeze frames on contact, by blow strength. */
export const HITSTOP = { punch: 3, kick: 4, special: 5, block: 3 } as const;

type AtkKind = 'punch' | 'kick' | 'special';
interface AtkSpec { s: number; a: number; r: number; dmg: number; range: number; y0: number; y1: number; stun: number; kb: number }
// s = startup, a = active, r = recovery (seconds); range is measured from 10 units in front of the body.
export const ATK: Record<'punch' | 'kick', AtkSpec> = {
  punch: { s: 3 / 60, a: 4 / 60, r: 8 / 60, dmg: 5, range: 48, y0: -92, y1: -56, stun: 0.26, kb: 150 },
  kick: { s: 6 / 60, a: 5 / 60, r: 13 / 60, dmg: 10, range: 74, y0: -62, y1: -16, stun: 0.4, kb: 300 },
};
const SPECIAL_START = 0.16;
const SPECIAL_TOTAL = 0.46;
/** A hit may be cancelled into the next move this long after contact. */
const CANCEL_WINDOW = 0.2;
const MAX_JABS = 3;

type FxKind = 'kabel' | 'wifi' | 'pensil' | 'drone' | 'kuas' | 'penggaris' | 'clipboard' | 'stempel' | 'dasi';
const SPECIAL_OF: Record<string, FxKind> = {
  'CH-NETINSTALL': 'kabel', 'CH-ICTSPEC': 'wifi', 'CH-DESIGNER': 'pensil', 'CH-ASSISTANT': 'drone', 'CH-VISUAL': 'kuas',
  'CH-ARCHITECT': 'penggaris', 'CH-SUPERVISOR': 'clipboard', 'CH-QA': 'stempel', 'CH-CEO': 'dasi',
};
const RANGED: FxKind[] = ['kabel', 'wifi', 'pensil', 'drone', 'stempel'];

/** `a`, `b`, `x` are presses this frame; `g` is an explicit guard button. */
interface Ctl { l: boolean; r: boolean; u: boolean; d: boolean; a: boolean; b: boolean; x: boolean; g: boolean; speed: number }
const NO_CTL: Ctl = { l: false, r: false, u: false, d: false, a: false, b: false, x: false, g: false, speed: 1 };

interface Atk { kind: AtkKind; t: number; hit: boolean; hitT: number; spawned: boolean; jab: number }
interface Fighter {
  c: CastMember; x: number; y: number; vx: number; vy: number; face: 1 | -1;
  hp: number; meter: number; atk: Atk | null;
  stun: number; blockstun: number; guard: boolean; crouch: boolean; walk: number; ko: boolean; win: boolean;
  buf: { a: number; b: number; x: number }; guardLatch: number; flash: number; land: number; combo: number;
}

interface Fx {
  kind: FxKind; owner: 0 | 1; x: number; y: number; vx: number; vy: number; w: number; h: number;
  life: number; t: number; dmg: number; kb: number; stun: number; hit: boolean; face: 1 | -1;
  attach: { dx: number; dy: number } | null; delay: number;
}

interface HitLog { by: 0 | 1; kind: string; raw: number; dmg: number; blocked: boolean }
interface Pop { x: number; y: number; t: number; life: number; s: string; color: string; size: number }
interface Star { x: number; y: number; vx: number; vy: number; rot: number; vr: number; t: number; life: number; c: string; r: number }

// react = how long the CPU needs to notice an attack before guarding (no input reading).
const LEVELS = [
  { think: 0.5, aggr: 0.55, block: 0.3, atk: 0.42, spec: 0.5, react: 0.24 },
  { think: 0.34, aggr: 0.7, block: 0.45, atk: 0.55, spec: 0.7, react: 0.18 },
  { think: 0.24, aggr: 0.8, block: 0.6, atk: 0.65, spec: 0.9, react: 0.13 },
];

const ease = (k: number) => 1 - (1 - k) * (1 - k);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function create(ctx: GameCtx): GameInstance {
  const { g, w, h } = ctx;
  const cast = ctx.cast;
  const SP: Record<FxKind, { name: string; desc: string }> = {
    kabel: { name: ctx.t('Lempar Gulungan Kabel'), desc: ctx.t('Proyektil kabel melaju ke depan') },
    wifi: { name: ctx.t('Tembakan Sinyal WiFi'), desc: ctx.t('Gelombang sinyal cepat jarak jauh') },
    pensil: { name: ctx.t('Lemparan Pensil Warna'), desc: ctx.t('Pensil tajam melesat lurus') },
    drone: { name: ctx.t('Drone Asisten'), desc: ctx.t('Drone kecil terbang pelan, pukulan keras') },
    kuas: { name: ctx.t('Sapuan Kuas Cat'), desc: ctx.t('Sapuan jarak dekat, memukul mundur') },
    penggaris: { name: ctx.t('Penggaris T Panjang'), desc: ctx.t('Sodokan penggaris dengan jangkauan panjang') },
    clipboard: { name: ctx.t('Clipboard Berputar'), desc: ctx.t('Berputar mengenai depan dan belakang') },
    stempel: { name: ctx.t('Cap REJECT'), desc: ctx.t('Stempel jatuh dari atas kepala lawan') },
    dasi: { name: ctx.t('Rapat Mendadak'), desc: ctx.t('Dorongan dasi, lawan terlempar jauh') },
  };

  let phase: 'select' | 'intro' | 'fight' | 'roundEnd' | 'matchEnd' | 'over' = 'select';
  const versus = ctx.players >= 2;
  let sel = Math.max(0, cast.findIndex((c) => c.id === ctx.playerId));
  let sel2 = (sel + 1) % cast.length;
  const ready = [false, false];
  let time = 0;
  let timer = 0;
  let clock = ROUND_TIME;
  let round = 1;
  let pWins = 0;
  let cWins = 0;
  let opIdx = 0;
  let score = 0;
  let opponents: CastMember[] = [];
  let banner = '';
  let matchWon = false;
  let hitstopF = 0;
  let frozenFrames = 0;
  let shake = 0;
  let shakeAmp = 0;
  const fx: Fx[] = [];
  const sparks: { x: number; y: number; t: number; big: boolean }[] = [];
  const pops: Pop[] = [];
  const stars: Star[] = [];
  const hits: HitLog[] = [];
  const specials: string[] = [];
  const ai = { think: 0, intent: 'idle' as 'idle' | 'approach' | 'retreat' | 'guard', blockT: 0, lastPAtk: false, lastFx: 0, pending: -1 };
  let P: Fighter = mkFighter(cast[sel], 170, 1);
  let C: Fighter = mkFighter(cast[(sel + 1) % cast.length], 470, -1);

  function mkFighter(c: CastMember, x: number, face: 1 | -1): Fighter {
    return {
      c, x, y: GROUND, vx: 0, vy: 0, face, hp: 100, meter: 0, atk: null, stun: 0, blockstun: 0, guard: false, crouch: false, walk: 0, ko: false, win: false,
      buf: { a: 0, b: 0, x: 0 }, guardLatch: 0, flash: 0, land: 0, combo: 0,
    };
  }

  const hud = () => ctx.setHud(phase === 'select' ? ctx.t('Pilih karakter')
    : versus ? ctx.t('Pemain 1 {a} · Pemain 2 {b}', { a: pWins, b: cWins })
      : ctx.t('Lawan {n}/3 · {s} poin', { n: opIdx + 1, s: score }));
  hud();

  function startMatch() {
    C = mkFighter(opponents[opIdx], 470, -1);
    round = 1; pWins = 0; cWins = 0;
    startRound();
  }

  // Super meter carries over between rounds of a match, like a real arcade cabinet.
  function startRound() {
    const pm = P.meter, cm = C.meter;
    P = mkFighter(P.c, 170, 1); P.meter = pm;
    C = mkFighter(C.c, 470, -1); C.meter = cm;
    fx.length = 0;
    clock = ROUND_TIME;
    hitstopF = 0;
    ai.think = 0.3; ai.intent = 'idle'; ai.blockT = 0; ai.lastPAtk = false; ai.lastFx = 0; ai.pending = -1;
    phase = 'intro';
    timer = 1.6;
    ctx.sfx('start');
    hud();
  }

  function confirmSelect() {
    if (versus) {
      opponents = [cast[sel2]];
      P = mkFighter(cast[sel], 170, 1);
      opIdx = 0;
      ctx.sfx('confirm');
      startMatch();
      return;
    }
    const pool = cast.filter((_, i) => i !== sel);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    opponents = pool.slice(0, 3);
    P = mkFighter(cast[sel], 170, 1);
    opIdx = 0;
    ctx.sfx('confirm');
    startMatch();
  }

  // ---- feedback ----
  function pop(x: number, y: number, s: string, color: string, size = 18) {
    pops.push({ x, y, t: 0, life: 0.7, s, color, size });
    if (pops.length > 12) pops.shift();
  }
  function starBurst(x: number, y: number, dir: number, n: number, big: boolean) {
    if (ctx.reducedMotion) return;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (ctx.rand() - 0.5) * 2.2;
      const sp = (big ? 220 : 160) + ctx.rand() * 140;
      stars.push({
        x, y, vx: Math.cos(a) * sp * 0.7 + dir * 90, vy: Math.sin(a) * sp, rot: ctx.rand() * 6, vr: (ctx.rand() - 0.5) * 16,
        t: 0, life: 0.45 + ctx.rand() * 0.25, c: i % 3 === 0 ? '#fffaf0' : PAL.gold, r: big ? 6 : 4.5,
      });
    }
    if (stars.length > 60) stars.splice(0, stars.length - 60);
  }

  // ---- combat ----
  function hurtbox(f: Fighter) {
    return { x0: f.x - 18, x1: f.x + 18, y0: f.y - (f.crouch ? 72 : 100), y1: f.y };
  }
  function overlap(a: { x0: number; x1: number; y0: number; y1: number }, b: { x0: number; x1: number; y0: number; y1: number }) {
    return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  }

  function applyHit(att: Fighter, def: Fighter, raw: number, kb: number, stun: number, dir: number, kind: string) {
    if (def.ko) return;
    const grounded = def.y >= GROUND;
    // dir is the travel direction of the blow; the defender must face against it to guard.
    const fromFront = def.face === -dir;
    const blocked = grounded && !def.atk && def.stun <= 0 && (def.guard || def.blockstun > 0) && fromFront;
    const dmg = blocked ? raw * BLOCK_FACTOR : raw;
    def.hp = Math.max(0, def.hp - dmg);
    const by: 0 | 1 = att === P ? 0 : 1;
    hits.push({ by, kind, raw, dmg: Math.round(dmg * 100) / 100, blocked });
    if (hits.length > 40) hits.shift();
    const hy = def.y - (def.crouch ? 55 : 70);
    const hx = def.x - dir * 10;
    // a defender pinned at the wall cannot slide, so the attacker is pushed back instead
    const pinned = (dir > 0 && def.x >= XMAX - 4) || (dir < 0 && def.x <= XMIN + 4);
    if (blocked) {
      def.blockstun = stun * 0.6;
      def.vx = dir * kb * 0.5;
      if (pinned && att.y >= GROUND) att.vx = -dir * kb * 0.45;
      ctx.sfx('block');
      hitstopF = HITSTOP.block;
      att.combo = 0;
      pop(hx, hy - 18, ctx.t('Blok!'), PAL.blue, 16);
      sparks.push({ x: hx, y: hy, t: 0.2, big: false });
    } else {
      def.stun = stun;
      def.vx = dir * kb;
      if (pinned && att.y >= GROUND) att.vx = -dir * kb * 0.5;
      if (!grounded) def.vy = -260;
      def.atk = null;
      def.crouch = false;
      def.flash = 4 * FRAME;
      att.combo = def.combo > 0 || att.combo > 0 ? att.combo + 1 : 1;
      def.combo = 0;
      const k = kind as keyof typeof HITSTOP;
      ctx.sfx(kind === 'special' ? 'thud' : 'hit', { rate: kind === 'punch' ? 1.25 : 0.85 });
      if (kind !== 'punch') ctx.sfx('pop', { rate: 0.6, gain: 0.5 });
      hitstopF = HITSTOP[k] ?? HITSTOP.punch;
      if (!ctx.reducedMotion) { shake = kind === 'punch' ? 0.1 : 0.16; shakeAmp = kind === 'punch' ? 3 : kind === 'kick' ? 5 : 6; }
      pop(hx, hy - 20, String(Math.round(dmg)), kind === 'punch' ? '#fffaf0' : PAL.gold, kind === 'punch' ? 20 : 26);
      if (att.combo >= 2) pop(att.x, att.y - 128, ctx.t('Kombo {n}!', { n: att.combo }), PAL.accent, 18);
      starBurst(hx, hy, dir, kind === 'punch' ? 5 : 9, kind !== 'punch');
      sparks.push({ x: hx, y: hy, t: 0.25, big: kind !== 'punch' });
    }
    if (kind !== 'special') att.meter = Math.min(100, att.meter + dmg * 2.4);
    def.meter = Math.min(100, def.meter + dmg * 1.6);
    if (by === 0) { score += Math.round(dmg * 10); hud(); }
    if (def.hp <= 0) {
      def.ko = true; def.stun = 0; def.blockstun = 0; def.atk = null;
      def.vy = -320; def.vx = dir * 220;
      hitstopF = 5;
      if (!ctx.reducedMotion) { shake = 0.3; shakeAmp = 7; }
      ctx.sfx('explode');
    }
  }

  function spawnSpecial(f: Fighter, owner: 0 | 1) {
    const kind = SPECIAL_OF[f.c.id] ?? 'dasi';
    specials.push(`${f.c.id}:${kind}`);
    const opp = owner === 0 ? C : P;
    const base: Fx = { kind, owner, x: f.x + f.face * 30, y: f.y - 66, vx: 0, vy: 0, w: 26, h: 26, life: 2.5, t: 0, dmg: 12, kb: 220, stun: 0.5, hit: false, face: f.face, attach: null, delay: 0 };
    switch (kind) {
      case 'kabel': Object.assign(base, { vx: f.face * 300, w: 28, h: 28, dmg: 14 }); break;
      case 'wifi': Object.assign(base, { vx: f.face * 430, w: 26, h: 44, dmg: 11, kb: 180 }); break;
      case 'pensil': Object.assign(base, { vx: f.face * 370, y: f.y - 76, w: 34, h: 10, dmg: 12 }); break;
      case 'drone': Object.assign(base, { vx: f.face * 170, y: f.y - 86, w: 30, h: 22, dmg: 16, life: 3.6 }); break;
      case 'kuas': Object.assign(base, { attach: { dx: 46, dy: -56 }, w: 72, h: 78, life: 0.2, dmg: 16, kb: 460, stun: 0.55 }); break;
      case 'penggaris': Object.assign(base, { attach: { dx: 92, dy: -70 }, w: 150, h: 18, life: 0.22, dmg: 14, kb: 280 }); break;
      case 'clipboard': Object.assign(base, { attach: { dx: 0, dy: -60 }, w: 132, h: 72, life: 0.5, dmg: 15, kb: 300 }); break;
      case 'stempel': Object.assign(base, { x: opp.x, y: 40, w: 60, h: 40, delay: 0.35, life: 1.6, dmg: 18, kb: 120, stun: 0.7 }); break;
      case 'dasi': Object.assign(base, { attach: { dx: 58, dy: -58 }, w: 100, h: 84, life: 0.26, dmg: 12, kb: 760, stun: 0.6 }); break;
    }
    fx.push(base);
    ctx.sfx(kind === 'stempel' ? 'stamp' : kind === 'wifi' ? 'power' : 'whoosh');
  }

  function startAtk(f: Fighter, kind: AtkKind, jab = 0) {
    f.atk = { kind, t: 0, hit: false, hitT: 0, spawned: false, jab };
    f.buf.a = 0; f.buf.b = 0; f.buf.x = 0;
    if (kind === 'special') { f.meter = 0; f.vx = 0; ctx.sfx('power', { rate: 1.3, gain: 0.6 }); }
    else if (kind === 'punch') ctx.sfx('swat', { gain: 0.5, rate: 1.1 });
    else ctx.sfx('whoosh', { rate: 0.8 });
  }

  /** Buffered press, newest intent first: special, kick, punch. */
  function wanted(f: Fighter): AtkKind | null {
    if (f.buf.x > 0 && f.meter >= 100) return 'special';
    if (f.buf.b > 0) return 'kick';
    if (f.buf.a > 0) return 'punch';
    return null;
  }

  function stepFighter(f: Fighter, o: Fighter, ctl: Ctl, dt: number) {
    const grounded = f.y >= GROUND;
    f.flash = Math.max(0, f.flash - dt);
    f.land = Math.max(0, f.land - dt);
    f.guardLatch = Math.max(0, f.guardLatch - dt);
    if (ctl.a) f.buf.a = BUFFER; else f.buf.a = Math.max(0, f.buf.a - dt);
    if (ctl.b) f.buf.b = BUFFER; else f.buf.b = Math.max(0, f.buf.b - dt);
    if (ctl.x) {
      f.buf.x = BUFFER;
      if (f.meter < 100 && (f === P || versus) && phase === 'fight') pop(f.x, f.y - 128, ctx.t('Meter belum penuh'), PAL.ink2, 13);
    } else f.buf.x = Math.max(0, f.buf.x - dt);
    if (f.ko || f.win) {
      f.guard = false;
    } else {
      if (grounded && !f.atk && f.stun <= 0) f.face = o.x >= f.x ? 1 : -1;
      const toward = f.face === 1 ? ctl.r : ctl.l;
      const away = f.face === 1 ? ctl.l : ctl.r;
      f.walk = 0;
      if (f.stun > 0) {
        f.stun -= dt;
        f.guard = false;
        if (f.stun <= 0) o.combo = 0;
      } else if (f.blockstun > 0) {
        f.blockstun -= dt;
        f.guard = true;
      } else if (f.atk) {
        f.guard = false;
        const a = f.atk;
        a.t += dt;
        if (a.hit) a.hitT += dt;
        if (a.kind === 'special') {
          if (grounded) f.vx = 0;
          if (!a.spawned && a.t >= SPECIAL_START) { a.spawned = true; spawnSpecial(f, f === P ? 0 : 1); }
          if (a.t >= SPECIAL_TOTAL) f.atk = null;
        } else {
          const s = ATK[a.kind];
          // a small lunge sells the blow and keeps a jab chain in range
          if (grounded) f.vx = a.t < s.s + s.a ? f.face * (a.kind === 'kick' ? 70 : 50) : 0;
          if (!a.hit && a.t >= s.s && a.t < s.s + s.a) {
            const box = f.face > 0
              ? { x0: f.x + 10, x1: f.x + 10 + s.range, y0: f.y + s.y0, y1: f.y + s.y1 }
              : { x0: f.x - 10 - s.range, x1: f.x - 10, y0: f.y + s.y0, y1: f.y + s.y1 };
            if (overlap(box, hurtbox(o)) && !o.ko) { a.hit = true; applyHit(f, o, s.dmg, s.kb, s.stun, f.face, a.kind); }
          }
          // cancel: a connected (or blocked) blow can flow into the next one right away
          const next = f.atk && a.hit && a.hitT <= CANCEL_WINDOW ? wanted(f) : null;
          if (next === 'special' || (next === 'kick' && a.kind === 'punch') || (next === 'punch' && a.kind === 'punch' && a.jab + 1 < MAX_JABS)) {
            startAtk(f, next, next === 'punch' ? a.jab + 1 : 0);
          } else if (f.atk && a.t >= s.s + s.a + s.r) f.atk = null;
        }
      }
      if (!f.atk && f.stun <= 0 && f.blockstun <= 0 && !f.ko && !f.win) {
        if (grounded) {
          f.crouch = false;
          f.guard = false;
          const want = wanted(f);
          if (want) startAtk(f, want);
          else if (ctl.u) { f.vy = -560; f.vx = (toward ? 1 : away ? -1 : 0) * f.face * 170; ctx.sfx('jump'); }
          else {
            const guardBtn = ctl.g || f.guardLatch > 0;
            if (ctl.g) f.guardLatch = Math.max(f.guardLatch, 0.25);
            f.crouch = ctl.d;
            f.guard = away || guardBtn;
            const sp = Math.max(0.5, Math.min(1, ctl.speed));
            f.vx = f.crouch || guardBtn ? 0 : toward ? f.face * 165 * sp : away ? -f.face * 125 * sp : 0;
            f.walk = f.vx === 0 ? 0 : 1;
          }
        } else {
          f.guard = false;
          const want = wanted(f);
          if (want && want !== 'special') startAtk(f, want);
        }
      }
    }
    if (f.y < GROUND || f.vy < 0) {
      f.vy += GRAV * dt;
      f.y += f.vy * dt;
      if (f.y >= GROUND) {
        f.y = GROUND; f.vy = 0; f.land = 0.12;
        if (f.atk && f.atk.kind !== 'special') f.atk = null;
        if (!f.ko) f.vx = 0;
        if (!f.ko && phase === 'fight') ctx.sfx('step', { gain: 0.6 });
      }
    } else if (f.stun > 0 || f.blockstun > 0 || f.ko || (f.atk && f.atk.kind !== 'special') || Math.abs(f.vx) > 200) {
      const dec = 900 * dt;
      if (!f.atk || f.atk.t > 0.3) f.vx = Math.abs(f.vx) <= dec ? 0 : f.vx - Math.sign(f.vx) * dec;
    }
    f.x = Math.min(XMAX, Math.max(XMIN, f.x + f.vx * dt));
  }

  function separate() {
    if (P.ko || C.ko) return;
    const dx = C.x - P.x;
    if (Math.abs(P.y - C.y) > 70 || Math.abs(dx) >= 36) return;
    const push = (36 - Math.abs(dx)) / 2;
    const s = dx === 0 ? P.face : Math.sign(dx);
    P.x = Math.min(XMAX, Math.max(XMIN, P.x - s * push));
    C.x = Math.min(XMAX, Math.max(XMIN, C.x + s * push));
    // a fighter pinned at the wall still needs room
    if (Math.abs(C.x - P.x) < 36) {
      if ((s > 0 && P.x <= XMIN + 0.01) || (s < 0 && P.x >= XMAX - 0.01)) C.x = P.x + s * 36;
      else P.x = C.x - s * 36;
    }
  }

  function stepFx(dt: number) {
    for (const e of fx) {
      e.t += dt;
      e.life -= dt;
      const ownerF = e.owner === 0 ? P : C;
      const target = e.owner === 0 ? C : P;
      let active = true;
      if (e.attach) {
        e.x = ownerF.x + e.face * e.attach.dx;
        e.y = ownerF.y + e.attach.dy;
      } else if (e.kind === 'stempel') {
        if (e.delay > 0) { e.delay -= dt; e.x += (target.x - e.x) * Math.min(1, dt * 6); active = false; }
        else if (e.y < GROUND - 24) { e.vy = 980; e.y = Math.min(GROUND - 24, e.y + e.vy * dt); }
        else { active = false; if (e.life > 0.3) { e.life = 0.3; ctx.sfx('stamp'); } }
      } else {
        e.x += e.vx * dt;
        if (e.kind === 'drone') e.y = ownerF.y - 86 + Math.sin(e.t * 8) * 6;
      }
      if (!active || e.hit || target.ko) continue;
      const box = { x0: e.x - e.w / 2, x1: e.x + e.w / 2, y0: e.y - e.h / 2, y1: e.y + e.h / 2 };
      if (overlap(box, hurtbox(target))) {
        e.hit = true;
        const dir = e.kind === 'clipboard' || e.kind === 'stempel' ? (target.x >= ownerF.x ? 1 : -1) : e.face;
        applyHit(ownerF, target, e.dmg, e.kb, e.stun, dir, 'special');
        if (RANGED.includes(e.kind) && e.kind !== 'stempel') e.life = Math.min(e.life, 0.08);
      }
    }
    for (let i = fx.length - 1; i >= 0; i--) {
      const e = fx[i];
      if (e.life <= 0 || e.x < -60 || e.x > w + 60) fx.splice(i, 1);
    }
  }

  function stepFeedback(dt: number) {
    shake = Math.max(0, shake - dt);
    for (const s of sparks) s.t -= dt;
    while (sparks.length && sparks[0].t <= 0) sparks.shift();
    for (let i = pops.length - 1; i >= 0; i--) { pops[i].t += dt; if (pops[i].t >= pops[i].life) pops.splice(i, 1); }
    for (let i = stars.length - 1; i >= 0; i--) {
      const s = stars[i];
      s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 900 * dt; s.rot += s.vr * dt;
      if (s.t >= s.life) stars.splice(i, 1);
    }
  }

  // The CPU only sees what a player sees: attack poses and projectiles on screen,
  // and only after a human-like reaction delay.
  function aiCtl(dt: number): Ctl {
    const L = LEVELS[Math.min(opIdx, LEVELS.length - 1)];
    const ctl: Ctl = { ...NO_CTL };
    const dist = Math.abs(P.x - C.x);
    const towardRight = P.x >= C.x;
    const holdToward = () => { if (towardRight) ctl.r = true; else ctl.l = true; };
    const holdAway = () => { if (towardRight) ctl.l = true; else ctl.r = true; };
    const pAtk = !!P.atk;
    const threatFx = fx.filter((e) => e.owner === 0).length;
    if (ai.pending < 0 && ((pAtk && !ai.lastPAtk && dist < 140) || threatFx > ai.lastFx)) {
      if (ctx.rand() < L.block) ai.pending = L.react * (0.85 + 0.3 * ctx.rand());
    }
    ai.lastPAtk = pAtk;
    ai.lastFx = threatFx;
    if (ai.pending >= 0) { ai.pending -= dt; if (ai.pending < 0) ai.blockT = 0.4; }
    if (C.stun > 0 || C.atk || C.ko) return ctl;
    if (ai.blockT > 0) { ai.blockT -= dt; holdAway(); return ctl; }
    ai.think -= dt;
    if (ai.think <= 0) {
      ai.think = L.think * (0.6 + 0.8 * ctx.rand());
      const kind = SPECIAL_OF[C.c.id] ?? 'dasi';
      const reach = kind === 'penggaris' ? 170 : kind === 'dasi' ? 120 : 100;
      const r = ctx.rand();
      if (C.meter >= 100 && r < L.spec && (RANGED.includes(kind) || dist < reach)) { ctl.x = true; return ctl; }
      if (dist < 64) {
        if (r < L.atk) { if (ctx.rand() < 0.6) ctl.a = true; else ctl.b = true; return ctl; }
        ai.intent = r < L.atk + L.block * 0.3 ? 'guard' : r < L.atk + 0.25 ? 'retreat' : 'idle';
      } else if (dist < 90 && r < L.atk * 0.6) {
        ctl.b = true; return ctl;
      } else if (r < L.aggr) ai.intent = 'approach';
      else if (r < L.aggr + 0.1) { ctl.u = true; holdToward(); return ctl; }
      else ai.intent = ctx.rand() < 0.5 ? 'idle' : 'retreat';
    }
    if (ai.intent === 'approach' && dist > 46) holdToward();
    if (ai.intent === 'retreat') holdAway();
    if (ai.intent === 'guard') ctl.g = true;
    return ctl;
  }

  function endRound() {
    let winner: 0 | 1 | -1;
    if (C.ko && !P.ko) winner = 0;
    else if (P.ko && !C.ko) winner = 1;
    else if (P.hp > C.hp) winner = 0;
    else if (C.hp > P.hp) winner = 1;
    else winner = -1;
    banner = !P.ko && !C.ko ? ctx.t('Waktu habis') : ctx.t('KO!');
    if (winner === 0) {
      pWins++;
      const tb = Math.ceil(clock) * 20;
      const perfect = P.hp >= 100 ? 1000 : 0;
      score += tb + perfect;
      P.win = true;
      banner += ' ' + (perfect ? ctx.t('Sempurna! +{b}', { b: tb + perfect }) : ctx.t('Bonus waktu +{b}', { b: tb }));
      ctx.sfx('right');
    } else if (winner === 1) {
      cWins++;
      C.win = true;
      ctx.sfx('wrong');
    } else {
      banner += ' ' + ctx.t('Seri');
    }
    P.atk = null; C.atk = null;
    phase = 'roundEnd';
    timer = 2.2;
    hud();
  }

  function afterRound() {
    // round cap stops endless draws
    if (pWins >= 2 || cWins >= 2 || round >= 5) {
      matchWon = pWins > cWins;
      if (matchWon) { score += 1000 * (opIdx + 1); ctx.sfx('win'); } else ctx.sfx('lose');
      phase = 'matchEnd';
      timer = 2.6;
      hud();
      return;
    }
    round++;
    startRound();
  }

  function afterMatch() {
    if (versus) {
      phase = 'over';
      const win = matchWon ? P : C;
      ctx.end({ score: 0, versus: true, won: true, summary: ctx.t('{name} (Pemain {n}) menang {a}-{b}', { name: win.c.name, n: matchWon ? 1 : 2, a: Math.max(pWins, cWins), b: Math.min(pWins, cWins) }) });
      return;
    }
    if (!matchWon) {
      phase = 'over';
      ctx.end({ score, won: false, summary: ctx.t('Mengalahkan {n} dari 3 lawan', { n: opIdx }) });
      return;
    }
    if (opIdx >= 2) {
      phase = 'over';
      ctx.end({ score, won: true, summary: ctx.t('Juara! Mengalahkan 3 lawan') });
      return;
    }
    opIdx++;
    P.meter = 0;
    startMatch();
  }

  return {
    update(dt, inp) {
      time += dt;
      stepFeedback(dt);
      if (phase === 'over') return;
      if (phase === 'select' && versus) {
        const ins = [inp, inp.players?.[1]];
        ins.forEach((pi, k) => {
          if (!pi || ready[k]) { if (pi && ready[k] && pi.hit.b) { ready[k] = false; ctx.sfx('back'); } return; }
          const d = pi.hit.left ? -1 : pi.hit.right ? 1 : 0;
          if (d) { if (k === 0) sel = (sel + cast.length + d) % cast.length; else sel2 = (sel2 + cast.length + d) % cast.length; ctx.sfx('ui'); }
          if (pi.hit.a) { ready[k] = true; ctx.sfx('confirm'); }
        });
        if (inp.tap) { const i = slotAt(inp.tap.x, inp.tap.y); if (i >= 0) { sel = i; ctx.sfx('ui'); } }
        if (ready[0] && ready[1]) confirmSelect();
        return;
      }
      if (phase === 'select') {
        if (inp.hit.left) { sel = (sel + cast.length - 1) % cast.length; ctx.sfx('ui'); }
        if (inp.hit.right) { sel = (sel + 1) % cast.length; ctx.sfx('ui'); }
        if (inp.tap) {
          const i = slotAt(inp.tap.x, inp.tap.y);
          if (i >= 0) { if (i === sel) { confirmSelect(); return; } sel = i; ctx.sfx('ui'); }
        }
        if (inp.hit.a) confirmSelect();
        return;
      }
      if (phase === 'intro' || phase === 'roundEnd' || phase === 'matchEnd') {
        timer -= dt;
        stepFighter(P, C, NO_CTL, dt);
        stepFighter(C, P, NO_CTL, dt);
        stepFx(dt);
        if (timer <= 0) {
          if (phase === 'intro') phase = 'fight';
          else if (phase === 'roundEnd') afterRound();
          else afterMatch();
        }
        return;
      }
      // Hit-stop freezes the fighters for a few frames, but presses made during
      // the freeze are kept in the buffer so a follow-up is never lost.
      if (hitstopF > 0) {
        hitstopF--;
        frozenFrames++;
        if (inp.hit.a) P.buf.a = BUFFER;
        if (inp.hit.b) P.buf.b = BUFFER;
        if (inp.hit.x) P.buf.x = BUFFER;
        const p2 = versus ? inp.players?.[1] : undefined;
        if (p2?.hit.a) C.buf.a = BUFFER;
        if (p2?.hit.b) C.buf.b = BUFFER;
        if (p2?.hit.x) C.buf.x = BUFFER;
        return;
      }
      clock = Math.max(0, clock - dt);
      const pc = ctlOf(inp);
      const p2 = inp.players?.[1];
      const cc = versus ? (p2 ? ctlOf(p2) : { ...NO_CTL }) : aiCtl(dt);
      stepFighter(P, C, pc, dt);
      stepFighter(C, P, cc, dt);
      separate();
      stepFx(dt);
      if (P.ko || C.ko || clock <= 0) endRound();
    },
    render() {
      if (phase === 'select') { if (versus) renderSelectVs(); else renderSelect(); return; }
      g.save();
      if (shake > 0 && !ctx.reducedMotion) {
        const k = Math.min(1, shake / 0.12);
        g.translate(Math.sin(time * 90) * shakeAmp * k, Math.cos(time * 77) * shakeAmp * 0.6 * k);
      }
      renderArena();
      const order = P.atk ? [C, P] : [P, C];
      for (const f of order) {
        g.fillStyle = 'rgba(0,0,0,0.16)';
        const air = Math.max(0, GROUND - f.y);
        g.beginPath(); g.ellipse(f.x, GROUND + 2, Math.max(12, 26 - air * 0.08), 6, 0, 0, Math.PI * 2); g.fill();
        drawFighter(f, f === P ? C : P);
      }
      for (const e of fx) drawFx(e);
      for (const s of sparks) {
        const k = s.t / 0.25;
        g.strokeStyle = s.big ? PAL.gold : '#fffaf0';
        g.lineWidth = 3;
        const n = ctx.reducedMotion ? 4 : 8;
        const r0 = 6 + (1 - k) * (s.big ? 24 : 15);
        g.beginPath();
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          g.moveTo(s.x + Math.cos(a) * r0 * 0.5, s.y + Math.sin(a) * r0 * 0.5);
          g.lineTo(s.x + Math.cos(a) * r0, s.y + Math.sin(a) * r0);
        }
        g.stroke();
      }
      for (const s of stars) drawStar(s);
      for (const p of pops) {
        const k = p.t / p.life;
        const sc = k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : 1.2 - Math.min(0.2, (k - 0.15));
        g.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
        g.save();
        g.translate(p.x, p.y - ease(Math.min(1, k * 1.4)) * 30);
        g.scale(sc, sc);
        g.font = `800 ${p.size}px 'Alegreya Sans', system-ui, sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 4; g.strokeStyle = 'rgba(29,42,35,0.85)'; g.lineJoin = 'round';
        g.strokeText(p.s, 0, 0);
        g.fillStyle = p.color; g.fillText(p.s, 0, 0);
        g.restore();
        g.globalAlpha = 1;
      }
      g.restore();
      renderHud();
      renderBanner();
    },
    snapshot: () => ({
      phase, versus, sel, sel2, ready: [...ready], selId: cast[sel]?.id, opIdx, round, pWins, cWins, clock: Math.round(clock * 100) / 100, score,
      opponents: opponents.map((o) => o.id),
      p: fsnap(P), c: fsnap(C), hitstop: hitstopF, frozen: frozenFrames, pops: pops.length, stars: stars.length,
      fx: fx.map((e) => e.kind), hits: hits.slice(-10), specials: [...specials],
    }),
  };

  function fsnap(f: Fighter) {
    return {
      id: f.c.id, x: Math.round(f.x * 10) / 10, y: Math.round(f.y * 10) / 10, hp: Math.round(f.hp * 100) / 100, meter: Math.round(f.meter), face: f.face,
      atk: f.atk?.kind ?? null, atkT: f.atk ? Math.round(f.atk.t * 1000) / 1000 : 0, jab: f.atk?.jab ?? 0,
      stun: f.stun > 0, guard: f.guard, ko: f.ko, flash: f.flash > 0, combo: f.combo,
    };
  }

  // ---- fighter rig: drawn here (not via drawChar) so every attack has its own
  // anticipation, full extension and recovery keyframes.
  interface Rig { lean: number; armF: number; extF: number; armB: number; legF: number; legB: number; extL: number; crouch: number; sx: number; sy: number; hurt: boolean; grin: boolean; trail: number; extB?: number }

  function rigOf(f: Fighter): Rig {
    const r: Rig = { lean: 0.04, armF: -2.15, extF: 0, armB: -1.85, legF: -0.18, legB: 0.22, extL: 0, crouch: 0, sx: 1, sy: 1, hurt: false, grin: false, trail: 0 };
    const breath = Math.sin(time * 5 + (f === P ? 0 : 1.7));
    r.sy = 1 + breath * 0.012; r.sx = 1 - breath * 0.012;
    if (f.ko) { r.hurt = true; r.armF = -2.6; r.armB = 2.4; return r; }
    if (f.win) { r.armF = -2.9; r.armB = 2.9; r.grin = true; r.lean = -0.04; r.sy = 1 + Math.abs(Math.sin(time * 8)) * 0.04; return r; }
    if (f.stun > 0) {
      const k = Math.min(1, f.stun / 0.3);
      r.hurt = true; r.lean = -0.28 * k; r.armF = -0.5; r.armB = 0.9; r.legF = 0.25; r.legB = -0.1; r.sx = 1 + 0.06 * k; r.sy = 1 - 0.06 * k;
      return r;
    }
    if (f.blockstun > 0 || (f.guard && f.y >= GROUND)) {
      r.armF = -2.55; r.armB = -2.35; r.extF = -6; r.crouch = 6; r.lean = -0.1;
      if (f.blockstun > 0) { r.sx = 1.05; r.sy = 0.95; }
      return r;
    }
    const a = f.atk;
    if (a && a.kind !== 'special') {
      const s = ATK[a.kind];
      const t = a.t;
      // three keyframes: wind up, snap to full extension, ease back to stance
      let k: number, phaseK: 'wind' | 'hit' | 'back';
      if (t < s.s) { phaseK = 'wind'; k = t / s.s; } else if (t < s.s + s.a) { phaseK = 'hit'; k = 1; } else { phaseK = 'back'; k = 1 - ease(Math.min(1, (t - s.s - s.a) / s.r)); }
      if (a.kind === 'punch') {
        const alt = a.jab % 2 === 1;
        if (phaseK === 'wind') {
          r.lean = lerp(0.04, -0.12, k); r.armF = lerp(-2.15, -0.55, k); r.extF = lerp(0, -6, k); r.sx = 1 - 0.05 * k; r.sy = 1 + 0.03 * k;
        } else {
          r.lean = lerp(0.04, 0.2, k); r.armF = lerp(-2.15, -Math.PI / 2 + (alt ? 0.12 : 0), k); r.extF = lerp(0, 22, k);
          r.armB = lerp(-1.85, 0.7, k); r.sx = 1 + 0.07 * k; r.sy = 1 - 0.04 * k; r.legB = lerp(0.22, 0.45, k); r.trail = phaseK === 'hit' ? 1 : 0;
        }
        if (alt) { const tmp = r.armF; r.armF = r.armB; r.armB = tmp; const e = r.extF; r.extF = 0; r.extB = e; }
      } else {
        if (phaseK === 'wind') {
          r.lean = lerp(0.04, -0.1, k); r.legF = lerp(-0.18, -0.9, k); r.extL = lerp(0, -8, k); r.armF = -2.4; r.armB = -1.4; r.sy = 1 - 0.05 * k; r.crouch = 4 * k;
        } else {
          r.lean = lerp(0.04, -0.26, k); r.legF = lerp(-0.18, -1.62, k); r.extL = lerp(0, 14, k); r.armF = lerp(-2.15, -2.7, k); r.armB = lerp(-1.85, 0.9, k);
          r.legB = lerp(0.22, 0.12, k); r.trail = phaseK === 'hit' ? 2 : 0;
        }
      }
      return r;
    }
    if (a && a.kind === 'special') {
      const k = Math.min(1, a.t / SPECIAL_START);
      if (a.t < SPECIAL_START) { r.lean = -0.16 * k; r.armF = lerp(-2.15, -0.2, k); r.armB = lerp(-1.85, -0.4, k); r.sx = 1 - 0.06 * k; r.sy = 1 + 0.05 * k; }
      else { r.lean = 0.18; r.armF = -Math.PI / 2 - 0.2; r.armB = -Math.PI / 2 + 0.2; r.extF = 16; r.grin = true; r.sx = 1.06; r.sy = 0.96; }
      return r;
    }
    if (f.y < GROUND) {
      const up = f.vy < 0;
      r.legF = up ? -0.7 : -0.3; r.legB = up ? 0.6 : 0.3; r.extL = up ? -6 : 0; r.armF = -2.3; r.armB = up ? -2.6 : -1.2;
      r.sx = up ? 0.92 : 1; r.sy = up ? 1.08 : 1;
      return r;
    }
    if (f.crouch) { r.crouch = 14; r.armF = -2.2; r.armB = -1.9; r.sx = 1.05; r.sy = 0.96; return r; }
    if (f.land > 0) { const k = f.land / 0.12; r.sx = 1 + 0.12 * k; r.sy = 1 - 0.12 * k; }
    if (f.walk) {
      const wv = Math.sin(time * 13);
      r.legF = -0.18 + wv * 0.5; r.legB = 0.22 - wv * 0.5; r.armB = -1.85 + wv * 0.2; r.lean = 0.08;
    }
    return r;
  }

  function drawRig(c: CastMember, x: number, y: number, hh: number, face: 1 | -1, r: Rig, mono: string | null) {
    const u = hh / 100;
    const col = (s: string) => mono ?? s;
    g.save();
    g.translate(x, y);
    g.scale(face, 1);
    g.scale(r.sx, r.sy);
    const cr = r.crouch * u;
    const leg = (dx: number, swing: number, ext: number) => {
      g.save();
      g.translate(dx * u, -34 * u + cr);
      g.rotate(swing);
      const len = (28 + ext) * u - cr * 0.6;
      g.fillStyle = col(c.bottom);
      g.fillRect(-5 * u, 0, 10 * u, len);
      g.fillStyle = col(c.shoes);
      g.fillRect(-6 * u, len - 2 * u, 14 * u, 6 * u);
      g.restore();
    };
    leg(-5, r.legB, 0);
    leg(6, r.legF, r.extL);
    g.translate(0, cr - 34 * u);
    g.rotate(r.lean);
    g.translate(0, 34 * u);
    g.fillStyle = col(c.main);
    roundRect(g, -14 * u, -64 * u, 28 * u, 32 * u, 6 * u);
    g.fillStyle = col(c.inner);
    g.fillRect(-4 * u, -62 * u, 8 * u, 16 * u);
    g.fillStyle = col(c.accent);
    g.fillRect(-14 * u, -36 * u, 28 * u, 4 * u);
    const arm = (dx: number, ang: number, ext: number, fist: boolean) => {
      g.save();
      g.translate(dx * u, -60 * u);
      g.rotate(ang);
      g.fillStyle = col(c.main);
      g.fillRect(-4 * u, 0, 8 * u, (20 + ext) * u);
      g.fillStyle = col(c.skin);
      g.beginPath();
      g.arc(0, (22 + ext) * u, (fist ? 5.8 : 4.5) * u, 0, Math.PI * 2);
      g.fill();
      g.restore();
    };
    arm(-11, r.armB, r.extB ?? 0, (r.extB ?? 0) > 8);
    const hy = -84 * u;
    g.fillStyle = col(c.skin);
    g.beginPath(); g.ellipse(2 * u, hy, 20 * u, 21 * u, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = col(c.hair);
    g.beginPath(); g.ellipse(0, hy - 7 * u, 21 * u, 16 * u, 0, Math.PI, Math.PI * 2); g.fill();
    g.fillRect(-21 * u, hy - 8 * u, 10 * u, 12 * u);
    const hs = c.hairStyle;
    if (/long|bob|ponytail|bun/.test(hs)) g.fillRect(-21 * u, hy - 4 * u, 12 * u, (/long/.test(hs) ? 30 : 18) * u);
    if (/ponytail/.test(hs)) { g.beginPath(); g.ellipse(-24 * u, hy + 4 * u, 6 * u, 14 * u, 0.3, 0, Math.PI * 2); g.fill(); }
    if (/bun/.test(hs)) { g.beginPath(); g.arc(-6 * u, hy - 24 * u, 8 * u, 0, Math.PI * 2); g.fill(); }
    if (/tuft|spike|messy/.test(hs)) { g.beginPath(); g.moveTo(-2 * u, hy - 20 * u); g.lineTo(6 * u, hy - 32 * u); g.lineTo(10 * u, hy - 18 * u); g.fill(); }
    if (!mono) {
      g.fillStyle = '#2b211c';
      if (r.hurt) {
        g.lineWidth = 2 * u; g.strokeStyle = '#2b211c';
        g.beginPath();
        g.moveTo(8 * u, hy - 3 * u); g.lineTo(14 * u, hy + 3 * u);
        g.moveTo(14 * u, hy - 3 * u); g.lineTo(8 * u, hy + 3 * u);
        g.stroke();
      } else {
        g.beginPath(); g.ellipse(11 * u, hy, 2.6 * u, (r.trail ? 2.4 : 4) * u, 0, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = '#b5523b';
      g.fillRect(9 * u, hy + 9 * u, (r.grin || r.trail ? 8 : 5) * u, (r.trail ? 3 : 2) * u);
    }
    arm(9, r.armF, r.extF, r.extF > 8);
    g.restore();
  }

  function drawFighter(f: Fighter, o: Fighter) {
    void o;
    if (f.ko) {
      g.save();
      g.translate(f.x, f.y);
      g.rotate(-f.face * Math.PI / 2 * Math.min(1, (GROUND - f.y < 1 ? 1 : 0.6)));
      g.translate(0, -10);
      drawChar(g, f.c, 0, 0, CH, f.face, 'ko', time);
      g.restore();
      return;
    }
    const r = rigOf(f);
    // motion smear on the active frames of a blow
    if (r.trail && !ctx.reducedMotion) {
      g.save();
      g.globalAlpha = 0.35;
      g.strokeStyle = '#fffaf0';
      g.lineWidth = 10; g.lineCap = 'round';
      const yy = f.y - (r.trail === 1 ? 70 : 32);
      g.beginPath(); g.moveTo(f.x + f.face * 12, yy); g.lineTo(f.x + f.face * (r.trail === 1 ? 62 : 82), yy - (r.trail === 1 ? 4 : 8)); g.stroke();
      g.restore();
    }
    drawRig(f.c, f.x, f.y, CH, f.face, r, null);
    if (f.flash > 0) {
      g.save();
      g.globalAlpha = 0.85;
      drawRig(f.c, f.x, f.y, CH, f.face, r, '#ffffff');
      g.restore();
    }
  }

  function drawStar(s: Star) {
    const k = s.t / s.life;
    g.save();
    g.globalAlpha = 1 - k * k;
    g.translate(s.x, s.y);
    g.rotate(s.rot);
    g.fillStyle = s.c;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 ? s.r * 0.45 : s.r;
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      if (i) g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
    g.restore();
  }

  // ---- drawing ----
  function slotAt(x: number, y: number) {
    if (y < 268 || y > 352) return -1;
    const i = Math.floor((x - 8) / 70);
    return i >= 0 && i < cast.length && (x - 8) % 70 <= 64 ? i : -1;
  }

  function renderSelect() {
    g.fillStyle = PAL.bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = PAL.green;
    g.fillRect(0, 0, w, 50);
    text(g, ctx.t('Pilih Karakter'), w / 2, 26, 26, PAL.surface);
    const c = cast[sel];
    g.fillStyle = PAL.sand;
    roundRect(g, 40, 62, 220, 196, 14);
    g.fillStyle = 'rgba(0,0,0,0.14)';
    g.beginPath(); g.ellipse(150, 246, 50, 9, 0, 0, Math.PI * 2); g.fill();
    drawChar(g, c, 150, 246, 170, 1, Math.floor(time * 1.2) % 3 === 2 ? 'special' : 'idle', time);
    text(g, c.name, 290, 86, 30, PAL.ink, 'left', 800);
    text(g, ctx.t(c.role), 290, 116, 16, PAL.ink2, 'left', 600);
    const sp = SP[SPECIAL_OF[c.id] ?? 'dasi'];
    text(g, ctx.t('Jurus khas: {n}', { n: sp.name }), 290, 152, 18, PAL.accent, 'left', 800);
    text(g, sp.desc, 290, 178, 15, PAL.ink, 'left', 600);
    text(g, ctx.t('{lr}: pilih · {a}: konfirmasi', { lr: ctx.key('lr'), a: ctx.key('a') }), 290, 222, 15, PAL.ink2, 'left', 600);
    for (let i = 0; i < cast.length; i++) {
      const x = 8 + i * 70;
      g.fillStyle = i === sel ? PAL.accent : 'rgba(29,42,35,0.18)';
      roundRect(g, x - 3, 265, 70, 90, 10);
      g.fillStyle = i === sel ? PAL.surface : PAL.sand;
      roundRect(g, x, 268, 64, 84, 8);
      drawChar(g, cast[i], x + 32, 332, 58, 1, 'idle', i === sel ? time : 0);
      text(g, cast[i].name, x + 32, 343, 11, PAL.ink, 'center', 800);
    }
  }

  function renderSelectVs() {
    g.fillStyle = PAL.bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = PAL.green;
    g.fillRect(0, 0, w, 50);
    text(g, ctx.t('Pilih Karakter · Berdua'), w / 2, 26, 26, PAL.surface);
    const clip = (s: string, maxW: number, size: number, weight = 600) => {
      g.font = `${weight} ${size}px 'Alegreya Sans', system-ui, sans-serif`;
      if (g.measureText(s).width <= maxW) return s;
      let t = s;
      while (t.length > 3 && g.measureText(t + '...').width > maxW) t = t.slice(0, -1);
      return t + '...';
    };
    const side = (k: 0 | 1) => {
      const c = cast[k === 0 ? sel : sel2];
      const x0 = k === 0 ? 20 : 330;
      g.fillStyle = PAL.sand;
      roundRect(g, x0, 60, 290, 198, 14);
      g.fillStyle = PLAYER_COLORS[k];
      roundRect(g, x0 + 10, 68, 92, 24, 8);
      text(g, ctx.t('Pemain {n}', { n: k + 1 }), x0 + 56, 81, 14, '#fffaf0', 'center', 800);
      g.fillStyle = 'rgba(0,0,0,0.14)';
      g.beginPath(); g.ellipse(x0 + 76, 246, 42, 8, 0, 0, Math.PI * 2); g.fill();
      drawChar(g, c, x0 + 76, 246, 140, k === 0 ? 1 : -1, ready[k] ? 'special' : 'idle', time);
      text(g, clip(c.name, 132, 22, 800), x0 + 150, 112, 22, PAL.ink, 'left', 800);
      text(g, clip(ctx.t(c.role), 132, 13), x0 + 150, 136, 13, PAL.ink2, 'left', 600);
      text(g, clip(SP[SPECIAL_OF[c.id] ?? 'dasi'].name, 132, 13, 800), x0 + 150, 162, 13, PAL.accent, 'left', 800);
      text(g, ready[k] ? ctx.t('Siap! ({b}: ganti)', { b: ctx.key('b', k > 0) }) : ctx.t('{lr}, lalu {a}', { lr: ctx.key('lr', k > 0), a: ctx.key('a', k > 0) }), x0 + 150, 226, 14, ready[k] ? PLAYER_COLORS[k] : PAL.ink2, 'left', 800);
    };
    side(0); side(1);
    for (let i = 0; i < cast.length; i++) {
      const x = 8 + i * 70;
      const mine = [i === sel, i === sel2];
      g.fillStyle = mine[0] && mine[1] ? PAL.gold : mine[0] ? PLAYER_COLORS[0] : mine[1] ? PLAYER_COLORS[1] : 'rgba(29,42,35,0.18)';
      roundRect(g, x - 3, 265, 70, 90, 10);
      g.fillStyle = mine[0] || mine[1] ? PAL.surface : PAL.sand;
      roundRect(g, x, 268, 64, 84, 8);
      drawChar(g, cast[i], x + 32, 332, 58, 1, 'idle', mine[0] || mine[1] ? time : 0);
      text(g, cast[i].name, x + 32, 343, 11, PAL.ink, 'center', 800);
      if (mine[0]) text(g, '1', x + 10, 278, 12, PLAYER_COLORS[0], 'center', 800);
      if (mine[1]) text(g, '2', x + 54, 278, 12, PLAYER_COLORS[1], 'center', 800);
    }
  }

  function renderArena() {
    g.fillStyle = '#eadfc8';
    g.fillRect(-20, -20, w + 40, GROUND + 20);
    for (let i = 0; i < 3; i++) {
      const x = 70 + i * 190;
      g.fillStyle = '#8a7a63';
      roundRect(g, x - 4, 66, 148, 118, 6);
      g.fillStyle = PAL.sky;
      g.fillRect(x, 70, 140, 110);
      g.fillStyle = '#d7ecef';
      g.fillRect(x + 8, 140, 40, 40); g.fillRect(x + 60, 126, 30, 54); g.fillRect(x + 100, 148, 34, 32);
      g.fillStyle = '#8a7a63';
      g.fillRect(x + 68, 70, 4, 110);
      g.fillRect(x, 122, 140, 4);
    }
    g.fillStyle = '#c9b48f';
    g.fillRect(-20, 200, w + 40, 6);
    for (const dx of [40, 330]) {
      g.fillStyle = '#9b7b55';
      g.fillRect(dx, 248, 200, 12);
      g.fillRect(dx + 10, 260, 8, GROUND - 260); g.fillRect(dx + 182, 260, 8, GROUND - 260);
      g.fillStyle = '#2f3a36';
      roundRect(g, dx + 30, 216, 52, 32, 3);
      g.fillStyle = '#7fb3c8';
      g.fillRect(dx + 34, 220, 44, 22);
      g.fillStyle = '#2f3a36';
      g.fillRect(dx + 52, 246, 8, 4);
      g.fillStyle = PAL.surface;
      g.fillRect(dx + 120, 240, 40, 8);
      g.fillStyle = PAL.accent;
      g.fillRect(dx + 170, 236, 10, 12);
    }
    g.fillStyle = PAL.grass;
    g.beginPath(); g.ellipse(606, 250, 20, 30, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#9b5a3c';
    g.fillRect(594, 274, 24, 22);
    g.fillStyle = '#c7ae86';
    g.fillRect(-20, GROUND, w + 40, h - GROUND + 20);
    g.strokeStyle = 'rgba(80,60,40,0.18)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x < w + 40; x += 64) { g.moveTo(x, GROUND); g.lineTo(x - 20, h); }
    g.moveTo(0, GROUND + 18); g.lineTo(w, GROUND + 18);
    g.stroke();
  }

  function renderHud() {
    const bar = (x: number, f: Fighter, right: boolean) => {
      g.fillStyle = PAL.ink;
      roundRect(g, x - 2, 10, 264, 20, 6);
      g.fillStyle = '#5a2a1e';
      g.fillRect(x, 12, 260, 16);
      const ww = 260 * (f.hp / 100);
      g.fillStyle = f.hp > 30 ? PAL.gold : PAL.red;
      g.fillRect(right ? x + 260 - ww : x, 12, ww, 16);
      text(g, f.c.name, right ? x + 260 : x, 42, 15, PAL.ink, right ? 'right' : 'left', 800);
      const mx = right ? x + 100 : x;
      g.fillStyle = PAL.ink;
      roundRect(g, mx - 2, h - 18, 164, 12, 4);
      g.fillStyle = f.meter >= 100 ? PAL.blue : '#7c8f9b';
      const mw = 160 * (f.meter / 100);
      g.fillRect(right ? mx + 160 - mw : mx, h - 16, mw, 8);
    };
    bar(14, P, false);
    bar(366, C, true);
    if (P.meter >= 100) text(g, ctx.t('Jurus siap ({x})', { x: ctx.key('x') }), 14, h - 28, 13, PAL.ink, 'left', 800);
    if (C.meter >= 100) text(g, versus ? ctx.t('Jurus siap ({x})', { x: ctx.key('x', true) }) : ctx.t('Jurus siap'), 626, h - 28, 13, PAL.ink, 'right', 800);
    g.fillStyle = PAL.green;
    roundRect(g, 296, 6, 48, 40, 8);
    text(g, String(Math.ceil(clock)), 320, 27, 22, PAL.surface, 'center', 800);
    for (let i = 0; i < 2; i++) {
      g.fillStyle = i < pWins ? PAL.gold : 'rgba(29,42,35,0.25)';
      g.beginPath(); g.arc(282 - i * 12, 42, 4.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = i < cWins ? PAL.gold : 'rgba(29,42,35,0.25)';
      g.beginPath(); g.arc(358 + i * 12, 42, 4.5, 0, Math.PI * 2); g.fill();
    }
    if (versus) {
      text(g, 'P1', 14, 58, 12, PLAYER_COLORS[0], 'left', 800);
      text(g, 'P2', 626, 58, 12, PLAYER_COLORS[1], 'right', 800);
    } else text(g, ctx.t('Lawan {n}/3', { n: opIdx + 1 }), 320, 58, 12, PAL.ink2, 'center', 700);
  }

  function renderBanner() {
    let big = '', small = '';
    if (phase === 'intro') {
      big = timer > 0.5 ? ctx.t('Ronde {n}', { n: round }) : ctx.t('Mulai!');
      small = round === 1 && timer > 0.5 ? ctx.t('{a} melawan {b}', { a: P.c.name, b: C.c.name }) : '';
    } else if (phase === 'roundEnd') {
      big = banner;
    } else if (phase === 'matchEnd' || phase === 'over') {
      if (versus) {
        big = ctx.t('Pemain {n} menang!', { n: matchWon ? 1 : 2 });
        small = (matchWon ? P : C).c.name;
      } else {
        big = matchWon ? (opIdx >= 2 ? ctx.t('Juara!') : ctx.t('Kamu menang!')) : ctx.t('Kamu kalah');
        small = ctx.t('{s} poin', { s: score });
      }
    }
    if (!big) return;
    g.fillStyle = 'rgba(29,42,35,0.82)';
    roundRect(g, 120, 108, 400, small ? 84 : 58, 14);
    text(g, big, w / 2, 137, big.length > 24 ? 22 : 30, PAL.surface, 'center', 800);
    if (small) text(g, small, w / 2, 172, 16, PAL.gold, 'center', 700);
  }

  function drawFx(e: Fx) {
    const ownerC = (e.owner === 0 ? P : C).c;
    g.save();
    g.translate(e.x, e.y);
    switch (e.kind) {
      case 'kabel': {
        g.rotate(e.t * 12 * e.face);
        g.strokeStyle = '#e07a2a'; g.lineWidth = 5;
        g.beginPath(); g.arc(0, 0, 12, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = '#2b2b2b'; g.lineWidth = 2;
        g.beginPath(); g.arc(0, 0, 7, 0, Math.PI * 1.5); g.stroke();
        g.beginPath(); g.moveTo(12, 0); g.lineTo(22, 6); g.stroke();
        break;
      }
      case 'wifi': {
        g.scale(e.face, 1);
        g.strokeStyle = PAL.blue; g.lineWidth = 4;
        for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(-14, 0, 8 + i * 8, -0.8, 0.8); g.stroke(); }
        g.fillStyle = PAL.blue; g.beginPath(); g.arc(-14, 0, 3.5, 0, Math.PI * 2); g.fill();
        break;
      }
      case 'pensil': {
        g.scale(e.face, 1);
        g.fillStyle = ownerC.accent; g.fillRect(-17, -4, 26, 8);
        g.fillStyle = '#f2d7a6'; g.beginPath(); g.moveTo(9, -4); g.lineTo(17, 0); g.lineTo(9, 4); g.fill();
        g.fillStyle = '#e88aa0'; g.fillRect(-21, -4, 4, 8);
        break;
      }
      case 'drone': {
        g.fillStyle = '#3a4a52'; roundRect(g, -12, -6, 24, 12, 4);
        g.fillStyle = PAL.gold; g.beginPath(); g.arc(e.face * 8, 0, 3, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#3a4a52'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(-12, -6); g.lineTo(-14, -11); g.moveTo(12, -6); g.lineTo(14, -11); g.stroke();
        const sp = Math.abs(Math.sin(e.t * 40)) * 9 + 2;
        g.fillStyle = 'rgba(58,74,82,0.5)';
        g.fillRect(-14 - sp, -13, sp * 2, 3); g.fillRect(14 - sp, -13, sp * 2, 3);
        break;
      }
      case 'kuas': {
        g.scale(e.face, 1);
        const k = Math.min(1, e.t / 0.12);
        g.strokeStyle = ownerC.accent; g.lineWidth = 16; g.lineCap = 'round';
        g.beginPath(); g.arc(-30, 0, 44, -1.1, -1.1 + 2.2 * k); g.stroke();
        g.lineCap = 'butt';
        g.fillStyle = '#9b7b55'; g.fillRect(-40, -6, 24, 6);
        break;
      }
      case 'penggaris': {
        g.scale(e.face, 1);
        const k = Math.min(1, e.t / 0.08);
        g.fillStyle = '#d9b36c';
        g.fillRect(-75 - 75 * (1 - k), -5, 150 * k + 4, 10);
        g.fillRect(-79 - 75 * (1 - k), -18, 8, 36);
        g.fillStyle = '#6b5332';
        for (let i = 0; i < 12; i++) g.fillRect(-70 - 75 * (1 - k) + i * 12 * k, -5, 1.5, 5);
        break;
      }
      case 'clipboard': {
        const a = e.t * 22;
        for (const s of [0, Math.PI]) {
          const px = Math.cos(a + s) * 52, py = Math.sin(a + s) * 16;
          g.save(); g.translate(px, py); g.rotate(a * 1.5);
          g.fillStyle = '#9b6b3e'; g.fillRect(-11, -14, 22, 28);
          g.fillStyle = PAL.surface; g.fillRect(-8, -9, 16, 20);
          g.fillStyle = '#7a7a7a'; g.fillRect(-5, -16, 10, 5);
          g.restore();
        }
        break;
      }
      case 'stempel': {
        if (e.delay > 0) {
          g.fillStyle = 'rgba(184,69,46,0.25)';
          g.beginPath(); g.ellipse(0, GROUND - e.y + 2, 30, 6, 0, 0, Math.PI * 2); g.fill();
        }
        g.fillStyle = '#5a3a24'; g.fillRect(-7, -38, 14, 22);
        g.beginPath(); g.arc(0, -40, 10, 0, Math.PI * 2); g.fill();
        g.fillStyle = PAL.red; roundRect(g, -30, -16, 60, 30, 4);
        text(g, ctx.t('REJECT'), 0, -1, 13, PAL.surface, 'center', 800);
        break;
      }
      case 'dasi': {
        g.scale(e.face, 1);
        const k = Math.min(1, e.t / 0.12);
        g.strokeStyle = 'rgba(163,74,39,0.5)'; g.lineWidth = 4;
        for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(-10 + i * 10, 0, 20 + i * 12 * k, -0.9, 0.9); g.stroke(); }
        g.fillStyle = ownerC.accent;
        g.beginPath(); g.moveTo(-34, -8); g.lineTo(-34 + 50 * k, -4); g.lineTo(-24 + 50 * k, 0); g.lineTo(-34 + 50 * k, 4); g.lineTo(-34, 8); g.fill();
        break;
      }
    }
    g.restore();
  }
}

export default { meta, create } satisfies GameModule;
