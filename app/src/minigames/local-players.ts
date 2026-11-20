// Local multiplayer for mini games: extra gamepads join as Pemain 2, 3, 4 on
// the intro card and each gets its own input, with the same press queue as
// Pemain 1 (no press lost on 120 Hz screens, a held button never fires the
// next screen). Pemain 1 stays keyboard + touch + the first pad.
import { BTNS, type Btn, type InputState, type PadAnalog } from './types';
import { PAD_PROFILES, faceButtons, stickAxes, type PadProfile } from '../input/pad-profiles';
import type { PadProfileId } from '../ui/settings';

export interface PadRead { down: Record<Btn, boolean>; ax: number; ay: number; raw: boolean[]; analog?: PadAnalog }

const NONE = (): Record<Btn, boolean> => Object.fromEntries(BTNS.map((b) => [b, false])) as Record<Btn, boolean>;

/** One pad's buttons and stick, mapped through the controller profile. */
export function readPadState(p: Gamepad | null | undefined, prof: PadProfile, aimSpeed = 1): PadRead {
  if (!p || !p.connected) return { down: NONE(), ax: 0, ay: 0, raw: [] };
  const f = faceButtons(prof);
  const ax = stickAxes(prof);
  const raw = p.buttons.map((b) => b.pressed || b.value > 0.5);
  const sx = p.axes[ax.move[0]] ?? 0;
  const sy = p.axes[ax.move[1]] ?? 0;
  const lx = Math.abs(sx) > prof.dead ? sx : 0;
  const ly = Math.abs(sy) > prof.dead ? sy : 0;
  return {
    down: {
      a: !!raw[f.A], b: !!raw[f.B], x: !!raw[f.X], y: !!raw[f.Y],
      left: !!raw[14] || lx < -0.5, right: !!raw[15] || lx > 0.5, up: !!raw[12] || ly < -0.5, down: !!raw[13] || ly > 0.5,
    },
    ax: raw[14] ? -1 : raw[15] ? 1 : lx,
    ay: raw[12] ? -1 : raw[13] ? 1 : ly,
    raw,
    // Sticks and triggers for analog games (billiards aims with Pemain 2's pad too).
    analog: {
      move: [sx, sy], look: [p.axes[ax.look[0]] ?? 0, p.axes[ax.look[1]] ?? 0],
      l2: p.buttons[6]?.value ?? 0, r2: p.buttons[7]?.value ?? 0, l1: !!raw[4], r1: !!raw[5],
      dead: prof.dead, aim: prof.aimScale * aimSpeed,
    },
  };
}

/** Phones from "Main pakai HP" (pad/virtual-pads.ts): they join as Pemain 2 and up, never as Pemain 1. */
export const isPhonePad = (p: Gamepad | null | undefined) => !!p && p.id.startsWith('HP PerumNet');

export function connectedPads(): Gamepad[] {
  return [...(navigator.getGamepads?.() ?? [])].filter((g): g is Gamepad => !!g && g.connected);
}

/** Pemain 2..4: one physical pad each, read by its Gamepad.index. */
export class PadPlayer {
  private prev = NONE();
  private queued = Object.fromEntries(BTNS.map((b) => [b, 0])) as Record<Btn, number>;
  private rawPrev: boolean[] = [];
  delivered = 0;
  /** Edges of Start (pause) and Select seen this frame. */
  start = false;
  select = false;
  /** Fresh presses this frame, in any phase (lobby: B leaves). */
  edge = NONE();
  private last: PadRead = { down: NONE(), ax: 0, ay: 0, raw: [] };

  constructor(readonly index: number, private profile: () => PadProfileId, private aimSpeed: () => number = () => 100) {
    // the A that joined this player is still held: it must not count in play
    this.prev = { ...this.read().down };
  }

  private read(): PadRead {
    const p = navigator.getGamepads?.()[this.index] ?? null;
    return readPadState(p, PAD_PROFILES[this.profile()] ?? PAD_PROFILES.standar, this.aimSpeed() / 100);
  }

  get connected(): boolean { return !!navigator.getGamepads?.()[this.index]?.connected; }

  /** Poll once per animation frame. Presses queue only while playing. */
  poll(playing: boolean) {
    const r = this.read();
    this.start = !!r.raw[9] && !this.rawPrev[9];
    this.select = !!r.raw[8] && !this.rawPrev[8];
    this.rawPrev = r.raw;
    for (const b of BTNS) {
      this.edge[b] = r.down[b] && !this.prev[b];
      if (playing && r.down[b] && !this.prev[b] && this.queued[b] < 3) this.queued[b]++;
      if (!playing) this.queued[b] = 0;
    }
    this.prev = { ...r.down };
    this.last = r;
  }

  /** Input for one 60 Hz game step; takes at most one queued press per button. */
  step(): InputState {
    const hit = NONE();
    const down = NONE();
    for (const b of BTNS) {
      hit[b] = this.queued[b] > 0;
      if (hit[b]) { this.queued[b]--; this.delivered++; }
      down[b] = this.last.down[b] || hit[b];
    }
    return { down, hit, ax: this.last.ax, ay: this.last.ay, tap: null, ptr: null, ...(this.last.analog ? { pad: this.last.analog } : {}) };
  }

  clear() { for (const b of BTNS) this.queued[b] = 0; }
}

/** Player colours for cursors, labels and markers (P1..P4). */
// white text passes 4.5:1 on the first three; yellow (5.8:1 with dark ink) takes dark text (cast.ts onSeat)
export const PLAYER_COLORS = ['#c4462b', '#2a74b5', '#2e8546', '#c99a1e'];
const SEAT_DARK = ['#8a2e1b', '#1b4f7c', '#1f5c30', '#8a6a10'];

/**
 * A cast member dressed in the seat colour. With 4 people on one screen the
 * shirt is what eyes track; Budi's green shirt read as Pemain 3 (green).
 */
export function seatLook<T extends { main: string; accent: string }>(c: T, seat: number): T {
  return { ...c, main: PLAYER_COLORS[seat], accent: SEAT_DARK[seat] };
}
