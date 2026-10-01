// Versioned layout documents for Office Studio: export, guarded import and
// local draft/publish/rollback storage. Import never executes or fetches
// anything: it parses JSON text, then rebuilds every fixture field from an
// allow-list after range checks, so unknown keys (including __proto__) are
// dropped and a bad file leaves the current layout untouched.
import type { Fixture, FloorId, World } from '../world/types';

export const LAYOUT_FORMAT = 'kantor-rpg-layout';
export const LAYOUT_VERSION = 1;
export const MAX_IMPORT_BYTES = 512 * 1024;
export const MAX_DEPTH = 6;
export const MAX_FIXTURES = 1500;

export interface LayoutDoc {
  format: typeof LAYOUT_FORMAT;
  version: typeof LAYOUT_VERSION;
  worldRevision: string;
  savedAt: string;
  note: string;
  fixtures: Fixture[];
}

export class LayoutError extends Error {}

const ID = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;
const TYPE = /^[a-z0-9_]+$/;

export function makeLayout(world: World, fixtures: Fixture[], note = ''): LayoutDoc {
  return { format: LAYOUT_FORMAT, version: LAYOUT_VERSION, worldRevision: world.revision.id, savedAt: new Date().toISOString(), note: note.slice(0, 200), fixtures };
}

export function serializeLayout(doc: LayoutDoc): string {
  return JSON.stringify(doc, null, 1);
}

function depth(v: unknown, d = 0): number {
  if (d > MAX_DEPTH) return d;
  if (v && typeof v === 'object') {
    let m = d;
    for (const x of Object.values(v as Record<string, unknown>)) m = Math.max(m, depth(x, d + 1));
    return m;
  }
  return d;
}

function finite(n: unknown, lo: number, hi: number, what: string): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < lo || n > hi) throw new LayoutError(`${what} di luar rentang`);
  return n;
}

function str(v: unknown, re: RegExp, what: string, max = 40): string {
  if (typeof v !== 'string' || v.length > max || !re.test(v)) throw new LayoutError(`${what} tidak valid`);
  return v;
}

/** Parse untrusted layout text. Throws LayoutError with a user-facing reason. */
export function parseLayout(text: string, world: World): LayoutDoc {
  if (typeof text !== 'string') throw new LayoutError('Isi file bukan teks');
  if (new Blob([text]).size > MAX_IMPORT_BYTES) throw new LayoutError(`File lebih dari ${MAX_IMPORT_BYTES / 1024} KB`);
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new LayoutError('JSON rusak'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new LayoutError('Struktur layout tidak dikenal');
  if (depth(raw) > MAX_DEPTH) throw new LayoutError('Struktur terlalu dalam');
  const r = raw as Record<string, unknown>;
  if (r.format !== LAYOUT_FORMAT) throw new LayoutError('Bukan file layout kantor-rpg');
  if (r.version !== LAYOUT_VERSION) throw new LayoutError(`Versi layout ${String(r.version)} tidak didukung`);
  if (r.worldRevision !== world.revision.id) throw new LayoutError(`Layout untuk revisi ${String(r.worldRevision)}, dataset sekarang ${world.revision.id}`);
  if (!Array.isArray(r.fixtures) || r.fixtures.length > MAX_FIXTURES) throw new LayoutError('Daftar fixture tidak valid');
  const rooms = new Map(world.rooms.map((x) => [x.id, x]));
  const seen = new Set<string>();
  const fixtures: Fixture[] = r.fixtures.map((f, i) => {
    if (!f || typeof f !== 'object' || Array.isArray(f)) throw new LayoutError(`Fixture #${i + 1} bukan objek`);
    const x = f as Record<string, unknown>;
    const id = str(x.id, ID, `ID fixture #${i + 1}`);
    if (seen.has(id)) throw new LayoutError(`ID ganda ${id}`);
    seen.add(id);
    const type = str(x.type, TYPE, `Tipe ${id}`);
    const cat = world.catalog[type];
    if (!cat) throw new LayoutError(`Tipe ${type} tidak ada di catalog`);
    const floor = x.floor === 'L1' || x.floor === 'L2' ? (x.floor as FloorId) : (() => { throw new LayoutError(`Lantai ${id} tidak valid`); })();
    const room = str(x.room, ID, `Ruang ${id}`);
    if (rooms.get(room)?.floor !== floor) throw new LayoutError(`Ruang ${room} tidak ada di ${floor}`);
    if (!Array.isArray(x.pos) || x.pos.length !== 2) throw new LayoutError(`Posisi ${id} tidak valid`);
    const pos: [number, number] = [finite(x.pos[0], 0, 32, `X ${id}`), finite(x.pos[1], 0, 24, `Y ${id}`)];
    const rot = finite(x.rot, 0, 270, `Rotasi ${id}`);
    if (rot % 90 !== 0) throw new LayoutError(`Rotasi ${id} harus kelipatan 90`);
    // Size, collider and asset always come from the catalog, never from the file:
    // an imported layout cannot point the runtime at another asset path.
    const out: Fixture = { id, floor, room, type, asset: `AST-${type.toUpperCase().replace(/_/g, '-')}`, pos, rot, size: [...cat.size] as [number, number, number], collider: cat.collider };
    for (const k of ['pairedWith', 'artwork', 'verticalLink', 'ictRack'] as const) if (x[k] !== undefined) out[k] = str(x[k], ID, `${k} ${id}`);
    return out;
  });
  const note = typeof r.note === 'string' ? r.note.slice(0, 200) : '';
  const savedAt = typeof r.savedAt === 'string' && !Number.isNaN(Date.parse(r.savedAt)) ? r.savedAt : new Date(0).toISOString();
  return { format: LAYOUT_FORMAT, version: LAYOUT_VERSION, worldRevision: world.revision.id, savedAt, note, fixtures };
}

const KEY_DRAFT = 'kantor-rpg.layout.draft.v1';
const KEY_PUBLISHED = 'kantor-rpg.layout.published.v1';
const KEY_HISTORY = 'kantor-rpg.layout.history.v1';
const HISTORY_MAX = 5;

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, v: string | null): boolean {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
    return true;
  } catch { return false; }
}

export const store = {
  loadDraft(world: World): LayoutDoc | null { const t = read(KEY_DRAFT); if (!t) return null; try { return parseLayout(t, world); } catch { return null; } },
  saveDraft(doc: LayoutDoc): boolean { return write(KEY_DRAFT, serializeLayout(doc)); },
  clearDraft(): void { write(KEY_DRAFT, null); },
  loadPublished(world: World): { doc: LayoutDoc | null; error: string | null } {
    const t = read(KEY_PUBLISHED);
    if (!t) return { doc: null, error: null };
    try { return { doc: parseLayout(t, world), error: null }; } catch (e) { return { doc: null, error: (e as Error).message }; }
  },
  publish(doc: LayoutDoc): boolean {
    const prev = read(KEY_PUBLISHED);
    let hist: string[] = [];
    try { hist = JSON.parse(read(KEY_HISTORY) ?? '[]') as string[]; } catch { hist = []; }
    if (prev) hist = [prev, ...hist].slice(0, HISTORY_MAX);
    return write(KEY_PUBLISHED, serializeLayout(doc)) && write(KEY_HISTORY, JSON.stringify(hist));
  },
  historyCount(): number { try { return (JSON.parse(read(KEY_HISTORY) ?? '[]') as string[]).length; } catch { return 0; } },
  /** Restore the previous published layout; with no history, back to world.json. */
  rollback(world: World): LayoutDoc | null {
    let hist: string[] = [];
    try { hist = JSON.parse(read(KEY_HISTORY) ?? '[]') as string[]; } catch { hist = []; }
    const [prev, ...rest] = hist;
    write(KEY_HISTORY, JSON.stringify(rest));
    write(KEY_PUBLISHED, prev ?? null);
    if (!prev) return null;
    try { return parseLayout(prev, world); } catch { return null; }
  },
};
