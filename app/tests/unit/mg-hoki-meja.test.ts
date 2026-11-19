import { describe, expect, it } from 'vitest';
import { mulberry, run } from './mg-harness';
import hoki, {
  CY, DASH_CD, E_HIT, FACE_DX, GOAL_HALF, GOAL_PAUSE, MAX_SPEED, MIDX, PUCK_MAX, READY_T, R_MALLET, R_PUCK, TABLE, WIN_GOALS,
  hitMallet, makeMallet, physicsStep, soloScore, type Disc, type PhysEvent,
} from '../../src/minigames/games/hoki-meja';
import { EN_HOKI_MEJA } from '../../src/i18n/en/mg/hoki-meja';
import { BTNS, type Btn, type InputState } from '../../src/minigames/types';

type V = { x: number; y: number; vx: number; vy: number };
type Snap = { phase: string; versus: boolean; humans: number; score: number[]; points: number; hits: number; lastScorer: number; puck: V; mallets: (V & { dash: boolean; cd: number })[] };
const SRC = Object.values(import.meta.glob('../../src/minigames/games/hoki-meja.ts', { query: '?raw', import: 'default', eager: true }))[0] as string;
const sn = (r: ReturnType<typeof run>) => r.snap() as unknown as Snap;
const READY_F = Math.ceil(READY_T * 60) + 1;
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
const none = () => Object.fromEntries(BTNS.map((b) => [b, false])) as Record<Btn, boolean>;
const input = (ax: number, ay: number, a = false, ptr: InputState['ptr'] = null): InputState => {
  const hit = none(); hit.a = a;
  return { down: none(), hit, ax, ay, tap: null, ptr };
};

/** Get behind the puck (on the side away from the target goal) and drive through it toward the goal. */
function chase(s: Snap, side: 0 | 1): { x: number; y: number; dash: boolean } {
  const m = s.mallets[side], p = s.puck;
  const gx = side === 0 ? TABLE.x1 : TABLE.x0;
  const mine = side === 0 ? p.x < MIDX + R_PUCK : p.x > MIDX - R_PUCK;
  let dx = gx - p.x, dy = CY - p.y;
  const dl = Math.hypot(dx, dy) || 1;
  dx /= dl; dy /= dl;
  const along = (m.x - p.x) * dx + (m.y - p.y) * dy;
  const lateral = -(m.x - p.x) * dy + (m.y - p.y) * dx;
  let tx: number, ty: number, dash = false;
  if (!mine) { tx = side === 0 ? TABLE.x0 + 80 : TABLE.x1 - 80; ty = CY + (p.y - CY) * 0.5; }
  else if (along < -20 && Math.abs(lateral) < 18) { tx = p.x + dx * 50; ty = p.y + dy * 50; dash = along > -110; }
  else { tx = p.x - dx * 75; ty = p.y - dy * 75; if (along > -30) { const sg = Math.sign(lateral) || 1; tx -= dy * sg * 60; ty += dx * sg * 60; } }
  return { x: clamp1((tx - m.x) / 30), y: clamp1((ty - m.y) / 30), dash };
}

describe('mini game: hoki-meja meta', () => {
  it('meta is complete and every literal has English', () => {
    const m = hoki.meta;
    expect(m.id).toBe('hoki-meja');
    expect(m.players).toBe(2);
    expect(m.view).toEqual({ w: 960, h: 560 });
    expect(m.touch).toEqual(['left', 'up', 'down', 'right', 'a']);
    expect(m.tutorial.length).toBeGreaterThanOrEqual(2);
    expect(m.tutorial.length).toBeLessThanOrEqual(3);
    expect(m.legend).toEqual([['arah', 'Gerak'], ['a', 'Sentak']]);
    for (const s of [m.title, m.blurb, m.score.unit, m.playersHint!, m.pointerHint!, ...m.tutorial, ...m.legend.map((e) => e[1]), ...Object.values(m.actions ?? {})]) {
      expect(EN_HOKI_MEJA[s as string], s as string).toBeTruthy();
    }
    const lits = [...SRC.matchAll(/\bt\(\s*'((?:\\.|[^'])*)'/g)].map((x) => x[1]);
    expect(lits.length).toBeGreaterThan(10);
    expect(lits.filter((s) => !(s in EN_HOKI_MEJA))).toEqual([]);
    for (const [id, en] of Object.entries(EN_HOKI_MEJA)) {
      expect((en.match(/\{\w+\}/g) ?? []).sort(), id).toEqual((id.match(/\{\w+\}/g) ?? []).sort());
      expect(/[\u2013\u2014]/.test(en + id)).toBe(false);
    }
  });
});

describe('mini game: hoki-meja physics', () => {
  it('a mallet moving into the puck sends it away faster than before', () => {
    // resting puck: a kinematic mallet at 900 gives it (1 + e) times its speed
    const p: Disc = { x: 300, y: CY, vx: 0, vy: 0 };
    const m = makeMallet(0); m.x = 300 - R_PUCK - R_MALLET - 4; m.y = CY; m.vx = MAX_SPEED;
    const ev: PhysEvent[] = [];
    for (let i = 0; i < 3; i++) physicsStep(p, [m], 1 / 60, ev);
    expect(ev.some((e) => e.kind === 'hit')).toBe(true);
    expect(p.vx).toBeGreaterThan(MAX_SPEED * (1 + E_HIT) * 0.95);
    // incoming puck at 200: the swing reverses it and adds the mallet speed
    const q: Disc = { x: 300, y: CY, vx: -200, vy: 0 };
    const m2 = makeMallet(0); m2.x = 300 - R_PUCK - R_MALLET - 2; m2.y = CY; m2.vx = 600;
    physicsStep(q, [m2], 1 / 60);
    expect(q.vx).toBeGreaterThan(200);
    expect(Math.abs(q.vx - ((1 + E_HIT) * 800 - 200))).toBeLessThan(20);
    // still mallet: plain bounce with restitution
    const r: Disc = { x: 300, y: CY, vx: -500, vy: 0 };
    const m3 = makeMallet(0); m3.x = 300 - R_PUCK - R_MALLET; m3.y = CY;
    expect(hitMallet({ ...r, x: r.x - 1 }, m3)).toBeCloseTo(1.9 * 500, 3);
  });

  it('the top speed cap and sub-steps stop a 1800 u/s puck tunnelling through a mallet', () => {
    // off the goal mouth so the puck stays on the table after the bounce
    const p: Disc = { x: 700, y: CY + 150, vx: -5000, vy: 0 };
    const m = makeMallet(0); m.x = 200; m.y = CY + 150;
    for (let i = 0; i < 20; i++) expect(physicsStep(p, [m], 1 / 60)).toBe(-1);
    expect(Math.hypot(p.vx, p.vy)).toBeLessThanOrEqual(PUCK_MAX + 1);
    expect(p.vx).toBeGreaterThan(0);
    expect(p.x).toBeGreaterThan(m.x);
  });

  it('a puck in the goal mouth past the line is a goal; outside the mouth it bounces', () => {
    const p: Disc = { x: TABLE.x0 + 40, y: CY + 20, vx: -900, vy: 0 };
    let g = -1;
    for (let i = 0; i < 10 && g < 0; i++) g = physicsStep(p, [], 1 / 60);
    expect(g).toBe(1);
    const q: Disc = { x: TABLE.x0 + 40, y: CY + GOAL_HALF + 40, vx: -900, vy: 0 };
    const ev: PhysEvent[] = [];
    for (let i = 0; i < 10; i++) expect(physicsStep(q, [], 1 / 60, ev)).toBe(-1);
    expect(q.vx).toBeGreaterThan(0);
    expect(ev.some((e) => e.kind === 'wall')).toBe(true);
    expect(soloScore(7, 4)).toBe(700 + 150 + 400);
    expect(soloScore(3, 7)).toBe(300);
  });
});

describe('mini game: hoki-meja play', () => {
  it('each mallet stays in its own half', () => {
    const r = run(hoki, 1, 2);
    r.stepPlayers(READY_F, []);
    expect(sn(r).phase).toBe('play');
    r.stepPlayers(120, [{ held: ['right', 'up'] }, { held: ['left', 'down'] }]);
    const s = sn(r);
    expect(s.mallets[0].x).toBeLessThanOrEqual(MIDX - R_MALLET + 0.1);
    expect(s.mallets[0].y).toBeGreaterThanOrEqual(TABLE.y0 + R_MALLET - 0.1);
    expect(s.mallets[1].x).toBeGreaterThanOrEqual(MIDX + R_MALLET - 0.1);
    expect(s.mallets[1].y).toBeLessThanOrEqual(TABLE.y1 - R_MALLET + 0.1);
    // pointer far across the centre line: the mallet follows but stops at its half
    const inst = hoki.create(r.ctx);
    for (let i = 0; i < READY_F; i++) inst.update(1 / 60, input(0, 0));
    for (let i = 0; i < 60; i++) inst.update(1 / 60, input(0, 0, false, { x: 900, y: 10, down: true }));
    const m = (inst.snapshot!() as unknown as Snap).mallets[0];
    expect(m.x).toBeCloseTo(MIDX - R_MALLET, 0);
    expect(m.y).toBeCloseTo(TABLE.y0 + R_MALLET, 0);
  });

  it('arrow keys are snappy, the speed is capped and A dashes once per cooldown', () => {
    const r = run(hoki, 2, 2);
    r.stepPlayers(READY_F, []);
    r.stepPlayers(6, [{ held: ['down'] }, {}]);
    expect(sn(r).mallets[0].vy).toBe(MAX_SPEED);
    r.stepPlayers(1, [{}, {}]);
    expect(sn(r).mallets[0].vy).toBeLessThan(MAX_SPEED * 0.5);
    r.stepPlayers(1, [{}, {}]);
    expect(sn(r).mallets[0].vy).toBe(0);
    r.stepPlayers(1, [{ held: ['up'], press: ['a'] }, {}]);
    let s = sn(r);
    expect(s.mallets[0].dash).toBe(true);
    expect(Math.hypot(s.mallets[0].vx, s.mallets[0].vy)).toBeGreaterThan(MAX_SPEED);
    expect(s.mallets[0].cd).toBeCloseTo(DASH_CD - 1 / 60, 1);
    r.stepPlayers(20, [{}, {}]);
    r.stepPlayers(1, [{ press: ['a'] }, {}]);
    s = sn(r);
    expect(s.mallets[0].dash).toBe(false);
  });

  it('fuzz: the puck never leaves the table over many random steps', () => {
    for (const seed of [11, 12, 13]) {
      const r = run(hoki, seed, 2);
      const rnd = mulberry(seed * 7);
      let held: Btn[][] = [[], []];
      for (let f = 0; f < 60 * 90 && !r.result; f++) {
        if (f % 9 === 0) held = [0, 1].map(() => (['left', 'right', 'up', 'down'] as Btn[]).filter(() => rnd() < 0.45));
        const press = [0, 1].map(() => (rnd() < 0.03 ? ['a'] as Btn[] : []));
        r.stepPlayers(1, [{ held: held[0], press: press[0] }, { held: held[1], press: press[1] }]);
        const { x, y } = sn(r).puck;
        expect(y).toBeGreaterThanOrEqual(TABLE.y0 + R_PUCK - 0.2);
        expect(y).toBeLessThanOrEqual(TABLE.y1 - R_PUCK + 0.2);
        expect(x).toBeGreaterThanOrEqual(TABLE.x0 - R_PUCK - 1);
        expect(x).toBeLessThanOrEqual(TABLE.x1 + R_PUCK + 1);
        if (x < TABLE.x0 + R_PUCK - 0.2 || x > TABLE.x1 - R_PUCK + 0.2) expect(Math.abs(y - CY)).toBeLessThan(GOAL_HALF);
      }
    }
  });

  it('a goal adds to the score, pauses 1 s and puts the puck in front of the player who conceded', () => {
    const r = run(hoki, 3, 2);
    let frames = 0;
    // Pemain 2 parks in the top corner, leaving the goal open
    while (sn(r).score[0] + sn(r).score[1] === 0 && frames++ < 60 * 120) {
      const c = chase(sn(r), 0);
      r.stepPlayers(1, [{ held: [...(c.x < -0.2 ? ['left'] : c.x > 0.2 ? ['right'] : []), ...(c.y < -0.2 ? ['up'] : c.y > 0.2 ? ['down'] : [])] as Btn[], press: c.dash ? ['a'] : [] }, { held: ['up', 'right'] }]);
    }
    let s = sn(r);
    expect(s.phase).toBe('goal');
    const scorer = s.lastScorer;
    expect(s.score[scorer]).toBe(1);
    expect(r.sfx).toContain('coin');
    expect(r.hud).toBe(`Pemain 1 ${s.score[0]} - ${s.score[1]} Pemain 2`);
    const starts = r.sfx.filter((x) => x === 'start').length;
    r.stepPlayers(Math.round(GOAL_PAUSE * 60) - 2, []);
    expect(sn(r).phase).toBe('goal');
    r.stepPlayers(3, []);
    s = sn(r);
    expect(s.phase).toBe('play');
    expect(s.puck).toEqual({ x: scorer === 0 ? MIDX + FACE_DX : MIDX - FACE_DX, y: CY, vx: 0, vy: 0 });
    expect(r.sfx.filter((x) => x === 'start').length).toBe(starts + 1);
  });

  it('solo: a chase policy against the computer plays to 7 and gets the PRD score', () => {
    const results: { score: number[]; points: number }[] = [];
    for (const seed of [23, 25, 26]) {
      const r = run(hoki, seed);
      const res = r.play((_f, s0) => {
        const c = chase(s0 as unknown as Snap, 0);
        return { axis: { x: c.x, y: c.y }, press: c.dash ? ['a'] : [] };
      }, 900);
      expect(res, `seed ${seed}`).not.toBeNull();
      const s = sn(r);
      expect(s.phase).toBe('over');
      expect(Math.max(...s.score)).toBe(WIN_GOALS);
      expect(res!.versus).toBeFalsy();
      expect(res!.won).toBe(s.score[0] === WIN_GOALS);
      expect(res!.score).toBe(soloScore(s.score[0], s.score[1]));
      expect(typeof res!.score).toBe('number');
      expect(r.hud).toBe(`Kamu ${s.score[0]} - ${s.score[1]} Lawan`);
      expect(r.sfx).toContain('clack');
      results.push({ score: s.score, points: res!.score });
    }
    // the computer is beatable but not a pushover: both sides score across the runs
    expect(results.some((x) => x.score[0] > 0)).toBe(true);
    expect(results.some((x) => x.score[1] > 0)).toBe(true);
  });

  it('two players: the right mallet follows Pemain 2, and the end is versus with score 0', () => {
    const r = run(hoki, 7, 2);
    expect(sn(r).humans).toBe(2);
    expect(sn(r).versus).toBe(true);
    r.stepPlayers(READY_F, []);
    const a = sn(r).mallets;
    r.stepPlayers(30, [{}, {}]);
    expect(sn(r).mallets[1]).toMatchObject({ x: a[1].x, y: a[1].y });
    r.stepPlayers(20, [{}, { held: ['up'] }]);
    const b = sn(r).mallets;
    expect(b[1].y).toBeLessThan(a[1].y - 100);
    expect(b[0].y).toBe(a[0].y);
    // both chase; the match must end with a versus result
    for (let i = 0; i < 60 * 900 && !r.result; i++) {
      const s = sn(r);
      const per = ([0, 1] as const).map((k) => {
        const c = chase(s, k);
        return { held: [...(c.x < -0.2 ? ['left'] : c.x > 0.2 ? ['right'] : []), ...(c.y < -0.2 ? ['up'] : c.y > 0.2 ? ['down'] : [])] as Btn[], press: (c.dash ? ['a'] : []) as Btn[] };
      });
      r.stepPlayers(1, per);
    }
    const s = sn(r);
    expect(r.result).not.toBeNull();
    expect(r.result!.versus).toBe(true);
    expect(r.result!.score).toBe(0);
    expect(r.result!.won).toBe(s.score[0] > s.score[1]);
    expect(r.result!.summary).toBe(`Pemain ${s.score[0] > s.score[1] ? 1 : 2} menang ${WIN_GOALS}-${Math.min(...s.score)}`);
  });

  it('is deterministic for a seed', () => {
    const go = () => {
      const r = run(hoki, 31);
      const res = r.play((_f, s0) => { const c = chase(s0 as unknown as Snap, 0); return { axis: { x: c.x, y: c.y }, press: c.dash ? ['a'] : [] }; }, 60);
      return JSON.stringify([res, r.snap(), r.sfx.length]);
    };
    expect(go()).toBe(go());
  });
});
