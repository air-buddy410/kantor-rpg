// Gamepad support through the browser Gamepad API (standard mapping: Xbox,
// PlayStation, most Bluetooth pads). Loaded lazily on the first
// `gamepadconnected`, so players without a pad download nothing.
//
// World: left stick walks (full tilt runs), right stick turns and tilts the
// camera, A interacts, B goes back, X toggles run, Y recenters the camera,
// LB/RB zoom, Select opens the map, Start opens Settings.
// Menus and dialogs: the D-pad (or a left stick flick inside a dialog) moves
// focus to the nearest control in that direction, A activates it, B closes.
// Studio: the D-pad navigates its controls; the right stick moves the selected fixture.
// The profile picked in Settings (pad-profiles.ts) can swap the sticks, widen the
// dead zone, slow the camera and turn off running at full tilt.
import { toast } from '../ui/dom';
import { t } from '../i18n';
import { PAD_PROFILES, faceButtons, stick as radial, stickAxes, type PadProfileId } from './pad-profiles';
import { PadActivity, setDevice } from './mode';
import { connectedText } from '../ui/pad-hud';

/** What the pad drives in the 3D world. Absent in the no-WebGL fallback. */
export interface PadWorld {
  setMove(m: { x: number; y: number; run: boolean } | null): void;
  look(yaw: number, pitch: number): void;
  zoom(f: number): void;
  interact(): void;
  toggleRun(): void;
  studioOpen(): boolean;
}

// Standard mapping indices (w3c.github.io/gamepad/#remapping).
export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, SELECT: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;
type Dir = 'up' | 'down' | 'left' | 'right';

const DEAD = 0.22;
const REPEAT_FIRST = 380;
const REPEAT_NEXT = 130;
const FOCUSABLE = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';

export const stick = (x: number, y: number, dead = DEAD) => radial(x, y, dead);

/** On-screen box used for spatial navigation; tiny inputs borrow their label's box. */
function box(e: HTMLElement): DOMRect | null {
  let r = e.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) {
    const label = e.closest('label') ?? (e.id ? document.querySelector<HTMLElement>(`label[for="${CSS.escape(e.id)}"]`) : null);
    if (!label) return null;
    r = label.getBoundingClientRect();
  }
  return r.width && r.height ? r : null;
}

export function focusables(scope: ParentNode): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) =>
    !(e as HTMLButtonElement).disabled && !e.closest('[hidden], [inert]') && getComputedStyle(e).visibility !== 'hidden' && box(e) !== null);
}

/** Nearest control from `from` in direction `dir`; null when nothing lies that way. */
export function nearest(from: HTMLElement, list: HTMLElement[], dir: Dir): HTMLElement | null {
  const a = box(from);
  if (!a) return list[0] ?? null;
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const e of list) {
    if (e === from) continue;
    const b = box(e)!;
    const dx = b.left + b.width / 2 - ax;
    const dy = b.top + b.height / 2 - ay;
    const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
    if (along <= 2) continue;
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    const score = along + across * 2.5;
    if (score < bestScore) { bestScore = score; best = e; }
  }
  return best;
}

// Modal stack in opening order: DOM order says nothing about which modal is on top.
const stack: HTMLDialogElement[] = [];
function track() {
  const sync = (d: HTMLDialogElement) => {
    const i = stack.indexOf(d);
    if (i >= 0) stack.splice(i, 1);
    if (d.open) stack.push(d);
  };
  // Already open when the pad connects: the modal holding focus is the top one.
  const open = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')];
  const focused = open.find((d) => d.contains(document.activeElement));
  open.filter((d) => d !== focused).concat(focused ? [focused] : []).forEach(sync);
  new MutationObserver((rs) => rs.forEach((r) => { if (r.target instanceof HTMLDialogElement) sync(r.target); }))
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
}

function topDialog(): HTMLDialogElement | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    const d = stack[i];
    if (d.open && d.isConnected) return d;
    stack.splice(i, 1);
  }
  return document.querySelector<HTMLDialogElement>('dialog[open]');
}

/** Same path as a real key press, so every existing shortcut handler applies. */
function key(k: string, onBody = false) {
  const target = onBody ? document.body : document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  target.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true, cancelable: true }));
}

function visible(id: string): HTMLElement | null {
  const e = document.getElementById(id);
  return e && e.getClientRects().length && !e.closest('[hidden]') ? e : null;
}

export class GamepadControl {
  private prev: boolean[] = [];
  private held: { dir: Dir; next: number } | null = null;
  private last = performance.now();
  private raf = 0;
  /** True once the pad has moved focus; cleared by B or by mouse/touch. */
  private navigating = false;
  private nudgeAt = 0;
  private seen = new PadActivity();

  constructor(private target: () => PadWorld | null, private profile: () => PadProfileId = () => 'standar') {
    track();
    window.addEventListener('gamepadconnected', () => this.connected());
    window.addEventListener('gamepaddisconnected', () => { if (!this.pad()) { this.target()?.setMove(null); toast(t('Stik terputus.')); } });
    window.addEventListener('pointerdown', () => this.leaveUi(false), true);
    this.connected();
  }

  private pad(): Gamepad | null {
    for (const p of navigator.getGamepads?.() ?? []) if (p && p.connected) return p;
    return null;
  }

  private connected() {
    if (!this.pad()) return;
    if (!this.raf) {
      toast(connectedText(), 4200);
      this.last = performance.now();
      this.raf = requestAnimationFrame(() => this.tick());
    }
  }

  private tick() {
    const p = this.pad();
    if (!p) { this.raf = 0; this.prev = []; return; }
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.poll(p, now, dt);
    this.raf = requestAnimationFrame(() => this.tick());
  }

  private poll(p: Gamepad, now: number, dt: number) {
    const prof = PAD_PROFILES[this.profile()] ?? PAD_PROFILES.standar;
    const raw = p.buttons.map((b) => b.pressed || b.value > 0.5);
    // Any fresh press or push switches the HUD to pad glyphs (mini games do the same in host.ts).
    if (this.seen.seen(p)) setDevice('pad', p);
    // A mini game reads the pad itself (minigames/host.ts); the world and the
    // menus must not also react to the same presses.
    if (document.documentElement.hasAttribute('data-minigame')) { this.target()?.setMove(null); this.prev = raw; return; }
    // Logical A/B/X/Y read from the physical buttons the profile assigns to them.
    // Edges are taken on the physical button, so switching profile while a
    // button is held does not fire the action it now maps to.
    const face = faceButtons(prof);
    const phys = (i: number) => (i === BTN.A ? face.A : i === BTN.B ? face.B : i === BTN.X ? face.X : i === BTN.Y ? face.Y : i);
    const down = raw.map((_, i) => !!raw[phys(i)]);
    const hit = (i: number) => !!raw[phys(i)] && !this.prev[phys(i)];
    const dialog = topDialog();
    const ui = !!dialog || (this.navigating && document.activeElement !== document.body);
    const ax = stickAxes(prof);
    const [lx, ly] = stick(p.axes[ax.move[0]] ?? 0, p.axes[ax.move[1]] ?? 0, prof.dead);
    const [rx, ry] = stick(p.axes[ax.look[0]] ?? 0, p.axes[ax.look[1]] ?? 0, prof.dead);

    const world = this.target();
    const studio = !!world?.studioOpen();
    // World motion. The Input layer already zeroes it while a dialog is open.
    if (world) {
      world.setMove(dialog || studio ? null : { x: lx, y: -ly, run: prof.autoRun && Math.hypot(lx, ly) > 0.97 });
      if (!dialog && !studio) {
        if (rx || ry) world.look(rx * dt * prof.lookYaw, -ry * dt * prof.lookPitch);
        if (down[BTN.LB]) world.zoom(Math.pow(1.9, dt));
        if (down[BTN.RB]) world.zoom(Math.pow(1.9, -dt));
      }
      // Studio keeps its fixed plan camera; the right stick nudges the selected fixture.
      if (studio && !dialog && Math.hypot(rx, ry) > 0.5 && now >= this.nudgeAt) {
        this.nudgeAt = now + 160;
        key(Math.abs(rx) > Math.abs(ry) ? (rx > 0 ? 'ArrowRight' : 'ArrowLeft') : (ry > 0 ? 'ArrowDown' : 'ArrowUp'), true);
      }
    }

    // Direction: D-pad anywhere; a left stick flick only inside a dialog.
    let dir: Dir | null = down[BTN.UP] ? 'up' : down[BTN.DOWN] ? 'down' : down[BTN.LEFT] ? 'left' : down[BTN.RIGHT] ? 'right' : null;
    if (!dir && dialog) {
      const sx = p.axes[ax.move[0]] ?? 0;
      const sy = p.axes[ax.move[1]] ?? 0;
      if (Math.hypot(sx, sy) > 0.6) dir = Math.abs(sx) > Math.abs(sy) ? (sx > 0 ? 'right' : 'left') : (sy > 0 ? 'down' : 'up');
    }
    if (dir) {
      const fresh = !this.held || this.held.dir !== dir;
      if (fresh || now >= this.held!.next) {
        this.held = { dir, next: now + (fresh ? REPEAT_FIRST : REPEAT_NEXT) };
        this.direction(dir, !!dialog);
      }
    } else this.held = null;

    if (hit(BTN.A)) {
      if (ui) this.activate();
      else if (studio) this.direction('down', false); // focus was lost by a Studio rebuild: put it back
      else world?.interact();
    }
    if (hit(BTN.B)) {
      if (dialog) this.closeDialog(dialog);
      else if (this.navigating) this.leaveUi(true);
      else key('Escape');
    }
    if (hit(BTN.X) || hit(BTN.LS)) world?.toggleRun();
    if (hit(BTN.Y) || hit(BTN.RS)) { if (!dialog) key('r'); }
    if (hit(BTN.SELECT)) { if (dialog) this.closeDialog(dialog); key('p'); }
    if (hit(BTN.START)) {
      if (dialog) this.closeDialog(dialog);
      else document.getElementById('btn-settings')?.click();
    }
    this.prev = raw;
  }

  private direction(dir: Dir, inDialog: boolean) {
    const active = document.activeElement as HTMLElement | null;
    // Sliders and dropdowns take left/right as a value change.
    if (active && (dir === 'left' || dir === 'right')) {
      if (active instanceof HTMLSelectElement) {
        const n = active.options.length;
        if (n) {
          active.selectedIndex = (active.selectedIndex + (dir === 'right' ? 1 : n - 1)) % n;
          active.dispatchEvent(new Event('input', { bubbles: true }));
          active.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return;
      }
      if (active instanceof HTMLInputElement && active.type === 'range') {
        if (dir === 'right') active.stepUp(); else active.stepDown();
        active.dispatchEvent(new Event('input', { bubbles: true }));
        active.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
    // The open Studio panel acts like a dialog: focus stays inside it.
    const studio = document.getElementById('studio-panel');
    const scope: ParentNode = topDialog() ?? (studio && !studio.hidden ? studio : document);
    const list = focusables(scope);
    if (!list.length) return;
    const inScope = active && active !== document.body && list.includes(active);
    const next = inScope ? nearest(active!, list, dir) : this.entry(list, inDialog);
    if (!next) return;
    this.enterUi();
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  /** First stop when the pad enters a dialog or the HUD. */
  private entry(list: HTMLElement[], inDialog: boolean): HTMLElement {
    if (inDialog) return list.find((e) => !(e instanceof HTMLButtonElement && e.value === 'close')) ?? list[0];
    const studio = document.getElementById('studio-panel');
    if (studio && !studio.hidden) { const first = list.find((e) => studio.contains(e)); if (first) return first; }
    return visible('btn-hud-toggle') && document.querySelector('.hud-top')?.getAttribute('data-menu') === 'closed'
      ? document.getElementById('btn-hud-toggle')!
      : visible('btn-chat') ?? visible('btn-directory') ?? list[0];
  }

  private activate() {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body) return;
    if (a instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color'].includes(a.type)) { a.select(); return; }
    if (a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement) return;
    // Panels such as the Studio re-render after a click and drop the focused node.
    // Keep the pad's place by moving to the control at the same position.
    const scope: ParentNode = topDialog() ?? a.closest('#studio-panel, #directory-panel') ?? document;
    const before = focusables(scope);
    const index = before.indexOf(a);
    a.click();
    requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      const after = focusables(topDialog() ?? scope);
      after[Math.min(Math.max(index, 0), after.length - 1)]?.focus({ preventScroll: true });
    });
  }

  private closeDialog(d: HTMLDialogElement) {
    if (d.dispatchEvent(new Event('cancel', { cancelable: true }))) d.close();
  }

  private enterUi() {
    this.navigating = true;
    document.documentElement.dataset.input = 'pad';
  }

  private leaveUi(blur: boolean) {
    if (!this.navigating) return;
    this.navigating = false;
    delete document.documentElement.dataset.input;
    if (blur) (document.activeElement as HTMLElement | null)?.blur();
  }
}

export function startGamepad(target: () => PadWorld | null, profile?: () => PadProfileId) {
  return new GamepadControl(target, profile);
}
