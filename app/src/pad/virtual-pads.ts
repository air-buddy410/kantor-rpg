// PC side of "Main pakai HP" (REQ-HP-04/05/07). Opens a room on pad-relay, gives
// each phone a WebRTC data channel when the network allows (relay fallback),
// and shows every phone to the app as a standard Gamepad at index 4..7 by
// wrapping navigator.getGamepads, so lobbies, HUD glyphs and profiles work
// unchanged. Lazy chunk: imported only when the panel opens.
import { BUTTONS, ICE_SERVERS, MAX_PHONES, RTC_TIMEOUT_MS, SILENT_MS, decodeInput, type InputPacket, type Wire } from './protocol';

export type Transport = 'langsung' | 'relay';
export type LinkStatus = 'connecting' | 'open' | 'down';
export interface PhoneInfo { id: string; index: number; seat: number; transport: Transport; latency: number | null; connected: boolean }
export interface PhoneLink {
  readonly code: string;
  readonly joinUrl: string;
  readonly status: LinkStatus;
  readonly phones: PhoneInfo[];
  /** Called on any change of status, phones, transport or latency. Returns an unsubscribe. */
  onChange(fn: () => void): () => void;
  /** Tell a phone which player it is, e.g. once host.ts knows the real seat. */
  setSeat(index: number, n: number): void;
  retry(): void;
  close(): void;
}

export const PAD_ID = 'HP PerumNet (PlayStation layout)';
export const FIRST_INDEX = 4;
const PING_MS = 1000;
// A game on the direct channel sends nothing through the relay; this keeps its 30 min idle sweep away.
const KEEPALIVE_MS = 60_000;

interface VBtn { pressed: boolean; touched: boolean; value: number }
interface VPad {
  id: string; index: number; mapping: 'standard'; connected: boolean; timestamp: number;
  buttons: VBtn[]; axes: number[]; hapticActuators: never[];
  vibrationActuator: { type: string; effects: string[]; playEffect(type: string, p?: RumbleParams): Promise<string>; reset(): Promise<string> };
}
interface RumbleParams { duration?: number; strongMagnitude?: number; weakMagnitude?: number }
interface Slot {
  id: string; index: number; seat: number; pad: VPad; seq: number; seen: number;
  transport: Transport; latency: number | null; pc?: RTCPeerConnection; dc?: RTCDataChannel; chain: Promise<unknown>; rtcTimer?: ReturnType<typeof setTimeout>;
}

const slots: (Slot | null)[] = new Array(MAX_PHONES).fill(null);
let installed = false;
let current: Link | null = null;

/** Wrap navigator.getGamepads once: originals plus connected phones at 4..7. Safe without the Gamepad API. */
export function installVirtualPads(): void {
  if (installed) return;
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  if (!nav) return;
  installed = true;
  const orig = typeof nav.getGamepads === 'function' ? nav.getGamepads.bind(nav) : null;
  const wrapped = (): (Gamepad | null)[] => {
    let base: (Gamepad | null)[] = [];
    try { base = orig ? [...orig()] : []; } catch { /* permissions policy can throw */ }
    slots.forEach((s, i) => {
      if (!s?.pad.connected) return;
      // ponytail: a real pad that the browser itself put at 4..7 would be shadowed; Chrome and Safari stop at 3.
      while (base.length < FIRST_INDEX + i) base.push(null);
      base[FIRST_INDEX + i] = s.pad as unknown as Gamepad;
    });
    return base;
  };
  Object.defineProperty(nav, 'getGamepads', { value: wrapped, configurable: true, writable: true });
}

function fire(type: 'gamepadconnected' | 'gamepaddisconnected', pad: VPad) {
  const g = globalThis as { dispatchEvent?: (e: Event) => boolean };
  if (typeof g.dispatchEvent !== 'function' || typeof Event !== 'function') return;
  const e = new Event(type);
  Object.defineProperty(e, 'gamepad', { value: pad });
  g.dispatchEvent(e);
}

function release(p: VPad) {
  for (const b of p.buttons) { b.pressed = b.touched = false; b.value = 0; }
  p.axes.fill(0);
  p.timestamp = performance.now();
}

const parse = (s: unknown): Wire | InputPacket | null => { try { return typeof s === 'string' ? JSON.parse(s) : null; } catch { return null; } };

class Link implements PhoneLink {
  code = '';
  status: LinkStatus = 'connecting';
  private ws: WebSocket | null = null;
  private subs = new Set<() => void>();
  private timer: ReturnType<typeof setInterval>;
  private closed = false;
  private pinged = 0;
  private kept = Date.now();

  constructor(private relayUrl: string) {
    this.timer = setInterval(() => this.tick(), 250);
    this.connect();
  }

  get joinUrl(): string {
    if (!this.code || typeof location === 'undefined') return '';
    // BASE_URL is './' in this build: resolve it against the page, not the origin.
    return new URL(`${import.meta.env.BASE_URL}pad.html#${this.code}`, location.href).href;
  }

  get phones(): PhoneInfo[] {
    return slots.filter((s): s is Slot => !!s).sort((a, b) => a.seat - b.seat)
      .map((s) => ({ id: s.id, index: s.index, seat: s.seat, transport: s.transport, latency: s.latency, connected: s.pad.connected }));
  }

  onChange(fn: () => void) { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
  private emit() { for (const f of this.subs) try { f(); } catch { /* a broken listener must not stop input */ } }

  setSeat(index: number, n: number) {
    const s = slots[index - FIRST_INDEX];
    if (!s || s.seat === n) return;
    s.seat = n;
    this.relay({ t: 'seat', n, to: s.id });
    this.emit();
  }

  retry() {
    if (this.closed) return;
    this.dropAll();
    this.ws?.close();
    this.connect();
  }

  close() {
    this.closed = true;
    clearInterval(this.timer);
    this.dropAll();
    this.ws?.close();
    this.ws = null;
    if (current === this) current = null;
    this.emit();
  }

  private connect() {
    this.code = '';
    this.status = 'connecting';
    this.emit();
    let ws: WebSocket;
    try { ws = new WebSocket(this.relayUrl); } catch { this.status = 'down'; this.emit(); return; }
    this.ws = ws;
    ws.onmessage = (e) => { const m = parse(e.data); if (m && !Array.isArray(m)) this.onRelay(m); };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.dropAll();
      if (!this.closed) { this.status = 'down'; this.code = ''; this.emit(); }
    };
  }

  private relay(m: Wire) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(m)); }

  /** Game traffic goes over the direct channel when it is open, else through the relay. */
  private toPhone(s: Slot, m: Wire) {
    if (s.dc?.readyState === 'open') { try { s.dc.send(JSON.stringify(m)); return; } catch { /* fall back */ } }
    this.relay({ ...m, to: s.id });
  }

  private onRelay(m: Wire) {
    if (m.t === 'room') { this.code = m.code; this.status = 'open'; this.emit(); return; }
    if (m.t === 'phone-join') { this.join(m.from); return; }
    if (m.t === 'phone-leave') { this.leave(m.from); return; }
    const s = slots.find((x) => x?.id === m.from);
    if (s) this.fromPhone(s, m);
  }

  private join(id: string) {
    const i = slots.findIndex((s) => !s);
    if (i < 0 || slots.some((s) => s?.id === id)) return;
    const index = FIRST_INDEX + i;
    const s: Slot = { id, index, seat: i + 2, pad: this.makePad(index, () => s), seq: -1, seen: Date.now(), transport: 'relay', latency: null, chain: Promise.resolve() };
    slots[i] = s;
    this.relay({ t: 'seat', n: s.seat, to: id });
    this.rtc(s);
    fire('gamepadconnected', s.pad);
    this.emit();
  }

  private leave(id: string) {
    const i = slots.findIndex((s) => s?.id === id);
    if (i < 0) return;
    const s = slots[i]!;
    slots[i] = null;
    clearTimeout(s.rtcTimer);
    try { s.pc?.close(); } catch { /* already closed */ }
    const was = s.pad.connected;
    release(s.pad);
    s.pad.connected = false;
    if (was) fire('gamepaddisconnected', s.pad);
    this.emit();
  }

  private dropAll() { for (const s of [...slots]) if (s) this.leave(s.id); }

  private fromPhone(s: Slot, m: Wire | InputPacket) {
    s.seen = Date.now();
    if (Array.isArray(m)) { this.input(s, m); return; }
    switch (m.t) {
      case 'input': this.input(s, m.p); break;
      case 'ping': this.toPhone(s, { t: 'pong', ts: m.ts }); break;
      case 'pong':
        if (Number.isFinite(m.ts)) { s.latency = Math.max(0, Math.round(performance.now() - m.ts)); this.emit(); }
        break;
      case 'answer': {
        const pc = s.pc;
        if (pc && typeof m.sdp === 'string') s.chain = s.chain.then(() => pc.setRemoteDescription({ type: 'answer', sdp: m.sdp })).catch(() => {});
        break;
      }
      case 'ice': {
        const pc = s.pc;
        if (pc && m.c) s.chain = s.chain.then(() => pc.addIceCandidate(m.c!)).catch(() => {});
        break;
      }
      case 'bye': this.leave(s.id); break;
    }
  }

  private input(s: Slot, p: unknown) {
    const d = decodeInput(p);
    if (!d) return;
    // Unordered channel plus relay: drop stale packets, accept a restart from 0.
    if (d.seq <= s.seq && s.seq - d.seq < 1000) return;
    s.seq = d.seq;
    const pad = s.pad;
    d.buttons.forEach((v, i) => {
      const b = pad.buttons[i];
      b.value = v;
      // Triggers count as pressed early, like hardware (XInput threshold 30/255).
      b.pressed = b.touched = i === 6 || i === 7 ? v > 0.12 : v > 0.5;
    });
    d.axes.forEach((v, i) => { pad.axes[i] = v; });
    pad.timestamp = performance.now();
    if (!pad.connected) { pad.connected = true; fire('gamepadconnected', pad); this.emit(); }
  }

  private tick() {
    const now = Date.now();
    const ping = now - this.pinged >= PING_MS;
    if (ping) this.pinged = now;
    const keep = now - this.kept >= KEEPALIVE_MS;
    if (keep) this.kept = now;
    for (const s of slots) {
      if (!s) continue;
      if (s.pad.connected && now - s.seen > SILENT_MS) {
        release(s.pad);
        s.pad.connected = false;
        fire('gamepaddisconnected', s.pad);
        this.emit();
      }
      if (ping) this.toPhone(s, { t: 'ping', ts: performance.now() });
      if (keep && s.pad.connected) this.relay({ t: 'seat', n: s.seat, to: s.id });
    }
  }

  private makePad(index: number, slot: () => Slot): VPad {
    const send = (p: RumbleParams = {}) => {
      const k = (v: unknown) => Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100) / 100;
      this.toPhone(slot(), { t: 'rumble', ms: Math.round(Math.max(0, Math.min(5000, Number(p.duration) || 0))), strong: k(p.strongMagnitude), weak: k(p.weakMagnitude) });
    };
    return {
      id: PAD_ID, index, mapping: 'standard', connected: true, timestamp: performance.now(),
      buttons: Array.from({ length: BUTTONS }, () => ({ pressed: false, touched: false, value: 0 })),
      axes: [0, 0, 0, 0], hapticActuators: [],
      vibrationActuator: {
        type: 'dual-rumble', effects: ['dual-rumble'],
        playEffect: (_type, p) => { send(p); return Promise.resolve('complete'); },
        reset: () => { send({}); return Promise.resolve('complete'); },
      },
    };
  }

  private rtc(s: Slot) {
    const RTC = (globalThis as { RTCPeerConnection?: typeof RTCPeerConnection }).RTCPeerConnection;
    if (!RTC) return;
    let pc: RTCPeerConnection;
    try { pc = new RTC({ iceServers: ICE_SERVERS }); } catch { return; }
    const dc = pc.createDataChannel('pad', { ordered: false, maxRetransmits: 0 });
    s.pc = pc; s.dc = dc;
    dc.onopen = () => { if (slots.includes(s)) { s.transport = 'langsung'; clearTimeout(s.rtcTimer); this.emit(); } };
    dc.onclose = () => { if (s.dc === dc) { s.dc = undefined; s.transport = 'relay'; this.emit(); } };
    dc.onmessage = (e) => { const m = parse(e.data); if (m) this.fromPhone(s, m); };
    pc.onicecandidate = (e) => this.relay({ t: 'ice', c: e.candidate ? e.candidate.toJSON() : null, to: s.id });
    s.chain = s.chain.then(async () => {
      await pc.setLocalDescription(await pc.createOffer());
      this.relay({ t: 'offer', sdp: pc.localDescription?.sdp ?? '', to: s.id });
    }).catch(() => {});
    // No direct path in time (guest WiFi isolation, symmetric NAT): stay on the relay for this phone.
    s.rtcTimer = setTimeout(() => {
      if (dc.readyState === 'open') return;
      try { pc.close(); } catch { /* ignore */ }
      if (s.pc === pc) { s.pc = undefined; s.dc = undefined; }
    }, RTC_TIMEOUT_MS);
  }
}

/** Start (or reuse) the room for this screen. Phones stay connected after the panel closes. */
export function startPhoneLink(opts: { relayUrl?: string } = {}): PhoneLink {
  if (current) return current;
  installVirtualPads();
  const url = opts.relayUrl ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/pad-relay?role=screen`;
  current = new Link(url);
  return current;
}

/** The running link, if any (for a HUD badge without opening a room). */
export const currentPhoneLink = (): PhoneLink | null => current;
