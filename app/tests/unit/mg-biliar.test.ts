import { describe, expect, it } from 'vitest';
import { run, type Run } from './mg-harness';
import biliar, {
  POCKETS, R, TABLE, HEAD, MAX_SPEED, E_BALL, SLIDE, collide, physicsStep, moving, momentum, resolveShot, angDiff, makeBall, strike, tickFalls, plan,
  type Ball, type PhysEvent, type Rules,
} from '../../src/minigames/games/biliar';
import type { Btn } from '../../src/minigames/types';

type Snap = {
  phase: string; turn: number; shots: number; aim: number; power: number; charging: boolean; latched: boolean; dragging: boolean; spin: string;
  hint: { angle: number; power: number }; score: number; fouls: number; mine: number; theirs: number; foe: string;
  cue: { x: number; y: number; vx: number; vy: number }; down: number[]; time: number;
};
type Policy = { held?: Btn[]; press?: Btn[]; axis?: { x: number; y: number }; tap?: { x: number; y: number } | null };

const ball = (n: number, x: number, y: number, vx = 0, vy = 0, rolling = false): Ball => makeBall(n, x, y, vx, vy, rolling);
const snap = (r: Run) => r.snap() as unknown as Snap;
const still = { x: 0, y: 0 };

/** Plays like a touch player: tap where the hint points, tap A, tap A again when the meter reaches the hint. */
function autoAim() {
  return (_f: number, s: Record<string, unknown>): Policy => {
    const p = s as unknown as Snap;
    if (p.phase !== 'aim' || p.turn !== 0) return { axis: still };
    if (Math.abs(angDiff(p.hint.angle, p.aim)) > 1e-6) {
      return { axis: still, tap: { x: p.cue.x + Math.cos(p.hint.angle) * 120, y: p.cue.y + Math.sin(p.hint.angle) * 120 } };
    }
    if (!p.charging) return { press: ['a'], axis: still };
    if (p.latched && p.power + 1 / 120 >= p.hint.power) return { press: ['a'], axis: still };
    return { axis: still };
  };
}

describe('mini game: biliar physics', () => {
  it('a straight head-on hit between equal balls passes the momentum on', () => {
    const a = ball(0, 200, 200, 400, 0);
    const b = ball(1, 200 + 2 * R - 0.5, 200);
    collide(a, b);
    expect(a.vx + b.vx).toBeCloseTo(400, 6);
    expect(b.vx).toBeCloseTo(400 * (1 + E_BALL) / 2, 6);
    expect(Math.abs(a.vx)).toBeLessThan(15);
  });

  it('oblique collisions conserve momentum and lose only a little energy', () => {
    for (const off of [0.2, 0.5, 0.8, 0.95]) {
      const a = ball(0, 200, 200, 600, 120);
      const b = ball(1, 200 + 2 * R * Math.sqrt(1 - off * off) - 0.3, 200 + 2 * R * off, -50, 0);
      const p0 = momentum([a, b]);
      const e0 = a.vx ** 2 + a.vy ** 2 + b.vx ** 2 + b.vy ** 2;
      expect(collide(a, b)).toBeGreaterThan(0);
      const p1 = momentum([a, b]);
      const e1 = a.vx ** 2 + a.vy ** 2 + b.vx ** 2 + b.vy ** 2;
      expect(p1.x).toBeCloseTo(p0.x, 6);
      expect(p1.y).toBeCloseTo(p0.y, 6);
      expect(e1).toBeLessThanOrEqual(e0 + 1e-6);
      expect(e1).toBeGreaterThan(e0 * 0.9);
    }
  });

  it('momentum is about conserved across a full simulated frame with a collision', () => {
    const balls = [ball(0, 200, 200, 800, 0, true), ball(1, 214, 205)];
    const p0 = momentum(balls);
    const ev: PhysEvent[] = [];
    physicsStep(balls, 1 / 60, ev);
    expect(ev.some((e) => e.kind === 'hit')).toBe(true);
    const p1 = momentum(balls);
    // only cloth friction may remove momentum: at most both balls sliding for one frame
    expect(Math.hypot(p1.x - p0.x, p1.y - p0.y)).toBeLessThan(2 * SLIDE / 60 + 1);
  });

  it('balls never tunnel or overlap, even at maximum cue speed', () => {
    for (let k = 0; k < 24; k++) {
      const ang = (k / 24) * Math.PI * 2;
      const cx = 320 - Math.cos(ang) * 60, cy = 209 - Math.sin(ang) * 60;
      const balls = [ball(0, cx, cy), ball(1, 320, 209), ball(2, 320 + Math.cos(ang) * 2 * R, 209 + Math.sin(ang) * 2 * R)];
      strike(balls[0], ang, 1);
      expect(Math.hypot(balls[0].vx, balls[0].vy)).toBeCloseTo(MAX_SPEED, 6);
      const ev: PhysEvent[] = [];
      for (let f = 0; f < 4; f++) {
        physicsStep(balls, 1 / 60, ev);
        for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) {
          if (balls[i].down || balls[j].down) continue;
          expect(Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y)).toBeGreaterThan(2 * R - 0.5);
        }
      }
      expect(ev.some((e) => e.kind === 'hit' && e.a === 0 && e.b === 1)).toBe(true);
      // the cue ball stays behind the first object ball along the shot line
      const along = (b: Ball) => (b.x - 320) * Math.cos(ang) + (b.y - 209) * Math.sin(ang);
      if (!balls[0].down && !balls[1].down) expect(along(balls[0])).toBeLessThan(along(balls[1]));
    }
  });

  it('a slid ball turns into a rolling ball, then stops; cushions keep balls on the table', () => {
    const lone = ball(1, 200, 209, 300, 0);
    physicsStep([lone], 0.1);
    expect(lone.vx - lone.wx).toBeGreaterThan(10);
    physicsStep([lone], 0.25);
    expect(lone.wx).toBeCloseTo(lone.vx, 6);
    // a sliding ball ends up at 5/7 of its speed once it rolls, minus rolling resistance
    expect(lone.vx).toBeLessThan(300 * 5 / 7);
    expect(lone.vx).toBeGreaterThan(300 * 5 / 7 - 40);
    const balls = [ball(0, 300, 200, 900, 640), ball(3, 400, 150, -500, 300), ball(9, 250, 260, 0, -700)];
    let f = 0;
    while (moving(balls) && f < 60 * 30) { physicsStep(balls, 1 / 60); f++; }
    expect(moving(balls)).toBe(false);
    expect(f).toBeLessThan(60 * 15);
    for (const b of balls) if (!b.down) {
      expect(b.x).toBeGreaterThanOrEqual(TABLE.x0 + R - 1e-6);
      expect(b.x).toBeLessThanOrEqual(TABLE.x1 - R + 1e-6);
      expect(b.y).toBeGreaterThanOrEqual(TABLE.y0 + R - 1e-6);
      expect(b.y).toBeLessThanOrEqual(TABLE.y1 - R + 1e-6);
    }
  });

  it('cushion bounce keeps about 75 percent of the normal speed', () => {
    const b = ball(4, TABLE.x0 + R + 3, 209, -400, 0, true);
    const ev: PhysEvent[] = [];
    physicsStep([b], 1 / 60, ev);
    const hit = ev.find((e) => e.kind === 'rail');
    expect(hit).toBeDefined();
    expect(b.vx).toBeGreaterThan(0);
    expect(b.vx / (hit as { v: number }).v).toBeGreaterThan(0.65);
    expect(b.vx / (hit as { v: number }).v).toBeLessThan(0.8);
  });

  it('english: stun stops, top spin follows, back spin draws back', () => {
    const after = (spin: 'none' | 'top' | 'back') => {
      // short distance so a stun shot is still sliding at contact
      const balls = [ball(0, 250, 209), ball(1, 300, 209)];
      strike(balls[0], 0, 0.45, spin);
      const ev: PhysEvent[] = [];
      for (let f = 0; f < 600 && moving(balls); f++) {
        physicsStep(balls, 1 / 60, ev);
        // take the object ball off so its rebound cannot hit the cue again
        if (ev.some((e) => e.kind === 'hit')) balls[1].down = true;
      }
      return balls[0].x - 284;
    };
    const stun = after('none'), follow = after('top'), draw = after('back');
    expect(follow).toBeGreaterThan(stun + 20);
    expect(draw).toBeLessThan(-10);
    expect(Math.abs(stun)).toBeLessThan(25);
  });

  it('a ball rolled into a corner pocket is counted and plays a shrinking drop', () => {
    const p = POCKETS[0];
    const b = ball(5, p.x + 80, p.y + 80, -300, -300, true);
    const ev: PhysEvent[] = [];
    for (let i = 0; i < 120 && moving([b]); i++) physicsStep([b], 1 / 60, ev);
    expect(b.down).toBe(true);
    expect(ev).toContainEqual({ kind: 'pocket', n: 5 });
    expect(b.fall).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) tickFalls([b], 1 / 60);
    expect(b.fall).toBe(0);
    expect(Math.hypot(b.x - p.x, b.y - p.y)).toBeLessThan(p.r);
  });

  it('the planner finds a straight pot and its shot really sinks the ball', () => {
    const balls = [ball(0, 300, 209), ball(3, 400, 160)];
    const corner = POCKETS[2];
    // put the object ball on the line to the top right corner
    const ux = corner.x - 420, uy = corner.y - 180, L = Math.hypot(ux, uy);
    balls[1].x = 420; balls[1].y = 180;
    balls[0].x = 420 - (ux / L) * 120; balls[0].y = 180 - (uy / L) * 120;
    const p = plan(balls, [3]);
    expect(p).not.toBeNull();
    strike(balls[0], p!.angle, p!.power);
    const ev: PhysEvent[] = [];
    for (let f = 0; f < 600 && moving(balls); f++) physicsStep(balls, 1 / 60, ev);
    expect(ev).toContainEqual({ kind: 'pocket', n: 3 });
  });
});

describe('mini game: biliar rules', () => {
  const table = (down: number[]) => Array.from({ length: 16 }, (_, n) => ({ ...ball(n, 0, 0), down: down.includes(n) }));

  it('first ball pocketed assigns the groups and keeps the turn', () => {
    const r: Rules = { turn: 0, groups: [null, null], winner: null };
    const out = resolveShot(r, [11, 2], table([11, 2]));
    expect(r.groups).toEqual(['stripe', 'solid']);
    expect(out.keep).toBe(true);
    expect(r.turn).toBe(0);
  });

  it('cue ball in the pocket is a foul and passes the turn', () => {
    const r: Rules = { turn: 0, groups: ['solid', 'stripe'], winner: null };
    const out = resolveShot(r, [3, 0], table([3, 0]));
    expect(out.foul).toBe(true);
    expect(r.turn).toBe(1);
  });

  it('the 8 early loses, the 8 last wins', () => {
    const early: Rules = { turn: 0, groups: ['solid', 'stripe'], winner: null };
    resolveShot(early, [8], table([1, 8]));
    expect(early.winner).toBe(1);
    const late: Rules = { turn: 1, groups: ['solid', 'stripe'], winner: null };
    resolveShot(late, [8], table([9, 10, 11, 12, 13, 14, 15, 8]));
    expect(late.winner).toBe(1);
  });

  it('in the game, scratching the cue moves the turn to the CPU and respots the cue', () => {
    const r = run(biliar, 7);
    // aim straight into the top left corner pocket with a tap, then X for a medium shot
    r.step(1, [], [], still, { x: POCKETS[0].x, y: POCKETS[0].y });
    r.step(1, [], ['x'], still);
    expect(snap(r).phase).toBe('roll');
    while (snap(r).phase === 'roll') r.step(1);
    const s = snap(r);
    expect(s.shots).toBe(1);
    expect(s.fouls).toBe(1);
    expect(s.turn).toBe(1);
    expect(s.down).not.toContain(0);
    expect(Math.hypot(s.cue.x - HEAD.x, s.cue.y - HEAD.y)).toBeLessThan(60);
    expect(r.sfx).toContain('wrong');
  });
});

describe('mini game: biliar controls', () => {
  it('tap A starts a swinging meter, a second tap A shoots in that same frame', () => {
    const r = run(biliar, 3);
    r.step(1, [], ['a'], still);
    r.step(2, [], [], still);
    expect(snap(r).latched).toBe(true);
    r.step(20, [], [], still);
    const p = snap(r).power;
    expect(p).toBeGreaterThan(0.3);
    r.step(1, [], ['a'], still);
    const s = snap(r);
    expect(s.phase).toBe('roll');
    expect(Math.hypot(s.cue.vx, s.cue.vy)).toBeGreaterThan(300);
    expect(r.sfx).toContain('clack');
  });

  it('the meter swings back down after reaching full power', () => {
    const r = run(biliar, 3);
    r.step(1, [], ['a'], still);
    r.step(75, [], [], still);
    const s = snap(r);
    expect(s.power).toBeLessThan(0.9);
    expect(s.phase).toBe('aim');
  });

  it('hold A then release also shoots', () => {
    const r = run(biliar, 3);
    r.step(1, [], ['a'], still);
    r.step(40, ['a'], [], still);
    expect(snap(r).phase).toBe('aim');
    r.step(1, [], [], still);
    expect(snap(r).phase).toBe('roll');
  });

  it('X shoots at medium power right away; B cancels a charge', () => {
    const r = run(biliar, 4);
    r.step(1, [], ['a'], still);
    r.step(10, [], [], still);
    r.step(1, [], ['b'], still);
    expect(snap(r).charging).toBe(false);
    expect(snap(r).power).toBe(0);
    r.step(1, [], ['x'], still);
    const s = snap(r);
    expect(s.phase).toBe('roll');
    expect(s.power).toBeCloseTo(0.5, 6);
  });

  it('the analog stick points the cue straight at a direction', () => {
    const r = run(biliar, 5);
    r.step(20, [], [], { x: -0.6, y: 0.6 });
    expect(Math.abs(angDiff(snap(r).aim, Math.atan2(0.6, -0.6)))).toBeLessThan(0.01);
  });

  it('holding left/right turns faster the longer it is held; up/down is fine', () => {
    const r = run(biliar, 5);
    const a0 = snap(r).aim;
    r.step(6, ['right']);
    const early = snap(r).aim - a0;
    r.step(54, ['right']);
    const a1 = snap(r).aim;
    r.step(6, ['right']);
    const late = snap(r).aim - a1;
    expect(late).toBeGreaterThan(early * 4);
    r.step(1, [], [], still);
    const a2 = snap(r).aim;
    r.step(30, ['down'], [], still);
    const fine = snap(r).aim - a2;
    expect(fine).toBeGreaterThan(0);
    expect(fine).toBeLessThan(0.05);
  });

  it('a tap on the table aims the cue at that spot', () => {
    const r = run(biliar, 6);
    const c = snap(r).cue;
    r.step(1, [], [], still, { x: c.x + 50, y: c.y - 50 });
    expect(Math.abs(angDiff(snap(r).aim, -Math.PI / 4))).toBeLessThan(1e-9);
  });

  it('pointer drag away from the shot pulls the cue, release strikes with power by distance', () => {
    // the harness has no ptr, so drive a game instance directly
    const r = run(biliar, 8);
    const g = biliar.create(r.ctx);
    const base = { down: { left: false, right: false, up: false, down: false, a: false, b: false, x: false, y: false }, hit: { left: false, right: false, up: false, down: false, a: false, b: false, x: false, y: false }, ax: 0, ay: 0, tap: null };
    g.update(1 / 60, { ...base, ptr: { x: 400, y: 300, down: true } });
    g.update(1 / 60, { ...base, ptr: { x: 340, y: 300, down: true } });
    const mid = g.snapshot!() as unknown as Snap;
    expect(mid.dragging).toBe(true);
    expect(Math.abs(angDiff(mid.aim, 0))).toBeLessThan(1e-9);
    expect(mid.power).toBeCloseTo(50 / 120, 6);
    g.update(1 / 60, { ...base, ptr: { x: 340, y: 300, down: false } });
    const s = g.snapshot!() as unknown as Snap;
    expect(s.phase).toBe('roll');
    expect(s.cue.vx).toBeGreaterThan(0);
  });

  it('pointer tap without dragging only aims', () => {
    const r = run(biliar, 8);
    const g = biliar.create(r.ctx);
    const base = { down: { left: false, right: false, up: false, down: false, a: false, b: false, x: false, y: false }, hit: { left: false, right: false, up: false, down: false, a: false, b: false, x: false, y: false }, ax: 0, ay: 0, tap: null };
    const c = (g.snapshot!() as unknown as Snap).cue;
    g.update(1 / 60, { ...base, ptr: { x: c.x, y: c.y + 80, down: true } });
    g.update(1 / 60, { ...base, ptr: { x: c.x, y: c.y + 80, down: false } });
    const s = g.snapshot!() as unknown as Snap;
    expect(s.phase).toBe('aim');
    expect(Math.abs(angDiff(s.aim, Math.PI / 2))).toBeLessThan(1e-9);
  });

  it('Y cycles the english: top, back, none', () => {
    const r = run(biliar, 2);
    r.step(1, [], ['y'], still);
    expect(snap(r).spin).toBe('top');
    r.step(1, [], ['y'], still);
    expect(snap(r).spin).toBe('back');
    r.step(1, [], ['y'], still);
    expect(snap(r).spin).toBe('none');
  });

  it('meta lists actions and a pointer hint', () => {
    expect(biliar.meta.actions?.a).toBeTruthy();
    expect(biliar.meta.actions?.x).toBeTruthy();
    expect(biliar.meta.actions?.y).toBeTruthy();
    expect(biliar.meta.pointerHint).toBeTruthy();
  });
});

describe('mini game: biliar full match', () => {
  it('auto-aim player vs CPU finishes within the limits with a sane score, and the CPU pots balls', () => {
    let cpuPots = 0;
    for (const seed of [1, 2, 3, 11, 20261013]) {
      const r = run(biliar, seed);
      const res = r.play(autoAim(), 60 * 15);
      expect(res, `seed ${seed}`).not.toBeNull();
      const s = snap(r);
      expect(s.shots).toBeLessThanOrEqual(40);
      expect(res!.score).toBe(s.mine * 100 + (res!.won ? 1000 : 0));
      expect(r.sfx).toContain('pocket');
      expect(s.foe).not.toBe('Budi');
      cpuPots += s.theirs;
    }
    expect(cpuPots).toBeGreaterThan(3);
  });

  it('a player who never shoots still gets an ending at the time limit', () => {
    const r = run(biliar, 5);
    const res = r.play(() => ({}), 60 * 11);
    expect(res).not.toBeNull();
    expect(snap(r).time).toBeGreaterThanOrEqual(600);
  });

  it('same seed gives the same match', () => {
    const a = run(biliar, 42), b = run(biliar, 42);
    const ra = a.play(autoAim(), 60 * 15), rb = b.play(autoAim(), 60 * 15);
    expect(ra).not.toBeNull();
    expect(ra).toEqual(rb);
    expect(a.snap()).toEqual(b.snap());
  });
});

describe('mini game: biliar on a DualSense (v2.3)', () => {
  type Pad = { move?: [number, number]; look?: [number, number]; l2?: number; r2?: number; aim?: number; dead?: number };
  const NONE = { left: false, right: false, up: false, down: false, a: false, b: false, x: false, y: false };
  /** A game fed frame by frame with an analog pad (the shared harness has no pad field). */
  function padGame(seed = 5) {
    const r = run(biliar, seed);
    const g = biliar.create(r.ctx);
    const S = () => g.snapshot!() as unknown as Snap & { trigger: boolean };
    const feed = (n: number, p: Pad, hit: Partial<typeof NONE> = {}) => {
      for (let i = 0; i < n; i++) {
        g.update(1 / 60, {
          down: { ...NONE }, hit: { ...NONE, ...(i === 0 ? hit : {}) }, ax: 0, ay: 0, tap: null, ptr: null,
          pad: { move: p.move ?? [0, 0], look: p.look ?? [0, 0], l2: p.l2 ?? 0, r2: p.r2 ?? 0, l1: false, r1: false, dead: p.dead ?? 0.22, aim: p.aim ?? 1 },
        });
      }
    };
    return { r, S, feed };
  }

  it('right stick turns the cue slowly: a light push moves under two degrees per second', () => {
    const { S, feed } = padGame();
    const a0 = S().aim;
    feed(60, { look: [0.35, 0] });
    const light = Math.abs(angDiff(S().aim, a0));
    expect(light).toBeGreaterThan(0);
    expect(light).toBeLessThan((2 * Math.PI) / 180);
    const a1 = S().aim;
    feed(60, { look: [1, 0] });
    const full = Math.abs(angDiff(S().aim, a1));
    expect(full).toBeGreaterThan(light * 10);
    expect(full).toBeLessThan(1);
  });

  it('L2 held makes the right stick four times finer', () => {
    const a = padGame(), b = padGame();
    const a0 = a.S().aim, b0 = b.S().aim;
    a.feed(30, { look: [0.8, 0] });
    b.feed(30, { look: [0.8, 0], l2: 1 });
    expect(Math.abs(angDiff(b.S().aim, b0)) * 4).toBeCloseTo(Math.abs(angDiff(a.S().aim, a0)), 6);
  });

  it('stick drift inside the dead zone does not move the cue; the Santai profile turns slower', () => {
    const { S, feed } = padGame();
    const a0 = S().aim;
    feed(120, { look: [0.18, 0.1], move: [0.1, -0.15] });
    expect(S().aim).toBe(a0);
    const std = padGame(), san = padGame();
    std.feed(30, { look: [0.9, 0] });
    san.feed(30, { look: [0.9, 0], aim: 0.6, dead: 0.32 });
    const dStd = Math.abs(angDiff(std.S().aim, padGame().S().aim));
    const dSan = Math.abs(angDiff(san.S().aim, padGame().S().aim));
    expect(dSan).toBeLessThan(dStd);
  });

  it('left stick points the cue at a direction', () => {
    const { S, feed } = padGame();
    feed(40, { move: [-0.7, 0.7] });
    expect(Math.abs(angDiff(S().aim, Math.atan2(0.7, -0.7)))).toBeLessThan(0.01);
  });

  it('R2: power follows the pull, release shoots with the peak of the last moment, a soft pull cancels', () => {
    const { r, S, feed } = padGame();
    feed(2, {});
    feed(20, { r2: 0.7 });
    expect(S().trigger).toBe(true);
    expect(S().power).toBeCloseTo(0.7, 6);
    feed(1, { r2: 0.4 });
    feed(1, { r2: 0 });
    expect(S().phase).toBe('roll');
    expect(S().power).toBeCloseTo(0.7, 6);
    expect(r.rumbles.length).toBeGreaterThan(0);
    const soft = padGame();
    soft.feed(2, {});
    soft.feed(10, { r2: 0.1 });
    soft.feed(1, { r2: 0 });
    expect(soft.S().phase).toBe('aim');
    expect(soft.S().power).toBe(0);
  });

  it('a trigger held into the turn must be released first; B cancels a pull', () => {
    const { S, feed } = padGame();
    feed(30, { r2: 0.9 });
    expect(S().trigger).toBe(false);
    feed(1, { r2: 0 });
    feed(10, { r2: 0.6 });
    expect(S().trigger).toBe(true);
    feed(1, { r2: 0.6 }, { b: true });
    expect(S().trigger).toBe(false);
    feed(5, { r2: 0.6 });
    expect(S().trigger).toBe(false);
    feed(1, { r2: 0 });
    expect(S().phase).toBe('aim');
  });

  it('meta has a pad tutorial and a pad legend with sticks and triggers', () => {
    expect(biliar.meta.padTutorial?.length).toBeGreaterThan(1);
    const keys = (biliar.meta.padLegend ?? []).flatMap(([k]) => (Array.isArray(k) ? k : [k]));
    expect(keys).toEqual(expect.arrayContaining(['ls', 'rs', 'l2', 'r2']));
  });
});
