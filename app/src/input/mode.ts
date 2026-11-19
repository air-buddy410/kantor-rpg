// Which input the player is using right now. The HUD, prompts and mini game
// legends show that device's buttons (Budi 2026-11-19: DualSense layout as soon
// as the controller connects). A key press, a click or a touch takes the HUD
// back; the next pad press switches it again. Kept on <html data-device> so CSS
// swaps keyboard hints for pad glyphs and hides the touch overlay.
import { padKind, type PadKind } from './glyphs';

export type Device = 'keyboard' | 'pad' | 'touch';

const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const pads = () => [...(typeof navigator !== 'undefined' ? navigator.getGamepads?.() ?? [] : [])].filter((p): p is Gamepad => !!p && p.connected);
let device: Device = coarse() ? 'touch' : 'keyboard';
let kind: PadKind = 'ps';

export const currentDevice = (): Device => device;
export const currentPadKind = (): PadKind => kind;

export function setDevice(d: Device, pad?: Gamepad | null) {
  const k = pad ? padKind(pad.id) : kind;
  if (d === device && k === kind) return;
  device = d;
  kind = k;
  document.documentElement.dataset.device = d;
  document.documentElement.dataset.pad = k;
  window.dispatchEvent(new Event('kantor:device'));
}

/**
 * Connecting a pad switches the HUD to it at once. Keyboard, mouse and touch
 * take it back. Capture phase on window, because the mini game host stops key
 * propagation; untrusted events are the keys the pad layer synthesises (B
 * sends Escape) and must not count.
 */
let tracking = false;
export function trackDevices() {
  if (tracking) return;
  tracking = true;
  const first = pads()[0];
  if (first) setDevice('pad', first);
  document.documentElement.dataset.device = device;
  document.documentElement.dataset.pad = kind;
  window.addEventListener('gamepadconnected', (e) => setDevice('pad', (e as GamepadEvent).gamepad));
  window.addEventListener('gamepaddisconnected', () => { if (device === 'pad' && !pads().length) setDevice(coarse() ? 'touch' : 'keyboard'); });
  window.addEventListener('keydown', (e) => { if (e.isTrusted) setDevice('keyboard'); }, true);
  window.addEventListener('pointerdown', (e) => { if (e.isTrusted) setDevice(e.pointerType === 'mouse' ? 'keyboard' : 'touch'); }, true);
}

/**
 * Rising edges only: a fresh button press or a stick pushed past half way. The
 * first poll only records the state, so a button already held (or a pad whose
 * axis rests at -1) does not pull the HUD away from the keyboard.
 */
export class PadActivity {
  private prev: boolean[] | null = null;
  private tilted = false;
  seen(p: Gamepad): boolean {
    const raw = p.buttons.map((b) => b.pressed || b.value > 0.5);
    const tilted = [0, 1, 2, 3].some((i) => Math.abs(p.axes[i] ?? 0) > 0.5);
    const fresh = !!this.prev && (raw.some((v, i) => v && !this.prev![i]) || (tilted && !this.tilted));
    this.prev = raw;
    this.tilted = tilted;
    return fresh;
  }
}
