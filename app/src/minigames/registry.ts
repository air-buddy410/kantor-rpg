// Every mini game, by id. Each entry is a dynamic import, so a game's code is
// downloaded only when someone opens it (PRD v2.0 REQ-ARC-03, REQ-MG-01).
import type { GameModule } from './types';

type Loader = () => Promise<{ default: GameModule }>;

export const GAMES: Record<string, Loader> = {
  // Game Station (L2-GAME); cabinet order lives in catalog.ts
  'bola-meja': () => import('./games/bola-meja'),
  'ular-kabel': () => import('./games/ular-kabel'),
  'teknisi-kilat': () => import('./games/teknisi-kilat'),
  'lomba-17an': () => import('./games/lomba-17an'),
  'hoki-meja': () => import('./games/hoki-meja'),
  'balap-drone': () => import('./games/balap-drone'),
  'tarung-kantor': () => import('./games/tarung-kantor'),
  'lompat-lantai': () => import('./games/lompat-lantai'),
  'sambung-kabel': () => import('./games/sambung-kabel'),
  'arena-bom': () => import('./games/arena-bom'),
  'catur': () => import('./games/catur'),
  // Facilities
  'lari-pagi': () => import('./games/lari-pagi'),
  'angkat-beban': () => import('./games/angkat-beban'),
  'peregangan': () => import('./games/peregangan'),
  'biliar': () => import('./games/biliar'),
  'barista': () => import('./games/barista'),
  'server-down': () => import('./games/server-down'),
  'susun-denah': () => import('./games/susun-denah'),
  'desain-poster': () => import('./games/desain-poster'),
  'kuis-perpustakaan': () => import('./games/kuis-perpustakaan'),
};

export { FACILITY_GAMES, FACILITY_TITLE, facilityGame } from './facility';
export { ARCADE_SLOTS, CATALOG, catalogGame } from './catalog';
