import { describe, expect, it } from 'vitest';
import world from '@design/world.json';
import walls from '@design/derived/walls.json';
import { buildFloor, MaterialCache, WALL_HEIGHT_EXTERIOR } from '../../src/world/build';
import type { DerivedWalls, World } from '../../src/world/types';

const W = world as unknown as World;

describe('runtime walls use the dataset windows (P03)', () => {
  for (const floor of ['L1', 'L2'] as const) {
    it(`${floor}: every window is built, as an opening or a high band`, () => {
      const fb = buildFloor(W, walls as unknown as DerivedWalls, floor, new MaterialCache(true), false, []);
      const got = fb.group.userData.windows as { full: number; high: number };
      const expected = W.windows.filter((w) => w.floor === floor);
      expect(got.full + got.high).toBe(expected.length);
      expect(got.high).toBe(expected.filter((w) => w.sill >= WALL_HEIGHT_EXTERIOR).length);
    });
  }

  it('every swing door names a room it connects', () => {
    for (const d of W.doors) {
      if (d.type === 'single' || d.type === 'double') expect(d.rooms).toContain(d.swing!.into);
      else expect(d.swing).toBeUndefined();
    }
  });
});
