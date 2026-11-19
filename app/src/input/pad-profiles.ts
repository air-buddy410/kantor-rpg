// Gamepad profiles chosen in Settings. Pure data, imported only by the lazy
// gamepad loop and the lazy Settings visual, so the entry chunk stays the same.
import type { PadProfileId } from '../ui/settings';
export type { PadProfileId };
export const PAD_PROFILE_IDS: readonly PadProfileId[] = ['standar', 'kidal', 'santai', 'terbalik'];

export interface PadProfile {
  /** Right stick walks and left stick turns the camera. */
  swapSticks: boolean;
  /** Radial dead zone; larger tolerates a pad whose sticks drift. */
  dead: number;
  /** Camera speed in rad/s at full tilt. */
  lookYaw: number;
  lookPitch: number;
  /** Full tilt switches to running; off means running only via the run button. */
  autoRun: boolean;
  /** Face buttons reversed, Japanese/Nintendo style: Cross <-> Circle, Square <-> Triangle. */
  swapFace: boolean;
  /** Multiplier for analog aiming in mini games (billiards cue): Santai turns slower. */
  aimScale: number;
}

export const PAD_PROFILES: Record<PadProfileId, PadProfile> = {
  standar: { swapSticks: false, dead: 0.22, lookYaw: 2.4, lookPitch: 1.2, autoRun: true, swapFace: false, aimScale: 1 },
  kidal: { swapSticks: true, dead: 0.22, lookYaw: 2.4, lookPitch: 1.2, autoRun: true, swapFace: false, aimScale: 1 },
  santai: { swapSticks: false, dead: 0.32, lookYaw: 1.4, lookPitch: 0.7, autoRun: false, swapFace: false, aimScale: 0.6 },
  terbalik: { swapSticks: false, dead: 0.22, lookYaw: 2.4, lookPitch: 1.2, autoRun: true, swapFace: true, aimScale: 1 },
};

export function isPadProfile(v: unknown): v is PadProfileId {
  return typeof v === 'string' && (PAD_PROFILE_IDS as readonly string[]).includes(v);
}

/** Axis indices [x, y] of the walking stick and the camera stick for a profile. */
export function stickAxes(p: PadProfile): { move: [number, number]; look: [number, number] } {
  return p.swapSticks ? { move: [2, 3], look: [0, 1] } : { move: [0, 1], look: [2, 3] };
}

/** Physical standard-mapping index that triggers each logical face action (A, B, X, Y). */
export function faceButtons(p: PadProfile): { A: number; B: number; X: number; Y: number } {
  return p.swapFace ? { A: 1, B: 0, X: 3, Y: 2 } : { A: 0, B: 1, X: 2, Y: 3 };
}

/** Radial dead zone, rescaled so motion starts at 0 just past the zone. */
export function stick(x: number, y: number, dead = 0.22): [number, number] {
  const m = Math.hypot(x, y);
  if (m < dead) return [0, 0];
  const k = Math.min(1, (m - dead) / (1 - dead)) / m;
  return [x * k, y * k];
}
