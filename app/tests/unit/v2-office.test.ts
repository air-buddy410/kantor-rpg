import { describe, expect, it } from 'vitest';
import worldJson from '@design/world.json';
import type { World } from '../../src/world/types';
import { FACILITY_GAMES, facilityGame } from '../../src/minigames/facility';
import { ARCADE_SLOTS, CATALOG, GAMES, catalogGame } from '../../src/minigames/registry';
import { gameSpots } from '../../src/minigames/catalog';
import { crossfade } from '../../src/game/avatar';
import { trackForRoom } from '../../src/audio/rooms';
import { SCOLD_LINES } from '../../src/game/scold';
import { EN } from '../../src/i18n/en';

const world = worldJson as unknown as World;

describe('v2.0 facilities and Game Station', () => {
  it('every facility fixture type maps to a registered game and exists in the world', () => {
    for (const f of FACILITY_GAMES) {
      if (f.game !== 'arcade') expect(GAMES[f.game], f.game).toBeTypeOf('function');
      expect(world.fixtures.some((x) => x.type === f.type), f.type).toBe(true);
    }
  });

  it('PRD facilities each reach their game: gym, billiards, coffee, server, drafting, easel, library', () => {
    const want: Record<string, string> = {
      treadmill: 'lari-pagi', dumbbell_rack: 'angkat-beban', exercise_mat: 'peregangan', billiard_table: 'biliar',
      coffee_bar: 'barista', rack_42u: 'server-down', drafting_table: 'susun-denah', easel: 'desain-poster', arcade_cabinet: 'arcade',
    };
    for (const [type, game] of Object.entries(want)) {
      const fx = world.fixtures.find((x) => x.type === type)!;
      expect(facilityGame(fx.type, fx.room), type).toBe(game);
    }
    const shelfRead = world.fixtures.find((x) => x.type === 'bookshelf' && x.room === 'L2-READ')!;
    const shelfWork = world.fixtures.find((x) => x.type === 'bookshelf' && x.room !== 'L2-READ')!;
    expect(facilityGame(shelfRead.type, shelfRead.room)).toBe('kuis-perpustakaan');
    expect(facilityGame(shelfWork.type, shelfWork.room)).toBeNull();
  });

  it('chess is played at the board game table and its stools in the game room, not in the Game Station', () => {
    const table = world.fixtures.find((x) => x.type === 'board_table')!;
    expect(table.room).toBe('L2-GAME');
    expect(facilityGame(table.type, table.room)).toBe('catur');
    const stools = world.fixtures.filter((x) => x.type === 'stool' && x.room === 'L2-GAME');
    expect(stools.length).toBeGreaterThanOrEqual(2);
    for (const s of stools) {
      expect(facilityGame(s.type, s.room)).toBe('catur');
      expect(Math.hypot(s.pos[0] - table.pos[0], s.pos[1] - table.pos[1])).toBeLessThan(1.6);
    }
    const pantryStool = world.fixtures.find((x) => x.type === 'stool' && x.room !== 'L2-GAME')!;
    expect(facilityGame(pantryStool.type, pantryStool.room)).toBeNull();
    expect(ARCADE_SLOTS).not.toContain('catur');
  });

  it('Game Station has 10 cabinets, multiplayer first, all loadable and described (v2.4)', () => {
    expect(ARCADE_SLOTS).toHaveLength(10);
    expect(new Set(ARCADE_SLOTS).size).toBe(10);
    const multi = ARCADE_SLOTS.map((id) => (catalogGame(id)?.players ?? 1) > 1);
    expect(multi.indexOf(false)).toBeGreaterThan(0);
    expect(multi.slice(multi.indexOf(false))).not.toContain(true);
    for (const id of ARCADE_SLOTS) {
      expect(GAMES[id]).toBeTypeOf('function');
      expect(catalogGame(id)?.title).toBeTruthy();
    }
  });

  it('game catalog: every game once, players match the module, every game has a room (v2.4)', async () => {
    expect(CATALOG.map((g) => g.id).sort()).toEqual(Object.keys(GAMES).sort());
    const spots = gameSpots(world);
    for (const g of CATALOG) {
      const m = (await GAMES[g.id]()).default.meta;
      expect(m.players ?? 1, g.id).toBe(g.players);
      expect(m.title, g.id).toBe(g.title);
      expect(spots.get(g.id)?.length, g.id).toBeGreaterThan(0);
    }
    expect(spots.get('biliar')![0].room.id).toBe('L2-BILLIARD');
    expect(spots.get('server-down')![0].room.id).toBe('L1-SERVER');
    expect(spots.get('bola-meja')![0].room.id).toBe('L2-GAME');
    expect(spots.get('catur')![0].room.id).toBe('L2-GAME');
  });

  it('every game module loads and its meta matches its id', async () => {
    for (const [id, load] of Object.entries(GAMES)) {
      const m = (await load()).default;
      expect(m.meta.id, id).toBe(id);
      expect(EN[m.meta.title], `${id} title in English`).toBeTruthy();
    }
  });
});

describe('v2.0 animation and sound helpers', () => {
  it('crossfade depends on the clip pair', () => {
    expect(crossfade('walk', 'run')).toBeLessThan(crossfade('idle', 'sit'));
    expect(crossfade('idle', 'surprised')).toBeLessThan(0.1);
    expect(crossfade('idle', 'wave')).toBe(0.25);
  });

  it('music follows the area', () => {
    expect(trackForRoom('L2-GAME', 'L2')).toBe('arcade');
    expect(trackForRoom('L2-GYM', 'L2')).toBe('gym');
    expect(trackForRoom(null, 'L1')).toBe('office');
    for (const r of world.rooms) expect(trackForRoom(r.id, r.floor)).toBeTruthy();
  });

  it('every persona has reprimand lines, all translated', () => {
    for (const a of world.actors.filter((x) => x.kind === 'npc')) {
      expect(SCOLD_LINES[a.id], a.id).toBeTruthy();
      for (const l of SCOLD_LINES[a.id]) expect(EN[l], l).toBeTruthy();
    }
  });
});
