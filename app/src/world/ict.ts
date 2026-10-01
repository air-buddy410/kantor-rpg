// Telecom outlets follow furniture in Office Studio layouts. Port of
// tools/kantor/ict_follow.py; app/tests/unit/ict.test.ts replays the cases the
// Python test generates, so both sides must produce identical outlet lists.
import type { Fixture, Outlet, World } from './types';

export interface OutletDerivation { outlets: Outlet[]; moved: string[]; removed: string[]; added: string[] }

const r3 = (v: number): number => Math.floor(v * 1000 + 0.5) / 1000;

/** FX-L1-D003 -> TO-L1-D003: stable across undo/redo and re-import. */
export function outletIdFor(fixtureId: string, floor: string): string {
  const m = /^FX-(L[12])-(.+)$/.exec(fixtureId);
  return m ? `TO-${m[1]}-${m[2]}` : `TO-${floor}-${fixtureId.replace('FX-', '')}`;
}

export function deriveOutlets(world: World, fixtures: Fixture[]): OutletDerivation {
  const { outletRules: rules, mountZ } = world.ict;
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  const devices = new Set(world.ict.devices.map((d) => d.id));
  const outlets: Outlet[] = [];
  const moved: string[] = [];
  const removed: string[] = [];
  const added: string[] = [];
  const served = new Set<string>();
  for (const o of world.ict.outlets) {
    if (devices.has(o.serves)) { outlets.push({ ...o }); continue; }
    const fx = byId.get(o.serves);
    if (!fx) { removed.push(o.id); continue; }
    served.add(fx.id);
    const pos: [number, number] = [r3(fx.pos[0]), r3(fx.pos[1])];
    if (pos[0] !== o.pos[0] || pos[1] !== o.pos[1] || fx.floor !== o.floor) moved.push(o.id);
    outlets.push({ ...o, floor: fx.floor, room: fx.room, pos });
  }
  // Python sorts by id with plain string comparison; match it (not localeCompare).
  const sorted = [...fixtures].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const fx of sorted) {
    const rule = rules[fx.type];
    if (!rule || served.has(fx.id)) continue;
    const id = outletIdFor(fx.id, fx.floor);
    added.push(id);
    outlets.push({
      id, floor: fx.floor, room: fx.room, pos: [r3(fx.pos[0]), r3(fx.pos[1])], mount: rule.mount, z: mountZ[rule.mount],
      ports: rule.ports, serves: fx.id, domain: rule.domainByFloor[fx.floor], endpointTypes: [...rule.endpointTypes],
    });
  }
  return { outlets, moved, removed, added };
}
