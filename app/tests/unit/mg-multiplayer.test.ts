import { describe, expect, it } from 'vitest';
import { run } from './mg-harness';
import tarung from '../../src/minigames/games/tarung-kantor';
import arena from '../../src/minigames/games/arena-bom';
import catur from '../../src/minigames/games/catur';

type Snap = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// Budi 2026-10-14: local multiplayer with several gamepads on one screen.
describe('local multiplayer: each player moves with their own pad', () => {
  it('Tarung Kantor: two players pick, ready up, and Pemain 2 drives the right fighter (no CPU)', () => {
    expect(tarung.meta.players).toBe(2);
    const r = run(tarung, 7, 2);
    r.stepPlayers(1, [{ press: ['right'] }, { press: ['right'] }]);
    r.stepPlayers(2, [{}, {}]);
    r.stepPlayers(1, [{ press: ['a'] }, {}]);
    let s = r.snap() as Snap;
    expect(s.versus).toBe(true);
    expect(s.ready).toEqual([true, false]);
    expect(s.phase).toBe('select');
    r.stepPlayers(1, [{}, { press: ['a'] }]);
    s = r.snap() as Snap;
    expect(s.phase).toBe('intro');
    expect(s.opponents).toEqual([s.c.id]);
    r.stepPlayers(110, [{}, {}]);
    expect((r.snap() as Snap).phase).toBe('fight');
    // Pemain 2 idle: the right fighter does not move by itself
    const x0 = (r.snap() as Snap).c.x;
    r.stepPlayers(40, [{}, {}]);
    expect((r.snap() as Snap).c.x).toBe(x0);
    // Pemain 2 walks toward Pemain 1
    r.stepPlayers(40, [{}, { held: ['left'] }]);
    expect((r.snap() as Snap).c.x).toBeLessThan(x0 - 30);
  });

  it('Tarung Kantor: a versus match ends with the winner, no leaderboard score', () => {
    const r = run(tarung, 9, 2);
    r.stepPlayers(1, [{ press: ['a'] }, {}]);
    r.stepPlayers(2, [{}, {}]);
    r.stepPlayers(1, [{}, { press: ['a'] }]);
    r.stepPlayers(110, [{}, {}]);
    // Pemain 1 walks in and punches; Pemain 2 stands still
    for (let i = 0; i < 4000 && !r.result; i++) r.stepPlayers(1, [i % 12 === 0 ? { held: ['right'], press: ['a'] } : { held: ['right'] }, {}]);
    expect(r.result?.versus).toBe(true);
    expect(r.result?.score).toBe(0);
    expect(r.result?.summary).toMatch(/Pemain 1/);
  });

  it('Tarung Kantor solo still fights the CPU', () => {
    const r = run(tarung, 7);
    r.step(1, [], ['a']);
    expect((r.snap() as Snap).versus).toBe(false);
    expect((r.snap() as Snap).opponents).toHaveLength(3);
  });

  it('Arena Bom: up to four players; Pemain 2 walks from its own corner, the rest stay CPU', () => {
    expect(arena.meta.players).toBe(4);
    const r = run(arena, 11, 2);
    r.stepPlayers(100, [{}, {}]);
    let s = r.snap() as Snap;
    expect(s.phase).toBe('play');
    expect(s.humans).toBe(2);
    const p2 = s.players[1];
    // Pemain 2 starts top right (clockwise spawns), so it walks down the edge lane
    r.stepPlayers(30, [{}, { held: ['down'] }]);
    s = r.snap() as Snap;
    expect(s.players[1].y).toBeGreaterThan(p2.y + 0.5);
    // Pemain 2 drops its own bomb
    r.stepPlayers(1, [{}, { press: ['a'] }]);
    expect((r.snap() as Snap).bombs).toBeGreaterThanOrEqual(1);
  });

  it('Arena Bom 4 players: no seat is driven by the computer (Budi 2026-11-20: 4P game was a mess)', () => {
    const r = run(arena, 11, 4);
    r.stepPlayers(110, [{}, {}, {}, {}]);
    const a = (r.snap() as Snap).players.map((p: { x: number; y: number }) => [p.x, p.y]);
    r.stepPlayers(240, [{}, {}, {}, {}]);
    const s = r.snap() as Snap;
    // nobody touches a stick: every player stays on its spawn and drops no bomb
    expect(s.players.map((p: { x: number; y: number }) => [p.x, p.y])).toEqual(a);
    expect(s.bombs).toBe(0);
    // spawns go round the board clockwise, in the order of the top bar
    expect(a).toEqual([[1, 1], [17, 1], [17, 9], [1, 9]]);
  });

  it('Arena Bom 2 players: Pemain 2 is not steered by the computer, the empty corners are', () => {
    const r = run(arena, 11, 2);
    r.stepPlayers(110, [{}, {}]);
    const a = (r.snap() as Snap).players.map((p: { x: number; y: number }) => [p.x, p.y]);
    r.stepPlayers(240, [{}, {}]);
    const s = (r.snap() as Snap).players.map((p: { x: number; y: number }) => [p.x, p.y]);
    expect(s.slice(0, 2)).toEqual(a.slice(0, 2));
    expect(s.slice(2)).not.toEqual(a.slice(2));
  });

  it('Arena Bom versus: the match result names the winning player and saves no score', () => {
    const r = run(arena, 5, 2);
    // nobody moves: the CPUs and the closing arena decide; the match must still end
    for (let i = 0; i < 60 * 60 * 14 && !r.result; i++) r.stepPlayers(1, [{}, {}]);
    expect(r.result?.versus).toBe(true);
    expect(r.result?.score).toBe(0);
  });

  it('Catur: Pemain 1 plays white, Pemain 2 plays black with its own pad, no computer move', () => {
    expect(catur.meta.players).toBe(2);
    const r = run(catur, 3, 2);
    let s = r.snap() as Snap;
    expect(s.versus).toBe(true);
    expect(s.phase).toBe('play');
    // white: e2 -> e4 (cursor starts on e2)
    r.stepPlayers(1, [{ press: ['a'] }, {}]);
    r.stepPlayers(1, [{ press: ['up'] }, {}]); r.stepPlayers(1, [{}, {}]);
    r.stepPlayers(1, [{ press: ['up'] }, {}]); r.stepPlayers(1, [{}, {}]);
    r.stepPlayers(1, [{ press: ['a'] }, {}]);
    s = r.snap() as Snap;
    expect(s.turn).toBe(-1);
    // the computer does not answer
    r.stepPlayers(120, [{}, {}]);
    expect((r.snap() as Snap).turn).toBe(-1);
    // Pemain 1's buttons do nothing on black's turn
    r.stepPlayers(1, [{ press: ['a'] }, {}]);
    expect((r.snap() as Snap).sel).toBe(-1);
    // black: e7 -> e5 with Pemain 2's pad (its cursor starts on e7)
    r.stepPlayers(1, [{}, { press: ['a'] }]);
    r.stepPlayers(1, [{}, { press: ['down'] }]); r.stepPlayers(1, [{}, {}]);
    r.stepPlayers(1, [{}, { press: ['down'] }]); r.stepPlayers(1, [{}, {}]);
    r.stepPlayers(1, [{}, { press: ['a'] }]);
    s = r.snap() as Snap;
    expect(s.turn).toBe(1);
    expect(s.last).toBe('e7e5');
  });
});
