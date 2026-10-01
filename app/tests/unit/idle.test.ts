import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import world from '@design/world.json';
import walls from '@design/derived/walls.json';
import { NavGrid } from '../../src/world/navgrid';
import { IdleSim } from '../../src/sim/idle';
import type { DerivedWalls, FloorId, World } from '../../src/world/types';

const W = world as unknown as World;
const WALLS = walls as unknown as DerivedWalls;
let nav: Record<FloorId, NavGrid>;

beforeAll(() => {
  nav = { L1: new NavGrid(W, WALLS, 'L1'), L2: new NavGrid(W, WALLS, 'L2') };
});
afterEach(() => vi.unstubAllGlobals());

function run(seed: number, seconds: number, onTick?: (sim: IdleSim) => void) {
  const sim = new IdleSim(W, nav, { seed, startHour: 8.5, minutesPerSecond: 2 });
  const dt = 0.1;
  for (let t = 0; t < seconds; t += dt) {
    sim.step(dt);
    onTick?.(sim);
  }
  return sim;
}

describe('idle simulation (REQ-IDLE-01)', () => {
  it('is deterministic for a seed', () => {
    const a = run(7, 300);
    const b = run(7, 300);
    expect(a.npcs.map((n) => [n.floor, n.pos.map((x) => x.toFixed(3)), n.activity])).toEqual(b.npcs.map((n) => [n.floor, n.pos.map((x) => x.toFixed(3)), n.activity]));
    const c = run(8, 300);
    expect(c.npcs.map((n) => n.pos.join())).not.toEqual(a.npcs.map((n) => n.pos.join()));
  });

  it('never over-books a slot, never strands an NPC and never touches the network (2 h soak)', () => {
    const fetchSpy = vi.fn(() => { throw new Error('network call from idle sim'); });
    vi.stubGlobal('fetch', fetchSpy);
    let maxShare = 0;
    const stuckSince = new Map<string, number>();
    let maxStuck = 0;
    const sim = run(42, 7200, (s) => {
      for (const [, ids] of s.occupancy()) expect(ids.length).toBeLessThanOrEqual(1);
      const counts: Record<string, number> = {};
      for (const n of s.npcs) if (n.phase === 'perform' && n.activity !== 'desk') counts[n.activity] = (counts[n.activity] ?? 0) + 1;
      for (const v of Object.values(counts)) maxShare = Math.max(maxShare, v / s.npcs.length);
      for (const n of s.npcs) {
        const moving = n.phase === 'travel' || n.phase === 'recover';
        const key = n.id;
        if (moving && Math.hypot(n.pos[0] - n.lastPos[0], n.pos[1] - n.lastPos[1]) === 0 && s.time - n.lastProgressAt > 0) {
          stuckSince.set(key, stuckSince.get(key) ?? s.time);
          maxStuck = Math.max(maxStuck, s.time - stuckSince.get(key)!);
        } else stuckSince.delete(key);
      }
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sim.externalCalls).toBe(0);
    expect(maxStuck).toBeLessThan(10);
    // No activity other than desk work is done by more than half the team at once.
    expect(maxShare).toBeLessThanOrEqual(0.5);
    for (const n of sim.npcs) {
      expect(Object.keys(n.stats.activities).length, `${n.id} variety`).toBeGreaterThanOrEqual(3);
      expect(n.workStatus).toBe('unknown');
    }
    const floors = new Set(sim.log.filter((l) => l.event === 'floor').map((l) => l.detail));
    expect(floors.has('L2')).toBe(true);
    expect(sim.log.some((l) => l.event === 'group')).toBe(true);
  });

  it('player interaction pauses an NPC and keeps its reservation until resume', () => {
    const sim = run(3, 120);
    const npc = sim.npcs.find((n) => n.slot)!;
    const slot = npc.slot!;
    sim.pauseForPlayer(npc.id);
    for (let k = 0; k < 600; k++) sim.step(0.1);
    expect(npc.phase).toBe('paused');
    expect(sim.reservations.get(slot)?.npc).toBe(npc.id);
    sim.resume(npc.id);
    expect(npc.phase).not.toBe('paused');
  });

  it('failure path: a destination sealed mid-route cancels, releases and recovers without deleting the NPC', () => {
    const sim = new IdleSim(W, nav, { seed: 11 });
    let traveller = null as null | (typeof sim.npcs)[number];
    for (let t = 0; t < 600 && !traveller; t += 0.1) {
      sim.step(0.1);
      traveller = sim.npcs.find((n) => n.phase === 'travel' && n.slot && !n.via) ?? null;
    }
    expect(traveller).not.toBeNull();
    const slotId = traveller!.slot!;
    const slot = W.activitySlots.find((s) => s.id === slotId)!;
    // A layout edit drops a shelf onto the slot's standing area.
    const blocker = { id: 'FX-TEST-999', floor: slot.floor, room: slot.room, type: 'storage_shelf', asset: 'X', pos: slot.pos, rot: 0, size: [2.6, 2.6, 2.0], collider: true };
    const sealed = { ...W, fixtures: [...W.fixtures, blocker] } as World;
    const nav2 = { L1: new NavGrid(sealed, WALLS, 'L1', sealed.fixtures), L2: new NavGrid(sealed, WALLS, 'L2', sealed.fixtures) };
    const before = traveller!.stats.cancelled;
    const tSeal = sim.time;
    sim.updateNav(nav2);
    expect(traveller!.slot).toBeNull();
    expect(sim.reservations.has(slotId)).toBe(false);
    expect(traveller!.stats.cancelled).toBe(before + 1);
    for (let t = 0; t < 300; t += 0.1) sim.step(0.1);
    expect(sim.npcs.length).toBe(W.actors.filter((a) => a.kind === 'npc').length);
    expect(sim.log.some((l) => l.t > tSeal && l.event === 'assign' && l.detail?.startsWith(slotId))).toBe(false);
    for (const [, ids] of sim.occupancy()) expect(ids.length).toBeLessThanOrEqual(1);
  });
});
