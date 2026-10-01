import { beforeAll, describe, expect, it } from 'vitest';
import world from '@design/world.json';
import walls from '@design/derived/walls.json';
import { NavGrid } from '../../src/world/navgrid';
import { IdleSim } from '../../src/sim/idle';
import { AGENT_GAP } from '../../src/sim/agents';
import { Player } from '../../src/game/player';
import type { DerivedWalls, FloorId, Vec2, World } from '../../src/world/types';

const W = world as unknown as World;
const WALLS = walls as unknown as DerivedWalls;
let nav: Record<FloorId, NavGrid>;
beforeAll(() => { nav = { L1: new NavGrid(W, WALLS, 'L1'), L2: new NavGrid(W, WALLS, 'L2') }; });
const d = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('CEO / persona collision', () => {
  it('a walking NPC never closes in on the CEO standing in the corridor, and is not stuck for good (30 min)', () => {
    const sim = new IdleSim(W, nav, { seed: 11, startHour: 9 });
    const player: Vec2 = [17, 9.25]; // L1 corridor in front of the core: busiest crossing
    sim.setPlayer('L1', player);
    let violations = 0;
    const prev = new Map<string, number>();
    const lastMove = new Map<string, number>();
    const lastPos = new Map<string, Vec2>();
    let longestStill = 0;
    for (let t = 0; t < 1800; t += 0.1) {
      sim.step(0.1);
      for (const n of sim.npcs) {
        const was = prev.get(n.id);
        const now = n.floor === 'L1' ? d(n.pos, player) : Infinity;
        // A step that ends inside the gap and closer than before is a collision.
        if (was !== undefined && now < AGENT_GAP - 1e-6 && now < was - 1e-6) violations++;
        prev.set(n.id, now);
        const moving = n.phase === 'travel' || n.phase === 'recover';
        const lp = lastPos.get(n.id);
        if (!moving || !lp || d(n.pos, lp) > 1e-4) lastMove.set(n.id, sim.time);
        lastPos.set(n.id, [n.pos[0], n.pos[1]]);
        longestStill = Math.max(longestStill, sim.time - lastMove.get(n.id)!);
      }
    }
    expect(violations).toBe(0);
    expect(sim.yields).toBeGreaterThan(0);
    expect(longestStill).toBeLessThan(10);
    for (const n of sim.npcs) expect(Object.values(n.stats.activities).reduce((a, b) => a + b, 0), n.id).toBeGreaterThan(2);
  });

  it('no NPC freezes on a corner-clipping step (seeds 3, 11, 23; 30 min each)', () => {
    // Seed 11 froze Kevin for good before lineWalkable became an exact traversal.
    for (const seed of [3, 11, 23]) {
      const sim = new IdleSim(W, nav, { seed, startHour: 9 });
      const since = new Map<string, number>();
      const last = new Map<string, Vec2>();
      let worst = 0;
      for (let t = 0; t < 1800; t += 0.1) {
        sim.step(0.1);
        for (const n of sim.npcs) {
          const lp = last.get(n.id);
          const moving = n.phase === 'travel' || n.phase === 'recover';
          if (!moving || !lp || d(n.pos, lp) > 1e-4) since.set(n.id, sim.time);
          last.set(n.id, [n.pos[0], n.pos[1]]);
          worst = Math.max(worst, sim.time - since.get(n.id)!);
        }
      }
      expect(worst, `seed ${seed}`).toBeLessThan(10);
    }
  });

  it('walking NPCs keep their spacing outside arrival zones (2 h soak, same floor pairs)', () => {
    const sim = new IdleSim(W, nav, { seed: 42, startHour: 8.5, minutesPerSecond: 2 });
    let closeSteps = 0;
    let pairSteps = 0;
    for (let t = 0; t < 7200; t += 0.1) {
      sim.step(0.1);
      const walking = sim.npcs.filter((n) => (n.phase === 'travel' || n.phase === 'recover') && n.path.length && d(n.pos, n.path[n.path.length - 1]) > 1.0);
      for (let i = 0; i < walking.length; i++) for (let j = i + 1; j < walking.length; j++) {
        if (walking[i].floor !== walking[j].floor) continue;
        pairSteps++;
        if (d(walking[i].pos, walking[j].pos) < AGENT_GAP * 0.5) closeSteps++;
      }
    }
    // Overlap deeper than half the gap between two walkers is the visible
    // "walk through" failure; it must stay a rare transient, not a pattern.
    expect(closeSteps).toBeLessThanOrEqual(Math.max(5, pairSteps * 0.002));
    for (const n of sim.npcs) expect(Object.keys(n.stats.activities).length, n.id).toBeGreaterThanOrEqual(3);
  });

  it('the CEO stops at a persona and slides around instead of passing through', () => {
    const p = new Player([10, 9.25], 'L1', 0);
    const npc: Vec2 = [11.2, 9.25];
    let minD = Infinity;
    for (let k = 0; k < 120; k++) {
      p.step(1 / 30, [1, 0.15], false, nav.L1, [npc]);
      minD = Math.min(minD, d(p.pos, npc));
    }
    expect(minD).toBeGreaterThanOrEqual(AGENT_GAP - 0.02);
    expect(p.pos[0]).toBeGreaterThan(npc[0]); // got past by sliding
  });
});
