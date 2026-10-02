// Keyboard + touch input. Locomotion is suppressed whenever a dialog is open
// or focus sits in a form control, so typing never moves the avatar.
import { anyDialogOpen } from '../ui/dom';

export class Input {
  private keys = new Set<string>();
  private joy = { x: 0, y: 0, active: false, id: -1 };
  runToggle = false;
  onInteract: () => void = () => {};
  onKey: (key: string) => void = () => {};

  constructor(private joystick: HTMLElement, private knob: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (this.textFocus()) return;
      const k = e.key.toLowerCase();
      if (anyDialogOpen()) return;
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      // Enter on a focused button/link must activate that control, not the world;
      // E has no native meaning, so it always interacts (focus often rests on a
      // HUD button after using the directory).
      const onControl = document.activeElement instanceof HTMLButtonElement || document.activeElement instanceof HTMLAnchorElement;
      if (!e.repeat && (k === 'e' || (k === 'enter' && !onControl))) this.onInteract();
      if (!e.repeat) this.onKey(k);
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    joystick.addEventListener('pointerdown', (e) => {
      this.joy.active = true;
      this.joy.id = e.pointerId;
      joystick.setPointerCapture(e.pointerId);
      this.updateJoy(e);
    });
    joystick.addEventListener('pointermove', (e) => { if (this.joy.active && e.pointerId === this.joy.id) this.updateJoy(e); });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.joy.id) return;
      this.joy = { x: 0, y: 0, active: false, id: -1 };
      knob.style.transform = '';
    };
    joystick.addEventListener('pointerup', end);
    joystick.addEventListener('pointercancel', end);
  }

  private updateJoy(e: PointerEvent) {
    const r = this.joystick.getBoundingClientRect();
    let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    this.joy.x = dx;
    this.joy.y = dy;
    this.knob.style.transform = `translate(${dx * 38}px, ${dy * 38}px)`;
  }

  textFocus(): boolean {
    const a = document.activeElement;
    return !!a && (a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement || (a as HTMLElement).isContentEditable);
  }

  enabled(): boolean {
    return !anyDialogOpen() && !this.textFocus();
  }

  /** Movement intent in camera space: x = right, y = forward, magnitude 0..1. */
  move(): { x: number; y: number; run: boolean } {
    if (!this.enabled()) return { x: 0, y: 0, run: false };
    let x = 0;
    let y = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) y += 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) y -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    if (this.joy.active) { x += this.joy.x; y -= this.joy.y; }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y, run: this.keys.has('shift') || this.runToggle || (this.joy.active && Math.hypot(this.joy.x, this.joy.y) > 0.95) };
  }

  held(key: string): boolean { return this.enabled() && this.keys.has(key); }
  clear(): void { this.keys.clear(); }
}
