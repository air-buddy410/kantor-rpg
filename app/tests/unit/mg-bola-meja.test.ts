import { describe, expect, it } from 'vitest';
import { run } from './mg-harness';
import bola, { FW, FH, MX, GOAL_PAUSE, INTRO_T, MATCH_T, KICK_R, WIN_GOALS } from '../../src/minigames/games/bola-meja';
import { EN_BOLA_MEJA } from '../../src/i18n/en/mg/bola-meja';
import type { Btn } from '../../src/minigames/types';

type Pl = { seat: number; id: string; team: string; cpu: boolean; x: number; y: number; stamina: number; charging: boolean; attacker: boolean };
type Snap = {
  phase: string; versus: boolean; humans: number; kickTeam: number; kicks: number; lastTouch: number; timeLeft: number;
  score: number[]; ball: { x: number; y: number; vx: number; vy: number }; players: Pl[];
};
type R = ReturnType<typeof run>;
const sn = (r: R) => r.snap() as Snap;
const INTRO_F = Math.round(INTRO_T * 60) + 1;
/** Longest possible match: clock plus intro plus a pause for every goal. */
const MAX_S = MATCH_T + INTRO_T + (2 * WIN_GOALS) * GOAL_PAUSE + 2;
const SRC = Object.values(import.meta.glob('../../src/minigames/games/bola-meja.ts', { query: '?raw', import: 'default', eager: true }))[0] as string;

/** A simple human: run behind the ball, then tap kick toward the right (Biru) goal. */
const chase = (f: number, raw: Record<string, unknown>) => {
  const s = raw as Snap;
  const me = s.players[0], b = s.ball;
  const gx = FW - MX - b.x, gy = FH / 2 - b.y, gl = Math.hypot(gx, gy) || 1;
  const d = Math.hypot(b.x - me.x, b.y - me.y);
  const behind = (b.x - me.x) * gx + (b.y - me.y) * gy > 0.6 * d * gl;
  let ax = b.x - (gx / gl) * 30 - me.x, ay = b.y - (gy / gl) * 30 - me.y;
  if (behind) { ax = b.x - me.x; ay = b.y - me.y; }
  const l = Math.hypot(ax, ay) || 1;
  const held: Btn[] = d > 140 ? ['b'] : [];
  const press: Btn[] = behind && d < KICK_R - 4 && f % 6 === 0 ? ['a'] : [];
  return { axis: { x: ax / l, y: ay / l }, held, press };
};

describe('mini game: bola-meja', () => {
  it('meta is complete and every literal has English', () => {
    const m = bola.meta;
    expect(m.id).toBe('bola-meja');
    expect(m.players).toBe(4);
    expect(m.touch).toEqual(['left', 'up', 'down', 'right', 'a', 'b']);
    expect(m.tutorial.length).toBeGreaterThanOrEqual(2);
    expect(m.tutorial.length).toBeLessThanOrEqual(3);
    expect(m.legend.map((e) => e[0])).toEqual(['arah', 'a', 'b']);
    for (const s of [m.title, m.blurb, m.score.unit, m.playersHint!, ...m.tutorial, ...m.legend.map((e) => e[1]), ...Object.values(m.actions ?? {})]) {
      expect(EN_BOLA_MEJA[s as string], s as string).toBeTruthy();
    }
    const lits = [...SRC.matchAll(/\bt\(\s*'((?:\\.|[^'])*)'/g)].map((x) => x[1]);
    expect(lits.length).toBeGreaterThan(10);
    expect(lits.filter((s) => !(s in EN_BOLA_MEJA))).toEqual([]);
    for (const [id, en] of Object.entries(EN_BOLA_MEJA)) {
      expect((en.match(/\{\w+\}/g) ?? []).sort(), id).toEqual((id.match(/\{\w+\}/g) ?? []).sort());
      expect(/[\u2013\u2014]/.test(en + id)).toBe(false);
    }
  });

  it('kickoff: intro pause, then play with Oranye on the ball and a HUD line', () => {
    const r = run(bola, 3);
    const s0 = sn(r);
    expect(s0.phase).toBe('intro');
    expect(s0.players.map((p) => [p.team, p.cpu])).toEqual([['oranye', false], ['biru', true], ['oranye', true], ['biru', true]]);
    expect(r.hud).toBe('Oranye 0 - 0 Biru · 3:00');
    r.step(INTRO_F);
    const s = sn(r);
    expect(s.phase).toBe('play');
    expect(s.kickTeam).toBe(0);
    expect(r.sfx).toContain('start');
    expect(s.ball).toEqual({ x: FW / 2, y: FH / 2, vx: 0, vy: 0 });
    r.step(61);
    expect(r.hud).toBe('Oranye 0 - 0 Biru · 2:59');
  });

  it('a tap kicks the ball the way Pemain 1 faces; holding A gives a harder shot', () => {
    const tap = run(bola, 5);
    tap.step(INTRO_F);
    tap.step(1, [], ['a']);
    tap.step(6);
    const a = sn(tap);
    expect(a.kicks).toBe(1);
    expect(a.lastTouch).toBe(0);
    expect(a.ball.x).toBeGreaterThan(FW / 2 + 20);
    expect(tap.sfx).toContain('ball');
    expect(tap.sfx).not.toContain('whoosh');

    const hold = run(bola, 5);
    hold.step(INTRO_F);
    hold.step(40, [], ['a']);
    expect(sn(hold).players[0].charging).toBe(true);
    hold.step(1);
    const b = sn(hold);
    expect(b.kicks).toBe(1);
    expect(hold.sfx).toContain('whoosh');
    expect(b.ball.vx).toBeGreaterThan(a.ball.vx + 200);
  });

  it('B sprints faster and drains stamina, which refills after', () => {
    const r = run(bola, 2);
    r.step(INTRO_F);
    const y0 = sn(r).players[0].y;
    r.step(30, ['up']);
    const walk = y0 - sn(r).players[0].y;
    const r2 = run(bola, 2);
    r2.step(INTRO_F);
    r2.step(30, ['up', 'b']);
    const s = sn(r2);
    expect(y0 - s.players[0].y).toBeGreaterThan(walk * 1.25);
    expect(s.players[0].stamina).toBeLessThan(0.8);
    r2.step(240);
    expect(sn(r2).players[0].stamina).toBe(1);
  });

  it('a goal adds to the score, shows the banner pause, then kicks off from the centre', () => {
    const r = run(bola, 7);
    let f = 0;
    while (sn(r).score[0] + sn(r).score[1] === 0 && f < 120 * 60) { const p = chase(f++, r.snap()); r.step(1, p.held, p.press, p.axis); }
    const s = sn(r);
    expect(s.score[0] + s.score[1]).toBe(1);
    expect(s.phase).toBe('goal');
    expect(s.ball.x < MX || s.ball.x > FW - MX).toBe(true);
    expect(r.sfx.some((x) => x === 'win' || x === 'coin')).toBe(true);
    const scorer = s.score[0] ? 0 : 1;
    const starts = r.sfx.filter((x) => x === 'start').length;
    r.step(Math.round(GOAL_PAUSE * 60) - 2);
    expect(sn(r).phase).toBe('goal');
    r.step(3);
    const k = sn(r);
    expect(k.phase).toBe('play');
    expect(k.kickTeam).toBe(1 - scorer);
    expect(Math.hypot(k.ball.x - FW / 2, k.ball.y - FH / 2)).toBeLessThan(1);
    expect(r.sfx.filter((x) => x === 'start').length).toBe(starts + 1);
    expect(r.hud).toContain(`Oranye ${k.score[0]} - ${k.score[1]} Biru`);
  });

  it('solo: a chasing player can beat the CPU and every match ends inside the time limit with the leaderboard score', () => {
    let wins = 0, goalsFor = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = run(bola, seed);
      const res = r.play(chase, MAX_S);
      expect(res, `seed ${seed}`).not.toBeNull();
      const s = sn(r);
      expect(s.phase).toBe('over');
      const [o, b] = s.score;
      expect(Math.max(o, b) >= WIN_GOALS || s.timeLeft === 0).toBe(true);
      expect(typeof res!.score).toBe('number');
      expect(res!.versus).toBeUndefined();
      expect(res!.won).toBe(o > b);
      expect(res!.score).toBe(o * 100 + Math.max(0, o - b) * 50 + (o > b ? 300 : 0));
      expect(res!.summary).toMatch(/^(Menang|Kalah|Seri) \d-\d/);
      if (s.timeLeft === 0) expect(r.sfx.filter((x) => x === 'tick').length).toBe(10);
      if (res!.won) wins++;
      goalsFor += o;
    }
    // beatable: a plain chase-and-tap policy scores and wins some; the CPU still wins others
    expect(wins).toBeGreaterThanOrEqual(1);
    expect(wins).toBeLessThan(6);
    expect(goalsFor).toBeGreaterThanOrEqual(6);
  });

  it('solo: the CPU scores against a player who stands still', () => {
    const r = run(bola, 4);
    const res = r.play(() => ({}), MAX_S);
    expect(res).not.toBeNull();
    expect(res!.won).toBe(false);
    expect(sn(r).score[1]).toBeGreaterThanOrEqual(3);
  });

  it('two players: Pemain 2 drives a Biru player, and the match ends as versus with no score', () => {
    const r = run(bola, 11, 2);
    const s0 = sn(r);
    expect(s0.versus).toBe(true);
    expect(s0.humans).toBe(2);
    expect(s0.players[1]).toMatchObject({ team: 'biru', cpu: false });
    expect(s0.players.map((p) => p.cpu)).toEqual([false, false, true, true]);
    r.stepPlayers(INTRO_F, [{}, {}]);
    const a = sn(r).players[1];
    // Pemain 2 idle: their player does not move by itself
    r.stepPlayers(40, [{}, {}]);
    expect(sn(r).players[1]).toMatchObject({ x: a.x, y: a.y });
    // only Pemain 2's input moves it; Pemain 1 holding a direction does not
    r.stepPlayers(30, [{ held: ['left'] }, { held: ['up'] }]);
    const b = sn(r).players[1];
    expect(a.y - b.y).toBeGreaterThan(60);
    r.stepPlayers(Math.round(MAX_S * 60), [{}, {}]);
    expect(r.result).not.toBeNull();
    expect(r.result!.versus).toBe(true);
    expect(r.result!.score).toBe(0);
    const [o, bl] = sn(r).score;
    expect(r.result!.won).toBe(o > bl);
    expect(r.result!.summary).toMatch(/^(Oranye menang|Biru menang|Seri) \d-\d$/);
  });

  it('is deterministic for a seed', () => {
    const go = (seed: number) => {
      const r = run(bola, seed);
      const res = r.play(chase, 60);
      return JSON.stringify([res, r.snap(), r.sfx.length]);
    };
    const a = go(42);
    expect(a).toBe(go(42));
    expect(a).not.toBe(go(43));
  });
});
