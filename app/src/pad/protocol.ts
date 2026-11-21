// Phone-as-controller wire protocol (REQ-HP). Shared by the PC (virtual-pads.ts),
// the phone page (phone.ts) and mirrored by server/pad-relay.mjs. Messages are
// JSON text; the relay adds `from` (phone id) on phone->screen and reads `to`
// on screen->phone.

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 6;
export const MAX_PHONES = 4;
export const MAX_MSG = 2048;
export const BUTTONS = 17;
export const RTC_TIMEOUT_MS = 4000;
export const SILENT_MS = 3000;
export const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/** Input packet, compact array: ['i', seq, buttonsBitmask, l2 0..255, r2 0..255, lx, ly, rx, ry] (axes int8 -127..127). */
export type InputPacket = ['i', number, number, number, number, number, number, number, number];

export type Msg =
  | { t: 'room'; code: string } // relay -> screen
  | { t: 'joined'; id: string } // relay -> phone
  | { t: 'phone-join'; from: string } // relay -> screen
  | { t: 'phone-leave'; from: string } // relay -> screen
  | { t: 'refused'; reason: 'full' | 'no-room' | 'bad-code' | 'busy' } // relay -> phone
  | { t: 'hello'; name?: string }
  | { t: 'seat'; n: number } // PC -> phone (0 = waiting in lobby, 2..5 = game seat)
  | { t: 'ping'; ts: number }
  | { t: 'pong'; ts: number }
  | { t: 'rumble'; ms: number; strong: number; weak: number }
  | { t: 'offer' | 'answer'; sdp: string }
  | { t: 'ice'; c: RTCIceCandidateInit | null }
  | { t: 'bye' };

export type Wire = (Msg | { t: 'input'; p: InputPacket }) & { from?: string; to?: string };

export interface PadState { buttons: number[]; axes: number[] } // buttons 0..1 values x17, axes -1..1 x4

const i8 = (v: number) => Math.max(-127, Math.min(127, Math.round(v * 127)));
const u8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

export function encodeInput(seq: number, s: PadState): InputPacket {
  let mask = 0;
  for (let i = 0; i < BUTTONS; i++) if ((s.buttons[i] ?? 0) > 0.5) mask |= 1 << i;
  return ['i', seq, mask, u8(s.buttons[6] ?? 0), u8(s.buttons[7] ?? 0), i8(s.axes[0] ?? 0), i8(s.axes[1] ?? 0), i8(s.axes[2] ?? 0), i8(s.axes[3] ?? 0)];
}

/** Packet to button values and axes; L2/R2 keep their analog value. Null when malformed. */
export function decodeInput(p: unknown): { seq: number; buttons: number[]; axes: number[] } | null {
  if (!Array.isArray(p) || p.length !== 9 || p[0] !== 'i' || !p.slice(1).every((n) => Number.isFinite(n))) return null;
  const [, seq, mask, l2, r2, ...ax] = p as number[];
  const buttons: number[] = Array.from({ length: BUTTONS }, (_, i) => ((mask >>> i) & 1 ? 1 : 0));
  buttons[6] = Math.max(0, Math.min(255, l2)) / 255;
  buttons[7] = Math.max(0, Math.min(255, r2)) / 255;
  return { seq, buttons, axes: ax.map((v) => Math.max(-1, Math.min(1, v / 127))) };
}

export function validCode(c: string): boolean {
  return c.length === CODE_LEN && [...c].every((ch) => CODE_ALPHABET.includes(ch));
}
