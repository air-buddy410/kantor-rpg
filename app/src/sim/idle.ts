// Deterministic NPC idle simulation (REQ-IDLE-01).
//
// Layers are kept apart on purpose (PRD 8): `activity` is what the avatar
// shows, `workStatus` is what an adapter would report. In the demo there is
// no adapter, so workStatus stays 'unknown' no matter what the avatar does.
// Nothing here performs network or model calls: decisions are a seeded
// utility function evaluated only when an NPC finishes its current activity.
import type { NavGrid } from '../world/navgrid';
import type { Actor, ActivitySlot, FloorId, Vec2, VerticalLink, World } from '../world/types';

export type Activity = ActivitySlot['activity'] | 'walk' | 'idle' | 'talk';
export type Phase = 'choose' | 'travel' | 'perform' | 'paused' | 'recover';
export type WorkStatus = 'working' | 'waiting' | 'blocked' | 'done' | 'unknown';

export interface NpcState {
  id: string;
  name: string;
  role: string;
  floor: FloorId;
  pos: Vec2;
  facing: number;
  phase: Phase;
  activity: Activity;
  slot: string | null;
  path: Vec2[];
  pathIndex: number;
  /** pending floor change after reaching a link end */
  via: { link: string; to: FloorId; arrive: Vec2 } | null;
  until: number;
  lastProgressAt: number;
  lastPos: Vec2;
  failures: number;
  recentActivities: Activity[];
  cooldown: Record<string, number>;
  workStatus: WorkStatus;
  workStatusSource: string;
  group: string | null;
  speed: number;
  stats: { activities: Record<string, number>; recoveries: number; cancelled: number; distance: number };
}

export interface Reservation { npc: string; expires: number }

export interface SimOptions {
  seed: number;
  /** simulated clock start, hours since midnight (e.g. 9 = 09:00) */
  startHour?: number;
  /** real seconds per simulated minute; only affects the clock label */
  minutesPerSecond?: number;
  maxNpcs?: number;
}

export interface SimEvents { onFloorChange?: (npc: NpcState) => void }

const WORK_ACTIVITIES = new Set(['desk']);
const PERFORM_SECONDS: Record<string, [number, number]> = {
  desk: [40, 90], coffee: [12, 25], chat: [20, 45], read: [18, 40], stretch: [8, 15], game: [25, 50],
  billiards: [25, 50], exercise: [20, 45], rest: [15, 35], talk: [6, 6], idle: [3, 6],
};
const COOLDOWN_SECONDS: Record<string, number> = { coffee: 120, game: 90, billiards: 90, exercise: 120, stretch: 60, chat: 60, read: 40, rest: 60, desk: 0 };
const STUCK_SECONDS = 2.5;
const RESERVATION_TTL = 30; // seconds of travel allowance before a reservation lapses

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class IdleSim {
  readonly npcs: NpcState[] = [];
  readonly reservations = new Map<string, Reservation>();
  time = 0;
  private rand: () => number;
  private slots: ActivitySlot[];
  private reach: Record<FloorId, Uint8Array>;
  /** hard cap so no leisure activity is done by more than half the team at once */
  private activityCap: number;
  private slotById = new Map<string, ActivitySlot>();
  private links: VerticalLink[];
  private groupCounter = 0;
  private nextGroupAt = 45;
  readonly startHour: number;
  readonly minutesPerSecond: number;
  /** count of external calls attempted; must stay 0 (boundary of REQ-IDLE-01) */
  externalCalls = 0;
  log: { t: number; npc: string; event: string; detail?: string }[] = [];

  constructor(private world: World, private nav: Record<FloorId, NavGrid>, opts: SimOptions, private events: SimEvents = {}) {
    this.rand = mulberry32(opts.seed);
    this.startHour = opts.startHour ?? 9;
    this.minutesPerSecond = opts.minutesPerSecond ?? 1;
    this.reach = this.computeReach();
    this.slots = this.reachableSlots();
    for (const s of world.activitySlots) this.slotById.set(s.id, s);
    this.links = world.verticalLinks.filter((l) => l.playable !== false);
    const npcs = world.actors.filter((a) => a.kind === 'npc').slice(0, opts.maxNpcs ?? 12);
    this.activityCap = Math.max(1, Math.floor(npcs.length / 2));
    for (const a of npcs) this.npcs.push(this.spawn(a));
  }

  /** Slots whose standing point is not connected to the spawn are never offered. */
  private reachableSlots(): ActivitySlot[] {
    return this.world.activitySlots.filter((s) => {
      const p = this.approachPoint(s);
      if (!p) return false;
      const g = this.nav[s.floor];
      const [i, j] = g.cellOf(p);
      return this.reach[s.floor][j * g.w + i] === 1;
    });
  }

  /** New fixture layout (Office Studio): slots and nav both change. */
  updateLayout(world: World, nav: Record<FloorId, NavGrid>): void {
    this.world = world;
    this.slotById.clear();
    for (const s of world.activitySlots) this.slotById.set(s.id, s);
    // NPCs whose home desk vanished keep working from wherever they are.
    this.updateNav(nav);
  }

  /** Layout changed (Office Studio publish): rebuild reachability and replan travellers. */
  updateNav(nav: Record<FloorId, NavGrid>): void {
    this.nav = nav;
    this.reach = this.computeReach();
    this.slots = this.reachableSlots();
    const ok = new Set(this.slots.map((s) => s.id));
    for (const npc of this.npcs) {
      if (npc.slot && !ok.has(npc.slot)) {
        this.fail(npc, 'slot no longer reachable');
        continue;
      }
      if ((npc.phase === 'travel') && npc.slot && !this.planRoute(npc, this.slotById.get(npc.slot)!)) this.fail(npc, 'replan failed');
      if (!this.nav[npc.floor].walkableAt(npc.pos)) {
        const near = this.nav[npc.floor].nearestWalkable(npc.pos, 1.5);
        if (near) npc.pos = near;
      }
    }
  }

  private computeReach(): Record<FloorId, Uint8Array> {
    const spawn = this.world.waypoints.find((w) => w.id === this.world.floors[0].spawn)!;
    const l1 = this.nav.L1.flood([this.nav.L1.cellOf(spawn.pos)]);
    const seeds: [number, number][] = [];
    for (const link of this.world.verticalLinks) {
      if (link.playable === false) continue;
      const a = link.ends.find((e) => e.floor === 'L1');
      const b = link.ends.find((e) => e.floor === 'L2');
      if (a && b && this.nav.L1.nearestWalkable(a.point, 1, l1)) seeds.push(this.nav.L2.cellOf(b.arrive ?? b.point));
    }
    return { L1: l1, L2: this.nav.L2.flood(seeds) };
  }

  /** Simulated wall clock label, e.g. "09:42" (labelled simulation in the UI). */
  clockLabel(): string {
    const mins = Math.floor(this.startHour * 60 + (this.time * this.minutesPerSecond));
    const h = Math.floor(mins / 60) % 24;
    return `${String(h).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }

  workHours(): boolean {
    const h = (this.startHour + (this.time * this.minutesPerSecond) / 60) % 24;
    return (h >= 9 && h < 12) || (h >= 13 && h < 17);
  }

  private spawn(a: Actor): NpcState {
    const seat = a.homeSeat ? this.world.activitySlots.find((s) => s.fixture === a.homeSeat) : undefined;
    const fallback = this.world.waypoints.find((w) => w.kind === 'safe' && w.floor === 'L1')!;
    const floor = (seat?.floor ?? fallback.floor) as FloorId;
    const start = (seat && this.approachPoint(seat)) ?? fallback.pos;
    return {
      id: a.id, name: a.displayName, role: a.role, floor, pos: [start[0], start[1]], facing: seat?.facing ?? 90,
      phase: 'choose', activity: 'idle', slot: null, path: [], pathIndex: 0, via: null, until: 0,
      lastProgressAt: 0, lastPos: [start[0], start[1]], failures: 0, recentActivities: [], cooldown: {},
      workStatus: 'unknown', workStatusSource: 'tidak ada adapter (demo offline)', group: null,
      speed: 1.3 + this.rand() * 0.25, stats: { activities: {}, recoveries: 0, cancelled: 0, distance: 0 },
    };
  }

  /** Walkable standing point next to a slot (sit slots are inside the chair collider). */
  approachPoint(s: ActivitySlot): Vec2 | null {
    return this.nav[s.floor].nearestWalkable(s.pos, 0.9);
  }

  activeCount(activity: string): number {
    return this.npcs.filter((n) => n.activity === activity && (n.phase === 'perform' || n.phase === 'travel')).length;
  }

  private reserve(slotId: string, npc: string): boolean {
    const r = this.reservations.get(slotId);
    if (r && r.npc !== npc && r.expires > this.time) return false;
    this.reservations.set(slotId, { npc, expires: this.time + RESERVATION_TTL });
    return true;
  }

  release(npc: NpcState, reason: string): void {
    if (npc.slot) {
      const r = this.reservations.get(npc.slot);
      if (r && r.npc === npc.id) this.reservations.delete(npc.slot);
      this.log.push({ t: this.time, npc: npc.id, event: 'release', detail: `${npc.slot} (${reason})` });
    }
    npc.slot = null;
  }

  /** Utility selection; evaluated only when an NPC needs a new activity. */
  private choose(npc: NpcState): void {
    const actor = this.world.actors.find((a) => a.id === npc.id)!;
    const pref = actor.rolePreference;
    const working = this.workHours();
    let best: { slot: ActivitySlot; score: number } | null = null;
    for (const s of this.slots) {
      const r = this.reservations.get(s.id);
      if (r && r.npc !== npc.id && r.expires > this.time) continue;
      if ((npc.cooldown[s.activity] ?? 0) > this.time) continue;
      if (s.activity !== 'desk' && this.activeCount(s.activity) >= this.activityCap) continue;
      if (s.activity === 'desk' && s.fixture !== actor.homeSeat) continue; // NPCs only use their own desk
      let score = (pref[s.activity] ?? 0.3) * 1.0;
      if (working && WORK_ACTIVITIES.has(s.activity)) score += 2.5;
      if (!working && !WORK_ACTIVITIES.has(s.activity)) score += 1.0;
      const dist = Math.hypot(s.pos[0] - npc.pos[0], s.pos[1] - npc.pos[1]) + (s.floor === npc.floor ? 0 : 12);
      score -= dist * 0.04;
      // Herding penalty: avoid everyone choosing coffee at once.
      score -= this.activeCount(s.activity) * 0.9;
      if (npc.recentActivities.slice(-2).includes(s.activity)) score -= 1.2;
      score += this.rand() * 0.8;
      if (!best || score > best.score) best = { slot: s, score };
    }
    if (!best) {
      npc.phase = 'perform';
      npc.activity = 'idle';
      npc.until = this.time + 3;
      return;
    }
    this.assign(npc, best.slot);
  }

  private assign(npc: NpcState, slot: ActivitySlot, group: string | null = null): boolean {
    if (!this.reserve(slot.id, npc.id)) return false;
    npc.slot = slot.id;
    npc.group = group;
    npc.activity = slot.activity;
    if (!this.planRoute(npc, slot)) {
      npc.stats.cancelled++;
      this.release(npc, 'no route');
      npc.cooldown[slot.activity] = this.time + 20;
      npc.phase = 'choose';
      npc.activity = 'idle';
      return false;
    }
    npc.phase = 'travel';
    npc.lastProgressAt = this.time;
    this.log.push({ t: this.time, npc: npc.id, event: 'assign', detail: `${slot.id} ${slot.activity}${group ? ` ${group}` : ''}` });
    return true;
  }

  private planRoute(npc: NpcState, slot: ActivitySlot): boolean {
    const goal = this.approachPoint(slot);
    if (!goal) return false;
    npc.via = null;
    if (slot.floor === npc.floor) {
      const p = this.nav[npc.floor].findPath(npc.pos, goal);
      if (!p) return false;
      npc.path = p;
      npc.pathIndex = 0;
      return true;
    }
    // Cross-floor: walk to the nearest usable link end, change floor there.
    let best: { path: Vec2[]; link: VerticalLink; len: number } | null = null;
    for (const link of this.links) {
      const from = link.ends.find((e) => e.floor === npc.floor);
      const to = link.ends.find((e) => e.floor === slot.floor);
      if (!from || !to) continue;
      const p = this.nav[npc.floor].findPath(npc.pos, from.point);
      if (!p) continue;
      const len = pathLength(p);
      if (!best || len < best.len) best = { path: p, link, len };
    }
    if (!best) return false;
    const to = best.link.ends.find((e) => e.floor === slot.floor)!;
    npc.path = best.path;
    npc.pathIndex = 0;
    npc.via = { link: best.link.id, to: slot.floor, arrive: to.arrive ?? to.point };
    return true;
  }

  /** Player started talking to this NPC: highest priority, pause in place. */
  pauseForPlayer(id: string): NpcState | null {
    const npc = this.npcs.find((n) => n.id === id);
    if (!npc) return null;
    npc.phase = 'paused';
    npc.activity = 'talk';
    const r = npc.slot ? this.reservations.get(npc.slot) : undefined;
    if (r) r.expires = Number.POSITIVE_INFINITY;
    this.log.push({ t: this.time, npc: id, event: 'pause', detail: 'interaksi CEO' });
    return npc;
  }

  resume(id: string): void {
    const npc = this.npcs.find((n) => n.id === id);
    if (!npc || npc.phase !== 'paused') return;
    if (npc.slot) {
      const r = this.reservations.get(npc.slot);
      if (r) r.expires = this.time + RESERVATION_TTL;
      const slot = this.slotById.get(npc.slot)!;
      npc.activity = slot.activity;
      npc.phase = this.planRoute(npc, slot) ? 'travel' : 'choose';
      if (npc.phase === 'choose') this.release(npc, 'resume without route');
    } else npc.phase = 'choose';
    npc.lastProgressAt = this.time;
  }

  /** Schedule a small group chat on chat slots of one room (virtual, no speech generation). */
  private scheduleGroup(): void {
    const byRoom = new Map<string, ActivitySlot[]>();
    for (const s of this.slots) if (s.activity === 'chat' && !this.reservations.has(s.id)) {
      const list = byRoom.get(s.room) ?? [];
      list.push(s);
      byRoom.set(s.room, list);
    }
    const rooms = [...byRoom.entries()].filter(([, l]) => l.length >= 2);
    if (!rooms.length) return;
    const [room, list] = rooms[Math.floor(this.rand() * rooms.length)];
    const free = this.npcs.filter((n) => (n.phase === 'perform' || n.phase === 'choose') && n.group === null && n.activity !== 'talk');
    if (free.length < 2) return;
    const size = Math.min(list.length, free.length, 2 + Math.floor(this.rand() * 2), this.activityCap - this.activeCount('chat'));
    if (size < 2) return;
    const group = `GRP-${++this.groupCounter}`;
    const members = [...free].sort(() => this.rand() - 0.5).slice(0, size);
    let joined = 0;
    members.forEach((npc, i) => {
      this.release(npc, 'join group');
      if (this.assign(npc, list[i], group)) joined++;
    });
    this.log.push({ t: this.time, npc: '-', event: 'group', detail: `${group} ${room} ${joined}/${size}` });
  }

  step(dt: number): void {
    this.time += dt;
    for (const [id, r] of this.reservations) if (r.expires <= this.time) this.reservations.delete(id);
    if (this.time >= this.nextGroupAt) {
      this.scheduleGroup();
      this.nextGroupAt = this.time + 60 + this.rand() * 60;
    }
    for (const npc of this.npcs) this.stepNpc(npc, dt);
  }

  private stepNpc(npc: NpcState, dt: number): void {
    switch (npc.phase) {
      case 'paused':
        return;
      case 'choose':
        this.choose(npc);
        return;
      case 'perform':
        if (this.time >= npc.until) {
          this.release(npc, 'done');
          npc.cooldown[npc.activity] = this.time + (COOLDOWN_SECONDS[npc.activity] ?? 30);
          npc.recentActivities.push(npc.activity);
          if (npc.recentActivities.length > 6) npc.recentActivities.shift();
          npc.group = null;
          npc.phase = 'choose';
        }
        return;
      case 'recover':
      case 'travel':
        this.travel(npc, dt);
    }
  }

  private travel(npc: NpcState, dt: number): void {
    const nav = this.nav[npc.floor];
    if (npc.pathIndex >= npc.path.length) {
      if (npc.via) {
        const v = npc.via;
        npc.floor = v.to;
        npc.pos = [v.arrive[0], v.arrive[1]];
        npc.lastPos = [...npc.pos] as Vec2;
        npc.via = null;
        this.events.onFloorChange?.(npc);
        this.log.push({ t: this.time, npc: npc.id, event: 'floor', detail: v.to });
        const slot = npc.slot ? this.slotById.get(npc.slot) : undefined;
        if (slot && this.planRoute(npc, slot)) return;
        if (npc.phase !== 'recover') { this.fail(npc, 'no route after floor change'); return; }
      }
      if (npc.phase === 'recover') { npc.phase = 'choose'; npc.activity = 'idle'; return; }
      const slot = npc.slot ? this.slotById.get(npc.slot) : undefined;
      npc.phase = 'perform';
      if (slot) {
        npc.facing = slot.facing;
        const [lo, hi] = PERFORM_SECONDS[slot.activity] ?? [10, 20];
        npc.until = this.time + lo + this.rand() * (hi - lo);
        npc.stats.activities[slot.activity] = (npc.stats.activities[slot.activity] ?? 0) + 1;
        const r = this.reservations.get(slot.id);
        if (r) r.expires = npc.until + 1;
      } else npc.until = this.time + 2;
      return;
    }
    const target = npc.path[npc.pathIndex];
    const dx = target[0] - npc.pos[0];
    const dy = target[1] - npc.pos[1];
    const d = Math.hypot(dx, dy);
    const stepLen = npc.speed * dt;
    if (d <= stepLen) {
      npc.pos = [target[0], target[1]];
      npc.pathIndex++;
    } else {
      const nx = npc.pos[0] + (dx / d) * stepLen;
      const ny = npc.pos[1] + (dy / d) * stepLen;
      if (nav.walkableAt([nx, ny])) npc.pos = [nx, ny];
    }
    if (d > 1e-6) npc.facing = (Math.atan2(dy, dx) * 180) / Math.PI;
    const moved = Math.hypot(npc.pos[0] - npc.lastPos[0], npc.pos[1] - npc.lastPos[1]);
    npc.stats.distance += moved;
    if (moved > 0.01) npc.lastProgressAt = this.time;
    npc.lastPos = [npc.pos[0], npc.pos[1]];
    if (this.time - npc.lastProgressAt > STUCK_SECONDS) this.fail(npc, 'stuck');
  }

  /** Failure path: release the reservation, retry once, then walk to the safe point. */
  private fail(npc: NpcState, why: string): void {
    npc.failures++;
    npc.stats.cancelled++;
    this.log.push({ t: this.time, npc: npc.id, event: 'fail', detail: why });
    this.release(npc, why);
    npc.group = null;
    if (npc.failures <= 1 && npc.phase !== 'recover') {
      npc.phase = 'choose';
      npc.activity = 'idle';
      return;
    }
    const safeId = this.world.floors.find((f) => f.id === npc.floor)!.safePoint;
    const safe = this.world.waypoints.find((w) => w.id === safeId)!;
    const p = this.nav[npc.floor].findPath(npc.pos, safe.pos);
    npc.stats.recoveries++;
    npc.failures = 0;
    npc.activity = 'walk';
    if (p) {
      npc.path = p;
      npc.pathIndex = 0;
      npc.phase = 'recover';
    } else {
      // Unreachable even from here (layout edit sealed it): place at the safe
      // point rather than deleting the NPC.
      npc.pos = [safe.pos[0], safe.pos[1]];
      npc.phase = 'choose';
    }
    npc.lastProgressAt = this.time;
  }

  /** Capacity check used by tests and the debug overlay. */
  occupancy(): Map<string, string[]> {
    const m = new Map<string, string[]>();
    for (const n of this.npcs) {
      if (n.slot && (n.phase === 'perform' || n.phase === 'travel' || n.phase === 'paused')) {
        const list = m.get(n.slot) ?? [];
        list.push(n.id);
        m.set(n.slot, list);
      }
    }
    return m;
  }
}

export function pathLength(p: Vec2[]): number {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return s;
}
