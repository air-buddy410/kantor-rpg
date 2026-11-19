import { describe, expect, it } from 'vitest';
import { run, type Run } from './mg-harness';
import biliar, {
  POCKETS, R, TABLE, HEAD, FOOT, MAX_SPEED, E_BALL, SLIDE, SPIN_MAX, SPIN_UI, SQUIRT, CENTER, collide, physicsStep, moving, momentum, resolveShot, angDiff,
  makeBall, strike, simulate, tickFalls, plan, newShot, handOk, bestSpot, calledPocket, respotEight, rack,
  type Ball, type PhysEvent, type Rules, type Shot, type Spin,
} from '../../src/minigames/games/biliar';
import type { Btn, InputState, PadAnalog } from '../../src/minigames/types';

type Snap = {
  phase: string; turn: number; shots: number; aim: number; power: number; charging: boolean; latched: boolean; dragging: boolean; spin: Spin; spinHeld: boolean;
  versus: boolean; foul: string | null; notice: string; hand: { behind: boolean } | null; called: number | null; winner: number | null; groups: (string | null)[];
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
    if (p.phase === 'place' && p.turn === 0) return { press: ['a'], axis: still };
    if (p.phase !== 'aim' || p.turn !== 0) return { axis: still };
    if (Math.abs(angDiff(p.hint.angle, p.aim)) > 1e-6) {
      return { axis: still, tap: { x: p.cue.x + Math.cos(p.hint.angle) * 30, y: p.cue.y + Math.sin(p.hint.angle) * 30 } };
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
    const after = (spin: Spin) => {
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
    const stun = after(CENTER), follow = after({ x: 0, y: 0.8 }), draw = after({ x: 0, y: -0.8 });
    expect(follow).toBeGreaterThan(stun + 20);
    expect(draw).toBeLessThan(-10);
    expect(Math.abs(stun)).toBeLessThan(25);
  });

  it('side english: the cue ball leaves a cushion at another angle, running vs reverse; squirt is about 0.02 rad', () => {
    // a cue ball sent at the right cushion at 45 degrees, no other balls
    const path = (spin: Spin) => {
      const c = ball(0, 450, 250);
      strike(c, -Math.PI / 4, 0.5, spin);
      const ev: PhysEvent[] = [];
      let out: { vx: number; vy: number } | null = null;
      for (let f = 0; f < 120 && !out; f++) {
        physicsStep([c], 1 / 60, ev);
        if (ev.some((e) => e.kind === 'rail')) out = { vx: c.vx, vy: c.vy };
      }
      return { out: out!, side: c.side };
    };
    const none = path(CENTER), right = path({ x: SPIN_MAX, y: 0 }), left = path({ x: -SPIN_MAX, y: 0 });
    const ang = (v: { vx: number; vy: number }) => Math.atan2(v.vy, v.vx);
    // heading up and right into the right cushion the kick points right of the approach (down the screen) for
    // right english: that is reverse here and checks the ball up; left english runs on along the cushion
    expect(right.out.vy).toBeGreaterThan(none.out.vy + 20);
    expect(left.out.vy).toBeLessThan(none.out.vy - 20);
    expect(Math.abs(angDiff(ang(right.out), ang(none.out)))).toBeGreaterThan(0.08);
    // the cushion took half of it, rolling took a little more
    expect(right.side).toBeGreaterThan(0);
    expect(right.side).toBeLessThan(SPIN_MAX / 2);
    expect(none.side).toBe(0);
    // squirt: right english pushes the start a little to the left of the aim
    const c = ball(0, 300, 200);
    strike(c, 0, 0.5, { x: SPIN_MAX, y: 0 });
    expect(Math.atan2(c.vy, c.vx)).toBeCloseTo(-SQUIRT, 9);
    // the same shot through simulate() ends somewhere else than without side spin
    const table = [ball(0, 450, 250), ball(1, 120, 120)];
    const endOf = (sp: Spin) => {
      const copy = table.map((b) => ({ ...b }));
      strike(copy[0], -Math.PI / 4, 0.6, sp);
      for (let f = 0; f < 900 && moving(copy); f++) physicsStep(copy, 1 / 60);
      return copy[0];
    };
    const e0 = endOf(CENTER), e1 = endOf({ x: SPIN_MAX, y: 0 });
    expect(Math.hypot(e1.x - e0.x, e1.y - e0.y)).toBeGreaterThan(20);
    expect(simulate(table, -Math.PI / 4, 0.6, { x: SPIN_MAX, y: 0 })).toEqual(simulate(table, -Math.PI / 4, 0.6, { x: SPIN_MAX, y: 0 }));
  });

  it('side spin fades slowly while the ball rolls', () => {
    const c = ball(0, 200, 209);
    strike(c, 0, 0.2, { x: 0.6, y: 0 });
    for (let f = 0; f < 30; f++) physicsStep([c], 1 / 60);
    expect(c.side).toBeLessThan(0.6);
    expect(c.side).toBeGreaterThan(0.4);
  });

  it('a ball rolled into a corner pocket is counted and plays a shrinking drop', () => {
    const p = POCKETS[0];
    const b = ball(5, p.x + 80, p.y + 80, -300, -300, true);
    const ev: PhysEvent[] = [];
    for (let i = 0; i < 120 && moving([b]); i++) physicsStep([b], 1 / 60, ev);
    expect(b.down).toBe(true);
    expect(ev).toContainEqual(expect.objectContaining({ kind: 'pocket', n: 5, p: 0 }));
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
    expect(ev).toContainEqual(expect.objectContaining({ kind: 'pocket', n: 3 }));
  });
});

describe('mini game: biliar rules', () => {
  // every ball on the cloth (stacked, positions do not matter to the rules) unless listed as down
  const table = (down: number[]) => Array.from({ length: 16 }, (_, n) => ({ ...ball(n, 300, 200), down: down.includes(n) }));
  const shotOf = (o: Partial<Shot>): Shot => ({ ...newShot(), first: 1, railAfter: true, ...o });
  const solids: Rules['groups'] = ['solid', 'stripe'];

  it('first legal pot assigns the groups and keeps the turn', () => {
    const r: Rules = { turn: 0, groups: [null, null], winner: null };
    const out = resolveShot(r, shotOf({ first: 11, pocketed: [11, 2] }), table([11, 2]));
    expect(r.groups).toEqual(['stripe', 'solid']);
    expect(out.keep).toBe(true);
    expect(out.foul).toBeNull();
    expect(r.turn).toBe(0);
  });

  it('break: a pot or 4 balls to a cushion is legal and the table stays open; less is a foul', () => {
    const pot: Rules = { turn: 0, groups: [null, null], winner: null };
    const a = resolveShot(pot, shotOf({ brk: true, first: 5, railAfter: true, pocketed: [3] }), table([3]));
    expect(a.foul).toBeNull();
    expect(a.keep).toBe(true);
    expect(pot.groups).toEqual([null, null]);
    const four: Rules = { turn: 0, groups: [null, null], winner: null };
    const b = resolveShot(four, shotOf({ brk: true, first: 5, railBalls: [1, 2, 3, 4] }), table([]));
    expect(b.foul).toBeNull();
    expect(four.turn).toBe(1);
    const soft: Rules = { turn: 0, groups: [null, null], winner: null };
    expect(resolveShot(soft, shotOf({ brk: true, first: 5, railBalls: [1, 2, 3] }), table([])).foul).toBe('break');
    expect(soft.turn).toBe(1);
  });

  it('each foul: cue ball down, nothing hit, wrong group first, the 8 first, no cushion after contact', () => {
    const foul = (groups: Rules['groups'], o: Partial<Shot>, down: number[] = []) => {
      const r: Rules = { turn: 0, groups: [...groups], winner: null };
      const out = resolveShot(r, shotOf(o), table([...down, ...(o.pocketed ?? [])]));
      if (out.foul) expect(r.turn).toBe(1);
      return out.foul;
    };
    expect(foul(solids, { first: 3, pocketed: [3, 0] })).toBe('cue');
    expect(foul(solids, { first: null, railAfter: true })).toBe('none');
    expect(foul(solids, { first: 9 })).toBe('wrong');
    expect(foul(solids, { first: 8 })).toBe('eight');
    expect(foul(solids, { first: 2, railAfter: false })).toBe('rail');
    expect(foul(solids, { first: 2, railAfter: false, pocketed: [2] })).toBeNull();
    // open table: anything but the 8 first is fine
    expect(foul([null, null], { first: 12 })).toBeNull();
    expect(foul([null, null], { first: 8 })).toBe('eight');
    // group cleared: now the 8 must be first
    expect(foul(solids, { first: 9 }, [1, 2, 3, 4, 5, 6, 7])).toBe('wrong');
    expect(foul(solids, { first: 8 }, [1, 2, 3, 4, 5, 6, 7])).toBeNull();
    // the cue ball off the cloth counts like a scratch
    const r: Rules = { turn: 0, groups: [...solids], winner: null };
    const t = table([]);
    t[0].x = TABLE.x0 - 30;
    expect(resolveShot(r, shotOf({ first: 2 }), t).foul).toBe('cue');
  });

  it('the 8: early loses, in the called pocket wins, in another pocket or with a scratch loses', () => {
    const early: Rules = { turn: 0, groups: [...solids], winner: null };
    expect(resolveShot(early, shotOf({ first: 1, pocketed: [8] }), table([1, 8])).eight).toBe('early');
    expect(early.winner).toBe(1);
    const stripes = [9, 10, 11, 12, 13, 14, 15];
    const win: Rules = { turn: 1, groups: [...solids], winner: null };
    expect(resolveShot(win, shotOf({ first: 8, pocketed: [8], eightPocket: 2, called: 2 }), table([...stripes, 8])).eight).toBe('win');
    expect(win.winner).toBe(1);
    const wrongPocket: Rules = { turn: 1, groups: [...solids], winner: null };
    expect(resolveShot(wrongPocket, shotOf({ first: 8, pocketed: [8], eightPocket: 5, called: 2 }), table([...stripes, 8])).eight).toBe('pocket');
    expect(wrongPocket.winner).toBe(0);
    const scratch: Rules = { turn: 1, groups: [...solids], winner: null };
    expect(resolveShot(scratch, shotOf({ first: 8, pocketed: [8, 0], eightPocket: 2, called: 2 }), table([...stripes, 8, 0])).eight).toBe('foul');
    expect(scratch.winner).toBe(0);
  });

  it('the 8 on the break is respotted on the foot spot and the breaker goes on', () => {
    const r: Rules = { turn: 0, groups: [null, null], winner: null };
    const balls = rack(() => 0.5);
    const e = balls.find((b) => b.n === 8)!;
    e.down = true;
    const out = resolveShot(r, shotOf({ brk: true, first: 1, pocketed: [8] }), balls);
    expect(out.eight).toBe('break');
    expect(r.winner).toBeNull();
    expect(out.keep).toBe(true);
    // the rack still covers the foot spot here, so the 8 goes to the nearest free point on the long string
    respotEight(balls);
    expect(e.down).toBe(false);
    expect(e.y).toBe(FOOT.y);
    for (const b of balls) if (b !== e) expect(Math.hypot(b.x - e.x, b.y - e.y)).toBeGreaterThanOrEqual(2 * R);
    const empty = [ball(0, HEAD.x, HEAD.y), { ...ball(8, 0, 0), down: true }];
    respotEight(empty);
    expect([empty[1].x, empty[1].y]).toEqual([FOOT.x, FOOT.y]);
  });

  it('the called pocket follows the aim line onto the 8', () => {
    const corner = POCKETS[2];
    const ex = 450, ey = 150;
    const L = Math.hypot(corner.x - ex, corner.y - ey), ux = (corner.x - ex) / L, uy = (corner.y - ey) / L;
    const balls = [ball(0, ex - ux * 100, ey - uy * 100), ball(8, ex, ey)];
    expect(calledPocket(balls, Math.atan2(uy, ux))).toBe(2);
    // aimed off the 8: the pocket nearest the 8
    expect(calledPocket(balls, Math.atan2(uy, ux) + Math.PI)).toBe(2);
    const side = POCKETS[4];
    const sx = 330, sy = 260;
    const M = Math.hypot(side.x - sx, side.y - sy), vx = (side.x - sx) / M, vy = (side.y - sy) / M;
    const b2 = [ball(0, sx - vx * 80, sy - vy * 80), ball(8, sx, sy)];
    expect(calledPocket(b2, Math.atan2(vy, vx))).toBe(4);
  });

  it('ball in hand: no overlap, on the cloth, behind the head string after a break foul; the computer picks a legal spot', () => {
    const balls = rack(() => 0.3);
    const one = balls[1];
    expect(handOk(balls, one.x + R, one.y, false)).toBe(false);
    expect(handOk(balls, 300, 150, false)).toBe(true);
    expect(handOk(balls, 300, 150, true)).toBe(false);
    expect(handOk(balls, HEAD.x - 10, 150, true)).toBe(true);
    expect(handOk(balls, TABLE.x0 + 2, 150, false)).toBe(false);
    expect(handOk(balls, POCKETS[1].x, TABLE.y0 + R + 1, false)).toBe(false);
    for (const behind of [true, false]) {
      const spot = bestSpot(balls, [1, 2, 3, 4, 5, 6, 7], behind)!;
      expect(spot).not.toBeNull();
      expect(handOk(balls, spot.x, spot.y, behind)).toBe(true);
    }
  });

  it('in the game, scratching on the break gives the CPU ball in hand behind the head string', () => {
    const r = run(biliar, 7);
    // aim straight into the top left corner pocket with a tap, then X for a medium shot
    r.step(1, [], [], still, { x: POCKETS[0].x, y: POCKETS[0].y });
    r.step(1, [], ['x'], still);
    expect(snap(r).phase).toBe('roll');
    while (snap(r).phase === 'roll') r.step(1);
    const s = snap(r);
    expect(s.shots).toBe(1);
    expect(s.fouls).toBe(1);
    expect(s.foul).toBe('cue');
    expect(s.notice).toBe('Foul: bola putih masuk.');
    expect(s.turn).toBe(1);
    expect(s.hand).toEqual({ behind: true });
    expect(s.down).not.toContain(0);
    expect(r.sfx).toContain('wrong');
    while (snap(r).phase !== 'place') r.step(1);
    while (snap(r).phase === 'place') r.step(1);
    const a = snap(r);
    expect(a.phase).toBe('aim');
    expect(a.hand).toBeNull();
    expect(a.cue.x).toBeLessThanOrEqual(HEAD.x);
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

  it('keyboard: hold C (Y) and the arrows move the spin dot, the aim stays; a tap of Y resets it', () => {
    const r = run(biliar, 2);
    const a0 = snap(r).aim;
    r.step(15, ['y', 'right']);
    expect(snap(r).spinHeld).toBe(true);
    expect(snap(r).spin.x).toBeCloseTo(0.4, 6);
    expect(snap(r).spin.y).toBe(0);
    r.step(6, ['y', 'up']);
    expect(snap(r).spin.y).toBeCloseTo(0.16, 6);
    expect(snap(r).aim).toBe(a0);
    // release after moving keeps the dot
    r.step(1);
    expect(snap(r).spin.x).toBeCloseTo(0.4, 6);
    // the dot never leaves the 0.8 circle
    r.step(120, ['y', 'up', 'left']);
    expect(Math.hypot(snap(r).spin.x, snap(r).spin.y)).toBeLessThanOrEqual(SPIN_MAX + 1e-9);
    r.step(1);
    r.step(3, ['y']);
    r.step(1);
    expect(Math.hypot(snap(r).spin.x, snap(r).spin.y)).toBe(0);
    // a long hold without arrows is not a tap
    r.step(6, ['y', 'down']);
    r.step(1);
    r.step(30, ['y']);
    r.step(1);
    expect(snap(r).spin.y).toBeLessThan(0);
  });

  it('pointer: a tap or a drag on the cue ball widget sets the spin dot directly', () => {
    const r = run(biliar, 8);
    const g = biliar.create(r.ctx);
    const S = () => g.snapshot!() as unknown as Snap;
    const base = { down: { left: false, right: false, up: false, down: false, a: false, b: false, x: false, y: false }, hit: { left: false, right: false, up: false, down: false, a: false, b: false, x: false, y: false }, ax: 0, ay: 0, tap: null };
    const a0 = S().aim;
    g.update(1 / 60, { ...base, ptr: { x: SPIN_UI.x + 6, y: SPIN_UI.y - 3, down: true } });
    expect(S().spin.x).toBeCloseTo(0.5, 6);
    expect(S().spin.y).toBeCloseTo(0.25, 6);
    g.update(1 / 60, { ...base, ptr: { x: SPIN_UI.x - 30, y: SPIN_UI.y, down: true } });
    expect(S().spin.x).toBeCloseTo(-SPIN_MAX, 9);
    expect(S().spin.y).toBeCloseTo(0, 9);
    g.update(1 / 60, { ...base, ptr: { x: SPIN_UI.x - 30, y: SPIN_UI.y, down: false } });
    expect(S().phase).toBe('aim');
    expect(S().dragging).toBe(false);
    g.update(1 / 60, { ...base, tap: { x: SPIN_UI.x, y: SPIN_UI.y + 6 } });
    expect(S().spin.x).toBeCloseTo(0, 6);
    expect(S().spin.y).toBeCloseTo(-0.5, 6);
    expect(S().aim).toBe(a0);
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

describe('mini game: biliar on a DualSense (v2.4)', () => {
  type Pad = { move?: [number, number]; look?: [number, number]; l2?: number; r2?: number; aim?: number; dead?: number };
  const NONE = { left: false, right: false, up: false, down: false, a: false, b: false, x: false, y: false };
  /** A game fed frame by frame with an analog pad (the shared harness has no pad field). */
  function padGame(seed = 5) {
    const r = run(biliar, seed);
    const g = biliar.create(r.ctx);
    const S = () => g.snapshot!() as unknown as Snap & { trigger: boolean };
    const feed = (n: number, p: Pad, hit: Partial<typeof NONE> = {}, held: Partial<typeof NONE> = {}) => {
      for (let i = 0; i < n; i++) {
        g.update(1 / 60, {
          down: { ...NONE, ...held }, hit: { ...NONE, ...(i === 0 ? hit : {}) }, ax: 0, ay: 0, tap: null, ptr: null,
          pad: { move: p.move ?? [0, 0], look: p.look ?? [0, 0], l2: p.l2 ?? 0, r2: p.r2 ?? 0, l1: false, r1: false, dead: p.dead ?? 0.22, aim: p.aim ?? 1 },
        });
      }
    };
    return { r, S, feed };
  }

  it('right stick turns the cue slowly: full tilt 0.4 rad/s, a light push under one degree per second', () => {
    const { S, feed } = padGame();
    const a0 = S().aim;
    feed(60, { look: [0.35, 0] });
    const light = Math.abs(angDiff(S().aim, a0));
    expect(light).toBeGreaterThan(0);
    expect(light).toBeLessThan(Math.PI / 180);
    const a1 = S().aim;
    feed(60, { look: [1, 0] });
    const full = Math.abs(angDiff(S().aim, a1));
    expect(full).toBeCloseTo(0.4, 6);
    expect(full).toBeGreaterThan(light * 10);
    // the e2e check: x = 0.9 for half a second turns more than 0.05 and less than 0.6 rad
    const e = padGame(7);
    const e0 = e.S().aim;
    e.feed(30, { look: [0.9, 0] });
    const half = Math.abs(angDiff(e.S().aim, e0));
    expect(half).toBeGreaterThan(0.05);
    expect(half).toBeLessThan(0.6);
  });

  it('L2 held makes the right stick eight times finer', () => {
    const a = padGame(), b = padGame();
    const a0 = a.S().aim, b0 = b.S().aim;
    a.feed(30, { look: [0.8, 0] });
    b.feed(30, { look: [0.8, 0], l2: 1 });
    expect(Math.abs(angDiff(b.S().aim, b0)) * 8).toBeCloseTo(Math.abs(angDiff(a.S().aim, a0)), 6);
  });

  it('hold Y and move the right stick: the spin dot moves with the tilt, the aim is frozen; a tap of Y resets', () => {
    const { S, feed } = padGame();
    const a0 = S().aim;
    feed(1, {}, { y: true }, { y: true });
    feed(30, { look: [1, 0] }, {}, { y: true });
    expect(S().spin.x).toBeCloseTo(0.8, 2);
    expect(S().aim).toBe(a0);
    feed(30, { look: [0, 1] }, {}, { y: true });
    // stick down = draw; the dot stays inside the 0.8 circle
    expect(S().spin.y).toBeLessThan(-0.3);
    expect(Math.hypot(S().spin.x, S().spin.y)).toBeLessThanOrEqual(SPIN_MAX + 1e-9);
    feed(1, {});
    const kept = S().spin;
    expect(kept.x).toBeGreaterThan(0.3);
    // half tilt moves slower than full tilt
    const h = padGame(), f = padGame();
    h.feed(12, { look: [0, -0.6] }, {}, { y: true });
    f.feed(12, { look: [0, -1] }, {}, { y: true });
    expect(h.S().spin.y).toBeGreaterThan(0);
    expect(h.S().spin.y).toBeLessThan(f.S().spin.y);
    expect(f.S().spin.y).toBeCloseTo(12 / 60 * 1.6, 6);
    // short tap
    feed(5, {}, {}, { y: true });
    feed(1, {});
    expect(Math.hypot(S().spin.x, S().spin.y)).toBe(0);
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

describe('mini game: biliar for two players (v2.4)', () => {
  const NONE = { left: false, right: false, up: false, down: false, a: false, b: false, x: false, y: false };
  const idle = (o: Partial<InputState> = {}): InputState => ({ down: { ...NONE }, hit: { ...NONE }, ax: 0, ay: 0, tap: null, ...o });
  const pad = (o: Partial<PadAnalog> = {}): PadAnalog => ({ move: [0, 0], look: [0, 0], l2: 0, r2: 0, l1: false, r1: false, dead: 0.22, aim: 1, ...o });

  /** Pemain 1 breaks with X until the turn passes; ball in hand is confirmed by whoever is up. */
  function toP2(step: (p1: Btn[], p2: Btn[]) => void, S: () => Snap) {
    for (let f = 0; f < 60 * 60 && !(S().turn === 1 && S().phase === 'aim'); f++) {
      const s = S();
      if (s.phase === 'aim' && s.turn === 0) step(['x'], []);
      else if (s.phase === 'place') step(s.turn === 0 ? ['a'] : [], s.turn === 1 ? ['a'] : []);
      else step([], []);
    }
    expect(S().turn).toBe(1);
    expect(S().phase).toBe('aim');
  }

  it('Pemain 2 plays from input.players[1], Pemain 1 cannot shoot for them, and there is no computer', () => {
    const r = run(biliar, 7, 2);
    const S = () => snap(r);
    expect(S().versus).toBe(true);
    r.stepPlayers(1, [{}, { press: ['x'] }]);
    expect(S().phase).toBe('aim');
    expect(S().shots).toBe(0);
    toP2((a, b) => r.stepPlayers(1, [{ press: a }, { press: b }]), S);
    expect(r.hud).toContain('Pemain 1');
    expect(r.hud).toContain('Pemain 2');
    const shots = S().shots;
    // nobody touches anything: no computer takes the shot
    r.stepPlayers(180, [{}, {}]);
    expect(S().phase).toBe('aim');
    expect(S().shots).toBe(shots);
    r.stepPlayers(1, [{ press: ['x'] }, {}]);
    expect(S().phase).toBe('aim');
    r.stepPlayers(1, [{}, { press: ['x'] }]);
    expect(S().phase).toBe('roll');
    expect(S().shots).toBe(shots + 1);
  });

  it("hot-seat (same input for both seats) and Pemain 2's own pad both work", () => {
    const r = run(biliar, 7, 2);
    const g = biliar.create(r.ctx);
    const S = () => g.snapshot!() as unknown as Snap;
    const mk = (btn: Btn[]) => idle({ hit: { ...NONE, ...Object.fromEntries(btn.map((b) => [b, true])) }, down: { ...NONE, ...Object.fromEntries(btn.map((b) => [b, true])) } });
    // one device: input.players = [p1, p1]
    toP2((a, b) => { const i = mk([...a, ...b]); g.update(1 / 60, { ...i, players: [i, i] }); }, S);
    const i = mk(['x']);
    g.update(1 / 60, { ...i, players: [i, i] });
    expect(S().phase).toBe('roll');
    // a second pad: Pemain 2's right stick turns the cue on their turn, Pemain 1's does not
    const h = run(biliar, 7, 2);
    const g2 = biliar.create(h.ctx);
    const S2 = () => g2.snapshot!() as unknown as Snap;
    toP2((a, b) => { const p1 = mk(a), p2 = mk(b); g2.update(1 / 60, { ...p1, players: [p1, p2] }); }, S2);
    const a0 = S2().aim;
    for (let f = 0; f < 30; f++) { const p1 = idle({ pad: pad({ look: [1, 0] }) }); g2.update(1 / 60, { ...p1, players: [p1, idle()] }); }
    expect(S2().aim).toBe(a0);
    for (let f = 0; f < 30; f++) { const p1 = idle(); g2.update(1 / 60, { ...p1, players: [p1, idle({ pad: pad({ look: [1, 0] }) })] }); }
    expect(Math.abs(angDiff(S2().aim, a0))).toBeCloseTo(0.2, 6);
    // and R2 pull and release shoots for Pemain 2
    for (let f = 0; f < 10; f++) { const p1 = idle(); g2.update(1 / 60, { ...p1, players: [p1, idle({ pad: pad({ r2: 0.6 }) })] }); }
    expect((S2() as unknown as { trigger: boolean }).trigger).toBe(true);
    const p1 = idle();
    g2.update(1 / 60, { ...p1, players: [p1, idle({ pad: pad({ r2: 0 }) })] });
    expect(S2().phase).toBe('roll');
  });

  it('a versus match ends with versus true and no score', () => {
    const r = run(biliar, 5, 2);
    r.stepPlayers(60 * 603, [{}, {}]);
    expect(r.result).not.toBeNull();
    expect(r.result!.versus).toBe(true);
    expect(r.result!.score).toBe(0);
    expect(r.result!.won).toBe(false);
    expect(r.result!.summary).toContain('Seri');
  });

  it('ball in hand for a human: the arrows move the cue ball, behind the head string after a break foul, A confirms', () => {
    const r = run(biliar, 7, 2);
    const g = biliar.create(r.ctx);
    const S = () => g.snapshot!() as unknown as Snap;
    const go = (o: Partial<InputState> = {}) => { const i = idle(o); g.update(1 / 60, { ...i, players: [i, i] }); };
    go({ tap: { x: POCKETS[0].x, y: POCKETS[0].y } });
    go({ hit: { ...NONE, x: true }, down: { ...NONE, x: true } });
    for (let f = 0; f < 60 * 20 && S().phase !== 'place'; f++) go();
    expect(S().phase).toBe('place');
    expect(S().turn).toBe(1);
    expect(S().hand).toEqual({ behind: true });
    const c0 = S().cue;
    for (let f = 0; f < 30; f++) go({ down: { ...NONE, up: true }, ay: -1 });
    expect(S().cue.y).toBeCloseTo(c0.y - 100, 6);
    // pushing right stops at the head string
    for (let f = 0; f < 120; f++) go({ down: { ...NONE, right: true }, ax: 1 });
    expect(S().cue.x).toBe(HEAD.x);
    go({ hit: { ...NONE, a: true }, down: { ...NONE, a: true } });
    expect(S().phase).toBe('aim');
    expect(S().hand).toBeNull();
  });

  it('impact sounds: clack, thud and pocket scale gain 0.2..1 and rate 0.9..1.15, never twice within 30 ms', () => {
    const r = run(biliar, 3);
    const log: { name: string; f: number; gain: number; rate: number }[] = [];
    let f = 0;
    const g = biliar.create({ ...r.ctx, sfx: (name, o) => { log.push({ name, f, gain: o?.gain ?? 1, rate: o?.rate ?? 1 }); } });
    const S = () => g.snapshot!() as unknown as Snap;
    g.update(1 / 60, idle({ hit: { ...NONE, x: true }, down: { ...NONE, x: true } }));
    for (; f < 60 * 8 && S().phase !== 'pause'; f++) g.update(1 / 60, idle());
    const impact = log.filter((e) => ['clack', 'thud', 'pocket'].includes(e.name));
    expect(impact.filter((e) => e.name === 'clack').length).toBeGreaterThan(1);
    expect(impact.some((e) => e.name === 'thud')).toBe(true);
    for (const e of impact) {
      expect(e.gain).toBeGreaterThanOrEqual(0.2); expect(e.gain).toBeLessThanOrEqual(1);
      expect(e.rate).toBeGreaterThanOrEqual(0.9); expect(e.rate).toBeLessThanOrEqual(1.15);
    }
    const gains = new Set(impact.map((e) => e.gain.toFixed(2)));
    expect(gains.size).toBeGreaterThan(2);
    for (const name of ['clack', 'thud', 'pocket']) {
      const fr = impact.filter((e) => e.name === name).map((e) => e.f);
      for (let i = 1; i < fr.length; i++) expect(fr[i] - fr[i - 1], name).toBeGreaterThanOrEqual(2);
    }
  });

  it('meta allows 2 players and hot-seat, with a lobby hint', () => {
    expect(biliar.meta.players).toBe(2);
    expect(biliar.meta.hotseat).toBe(true);
    expect(biliar.meta.playersHint).toBeTruthy();
  });
});
