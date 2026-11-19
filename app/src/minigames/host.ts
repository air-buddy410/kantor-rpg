// Mini game host (PRD v2.0 REQ-MG). Full-screen layer over the 3D office:
// intro card, letterboxed canvas, pause, result card with a local top-10, and
// one input layer for keyboard, touch and gamepad. Lazy chunk: the office
// imports it only when a facility or the Game Station is used.
import './minigames.css';
import { t } from '../i18n';
import { sound } from '../audio';
import { buildCast } from './cast';
import { GAMES } from './registry';
import { BTNS, type Btn, type GameInstance, type GameMeta, type GameModule, type GameResult, type InputState, type LegendKey, type PadAnalog } from './types';
import { PAD_PROFILES, faceButtons, stickAxes, type PadProfile } from '../input/pad-profiles';
import { PadActivity, currentDevice, currentPadKind, setDevice, trackDevices, type Device } from '../input/mode';
import { keyChips, keyText, renderLegend, richLine } from '../input/legend';
import type { PadProfileId } from '../ui/settings';
import { PLAYER_COLORS, PadPlayer, connectedPads, isPhonePad } from './local-players';

export interface HostOpts {
  reducedMotion: boolean;
  padProfile: () => PadProfileId;
  /** Stick aim speed in percent from Settings (default 100). */
  aimSpeed?: () => number;
  playerName: string;
  /** Called after the layer closes (the office resumes). */
  onClose: (r: GameResult | null) => void;
  seed?: number;
}

// ---- local leaderboard -------------------------------------------------------
const SCORE_KEY = 'kantor-rpg.scores.v1';
export interface ScoreRow { name: string; score: number; at: string }
export function loadScores(): Record<string, ScoreRow[]> {
  try { return JSON.parse(localStorage.getItem(SCORE_KEY) ?? '{}') as Record<string, ScoreRow[]>; } catch { return {}; }
}
export function addScore(meta: GameMeta, row: ScoreRow): { rank: number; list: ScoreRow[] } {
  const all = loadScores();
  const list = [...(all[meta.id] ?? []), row];
  list.sort((a, b) => (meta.score.higherIsBetter ? b.score - a.score : a.score - b.score));
  const top = list.slice(0, 10);
  all[meta.id] = top;
  try { localStorage.setItem(SCORE_KEY, JSON.stringify(all)); } catch { /* storage blocked: board lasts this visit */ }
  return { rank: top.indexOf(row) + 1, list: top };
}
export function formatScore(meta: GameMeta, v: number): string {
  if (meta.score.time) { const s = Math.max(0, v); return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; }
  return `${Math.round(v)} ${t(meta.score.unit)}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const KEYMAP: Record<string, Btn> = {
  arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down',
  ' ': 'a', enter: 'a', e: 'a', j: 'a', k: 'b', shift: 'b', backspace: 'b', l: 'x', x: 'x', i: 'y', c: 'y',
};
const BTN_LABEL: Record<Btn, string> = { left: '◀', right: '▶', up: '▲', down: '▼', a: 'A', b: 'B', x: 'X', y: 'Y' };

type Phase = 'loading' | 'intro' | 'play' | 'pause' | 'result' | 'error';

// Button list order in the tutorial; pad-only rows (sticks, triggers) follow on a pad.
const ACTION_ORDER: LegendKey[] = ['arah', 'lr', 'ud', 'left', 'right', 'up', 'down', 'a', 'b', 'x', 'y'];
const PAD_ORDER: LegendKey[] = ['ls', 'rs', 'l1', 'r1', 'l2', 'r2'];

export class MiniGameHost {
  readonly root: HTMLElement;
  private canvas = el('canvas', { class: 'mg-canvas', 'aria-label': '' });
  private g: CanvasRenderingContext2D;
  private bar = el('div', { class: 'mg-bar' });
  private hudEl = el('span', { class: 'mg-hud', 'aria-live': 'off' });
  private titleEl = el('h2', { class: 'mg-title', id: 'mg-title' });
  private card = el('div', { class: 'mg-card', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'mg-card-title' });
  private touch = el('div', { class: 'mg-touch' });
  /** Button legend under the canvas, in the glyphs of the device in use. */
  private legend = el('ul', { class: 'mg-legend', 'aria-label': t('Tombol game') });
  private padSeen = new PadActivity();
  /** Redraws the open card's tutorial when the device changes; null when no tutorial is shown. */
  private tutRefresh: (() => void) | null = null;
  private muteBtn = el('button', { type: 'button', class: 'btn mg-mute', 'aria-pressed': 'false' });
  private mod: GameModule | null = null;
  private inst: GameInstance | null = null;
  private phase: Phase = 'loading';
  private keys = new Set<Btn>();
  private touchDown = new Set<Btn>();
  // Presses waiting for a 60 Hz game step, counted per button. A tap shorter
  // than a frame, a press on a 120 Hz frame that runs no step, and two quick
  // presses inside one slow frame each still reach the game, one per step.
  private queued = Object.fromEntries(BTNS.map((b) => [b, 0])) as Record<Btn, number>;
  /** Pad buttons held on the previous frame (edge detection for the pad). */
  private prevDown: Record<Btn, boolean> = Object.fromEntries(BTNS.map((b) => [b, false])) as Record<Btn, boolean>;
  private padPrev: boolean[] = [];
  private tap: { x: number; y: number } | null = null;
  private ptr: { x: number; y: number; down: boolean } | null = null;
  private device: Device = 'keyboard';
  private raf = 0;
  private last = 0;
  private acc = 0;
  private result: GameResult | null = null;
  private seed: number;
  private runs = 0;
  private hudText = '';
  private escHeld = false;
  /** Last frame state for tests (window.__kantor.minigame()). */
  frames = 0;
  /** Presses handed to the game per button (test hook: no press may get lost). */
  private delivered: Record<string, number> = {};
  /** Pemain 1's pad: a Gamepad.index, null = first connected, -1 = none yet (keyboard). */
  private p1Pad: number | null = null;
  /** Pemain 2..4, one pad each, joined on the intro card. */
  private extras: PadPlayer[] = [];
  /** A held on pads that have not joined (join on a fresh press only). */
  private lobbyPrev = new Map<number, boolean>();
  private lobbyEl: HTMLElement | null = null;
  /** Keyboard or touch used since the game opened: a late pad then joins as Pemain 2. */
  private localUsed = false;

  constructor(readonly gameId: string, private opts: HostOpts) {
    this.seed = opts.seed ?? (Date.now() >>> 0);
    this.root = el('section', { class: 'mg-host', id: 'mg-host', 'aria-labelledby': 'mg-title', 'data-game': gameId });
    this.g = this.canvas.getContext('2d')!;
    const close = el('button', { type: 'button', class: 'btn mg-close' }, t('Keluar'));
    close.addEventListener('click', () => this.close());
    const pause = el('button', { type: 'button', class: 'btn mg-pause' }, t('Jeda'));
    pause.addEventListener('click', () => this.togglePause());
    this.muteBtn.addEventListener('click', () => sound.with((e) => { e.toggleMute(); this.syncMute(); }));
    this.bar.append(this.titleEl, this.hudEl, this.muteBtn, pause, close);
    const stage = el('div', { class: 'mg-stage' });
    stage.append(this.canvas, this.card);
    this.root.append(this.bar, stage, this.legend, this.touch);
    trackDevices();
    this.canvas.addEventListener('pointerdown', (e) => { this.onTap(e); this.onPtr(e, true); if (this.phase === 'play') this.canvas.setPointerCapture?.(e.pointerId); });
    this.canvas.addEventListener('pointermove', (e) => this.onPtr(e, this.ptr?.down ?? false));
    this.canvas.addEventListener('pointerup', (e) => this.onPtr(e, false));
    this.canvas.addEventListener('pointercancel', (e) => this.onPtr(e, false));
    this.canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !this.ptr?.down) this.ptr = null; });
    this.syncMute();
    // Buttons already held when the game opens (the A that picked it in the
    // Game Station) must be released first, or they press "Mulai" at once.
    const held = this.readPad();
    for (const b of BTNS) this.prevDown[b] = !!held.down[b];
  }

  async open(): Promise<void> {
    document.body.append(this.root);
    document.documentElement.setAttribute('data-minigame', this.gameId);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('resize', this.fit);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('kantor:device', this.onDevice);
    this.showCard(t('Memuat permainan...'), [], []);
    const loader = GAMES[this.gameId];
    try {
      if (!loader) throw new Error(this.gameId);
      this.mod = (await loader()).default;
    } catch {
      this.phase = 'error';
      this.showCard(t('Permainan gagal dimuat.'), [t('Periksa koneksi, lalu coba lagi.')], [[t('Keluar'), () => this.close()]]);
      return;
    }
    const m = this.mod.meta;
    this.titleEl.textContent = t(m.title);
    this.canvas.setAttribute('aria-label', t(m.title));
    this.canvas.width = m.view.w;
    this.canvas.height = m.view.h;
    this.buildTouch(m);
    this.renderLegend();
    sound.music(m.music);
    this.intro();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private intro() {
    const m = this.mod!.meta;
    this.phase = 'intro';
    const best = loadScores()[m.id]?.[0];
    const lines = [t(m.blurb)];
    if (best) lines.push(t('Skor terbaik: {score} ({name})', { score: formatScore(m, best.score), name: best.name }));
    let extra: HTMLElement = this.tutorial();
    if ((m.players ?? 1) > 1) {
      if (this.p1Pad === null) this.p1Pad = connectedPads().find((q) => !isPhonePad(q))?.index ?? -1;
      this.lobbyEl = el('div', { class: 'mg-lobby', 'aria-live': 'polite' });
      this.renderLobby();
      const wrap = el('div');
      wrap.append(this.lobbyEl, extra);
      extra = wrap;
    }
    this.showCard(t(m.title), lines, [[t('Mulai'), () => this.start()], [t('Keluar'), () => this.close()]], extra);
  }

  /** B on a joined Pemain 2+ pad leaves the lobby (its seat opens again). */
  private lobbyLeave() {
    if (this.phase !== 'intro') return;
    const before = this.extras.length;
    this.extras = this.extras.filter((x) => { if (x.edge.b) { this.lobbyPrev.set(x.index, true); return false; } return true; });
    if (this.extras.length !== before) { sound.sfx('back'); this.renderLobby(); }
  }

  private maxPlayers(): number { return this.mod?.meta.players ?? 1; }
  /** "Gantian satu perangkat" ticked on the intro card (hot-seat games only). */
  private hotseat = false;
  private humans(): number { return 1 + this.extras.length + (this.hotseat && !this.extras.length ? 1 : 0); }

  /** Lobby rows: who plays, and how the next player joins. */
  private renderLobby() {
    const box = this.lobbyEl;
    const m = this.mod?.meta;
    if (!box || !m) return;
    box.replaceChildren(el('h4', {}, t('Pemain')));
    const list = el('ol', { class: 'mg-lobby-list' });
    const p1 = el('li', { 'data-p': '1' });
    p1.style.setProperty('--pc', PLAYER_COLORS[0]);
    p1.append(el('b', {}, t('Pemain {n}', { n: 1 })), el('span', {}, this.p1Pad !== null && this.p1Pad >= 0 ? t('Keyboard, layar sentuh, atau stik 1') : t('Keyboard atau layar sentuh')));
    list.append(p1);
    this.extras.forEach((_x, i) => {
      const li = el('li', { 'data-p': String(i + 2) });
      li.style.setProperty('--pc', PLAYER_COLORS[i + 1]);
      const s = el('span');
      s.append(...this.padLine(t('Stik {n} · {b} untuk batal', { n: i + 2 })));
      li.append(el('b', {}, t('Pemain {n}', { n: i + 2 })), s);
      list.append(li);
    });
    box.append(list);
    const free = this.maxPlayers() - 1 - this.extras.length;
    const note = el('p', { class: 'mg-lobby-note' });
    if (free > 0) note.append(...this.padLine(t('Mau main bareng? Sambungkan stik lain lalu tekan {a} untuk ikut (sampai {n} pemain).', { n: this.maxPlayers() })));
    else note.textContent = t('Semua tempat pemain sudah terisi.');
    box.append(note);
    if (m.playersHint) box.append(el('p', { class: 'mg-lobby-note' }, t(m.playersHint)));
    if (m.hotseat && !this.extras.length) {
      const lab = el('label', { class: 'mg-hotseat' });
      const cb = el('input', { type: 'checkbox', id: 'mg-hotseat' });
      cb.checked = this.hotseat;
      cb.addEventListener('change', () => { this.hotseat = cb.checked; });
      lab.append(cb, ` ${t('Gantian satu perangkat (2 pemain)')}`);
      box.append(lab);
    }
  }

  /** Intro card: pads that are not playing yet join with a fresh A; a joined Pemain 2+ leaves with B. */
  private lobbyPoll() {
    if (this.maxPlayers() < 2 || this.phase !== 'intro') return;
    let changed = false;
    for (let i = this.extras.length - 1; i >= 0; i--) {
      const x = this.extras[i];
      if (!x.connected) { this.extras.splice(i, 1); changed = true; }
    }
    const taken = new Set(this.extras.map((x) => x.index));
    for (const p of connectedPads()) {
      if (p.index === this.p1Pad || taken.has(p.index)) continue;
      const prof = PAD_PROFILES[this.opts.padProfile()] ?? PAD_PROFILES.standar;
      const a = !!p.buttons[faceButtons(prof).A]?.pressed;
      const was = this.lobbyPrev.get(p.index) ?? true;
      this.lobbyPrev.set(p.index, a);
      if (!a || was) continue;
      if (this.p1Pad === -1 && !this.localUsed && !isPhonePad(p)) { this.p1Pad = p.index; changed = true; continue; }
      if (this.extras.length < this.maxPlayers() - 1) {
        this.extras.push(new PadPlayer(p.index, this.opts.padProfile, () => this.opts.aimSpeed?.() ?? 100));
        // a phone shows the seat it got ("Pemain 3"), not its join order
        if (isPhonePad(p)) void import('../pad/virtual-pads').then((m) => m.currentPhoneLink()?.setSeat(p.index, this.extras.length + 1));
        sound.sfx('confirm');
        changed = true;
      }
    }
    if (changed) this.renderLobby();
  }

  private prof(): PadProfile { return PAD_PROFILES[this.opts.padProfile()] ?? PAD_PROFILES.standar; }

  /** A translated line with {a}, {b}... as gamepad glyphs (Pemain 2+ always play on a pad). */
  private padLine(s: string): (Node | string)[] { return richLine(s, 'pad', this.prof(), currentPadKind()); }

  /** Legend bar under the canvas: this game's buttons for the device in use, plus pause. */
  private renderLegend() {
    const m = this.mod?.meta;
    if (!m) return;
    const d = currentDevice();
    const prof = this.prof();
    const kind = currentPadKind();
    renderLegend(this.legend, d === 'pad' && m.padLegend ? m.padLegend : m.legend, d, prof, kind);
    if (d !== 'touch') {
      const li = el('li', { class: 'mg-legend-pause' });
      li.append(...(d === 'pad' ? keyChips('options', d, prof, kind) : [el('kbd', {}, 'Esc')]), el('span', {}, t('Jeda')));
      this.legend.append(li);
    }
    this.fit();
  }

  /** Device changed (pad pressed, key typed, screen touched): legend, tutorial and touch buttons follow. */
  private onDevice = () => {
    this.renderLegend();
    this.touch.hidden = currentDevice() === 'pad' || !this.coarse();
    if (this.tutRefresh) { this.device = currentDevice(); this.tutRefresh(); }
    this.fit();
  };

  private coarse() { return matchMedia('(pointer: coarse)').matches || matchMedia('(any-pointer: coarse)').matches; }

  /** Tutorial block: short steps, device tabs, then "button: what it does" rows for this game. */
  private tutorial(): HTMLElement {
    const m = this.mod!.meta;
    this.device = currentDevice();
    const box = el('div', { class: 'mg-tut' });
    const steps = el('ol', { class: 'mg-steps' });
    const tabs = el('div', { class: 'mg-tut-tabs', role: 'group', 'aria-label': t('Tombol untuk perangkat') });
    const list = el('dl', { class: 'mg-tut-list' });
    const note = el('p', { class: 'mg-tut-note' });
    const devs: [Device, string][] = [['keyboard', t('Keyboard')], ['pad', t('Stik game')], ['touch', t('Layar sentuh')]];
    const render = () => {
      const d = this.device;
      const prof = this.prof();
      const kind = currentPadKind();
      steps.replaceChildren();
      for (const line of d === 'pad' && m.padTutorial ? m.padTutorial : m.tutorial) {
        const li = el('li');
        li.append(...richLine(t(line), d, prof, kind));
        steps.append(li);
      }
      list.replaceChildren();
      const rows: [LegendKey, string][] = ACTION_ORDER.flatMap((k) => (m.actions?.[k as Btn | 'arah'] ? [[k, m.actions[k as Btn | 'arah']!] as [LegendKey, string]] : []));
      if (d === 'pad') for (const k of PAD_ORDER) { const v = m.padActions?.[k as keyof typeof m.padActions]; if (v) rows.push([k, v]); }
      for (const [k, what] of rows) {
        const dt = el('dt');
        dt.append(...keyChips(k, d, prof, kind, true));
        list.append(dt, el('dd', {}, t(what)));
      }
      note.replaceChildren(...(d === 'keyboard' ? [t('Esc atau P: jeda. M: suara.')]
        : d === 'pad' ? richLine(t('{options}: jeda. {create}: keluar dari kartu.'), d, prof, kind)
          : [m.pointerHint ? t(m.pointerHint) : t('Tombol Jeda ada di bilah atas.')]));
      for (const b of tabs.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.dev === d));
    };
    for (const [d, label] of devs) {
      const b = el('button', { type: 'button', class: 'btn mg-tut-tab', 'data-dev': d }, label);
      b.addEventListener('click', () => { this.device = d; render(); });
      tabs.append(b);
    }
    render();
    this.tutRefresh = render;
    box.append(el('h4', {}, t('Cara main')), steps, el('h4', { class: 'mg-tut-sub' }, t('Tombol')), tabs, list, note);
    return box;
  }

  private start() {
    const m = this.mod!;
    const seed = (this.seed + this.runs * 7919) >>> 0;
    this.runs++;
    this.result = null;
    this.inst?.dispose?.();
    const rand = mulberry32(seed);
    this.inst = m.create({
      canvas: this.canvas, g: this.g, w: m.meta.view.w, h: m.meta.view.h, rand, seed,
      t: (s, v) => t(s, v), sfx: (n, o) => sound.sfx(n, o), reducedMotion: this.opts.reducedMotion,
      key: (k, pad) => keyText(k, pad ? 'pad' : currentDevice(), this.prof(), currentPadKind()),
      rumble: (strength, ms) => this.rumble(strength, ms),
      cast: buildCast(), playerId: 'CH-CEO', players: this.humans(),
      end: (r) => { if (!this.result) { this.result = r; this.finish(r); } },
      setHud: (s) => { if (s !== this.hudText) { this.hudText = s; this.hudEl.textContent = s; } },
    });
    this.hideCard();
    this.phase = 'play';
    sound.sfx('start');
    this.canvas.focus?.();
  }

  private finish(r: GameResult) {
    const m = this.mod!.meta;
    this.phase = 'result';
    sound.sfx(r.won === false ? 'lose' : 'win');
    const lines: string[] = [];
    if (r.summary) lines.push(r.summary);
    let rank = 0;
    let list = r.versus ? [] : loadScores()[m.id] ?? [];
    if (r.score > 0 && !r.versus) ({ rank, list } = addScore(m, { name: this.opts.playerName, score: r.score, at: new Date().toISOString() }));
    if (!r.versus) lines.push(t('Skor: {score}', { score: formatScore(m, r.score) }));
    if (rank) lines.push(t('Peringkat {n} di papan skor perangkat ini.', { n: rank }));
    const board = el('ol', { class: 'mg-board', 'aria-label': t('Papan skor') });
    list.slice(0, 10).forEach((row, i) => {
      const li = el('li', i + 1 === rank ? { class: 'me' } : {});
      li.append(el('span', {}, row.name), el('span', {}, formatScore(m, row.score)));
      board.append(li);
    });
    this.showCard(r.won === false && !r.versus ? t('Belum berhasil') : t('Selesai!'), lines, [[t('Main lagi'), () => this.start()], [t('Keluar'), () => this.close(r)]], list.length ? board : null);
  }

  private togglePause() {
    if (this.phase === 'play') {
      this.phase = 'pause';
      this.showCard(t('Jeda'), [], [[t('Lanjut'), () => { this.hideCard(); this.phase = 'play'; this.last = performance.now(); }], [t('Ulang'), () => this.start()], [t('Keluar'), () => this.close()]], this.tutorial());
    } else if (this.phase === 'pause') {
      this.hideCard();
      this.phase = 'play';
      this.last = performance.now();
    }
  }

  close(r: GameResult | null = this.result) {
    cancelAnimationFrame(this.raf);
    this.inst?.dispose?.();
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('resize', this.fit);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('kantor:device', this.onDevice);
    document.documentElement.removeAttribute('data-minigame');
    this.root.remove();
    sound.sfx('back');
    this.opts.onClose(r);
  }

  // ---- cards ------------------------------------------------------------------
  private showCard(title: string, lines: string[], actions: [string, () => void][], extra: HTMLElement | null = null) {
    const h = el('h3', { id: 'mg-card-title' }, title);
    const body = lines.map((l) => el('p', {}, l));
    const row = el('div', { class: 'row' });
    actions.forEach(([label, fn], i) => {
      const b = el('button', { type: 'button', class: i === 0 ? 'btn primary' : 'btn' }, label);
      b.addEventListener('click', () => { sound.sfx('confirm'); fn(); });
      row.append(b);
    });
    // A card without a tutorial (loading, result) must not keep redrawing an old one.
    if (!extra?.querySelector('.mg-steps')) this.tutRefresh = null;
    this.card.replaceChildren(h, ...body, ...(extra ? [extra] : []), row);
    this.card.hidden = false;
    (row.querySelector('button') as HTMLButtonElement | null)?.focus();
  }

  private hideCard() { this.card.hidden = true; }

  private syncMute() {
    const muted = sound.engine?.prefs.muted ?? false;
    this.muteBtn.textContent = muted ? t('Suara mati') : t('Suara nyala');
    this.muteBtn.setAttribute('aria-pressed', String(muted));
  }

  // ---- layout -----------------------------------------------------------------
  private fit = () => {
    if (!this.mod) return;
    const { w, h } = this.mod.meta.view;
    const stage = this.canvas.parentElement!;
    const r = stage.getBoundingClientRect();
    // 12 px = the stage padding on both sides; keeps the canvas inside narrow phones.
    const k = Math.min((r.width - 12) / w, (r.height - 12) / h);
    this.canvas.style.width = `${Math.floor(w * k)}px`;
    this.canvas.style.height = `${Math.floor(h * k)}px`;
  };

  private buildTouch(m: GameMeta) {
    // A pad in hand (iPad or phone with a DualSense) does not need on-screen buttons.
    this.touch.hidden = !this.coarse() || currentDevice() === 'pad';
    this.touch.replaceChildren();
    const pad = el('div', { class: 'mg-dpad' });
    const btns = el('div', { class: 'mg-btns' });
    for (const b of m.touch) {
      const k = el('button', { type: 'button', class: `mg-tb mg-tb-${b}`, 'aria-label': b }, BTN_LABEL[b]);
      // Latch the press too: a quick tap that starts and ends between two
      // frames must still count as a hit, otherwise taps feel ignored.
      const on = (e: PointerEvent) => { e.preventDefault(); this.localUsed = true; this.touchDown.add(b); this.press(b); k.classList.add('on'); k.setPointerCapture(e.pointerId); navigator.vibrate?.(8); };
      const off = () => { this.touchDown.delete(b); k.classList.remove('on'); };
      k.addEventListener('pointerdown', on);
      k.addEventListener('pointerup', off);
      k.addEventListener('pointercancel', off);
      k.addEventListener('lostpointercapture', off);
      k.addEventListener('contextmenu', (e) => e.preventDefault());
      (['left', 'right', 'up', 'down'].includes(b) ? pad : btns).append(k);
    }
    this.touch.append(pad, btns);
  }

  // ---- input ------------------------------------------------------------------
  private onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    const target = e.target as HTMLElement | null;
    const onButton = target instanceof HTMLButtonElement && !this.card.hidden;
    if (k === 'escape' || k === 'p') {
      e.preventDefault(); e.stopPropagation();
      if (!this.escHeld) { this.escHeld = true; if (this.phase === 'play' || this.phase === 'pause') this.togglePause(); else if (this.phase === 'intro' || this.phase === 'error' || this.phase === 'loading') this.close(); }
      return;
    }
    if (k === 'm') { e.stopPropagation(); sound.with((en) => { en.toggleMute(); this.syncMute(); }); return; }
    const b = KEYMAP[k];
    // Enter/Space on a focused card button must press that button.
    // A held Enter (from the Game Station slot) auto-repeats and would click
    // "Mulai" too: only a fresh press may activate a card button.
    if (onButton && (k === 'enter' || k === ' ')) { e.stopPropagation(); if (e.repeat) e.preventDefault(); return; }
    e.stopPropagation();
    if (b) { e.preventDefault(); if (!e.repeat) this.press(b); this.keys.add(b); this.localUsed = true; }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (k === 'escape' || k === 'p') this.escHeld = false;
    const b = KEYMAP[k];
    if (b) this.keys.delete(b);
    e.stopPropagation();
  };

  /** Queue one press (capped so a mashed burst never leaves a long backlog). */
  private press(b: Btn) { if (this.queued[b] < 3) this.queued[b]++; }

  private onBlur = () => { for (const x of this.extras) x.clear(); for (const b of BTNS) this.queued[b] = 0; this.keys.clear(); this.touchDown.clear(); if (this.ptr) this.ptr.down = false; if (this.phase === 'play') this.togglePause(); };

  private gameXY(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    const m = this.mod!.meta;
    return { x: ((e.clientX - r.left) / r.width) * m.view.w, y: ((e.clientY - r.top) / r.height) * m.view.h };
  }

  private onPtr(e: PointerEvent, down: boolean) {
    if (!this.mod) return;
    if (e.type === 'pointerdown' || e.type === 'pointermove') e.preventDefault();
    this.ptr = { ...this.gameXY(e), down };
  }

  private onTap(e: PointerEvent) {
    if (this.phase !== 'play' || !this.mod) return;
    const r = this.canvas.getBoundingClientRect();
    this.tap = { x: ((e.clientX - r.left) / r.width) * this.mod.meta.view.w, y: ((e.clientY - r.top) / r.height) * this.mod.meta.view.h };
  }

  private readPad(): { down: Partial<Record<Btn, boolean>>; ax: number; ay: number; start: boolean; select: boolean; analog?: PadAnalog } {
    const none = { down: {}, ax: 0, ay: 0, start: false, select: false };
    let p: Gamepad | null = null;
    if (this.p1Pad === -1) return none;
    if (this.p1Pad !== null) p = navigator.getGamepads?.()[this.p1Pad] ?? null;
    else for (const q of navigator.getGamepads?.() ?? []) if (q && q.connected && !this.extras.some((x) => x.index === q.index)) { p = q; break; }
    if (!p || !p.connected) return none;
    if (this.padSeen.seen(p)) setDevice('pad', p);
    const prof = this.prof();
    const f = faceButtons(prof);
    const ax = stickAxes(prof);
    const raw = p.buttons.map((b) => b.pressed || b.value > 0.5);
    const sx = p.axes[ax.move[0]] ?? 0;
    const sy = p.axes[ax.move[1]] ?? 0;
    const dz = prof.dead;
    const lx = Math.abs(sx) > dz ? sx : 0;
    const ly = Math.abs(sy) > dz ? sy : 0;
    const start = !!raw[9] && !this.padPrev[9];
    const select = !!raw[8] && !this.padPrev[8];
    this.padPrev = raw;
    return {
      down: {
        a: raw[f.A], b: raw[f.B], x: raw[f.X], y: raw[f.Y],
        left: raw[14] || lx < -0.5, right: raw[15] || lx > 0.5, up: raw[12] || ly < -0.5, down: raw[13] || ly > 0.5,
      },
      ax: raw[14] ? -1 : raw[15] ? 1 : lx, ay: raw[12] ? -1 : raw[13] ? 1 : ly, start, select,
      analog: {
        move: [sx, sy], look: [p.axes[ax.look[0]] ?? 0, p.axes[ax.look[1]] ?? 0],
        l2: p.buttons[6]?.value ?? 0, r2: p.buttons[7]?.value ?? 0, l1: !!raw[4], r1: !!raw[5],
        dead: dz, aim: prof.aimScale * ((this.opts.aimSpeed?.() ?? 100) / 100),
      },
    };
  }

  private input(): InputState {
    const pad = this.readPad();
    const playing0 = this.phase === 'play';
    for (const x of this.extras) {
      x.poll(playing0);
      if (x.start && (this.phase === 'play' || this.phase === 'pause')) this.togglePause();
    }
    this.lobbyLeave();
    this.lobbyPoll();
    if (pad.start) this.togglePause();
    if (pad.select && this.phase !== 'play') this.close();
    // Card open: the pad's A presses the focused card button, B the last one.
    if (this.phase !== 'play' && !this.card.hidden) {
      if (pad.down.a && !this.prevDown.a) (document.activeElement as HTMLElement | null)?.click?.();
      if (pad.down.left && !this.prevDown.left) this.moveCardFocus(-1);
      if (pad.down.right && !this.prevDown.right) this.moveCardFocus(1);
    }
    const down = {} as Record<Btn, boolean>;
    const padNow = {} as Record<Btn, boolean>;
    // The A that pressed "Mulai" on the card above must not also reach the
    // game as its first press: queue only when play was already running.
    const playing = playing0 && this.phase === 'play';
    for (const b of BTNS) {
      padNow[b] = !!pad.down[b];
      if (playing && padNow[b] && !this.prevDown[b]) this.press(b);
      // Presses made on a card (intro, pause) must not fire once play starts.
      if (!playing) this.queued[b] = 0;
      down[b] = this.keys.has(b) || this.touchDown.has(b) || padNow[b] || this.queued[b] > 0;
    }
    this.prevDown = padNow;
    const hit = Object.fromEntries(BTNS.map((b) => [b, false])) as Record<Btn, boolean>;
    let ax = pad.ax + (down.right && !pad.down.right ? 1 : 0) - (down.left && !pad.down.left ? 1 : 0);
    let ay = pad.ay + (down.down && !pad.down.down ? 1 : 0) - (down.up && !pad.down.up ? 1 : 0);
    ax = Math.max(-1, Math.min(1, ax));
    ay = Math.max(-1, Math.min(1, ay));
    if (!playing) this.tap = null;
    return { down, hit, ax, ay, tap: null, ptr: this.ptr ? { ...this.ptr } : null, ...(pad.analog ? { pad: pad.analog } : {}) };
  }

  /** DualSense/Xbox rumble through the Gamepad API (Chrome, Edge); silently absent elsewhere or with reduced motion. */
  private rumble(strength: number, ms: number) {
    if (this.opts.reducedMotion || this.p1Pad === -1 || currentDevice() !== 'pad') return;
    const p = this.p1Pad !== null ? navigator.getGamepads?.()[this.p1Pad] : connectedPads()[0];
    const v = (p as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }) | null | undefined)?.vibrationActuator;
    const k = Math.max(0, Math.min(1, strength));
    void v?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: k, weakMagnitude: Math.min(1, k * 1.4) })?.catch(() => {});
  }

  private moveCardFocus(d: number) {
    const bs = [...this.card.querySelectorAll('button')];
    const i = bs.indexOf(document.activeElement as HTMLButtonElement);
    bs[(i + d + bs.length) % bs.length]?.focus();
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const input = this.input();
    if (this.phase === 'play' && this.inst) {
      // Fixed 60 Hz step: game logic is frame-rate independent and replayable.
      // Each step takes at most one queued press per button; the rest wait
      // for the next step, so no press is lost or merged.
      this.acc += dt;
      let n = 0;
      while (this.acc >= 1 / 60 && n < 6) {
        const hit = {} as Record<Btn, boolean>;
        for (const b of BTNS) {
          hit[b] = this.queued[b] > 0;
          if (hit[b]) { this.queued[b]--; this.delivered[b] = (this.delivered[b] ?? 0) + 1; }
        }
        const tap = this.tap;
        this.tap = null;
        const p1: InputState = { ...input, hit, tap };
        if (this.extras.length) p1.players = [p1, ...this.extras.map((x) => x.step())];
        else if (this.humans() === 2) p1.players = [p1, p1];
        this.inst.update(1 / 60, p1);
        this.acc -= 1 / 60;
        n++;
        this.frames++;
        if (this.phase !== 'play') break;
      }
      if (n === 6) this.acc = 0;
    }
    this.inst?.render();
  };

  /** Test hook: game snapshot plus host phase. */
  state() { return { phase: this.phase, game: this.gameId, frames: this.frames, delivered: { ...this.delivered }, players: this.humans(), pads: { p1: this.p1Pad, extra: this.extras.map((x) => x.index) }, hud: this.hudText, result: this.result, snap: this.inst?.snapshot?.() ?? null }; }
}

let current: MiniGameHost | null = null;
export function openMiniGame(id: string, opts: HostOpts): MiniGameHost {
  current?.close(null);
  current = new MiniGameHost(id, { ...opts, onClose: (r) => { current = null; opts.onClose(r); } });
  void current.open();
  return current;
}
export function currentMiniGame(): MiniGameHost | null { return current; }
