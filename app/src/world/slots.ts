// Port of design/authoring/seed_world.py::derive_slots so Office Studio can
// re-derive activity slots for moved or new fixtures. Parity with the Python
// output is unit-tested against world.activitySlots.
import type { ActivitySlot, Fixture, World } from './types';

interface SlotTemplate { activity: ActivitySlot['activity']; dx: number; dy: number; pose: 'sit' | 'stand'; facingRel?: number }

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r1 = (v: number) => Math.round(v * 10) / 10;

export function deriveSlots(fixtures: Fixture[], catalog: World['catalog']): ActivitySlot[] {
  const out: ActivitySlot[] = [];
  for (const fx of fixtures) {
    const tpl = ((catalog[fx.type] as unknown as { slots?: SlotTemplate[] }).slots ?? []);
    tpl.forEach((s, i) => {
      const r = (fx.rot * Math.PI) / 180;
      const ox = s.dx * Math.cos(r) - s.dy * Math.sin(r);
      const oy = s.dx * Math.sin(r) + s.dy * Math.cos(r);
      const facing = (((fx.rot - 90 + (s.facingRel ?? 0)) % 360) + 360) % 360;
      out.push({
        id: `SL-${fx.id.slice(3)}-${i + 1}`, fixture: fx.id, floor: fx.floor, room: fx.room, activity: s.activity,
        pos: [r3(fx.pos[0] + ox), r3(fx.pos[1] + oy)], facing: r1(facing), pose: s.pose, capacity: 1,
      });
    });
  }
  return out;
}

/** A world copy whose fixtures (and therefore slots) come from a layout. */
export function withFixtures(world: World, fixtures: Fixture[]): World {
  return { ...world, fixtures, activitySlots: deriveSlots(fixtures, world.catalog) };
}
