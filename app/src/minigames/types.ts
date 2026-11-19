// Contract between the mini game host (host.ts) and each game module.
// A module is loaded only when the player opens it, so nothing here may pull
// in three.js or world code: games draw on a plain 2D canvas.

export type Btn = 'left' | 'right' | 'up' | 'down' | 'a' | 'b' | 'x' | 'y';
export const BTNS: Btn[] = ['left', 'right', 'up', 'down', 'a', 'b', 'x', 'y'];
/**
 * Pad-only controls a game may read from InputState.pad: the walking stick
 * ('ls'), the camera stick ('rs') and the triggers. The left-handed profile
 * swaps which physical stick is which, the legend follows.
 */
export type PadExtra = 'ls' | 'rs' | 'l1' | 'r1' | 'l2' | 'r2' | 'options' | 'create' | 'dpad';
/** Legend and tutorial keys: a button, the four directions ('arah'), one axis ('lr', 'ud') or a pad-only control. */
export type LegendKey = Btn | 'arah' | 'lr' | 'ud' | PadExtra;
/** One legend entry: the key (or keys that do the same thing) and a one to three word label. */
export type LegendEntry = [LegendKey | LegendKey[], string];

/** Raw analog state of Pemain 1's pad, mapped through the controller profile. */
export interface PadAnalog {
  /** Walking stick and camera stick (swapped by the left-handed profile), -1..1, no dead zone applied. */
  move: [number, number];
  look: [number, number];
  /** Trigger travel 0..1. */
  l2: number;
  r2: number;
  /** Shoulder buttons held. */
  l1: boolean;
  r1: boolean;
  /** Profile dead zone, for games that apply their own curve. */
  dead: number;
  /** Aim speed multiplier from the controller profile (Santai turns slower). */
  aim: number;
}

/** Input snapshot for one frame. `down` is held, `hit` is pressed this frame. */
export interface InputState {
  down: Record<Btn, boolean>;
  hit: Record<Btn, boolean>;
  /** Analog direction, -1..1 each axis, y up = -1 (screen space). Digital keys give unit steps. */
  ax: number;
  ay: number;
  /** Last pointer tap in game units, consumed by the game (games that support tap). */
  tap: { x: number; y: number } | null;
  /**
   * Live pointer (mouse or finger) in game units while it is over the canvas,
   * `down` true while pressed. Lets games offer drag controls (aim, pull back).
   * Optional so the headless harness and older games can ignore it.
   */
  ptr?: { x: number; y: number; down: boolean } | null;
  /**
   * Local multiplayer: one input per player, index 0 is Pemain 1 (the same
   * state as the fields above). Present only when more than one player joined.
   */
  players?: InputState[];
  /** Present while Pemain 1 has a gamepad: sticks and triggers for analog controls. */
  pad?: PadAnalog;
}

export interface GameResult {
  /** Number saved to the leaderboard; 0 means "no score" (quit early). */
  score: number;
  /** Short line shown on the result card, already translated. */
  summary?: string;
  won?: boolean;
  /** A match between local players: no leaderboard entry, no score line. */
  versus?: boolean;
}

export interface GameMeta {
  id: string;
  /** Indonesian source title; t() translates. */
  title: string;
  /** One line under the title in the launcher and the help card. */
  blurb: string;
  /** Logical canvas size in game units; the host letterboxes it. */
  view: { w: number; h: number };
  score: { unit: string; higherIsBetter: boolean; time?: boolean };
  /** Music track name for audio/music.ts. */
  music: string;
  /** Where the game lives: a facility kind from world.json, or 'arcade'. */
  place: string;
  /** Which on-screen buttons a touch player needs. */
  touch: Btn[];
  /**
   * What each button does in this game (Indonesian source, host translates).
   * The tutorial turns these into per-device rows: keyboard keys, gamepad
   * buttons and on-screen buttons. 'arah' covers the four directions.
   */
  actions?: Partial<Record<Btn | 'arah', string>>;
  /** Extra tutorial line for touch/mouse players (drag or tap controls). */
  pointerHint?: string;
  /**
   * Short tutorial on the intro card: two or three steps (Indonesian source).
   * {a}, {arah}, {lr} and the other LegendKey names become the key of the
   * device in use (Spasi on a keyboard, the Cross glyph on a DualSense).
   */
  tutorial: string[];
  /** Tutorial for gamepad players when the pad plays differently (analog aim, triggers). */
  padTutorial?: string[];
  /** Legend bar under the running game. Pad-only keys are left out on other devices. */
  legend: LegendEntry[];
  /** Legend for gamepad players when the pad plays differently (replaces `legend` on a pad). */
  padLegend?: LegendEntry[];
  /** Rows in the button list that exist only on a gamepad (sticks, triggers). */
  padActions?: Partial<Record<PadExtra, string>>;
  /** Local multiplayer: how many players may join on one screen (default 1). */
  players?: number;
  /** Lobby line for multiplayer games, e.g. what Pemain 2 controls (Indonesian source). */
  playersHint?: string;
  /**
   * Turn-based game that two people can play on one device by passing it:
   * the intro card offers "Gantian satu perangkat" and the host then sends
   * Pemain 1's input as Pemain 2 too.
   */
  hotseat?: boolean;
}

/** Everything the host gives a running game. */
export interface GameCtx {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  readonly w: number;
  readonly h: number;
  /** Deterministic RNG for this run (seeded by the host). */
  rand(): number;
  readonly seed: number;
  /** Translate an Indonesian UI string. */
  t(s: string, vars?: Record<string, string | number>): string;
  /**
   * What to press on the device in use, for canvas text: Spasi on a keyboard,
   * ✕ on a DualSense. `pad` asks for the gamepad key (Pemain 2 always plays on a pad).
   */
  key(k: LegendKey, pad?: boolean): string;
  /** Short rumble on Pemain 1's gamepad (0..1 strength); nothing without a pad. */
  rumble(strength: number, ms: number): void;
  sfx(name: string, opts?: { pan?: number; rate?: number; gain?: number }): void;
  readonly reducedMotion: boolean;
  /** Player avatar colours and the cast, for drawing characters. */
  readonly cast: CastMember[];
  readonly playerId: string;
  /** Players who joined on the intro card (1 = solo against the computer). */
  readonly players: number;
  /** Finish the run; the host shows the result card. */
  end(r: GameResult): void;
  /** Live score shown in the host bar. */
  setHud(text: string): void;
}

export interface CastMember {
  id: string;
  name: string;
  role: string;
  skin: string;
  hair: string;
  hairStyle: string;
  main: string;
  inner: string;
  bottom: string;
  accent: string;
  shoes: string;
}

export interface GameInstance {
  update(dt: number, input: InputState): void;
  render(): void;
  /** Optional: host is about to remove the game. */
  dispose?(): void;
  /** Optional state for tests (plain JSON). */
  snapshot?(): Record<string, unknown>;
}

export interface GameModule {
  meta: GameMeta;
  create(ctx: GameCtx): GameInstance;
}
