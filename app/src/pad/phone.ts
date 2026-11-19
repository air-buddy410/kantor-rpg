// Phone controller page (REQ-HP-03/05): pad.html#<code>. Touch controls in the
// DualSense layout, sent to the PC over a WebRTC data channel when it opens
// within 4 s, else through pad-relay. Input goes out at most 60 times a second,
// at once on a change, and is repeated while held because the direct channel
// is unreliable by design (a lost "release" must not leave a button stuck).
import './phone.css';
import { initLang, t } from '../i18n';
import { PLAYER_COLORS } from '../minigames/local-players';
import { BUTTONS, ICE_SERVERS, RTC_TIMEOUT_MS, encodeInput, validCode, type Wire } from './protocol';

const SEND_MS = 1000 / 60;
const state = { buttons: new Array<number>(BUTTONS).fill(0), axes: [0, 0, 0, 0] };
const svgNS = 'http://www.w3.org/2000/svg';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function icon(paths: string, fill = false): SVGSVGElement {
  const s = document.createElementNS(svgNS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = paths;
  s.classList.add(fill ? 'hp-ico-fill' : 'hp-ico');
  return s;
}

/** Pointer captured by the element: multi-touch works because each finger owns its control. */
/** 90 while the controller is turned by CSS on an upright phone (iPhone cannot lock orientation). */
let rot = 0;
/** Pointer position in px from the element's centre, in the element's own (unrotated) frame. */
function local(ev: PointerEvent, el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const dx = ev.clientX - (r.left + r.width / 2), dy = ev.clientY - (r.top + r.height / 2);
  return rot ? { x: dy, y: -dx } : { x: dx, y: dy };
}

/** Short tick on press where the browser allows it (Android); there is no feel of a real button. */
const buzz = () => { try { navigator.vibrate?.(8); } catch { /* not allowed yet */ } };

function track(e: HTMLElement, on: { down?: (ev: PointerEvent) => void; move?: (ev: PointerEvent) => void; up: () => void }) {
  let id = -1;
  e.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    // a button inside the stick zone keeps its finger; the zone must not capture it too
    ev.stopPropagation();
    if (id !== -1) return;
    id = ev.pointerId;
    try { e.setPointerCapture(id); } catch { /* pointer already gone */ }
    on.down?.(ev); on.move?.(ev);
  });
  e.addEventListener('pointermove', (ev) => { if (ev.pointerId === id) on.move?.(ev); });
  const end = (ev: PointerEvent) => { if (ev.pointerId !== id) return; id = -1; on.up(); };
  e.addEventListener('pointerup', end);
  e.addEventListener('pointercancel', end);
  e.addEventListener('lostpointercapture', end);
}

function button(i: number, cls: string, label: string, content: Node | string) {
  const b = h('button', { type: 'button', class: `hp-btn ${cls}`, 'aria-label': label, 'data-b': String(i) });
  b.append(content);
  track(b, { down: () => { set(i, 1); b.classList.add('on'); buzz(); }, up: () => { set(i, 0); b.classList.remove('on'); } });
  return b;
}

function set(i: number, v: number) {
  if (state.buttons[i] === v) return;
  state.buttons[i] = v;
  changed();
}

// ---- controls ----
function faceButtons(): HTMLElement {
  const face = h('div', { class: 'hp-face', role: 'group', 'aria-label': t('Tombol aksi') });
  const shapes: [number, string, string, string][] = [
    [3, 'tri', t('Segitiga'), '<path d="M12 4.5 20.5 19h-17z"/>'],
    [2, 'sq', t('Kotak'), '<rect x="5" y="5" width="14" height="14" rx="1"/>'],
    [1, 'ci', t('Lingkaran'), '<circle cx="12" cy="12" r="7.5"/>'],
    [0, 'cr', t('Silang'), '<path d="M5.5 5.5l13 13M18.5 5.5l-13 13"/>'],
  ];
  for (const [i, cls, label, d] of shapes) face.append(button(i, `hp-f ${cls}`, label, icon(d)));
  return face;
}

function dpad(): HTMLElement {
  const pad = h('div', { class: 'hp-dpad', role: 'group', 'aria-label': t('D-pad') });
  const arms = ([[12, 'u', t('D-pad atas')], [13, 'd', t('D-pad bawah')], [14, 'l', t('D-pad kiri')], [15, 'r', t('D-pad kanan')]] as const)
    .map(([i, c, label]) => {
      const a = h('span', { class: `hp-arm ${c}`, role: 'img', 'aria-label': label });
      a.append(icon('<path d="M7 14l5-5 5 5z"/>', true));
      pad.append(a);
      return [i, a] as const;
    });
  // One surface with eight sectors, so a thumb can roll between directions and diagonals.
  const apply = (x: number, y: number) => {
    const on = new Set<number>();
    if (Math.hypot(x, y) > 0.2) {
      const a = Math.atan2(y, x), s = Math.PI / 8;
      if (Math.abs(a) < 3 * s) on.add(15);
      if (Math.abs(a) > 5 * s) on.add(14);
      if (a > s && a < 7 * s) on.add(13);
      if (a < -s && a > -7 * s) on.add(12);
    }
    for (const [i, el] of arms) {
      if (on.has(i) && !state.buttons[i]) buzz();
      set(i, on.has(i) ? 1 : 0); el.classList.toggle('on', on.has(i));
    }
  };
  track(pad, {
    move: (ev) => { const p = local(ev, pad); apply(p.x / (pad.offsetWidth / 2), p.y / (pad.offsetHeight / 2)); },
    up: () => apply(0, 0),
  });
  return pad;
}

/**
 * Analog stick on axes ax, ax+1. With a zone the stick floats: its base jumps to
 * where the thumb lands (clamped inside the zone) and returns home on release,
 * so a thumb that drifts without a physical edge still hits it.
 */
function stick(ax: 0 | 2, label: string, zone?: HTMLElement): HTMLElement {
  const base = h('div', { class: `hp-stick ${ax ? 'rs' : 'ls'}`, role: 'img', 'aria-label': label });
  const knob = h('span', { class: 'hp-knob' });
  base.append(knob);
  let ox = 0, oy = 0;
  const put = (x: number, y: number) => {
    state.axes[ax] = x; state.axes[ax + 1] = y;
    const r = base.offsetWidth / 2 - knob.offsetWidth / 2;
    knob.style.transform = `translate(${x * r}px, ${y * r}px)`;
    changed();
  };
  const home = () => { for (const k of ['left', 'top', 'right', 'bottom']) base.style.removeProperty(k); base.classList.remove('float'); };
  const area = zone ?? base;
  track(area, {
    down: (ev) => {
      if (!zone) { ox = oy = 0; return; }
      const p = local(ev, zone), R = base.offsetWidth / 2;
      const hw = zone.offsetWidth / 2 - R, hh = zone.offsetHeight / 2 - R;
      ox = Math.max(-hw, Math.min(hw, p.x)); oy = Math.max(-hh, Math.min(hh, p.y));
      Object.assign(base.style, { left: `${ox + hw}px`, top: `${oy + hh}px`, right: 'auto', bottom: 'auto' });
      base.classList.add('float');
    },
    move: (ev) => {
      const p = local(ev, area);
      // a fixed stick is measured from its own centre, a floating one from where it landed
      const cx = zone ? ox : 0, cy = zone ? oy : 0;
      const r = base.offsetWidth / 2 - knob.offsetWidth / 4;
      let x = (p.x - cx) / r, y = (p.y - cy) / r;
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; } // radius normalisation: full tilt on the rim, same in every direction
      put(Math.round(x * 100) / 100, Math.round(y * 100) / 100);
    },
    up: () => { put(0, 0); if (zone) home(); },
  });
  return base;
}

function trigger(i: 6 | 7, label: string): HTMLElement {
  const tr = h('div', { class: `hp-trig ${label.toLowerCase()}`, role: 'slider', 'aria-label': t('{tombol}, geser ke bawah', { tombol: label }), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-orientation': 'vertical' });
  const fill = h('span', { class: 'hp-trig-fill' });
  tr.append(fill, h('span', { class: 'hp-trig-lbl' }, label));
  const put = (v: number) => {
    fill.style.transform = `scaleY(${v})`;
    tr.setAttribute('aria-valuenow', String(Math.round(v * 100)));
    tr.classList.toggle('on', v > 0);
    set(i, v);
  };
  track(tr, {
    move: (ev) => { const p = local(ev, tr); put(Math.round(Math.max(0.15, Math.min(1, p.y / tr.offsetHeight + 0.5)) * 100) / 100); },
    up: () => put(0),
  });
  return tr;
}

// ---- sending ----
let seq = 0;
let lastSent = 0;
let pending = 0;
let neutral = true;

function changed() {
  if (pending) return;
  const wait = SEND_MS - (performance.now() - lastSent);
  if (wait <= 0) flush(); else pending = window.setTimeout(flush, wait);
}

function flush() {
  pending = 0;
  lastSent = performance.now();
  neutral = state.buttons.every((v) => !v) && state.axes.every((v) => !v);
  net.input(encodeInput(++seq, state));
}

// Repeat the current state: 10 Hz while anything is held, 1 Hz at rest (keeps the PC from timing out).
let lastRepeat = 0;
setInterval(() => {
  const now = performance.now();
  if (now - lastSent > (neutral ? 1000 : 100) && now - lastRepeat > 90) { lastRepeat = now; flush(); }
}, 50);

function releaseAll() {
  state.buttons.fill(0); state.axes.fill(0);
  document.querySelectorAll('.on').forEach((e) => e.classList.remove('on'));
  document.querySelectorAll<HTMLElement>('.hp-knob').forEach((e) => e.style.removeProperty('transform'));
  document.querySelectorAll<HTMLElement>('.hp-trig-fill').forEach((e) => e.style.removeProperty('transform'));
  flush();
}

// ---- network: relay socket plus optional direct channel ----
type Phase = 'connecting' | 'joined' | 'seat' | 'refused' | 'bye' | 'nocode';
const net = (() => {
  const code = decodeURIComponent(location.hash.slice(1)).trim().toUpperCase();
  const q = new URLSearchParams(location.search);
  // ?relay= exists for local testing against a relay on another port.
  const base = q.get('relay') ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/pad-relay`;
  let ws: WebSocket | null = null;
  let pc: RTCPeerConnection | null = null;
  let dc: RTCDataChannel | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  let backoff = 500;
  /** Failed tries in a row; after a few the page says why it waits. */
  let fails = 0;
  let stop = false;
  let path: 'langsung' | 'relay' = 'relay';
  const api = {
    code, phase: 'connecting' as Phase, seat: 0, reason: '',
    input(p: ReturnType<typeof encodeInput>) {
      if (dc?.readyState === 'open') { try { dc.send(JSON.stringify(p)); return; } catch { /* fall back */ } }
      relay({ t: 'input', p });
    },
    get path() { return path; },
    fails: () => fails,
    start() { if (validCode(code)) connect(); else { api.phase = 'nocode'; ui(); } },
  };
  const relay = (m: Wire) => { if (ws?.readyState === 1) ws.send(JSON.stringify(m)); };
  const reply = (m: Wire) => { if (dc?.readyState === 'open') dc.send(JSON.stringify(m)); else relay(m); };

  function dropRtc() {
    try { pc?.close(); } catch { /* closed */ }
    pc = null; dc = null; path = 'relay';
  }

  function connect() {
    api.phase = 'connecting'; ui();
    const s = new WebSocket(`${base}?role=phone&code=${encodeURIComponent(code)}`);
    ws = s;
    s.onmessage = (e) => { let m: Wire; try { m = JSON.parse(e.data as string); } catch { return; } on(m); };
    s.onclose = () => {
      if (ws !== s) return;
      ws = null; dropRtc();
      if (stop) return;
      // Network blip or relay restart: back off up to 5 s and rejoin with the same code.
      setTimeout(connect, backoff);
      backoff = Math.min(5000, backoff * 2);
      fails++;
      api.phase = 'connecting'; ui();
    };
  }

  function on(m: Wire) {
    switch (m.t) {
      case 'joined': backoff = 500; fails = 0; api.phase = api.seat ? 'seat' : 'joined'; relay({ t: 'hello' }); ui(); break;
      case 'refused': stop = true; api.phase = 'refused'; api.reason = m.reason; ui(); break;
      case 'bye': stop = true; api.phase = 'bye'; dropRtc(); ui(); break;
      case 'seat': api.seat = m.n; api.phase = 'seat'; ui(); break;
      case 'ping': reply({ t: 'pong', ts: m.ts }); break;
      case 'rumble': rumble(m.ms, Math.max(m.strong, m.weak)); break;
      case 'offer': answer(m.sdp); break;
      case 'ice': { const p = pc; if (p && m.c) chain = chain.then(() => p.addIceCandidate(m.c!)).catch(() => {}); break; }
    }
  }

  function answer(sdp: string) {
    const RTC = window.RTCPeerConnection;
    if (!RTC || typeof sdp !== 'string') return;
    dropRtc();
    const p = new RTC({ iceServers: ICE_SERVERS });
    pc = p;
    p.onicecandidate = (e) => relay({ t: 'ice', c: e.candidate ? e.candidate.toJSON() : null });
    p.ondatachannel = (e) => {
      const c = e.channel;
      c.onopen = () => { if (pc === p) { dc = c; path = 'langsung'; ui(); } };
      c.onclose = () => { if (dc === c) { dc = null; path = 'relay'; ui(); } };
      c.onmessage = (ev) => { try { on(JSON.parse(ev.data as string)); } catch { /* ignore */ } };
    };
    chain = chain.then(async () => {
      await p.setRemoteDescription({ type: 'offer', sdp });
      await p.setLocalDescription(await p.createAnswer());
      relay({ t: 'answer', sdp: p.localDescription?.sdp ?? '' });
    }).catch(() => {});
    setTimeout(() => { if (pc === p && !dc) dropRtc(); }, RTC_TIMEOUT_MS);
  }
  return api;
})();

function rumble(ms: number, k: number) {
  if (k < 0.05 || !navigator.vibrate) return;
  try { navigator.vibrate(Math.max(10, Math.min(1000, Math.round(ms)))); } catch { /* blocked until first touch */ }
}

// ---- page ----
const statusText = h('p', { class: 'hp-status', role: 'status', 'aria-live': 'polite' });
const hint = h('p', { class: 'hp-hint' });

function ui() {
  const ph = net.phase;
  const seat = net.seat;
  document.body.dataset.phase = ph;
  if (ph === 'seat' && seat) {
    statusText.textContent = t('Pemain {n}', { n: seat });
    document.body.style.setProperty('--seat', PLAYER_COLORS[Math.max(0, Math.min(PLAYER_COLORS.length - 1, seat - 1))]);
  } else document.body.style.removeProperty('--seat');
  if (ph === 'connecting') statusText.textContent = t('Menyambung');
  if (ph === 'joined') statusText.textContent = t('Tersambung');
  if (ph === 'nocode') statusText.textContent = t('Kode tidak ada atau salah.');
  if (ph === 'bye') statusText.textContent = t('Layar menutup sambungan.');
  if (ph === 'refused') statusText.textContent = net.reason === 'full' ? t('Layar ini sudah penuh (4 HP).') : net.reason === 'busy' ? t('Server kontroler sedang penuh.') : t('Kode sudah tidak berlaku.');
  const dead = ph === 'nocode' || ph === 'bye' || ph === 'refused';
  hint.textContent = dead ? t('Scan ulang QR di layar.') : ph === 'seat' || ph === 'joined' ? (net.path === 'langsung' ? t('Jalur langsung') : t('Jalur relay'))
    : ph === 'connecting' && net.fails() >= 3 ? t('Belum tersambung. Pastikan HP memakai WiFi kantor, mencoba lagi...') : '';
}

/** Android: full screen plus a landscape lock on the first touch. iPhone has neither, it gets the CSS turn. */
function landscape() {
  const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
  const root = document.documentElement;
  if (!o?.lock || !root.requestFullscreen) return;
  const lock = () => o.lock!('landscape').catch(() => {});
  if (document.fullscreenElement) void lock();
  else root.requestFullscreen({ navigationUI: 'hide' }).then(lock).catch(() => {});
}

/** Size from the short side, turn the controller when the phone stands upright. */
function layout() {
  const w = window.innerWidth, hgt = window.innerHeight;
  rot = hgt > w ? 90 : 0;
  const st = document.documentElement.style;
  st.setProperty('--L', `${Math.max(w, hgt)}px`);
  st.setProperty('--S', `${Math.min(w, hgt)}px`);
  document.body.dataset.rot = String(rot);
}

// iOS Safari ignores user-scalable=no since iOS 10 (WebKit blog), so the zoom
// gestures themselves are cancelled: pinch (gesture*), drag-zoom and pan
// (touchmove), double-tap (a second touchend within 350 ms).
function noZoom() {
  const stop = (e: Event) => e.preventDefault();
  for (const n of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick']) document.addEventListener(n, stop, { passive: false });
  document.addEventListener('touchmove', stop, { passive: false });
  let lastEnd = 0;
  document.addEventListener('touchend', (e) => { if (e.timeStamp - lastEnd < 350) e.preventDefault(); lastEnd = e.timeStamp; }, { passive: false });
  // a zoom that still got through is undone: rewriting the viewport tag makes Safari rescale to 1
  // ponytail: not provable without a real iPhone; the gesture blocks above are the main guard
  const vv = window.visualViewport;
  vv?.addEventListener('resize', () => {
    if (vv.scale <= 1.01) return;
    const m = document.querySelector('meta[name="viewport"]');
    const c = m?.getAttribute('content');
    if (!m || !c) return;
    m.setAttribute('content', `${c}, minimum-scale=1`);
    requestAnimationFrame(() => m.setAttribute('content', c));
  });
}

async function wake() {
  try { await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<unknown> } }).wakeLock?.request('screen'); } catch { /* not allowed now, retried on next visibility change */ }
}

void initLang().then(() => {
  document.title = t('Kontroler HP');
  const app = h('main', { class: 'hp' });
  const mid = h('div', { class: 'hp-mid' });
  mid.append(statusText, hint);
  const small = h('div', { class: 'hp-small' });
  small.append(button(8, 'hp-s', 'Create', 'Create'), button(9, 'hp-s', 'Options', 'Options'));
  // iPhone Safari has no full screen for pages, so the button only shows where it works
  if ('requestFullscreen' in document.documentElement) {
    const fs = h('button', { type: 'button', class: 'hp-btn hp-s hp-fs', 'aria-label': t('Layar penuh') });
    fs.append(icon('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'));
    fs.addEventListener('click', () => { if (document.fullscreenElement) void document.exitFullscreen?.(); else landscape(); });
    small.append(fs);
  }
  mid.append(small);
  // DualSense order: shoulders on top, D-pad and left stick under the left thumb,
  // action buttons and right stick under the right thumb, rare buttons in the middle.
  const left = h('div', { class: 'hp-left' });
  left.append(dpad(), stick(0, t('Stik kiri'), left));
  const right = h('div', { class: 'hp-right' });
  right.append(faceButtons(), stick(2, t('Stik kanan')));
  app.append(trigger(6, 'L2'), button(4, 'hp-sh l1', 'L1', 'L1'), mid, button(5, 'hp-sh r1', 'R1', 'R1'), trigger(7, 'R2'), left, right);
  document.body.append(app);
  noZoom();
  layout();
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', layout);
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  // A locked or backgrounded phone must not leave the player running.
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); else void wake(); });
  // capture phase: controls stop propagation of their own presses
  window.addEventListener('pointerdown', () => { void wake(); landscape(); }, { once: true, capture: true });
  window.addEventListener('hashchange', () => location.reload());
  void wake();
  ui();
  net.start();
});
