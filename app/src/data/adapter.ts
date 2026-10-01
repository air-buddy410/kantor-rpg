// Data adapter contract (PRD 9). The public/demo build only has the demo
// adapter: fixture actors with workStatus 'unknown'. The private adapter is
// M4-gated and deliberately not implemented; asking for it throws, so no code
// path in this build can reach a private source or endpoint.
import type { World } from '../world/types';

export type WorkStatus = 'working' | 'waiting' | 'blocked' | 'done' | 'unknown';
export type DataMode = 'demo' | 'private';

export interface ActorSummary {
  actorId: string;
  workStatus: WorkStatus;
  observedAt: string | null;
  source: string;
  taskSummary?: string;
}

export interface Snapshot {
  version: 1;
  mode: DataMode;
  observedAt: string;
  freshnessTTL: number; // seconds
  actors: ActorSummary[];
}

export class AdapterDisabledError extends Error {
  constructor() {
    super('Integrasi private (M4) dinonaktifkan sampai ada izin sumber, hosting, auth dan privasi.');
    this.name = 'AdapterDisabledError';
  }
}

export const PRIVATE_ENABLED = false as const;
const STATUSES: WorkStatus[] = ['working', 'waiting', 'blocked', 'done', 'unknown'];
const MAX_SUMMARY = 140;

export function demoSnapshot(world: World, now = new Date()): Snapshot {
  return {
    version: 1,
    mode: 'demo',
    observedAt: now.toISOString(),
    freshnessTTL: 0,
    actors: world.actors.filter((a) => a.kind === 'npc').map((a) => ({
      actorId: a.id, workStatus: 'unknown', observedAt: null, source: 'fixture demo (tanpa adapter)',
    })),
  };
}

export function createAdapter(mode: DataMode, world: World): { mode: DataMode; snapshot: () => Snapshot } {
  if (mode === 'private') throw new AdapterDisabledError();
  return { mode: 'demo', snapshot: () => demoSnapshot(world) };
}

/** Keep only allow-listed fields; anything unexpected maps to 'unknown', never 'done'. */
export function sanitizeActor(raw: unknown, knownActors: Set<string>): ActorSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.actorId !== 'string' || !knownActors.has(r.actorId)) return null;
  const status = STATUSES.includes(r.workStatus as WorkStatus) ? (r.workStatus as WorkStatus) : 'unknown';
  const observedAt = typeof r.observedAt === 'string' && !Number.isNaN(Date.parse(r.observedAt)) ? r.observedAt : null;
  const out: ActorSummary = { actorId: r.actorId, workStatus: observedAt ? status : 'unknown', observedAt, source: typeof r.source === 'string' ? r.source.slice(0, 60) : 'tidak diketahui' };
  if (typeof r.taskSummary === 'string') out.taskSummary = r.taskSummary.replace(/https?:\/\/\S+/g, '[tautan dihapus]').slice(0, MAX_SUMMARY);
  return out;
}

/** Stale or missing timestamps degrade to 'unknown' (adapter errors are never 'done'). */
export function effectiveStatus(a: ActorSummary, snapshot: Snapshot, now = Date.now()): { status: WorkStatus; stale: boolean } {
  if (!a.observedAt) return { status: 'unknown', stale: true };
  const age = (now - Date.parse(a.observedAt)) / 1000;
  if (snapshot.freshnessTTL <= 0 || age > snapshot.freshnessTTL || age < -60) return { status: 'unknown', stale: true };
  return { status: a.workStatus, stale: false };
}
