import { describe, expect, it } from 'vitest';
import world from '@design/world.json';
import walls from '@design/derived/walls.json';
import counts from '@design/derived/nav-counts.json';
import { NavGrid } from '../../src/world/navgrid';
import type { DerivedWalls, FloorId, World } from '../../src/world/types';

const W = world as unknown as World;
const WALLS = walls as unknown as DerivedWalls;

describe('navgrid parity with tools/kantor/nav.py', () => {
  for (const floor of ['L1', 'L2'] as FloorId[]) {
    for (const mode of ['staff', 'visitor'] as const) {
      it(`${floor} ${mode} walkable count and probes match Python`, () => {
        const g = new NavGrid(W, WALLS, floor, W.fixtures, mode);
        const key = `${floor}_${mode}` as keyof typeof counts.counts;
        expect(g.walkableCount()).toBe(counts.counts[key]);
        let probes = '';
        for (let k = 0; k < g.w * g.h; k += 997) probes += String(g.blocked[k]);
        expect(probes).toBe(counts.probes[key as keyof typeof counts.probes]);
      });
    }
  }
});

describe('navgrid behaviour', () => {
  const g1 = new NavGrid(W, WALLS, 'L1');
  const v1 = new NavGrid(W, WALLS, 'L1', W.fixtures, 'visitor');
  const spawn = W.waypoints.find((w) => w.id === 'WP-L1-SPAWN')!.pos;

  it('spawn is walkable and walls are not', () => {
    expect(g1.walkableAt(spawn)).toBe(true);
    expect(g1.walkableAt([8, 4.5 + 2])).toBe(false); // wall between lobby and meeting, away from the door
  });

  it('finds a staff path from lobby to the server room but not as visitor', () => {
    expect(g1.findPath(spawn, [27, 20.5])).not.toBeNull();
    expect(v1.findPath(spawn, [27, 20.5])).toBeNull();
  });

  it('path points are all walkable and connected', () => {
    const path = g1.findPath(spawn, [3.5, 20.5])!;
    expect(path.length).toBeGreaterThan(2);
    for (let k = 1; k < path.length; k++) expect(g1.lineWalkable(path[k - 1], path[k])).toBe(true);
  });
});
