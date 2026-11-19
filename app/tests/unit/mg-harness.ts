// Headless runner for mini game modules: a no-op 2D context, scripted input and
// a fixed 60 Hz clock. Lets vitest play a game to the end without a browser.
import type { Btn, GameCtx, GameModule, GameResult, InputState } from '../../src/minigames/types';
import { BTNS } from '../../src/minigames/types';
import { buildCast } from '../../src/minigames/cast';

function fakeContext(): CanvasRenderingContext2D {
  const grad = { addColorStop() {} };
  const target: Record<string | symbol, unknown> = {
    measureText: (s: string) => ({ width: String(s).length * 7, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createPattern: () => ({}),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    isPointInPath: () => false,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  };
  return new Proxy(target, {
    get(t, k) { return k in t ? t[k] : () => undefined; },
    set(t, k, v) { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
}

export interface Run {
  ctx: GameCtx;
  result: GameResult | null;
  /** Rumble requests the game made: [strength, ms]. */
  rumbles: [number, number][];
  hud: string;
  sfx: string[];
  /** Advance n frames (1/60 s each) holding `held` buttons; `press` is a one-frame hit. */
  step(n?: number, held?: Btn[], press?: Btn[], axis?: { x: number; y: number }, tap?: { x: number; y: number } | null): void;
  /** Play until the game ends or `maxSeconds` pass, choosing input each frame with `policy`. */
  play(policy: (frame: number, snap: Record<string, unknown>) => { held?: Btn[]; press?: Btn[]; axis?: { x: number; y: number }; tap?: { x: number; y: number } | null }, maxSeconds: number): GameResult | null;
  snap(): Record<string, unknown>;
  /** Multiplayer: advance n frames; `per[k]` is Pemain k+1's held/pressed buttons. */
  stepPlayers(n: number, per: { held?: Btn[]; press?: Btn[] }[]): void;
}

export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function run(mod: GameModule, seed = 20261013, players = 1): Run {
  const g = fakeContext();
  const rand = mulberry(seed);
  const r: Run = {
    result: null, hud: '', sfx: [], rumbles: [],
    ctx: null as unknown as GameCtx,
    step(n = 1, held = [], press = [], axis, tap = null) {
      for (let i = 0; i < n && !r.result; i++) {
        const down = Object.fromEntries(BTNS.map((b) => [b, held.includes(b) || press.includes(b)])) as Record<Btn, boolean>;
        const hit = Object.fromEntries(BTNS.map((b) => [b, press.includes(b) && i === 0])) as Record<Btn, boolean>;
        const ax = axis?.x ?? ((down.right ? 1 : 0) - (down.left ? 1 : 0));
        const ay = axis?.y ?? ((down.down ? 1 : 0) - (down.up ? 1 : 0));
        const input: InputState = { down, hit, ax, ay, tap: i === 0 ? tap : null };
        inst.update(1 / 60, input);
        inst.render();
      }
    },
    play(policy, maxSeconds) {
      const frames = Math.round(maxSeconds * 60);
      for (let f = 0; f < frames && !r.result; f++) {
        const p = policy(f, r.snap());
        r.step(1, p.held, p.press, p.axis, p.tap ?? null);
      }
      return r.result;
    },
    snap() { return inst.snapshot?.() ?? {}; },
    stepPlayers(n, per) {
      const mk = (held: Btn[] = [], press: Btn[] = [], first: boolean): InputState => {
        const down = Object.fromEntries(BTNS.map((b) => [b, held.includes(b) || press.includes(b)])) as Record<Btn, boolean>;
        const hit = Object.fromEntries(BTNS.map((b) => [b, press.includes(b) && first])) as Record<Btn, boolean>;
        return { down, hit, ax: (down.right ? 1 : 0) - (down.left ? 1 : 0), ay: (down.down ? 1 : 0) - (down.up ? 1 : 0), tap: null };
      };
      for (let i = 0; i < n && !r.result; i++) {
        const all = Array.from({ length: players }, (_, k) => mk(per[k]?.held, per[k]?.press, i === 0));
        inst.update(1 / 60, { ...all[0], players: all });
        inst.render();
      }
    },
  };
  const canvas = { width: mod.meta.view.w, height: mod.meta.view.h } as HTMLCanvasElement;
  r.ctx = {
    canvas, g, w: mod.meta.view.w, h: mod.meta.view.h, rand, seed,
    t: (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s),
    sfx: (name) => { r.sfx.push(name); },
    key: (k) => `[${k}]`,
    rumble: (s, ms) => { r.rumbles.push([s, ms]); },
    reducedMotion: false,
    cast: buildCast(),
    playerId: 'CH-CEO',
    players,
    end: (res) => { if (!r.result) r.result = res; },
    setHud: (s) => { r.hud = s; },
  };
  const inst = mod.create(r.ctx);
  return r;
}
