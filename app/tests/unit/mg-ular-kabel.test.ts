import { describe, expect, it } from 'vitest';
import { run } from './mg-harness';
import ular, { BOOSTS, COUNT_T, GW, SPEED, STARTS } from '../../src/minigames/games/ular-kabel';
import { EN_ULAR_KABEL } from '../../src/i18n/en/mg/ular-kabel';

type Snap = {
  phase: string; round: number; versus: boolean; humans: number; winsBy: number[]; score: number; survT: number; roundT: number; inset: number;
  alive: boolean[]; heads: { x: number; y: number }[]; dirs: number[]; boosts: number[]; boosting: boolean[]; cpu: boolean[]; trail: number[];
};
const COUNT_F = Math.round(COUNT_T * 60);
const SRC = Object.values(import.meta.glob('../../src/minigames/games/ular-kabel.ts', { query: '?raw', import: 'default', eager: true }))[0] as string;
const sn = (r: ReturnType<typeof run>) => r.snap() as Snap;

describe('mini game: ular-kabel', () => {
  it('meta is complete and every literal has English', () => {
    const m = ular.meta;
    expect(m.id).toBe('ular-kabel');
    expect(m.players).toBe(4);
    expect(m.touch).toEqual(['left', 'up', 'down', 'right', 'a']);
    expect(m.tutorial.length).toBeGreaterThanOrEqual(2);
    expect(m.tutorial.length).toBeLessThanOrEqual(3);
    for (const s of [m.title, m.blurb, m.score.unit, m.playersHint!, ...m.tutorial, ...m.legend.map((e) => e[1]), ...Object.values(m.actions ?? {})]) {
      expect(EN_ULAR_KABEL[s as string], s as string).toBeTruthy();
    }
    const lits = [...SRC.matchAll(/\bt\(\s*'((?:\\.|[^'])*)'/g)].map((m) => m[1]);
    expect(lits.length).toBeGreaterThan(10);
    expect(lits.filter((s) => !(s in EN_ULAR_KABEL))).toEqual([]);
    for (const [id, en] of Object.entries(EN_ULAR_KABEL)) {
      expect((en.match(/\{\w+\}/g) ?? []).sort(), id).toEqual((id.match(/\{\w+\}/g) ?? []).sort());
      expect(/[\u2013\u2014]/.test(en + id)).toBe(false);
    }
  });

  it('counts down 3-2-1, then the cable runs at a steady pace', () => {
    const r = run(ular, 1);
    r.step(COUNT_F - 1);
    expect(sn(r).phase).toBe('count');
    expect(r.sfx.filter((s) => s === 'tick').length).toBe(3);
    r.step(1);
    expect(sn(r).phase).toBe('play');
    expect(r.sfx).toContain('start');
    r.step(60);
    // one second at SPEED cells/s, give or take the cell in progress
    expect(sn(r).heads[0].x - STARTS[0][0]).toBeGreaterThanOrEqual(SPEED - 1);
    expect(sn(r).heads[0].x - STARTS[0][0]).toBeLessThanOrEqual(SPEED);
  });

  it('a player cannot reverse into their own cable', () => {
    const r = run(ular, 2);
    r.step(COUNT_F + 10);
    const x0 = sn(r).heads[0].x;
    r.step(1, [], ['left']);
    r.step(20, ['left']);
    const s = sn(r);
    expect(s.alive[0]).toBe(true);
    expect(s.dirs[0]).toBe(1);
    expect(s.heads[0].x).toBeGreaterThan(x0);
  });

  it('two quick turns inside one cell both apply', () => {
    const r = run(ular, 3);
    r.step(COUNT_F + 3);
    const { x, y } = sn(r).heads[0];
    // down then left within two frames: a U-shaped double turn
    r.step(1, [], ['down']);
    r.step(1, [], ['left']);
    r.step(30);
    const s = sn(r);
    expect(s.alive[0]).toBe(true);
    expect(s.dirs[0]).toBe(3);
    expect(s.heads[0].y).toBe(y + 1);
    expect(s.heads[0].x).toBeLessThan(x);
  });

  it('boost doubles the speed and uses one charge', () => {
    const a = run(ular, 4), b = run(ular, 4);
    a.step(COUNT_F); b.step(COUNT_F);
    a.step(1, [], ['a']); b.step(1);
    a.step(29); b.step(29);
    expect(sn(a).boosts[0]).toBe(BOOSTS - 1);
    expect(sn(b).boosts[0]).toBe(BOOSTS);
    const da = sn(a).heads[0].x - STARTS[0][0], db = sn(b).heads[0].x - STARTS[0][0];
    expect(da).toBeGreaterThanOrEqual(db * 2 - 1);
    expect(a.sfx).toContain('turbo');
  });

  it('driving into the wall eliminates the player', () => {
    const r = run(ular, 5);
    r.step(COUNT_F);
    r.step(1, [], ['up']);
    r.step(90);
    const s = sn(r);
    expect(s.alive[0]).toBe(false);
    expect(s.heads[0]).toEqual({ x: STARTS[0][0], y: 0 });
    expect(r.sfx).toContain('crash');
  });

  it('CPUs do not crash in the first seconds on an open board', () => {
    let early = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const r = run(ular, seed);
      // P1 drives straight along the top; nobody blocks a CPU for 4 s
      r.step(COUNT_F + 4 * 60);
      early += sn(r).alive.slice(1).filter((a) => !a).length;
    }
    expect(early).toBe(0);
  });

  it('solo: a simple wall-dodging policy finishes the match with the PRD score', () => {
    const r = run(ular, 6);
    // turn clockwise when close to a wall; trails still get you, so rounds end
    const res = r.play((_f, s0) => {
      const s = s0 as unknown as Snap;
      if (s.phase !== 'play' || !s.alive[0]) return {};
      const { x, y } = s.heads[0];
      const d = s.dirs[0];
      const near = (d === 0 && y <= 2 + s.inset) || (d === 2 && y >= 37 - s.inset) || (d === 1 && x >= GW - 3 - s.inset) || (d === 3 && x <= 2 + s.inset);
      return near ? { press: [(['right', 'down', 'left', 'up'] as const)[d]] } : {};
    }, 900);
    expect(res).not.toBeNull();
    const s = sn(r);
    expect(s.phase).toBe('over');
    expect(Math.max(...s.winsBy)).toBeGreaterThanOrEqual(3);
    expect(res!.versus).toBeFalsy();
    expect(res!.score).toBe(s.winsBy[0] * 300 + Math.round(s.survT * 5) + (res!.won ? 500 : 0));
    expect(res!.score).toBeGreaterThan(0);
    expect(r.hud).toMatch(/^Ronde \d+ · Kamu \d+ · Rival \d+$/);
  });

  it('two players: Pemain 2 steers the second cable and the end is versus with score 0', () => {
    const r = run(ular, 7, 2);
    expect(sn(r).humans).toBe(2);
    expect(sn(r).cpu).toEqual([false, false, true, true]);
    r.stepPlayers(COUNT_F + 2, []);
    const p2 = sn(r).heads[1];
    expect(sn(r).dirs[1]).toBe(3);
    r.stepPlayers(1, [{}, { press: ['up'] }]);
    r.stepPlayers(30, []);
    const s = sn(r);
    expect(s.dirs[1]).toBe(0);
    expect(s.heads[1].y).toBeLessThan(p2.y);
    // Pemain 1 got no input and kept heading right
    expect(s.dirs[0]).toBe(1);
    for (let k = 0; k < 900 && !r.result; k++) r.stepPlayers(60, []);
    expect(r.result).not.toBeNull();
    expect(r.result!.versus).toBe(true);
    expect(r.result!.score).toBe(0);
    expect(sn(r).versus).toBe(true);
  });

  it('is deterministic for a seed', () => {
    const go = (seed: number) => {
      const r = run(ular, seed);
      const res = r.play((f) => ({ press: f % 50 === 0 ? [(['down', 'right', 'up', 'left'] as const)[(f / 50) % 4]] : [] }), 600);
      return JSON.stringify([res, r.snap(), r.sfx.length]);
    };
    const a = go(41);
    expect(a).toBe(go(41));
    expect(a).not.toBe(go(42));
  });
});
