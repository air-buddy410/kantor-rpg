// One list of every mini game: players, where it stands in the office and
// whether it is a Game Station cabinet (Budi 2026-11-19). The HUD game list and
// the Game Station read it; rooms come from world.json, so moving a fixture in
// the Studio moves its game in the list too.
import type { Fixture, Room, World } from '../world/types';
import { FACILITY_GAMES } from './facility';

export interface CatalogGame {
  id: string;
  title: string;
  blurb: string;
  /** Most players on one screen; 1 = single player. */
  players: number;
  /** Co-op: everyone plays together against the clock, empty seats stay empty. */
  coop?: boolean;
}

/** Launcher text (same strings as each game's meta) and player counts, so the list never loads a game module. */
export const CATALOG: CatalogGame[] = [
  { id: 'bola-meja', title: 'Bola Meja', blurb: 'Futsal tampak atas 2 lawan 2.', players: 4 },
  { id: 'ular-kabel', title: 'Ular Kabel', blurb: 'Tarik kabel fiber, jangan menabrak.', players: 4 },
  { id: 'teknisi-kilat', title: 'Teknisi Kilat', blurb: 'Kerja tim: perbaiki gangguan sebelum SLA habis.', players: 4, coop: true },
  { id: 'lomba-17an', title: 'Lomba 17-an', blurb: 'Balap karung, makan kerupuk, tarik tambang.', players: 4 },
  { id: 'arena-bom', title: 'Arena Bom', blurb: 'Pasang bom, buka jalan, kalahkan 3 lawan.', players: 4 },
  { id: 'hoki-meja', title: 'Hoki Meja', blurb: 'Air hockey satu lawan satu.', players: 2 },
  { id: 'tarung-kantor', title: 'Tarung Kantor', blurb: 'Satu lawan satu dengan karakter tim. Kalahkan 3 lawan berturut-turut.', players: 2 },
  { id: 'catur', title: 'Catur Kantor', blurb: 'Catur lawan rekan tim, tiga tingkat kesulitan.', players: 2 },
  { id: 'biliar', title: 'Biliar 8-Ball', blurb: '8-ball tampak atas melawan rekan tim. Masukkan semua bolamu, lalu bola 8.', players: 2 },
  { id: 'balap-drone', title: 'Balap Drone', blurb: 'Balap tampak atas di sirkuit sekitar kantor. 3 putaran.', players: 1 },
  { id: 'lompat-lantai', title: 'Lompat Lantai', blurb: 'Platformer 2D: kumpulkan dokumen, hindari kabel kusut.', players: 1 },
  { id: 'sambung-kabel', title: 'Sambung Kabel', blurb: 'Putar ubin, sambungkan OLT ke setiap rumah.', players: 1 },
  { id: 'lari-pagi', title: 'Lari Pagi', blurb: 'Lari 60 detik di treadmill. Melangkah mengikuti ketukan, kiri dan kanan bergantian.', players: 1 },
  { id: 'angkat-beban', title: 'Angkat Beban', blurb: 'Tekan A saat penanda di zona hijau: sekali untuk angkat, sekali untuk turunkan. 10 repetisi.', players: 1 },
  { id: 'peregangan', title: 'Peregangan', blurb: 'Lihat urutan gerakan, lalu ulangi. Tiap ronde bertambah satu gerakan.', players: 1 },
  { id: 'barista', title: 'Barista', blurb: 'Buat 5 pesanan kopi untuk rekan tim. Tepat waktu, tepat takaran.', players: 1 },
  { id: 'kuis-perpustakaan', title: 'Kuis Perpustakaan', blurb: 'Lima soal tentang kantor ini dan dunia ICT/ISP. 15 detik per soal.', players: 1 },
  { id: 'server-down', title: 'Server Down', blurb: 'Tiket insiden masuk bergiliran. Pindahkan kabel patch ke port switch yang benar sebelum SLA habis.', players: 1 },
  { id: 'susun-denah', title: 'Susun Denah', blurb: 'Potongan ruang lepas dari denah kantor. Kembalikan tiap ruang ke tempatnya sebelum waktu habis.', players: 1 },
  { id: 'desain-poster', title: 'Desain Poster', blurb: 'Susun poster sesuai brief. Kevin menilai kontras, kecocokan brief dan hierarki judul.', players: 1 },
];

/** Game Station cabinet order: multiplayer first (Budi), then the solo cabinets. */
export const ARCADE_SLOTS = ['bola-meja', 'ular-kabel', 'teknisi-kilat', 'lomba-17an', 'hoki-meja', 'arena-bom', 'tarung-kantor', 'balap-drone', 'lompat-lantai', 'sambung-kabel'];

export const catalogGame = (id: string) => CATALOG.find((g) => g.id === id);

export interface GameSpot {
  game: string;
  /** Fixture that opens the game (the arcade cabinet for Game Station games). */
  fixture: Fixture;
  room: Room;
}

/**
 * Where each game can be played. Game Station games stand at the arcade
 * cabinets; facility games at every fixture that opens them. Sorted so the
 * first spot is the main one (Game Station first, then by room name).
 */
export function gameSpots(world: Pick<World, 'fixtures' | 'rooms'>): Map<string, GameSpot[]> {
  const rooms = new Map(world.rooms.map((r) => [r.id, r]));
  const out = new Map<string, GameSpot[]>();
  const add = (game: string, fx: Fixture) => {
    const room = rooms.get(fx.room);
    if (!room) return;
    const list = out.get(game) ?? [];
    if (!list.some((s) => s.room.id === room.id)) list.push({ game, fixture: fx, room });
    out.set(game, list);
  };
  for (const fx of world.fixtures) {
    for (const f of FACILITY_GAMES) {
      if (f.type !== fx.type || (f.rooms && !f.rooms.includes(fx.room))) continue;
      if (f.game === 'arcade') { if (fx.type === 'arcade_cabinet') for (const id of ARCADE_SLOTS) add(id, fx); }
      else add(f.game, fx);
    }
  }
  return out;
}
