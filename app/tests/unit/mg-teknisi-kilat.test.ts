import { describe, expect, it } from 'vitest';
import { run, type Run } from './mg-harness';
import type { Btn } from '../../src/minigames/types';
import teknisi, { HOUSES, REPAIR_T, ROADS_X, ROADS_Y, SHIFT, STATIONS, approach, type Tool } from '../../src/minigames/games/teknisi-kilat';
import { EN_TEKNISI_KILAT } from '../../src/i18n/en/mg/teknisi-kilat';

type Tk = { id: number; house: number; tool: Tool; slaLeft: number; sla: number; progress: number };
type Pl = { id: string; x: number; y: number; carrying: Tool | null };
type Snap = { phase: string; timeLeft: number; elapsed: number; score: number; target: number; fixed: number; missed: number; strikes: number; spawned: number; humans: number; tickets: Tk[]; players: Pl[]; ground: { tool: Tool }[] };
const S = (r: Run) => r.snap() as unknown as Snap;
const SRC = Object.values(import.meta.glob('../../src/minigames/games/teknisi-kilat.ts', { query: '?raw', import: 'default', eager: true }))[0] as string;

type Pt = { x: number; y: number };
const nearest = (y: number) => ROADS_Y.reduce((a, b) => (Math.abs(b - y) < Math.abs(a - y) ? b : a));
/** Axis-aligned waypoints along the roads, so a straight walk never hits a building. */
function route(from: Pt, to: Pt): Pt[] {
  if (from.x <= 200 && to.x <= 200) return [{ x: to.x, y: from.y }, to];
  const a = nearest(from.y), b = nearest(to.y), vx = ROADS_X[0];
  return [{ x: from.x, y: a }, { x: vx, y: a }, { x: vx, y: b }, { x: to.x, y: b }, { x: to.x, y: to.y }];
}
/** Digital direction keys toward a point; [] once there. */
function toward(p: Pt, q: Pt): Btn[] {
  const out: Btn[] = [];
  if (q.x - p.x > 2) out.push('right'); else if (p.x - q.x > 2) out.push('left');
  if (q.y - p.y > 2) out.push('down'); else if (p.y - q.y > 2) out.push('up');
  return out;
}

/** Walk Pemain 1 along a road route to `to`; false if it does not arrive. */
function walk(r: Run, to: Pt): boolean {
  for (const wp of route(S(r).players[0], to)) {
    for (let f = 0; f < 600; f++) {
      const keys = toward(S(r).players[0], wp);
      if (!keys.length) break;
      r.step(1, keys);
    }
  }
  return toward(S(r).players[0], to).length === 0;
}
const stationOf = (tool: Tool) => approach(STATIONS.find((s) => s.tool === tool)!);
function waitTicket(r: Run): Tk {
  for (let i = 0; i < 60 * 30 && !S(r).tickets.length; i++) r.step(1);
  return S(r).tickets[0];
}

/** A simple solo technician: fetch the tool for the most urgent ticket, carry it there, hold A. */
function bot() {
  let goal = '';
  let path: Pt[] = [];
  return (_f: number, s0: Record<string, unknown>): { held?: Btn[]; press?: Btn[] } => {
    const s = s0 as unknown as Snap;
    const p = s.players[0];
    const urgent = [...s.tickets].sort((a, b) => a.slaLeft - b.slaLeft);
    const job = p.carrying ? urgent.find((t) => t.tool === p.carrying) : undefined;
    let key = '', to: Pt | null = null, act: 'press' | 'hold' = 'press';
    if (job) { key = `h${job.id}`; to = approach(HOUSES[job.house]); act = 'hold'; }
    else if (urgent.length) { key = `s${urgent[0].tool}`; to = stationOf(urgent[0].tool); }
    if (!to) return {};
    if (key !== goal) { goal = key; path = route(p, to); }
    while (path.length && !toward(p, path[0]).length) path.shift();
    if (path.length) return { held: toward(p, path[0]) };
    return act === 'hold' ? { held: ['a'] } : { press: ['a'] };
  };
}

describe('mini game: teknisi-kilat', () => {
  it('meta is complete, co-op, and every literal has English', () => {
    const m = teknisi.meta;
    expect(m.id).toBe('teknisi-kilat');
    expect(m.players).toBe(4);
    expect(m.place).toBe('arcade');
    expect(m.view).toEqual({ w: 960, h: 600 });
    expect(m.touch).toEqual(['left', 'up', 'down', 'right', 'a', 'b']);
    expect(m.tutorial.length).toBeGreaterThanOrEqual(2);
    expect(m.tutorial.length).toBeLessThanOrEqual(3);
    expect(m.tutorial.join(' ')).toMatch(/\{arah\}.*\{a\}.*\{b\}/);
    expect(m.legend).toEqual([['arah', 'Jalan'], ['a', 'Ambil / perbaiki'], ['b', 'Taruh alat']]);
    expect(m.playersHint).toMatch(/Tidak ada lawan komputer/);
    expect(STATIONS).toHaveLength(4);
    expect(HOUSES.length).toBeGreaterThanOrEqual(6);
    expect(HOUSES.length).toBeLessThanOrEqual(8);
    for (const s of [m.title, m.blurb, m.score.unit, m.playersHint!, ...m.tutorial, ...m.legend.map((e) => e[1]), ...Object.values(m.actions ?? {})]) {
      expect(EN_TEKNISI_KILAT[s as string], s as string).toBeTruthy();
    }
    const lits = [...SRC.matchAll(/\bt\(\s*'((?:\\.|[^'])*)'/g)].map((x) => x[1]);
    // tool names go through t() from a table, check them too
    lits.push('ONT baru', 'Kabel drop', 'Konektor', 'Splitter');
    expect(lits.length).toBeGreaterThan(10);
    expect(lits.filter((s) => !(s in EN_TEKNISI_KILAT))).toEqual([]);
    for (const [id, en] of Object.entries(EN_TEKNISI_KILAT)) {
      expect((en.match(/\{\w+\}/g) ?? []).sort(), id).toEqual((id.match(/\{\w+\}/g) ?? []).sort());
      expect(/[\u2013\u2014]/.test(en + id)).toBe(false);
    }
  });

  it('pick the right tool, hold A at the house: score rises and the ticket closes', () => {
    const r = run(teknisi, 3);
    const tk = waitTicket(r);
    expect(tk.slaLeft).toBeGreaterThan(27);
    expect(walk(r, stationOf(tk.tool))).toBe(true);
    r.step(1, [], ['a']);
    expect(S(r).players[0].carrying).toBe(tk.tool);
    expect(r.sfx).toContain('click');
    expect(walk(r, approach(HOUSES[tk.house]))).toBe(true);
    // releasing pauses the bar, it does not reset it
    r.step(30, ['a']);
    const half = S(r).tickets.find((t) => t.id === tk.id)!.progress;
    expect(half).toBeCloseTo(0.5, 1);
    r.step(20);
    expect(S(r).tickets.find((t) => t.id === tk.id)!.progress).toBe(half);
    const before = S(r);
    const sla = before.tickets.find((t) => t.id === tk.id)!.slaLeft;
    r.step(Math.ceil((REPAIR_T - half) * 60) + 1, ['a']);
    const s = S(r);
    expect(s.tickets.some((t) => t.id === tk.id)).toBe(false);
    expect(s.fixed).toBe(1);
    expect(s.players[0].carrying).toBeNull();
    expect(s.score).toBeGreaterThanOrEqual(100 + Math.floor(sla - 1.1) * 5);
    expect(s.score).toBeLessThanOrEqual(100 + Math.floor(sla) * 5);
    expect(r.sfx).toContain('connect');
    expect(r.hud).toMatch(/^Skor \d+ · Tiket 1 · Waktu \d:\d\d$/);
  });

  it('the wrong tool does not repair', () => {
    const r = run(teknisi, 3);
    const tk = waitTicket(r);
    const other = (['ont', 'kabel', 'konektor', 'splitter'] as Tool[]).find((t) => t !== tk.tool)!;
    walk(r, stationOf(other));
    r.step(1, [], ['a']);
    expect(S(r).players[0].carrying).toBe(other);
    walk(r, approach(HOUSES[tk.house]));
    const n = r.sfx.length;
    r.step(1, [], ['a']);
    expect(r.sfx.slice(n)).toContain('wrong');
    r.step(120, ['a']);
    const s = S(r);
    const still = s.tickets.find((t) => t.id === tk.id)!;
    expect(still.progress).toBe(0);
    expect(s.fixed).toBe(0);
    expect(s.score).toBe(0);
    expect(s.players[0].carrying).toBe(other);
  });

  it('B drops the tool and A picks it up again', () => {
    const r = run(teknisi, 5);
    walk(r, stationOf('splitter'));
    r.step(1, [], ['a']);
    walk(r, { x: 150, y: 300 });
    r.step(1, [], ['b']);
    expect(S(r).players[0].carrying).toBeNull();
    expect(S(r).ground).toEqual([expect.objectContaining({ tool: 'splitter' })]);
    expect(r.sfx).toContain('clank');
    r.step(1, [], ['a']);
    expect(S(r).players[0].carrying).toBe('splitter');
    expect(S(r).ground).toHaveLength(0);
  });

  it('a ticket left alone expires: -50 and a strike, with an alarm under 5 s', () => {
    const r = run(teknisi, 3);
    const tk = waitTicket(r);
    r.step(Math.ceil((tk.slaLeft - 4) * 60));
    expect(r.sfx).toContain('alarm');
    r.step(5 * 60);
    const s = S(r);
    expect(s.tickets.some((t) => t.id === tk.id)).toBe(false);
    expect(s.missed).toBeGreaterThanOrEqual(1);
    expect(s.strikes).toBe(s.missed);
    expect(s.score).toBe(-50 * s.missed);
    expect(r.sfx).toContain('wrong');
  });

  it('three strikes end the shift early with a team score (not versus)', () => {
    const r = run(teknisi, 4);
    const res = r.play(() => ({}), SHIFT + 5);
    expect(res).not.toBeNull();
    const s = S(r);
    expect(s.strikes).toBe(3);
    expect(s.elapsed).toBeLessThan(SHIFT);
    expect(res!.versus).toBeFalsy();
    expect(res!.won).toBe(false);
    expect(res!.score).toBe(0);
    expect(res!.summary).toBe('0 tiket beres, 3 lewat SLA');
  });

  it('a working solo technician lasts the 3 minute shift', () => {
    const r = run(teknisi, 8);
    const b = bot();
    let minSla = 99;
    const res = r.play((f, s) => { for (const t of (s as unknown as Snap).tickets) minSla = Math.min(minSla, t.sla); return b(f, s); }, SHIFT + 5);
    expect(res).not.toBeNull();
    const s = S(r);
    expect(s.strikes).toBeLessThan(3);
    expect(s.timeLeft).toBe(0);
    expect(s.fixed).toBeGreaterThanOrEqual(8);
    expect(res!.score).toBe(Math.max(0, s.score));
    expect(res!.won).toBe(s.score >= s.target);
    expect(res!.summary).toBe(`${s.fixed} tiket beres, ${s.missed} lewat SLA`);
    // SLA shortens through the shift
    expect(minSla).toBeLessThan(23);
  });

  it('two players: Pemain 2 walks on its own pad, no CPU joins', () => {
    const r = run(teknisi, 7, 2);
    const s0 = S(r);
    expect(s0.humans).toBe(2);
    expect(s0.players).toHaveLength(2);
    expect(s0.players[0].id).toBe('CH-CEO');
    expect(s0.players[1].id).not.toBe('CH-CEO');
    r.stepPlayers(30, [{}, { held: ['down'] }]);
    const s1 = S(r);
    expect(s1.players[0]).toEqual(s0.players[0]);
    expect(s1.players[1].y).toBeGreaterThan(s0.players[1].y + 80);
    expect(s1.players[1].x).toBe(s0.players[1].x);
    r.stepPlayers(30, [{ held: ['right'] }, {}]);
    expect(S(r).players[0].x).toBeGreaterThan(s0.players[0].x + 80);
    expect(S(r).players[1].y).toBe(s1.players[1].y);
  });

  it('more players bring more tickets', () => {
    const count = (n: number) => { const r = run(teknisi, 9, n); r.stepPlayers(60 * 25, []); return S(r).spawned; };
    expect(count(4)).toBeGreaterThan(count(1));
  });

  it('is deterministic for a seed', () => {
    const go = (seed: number) => { const r = run(teknisi, seed); const res = r.play(bot(), 90); return JSON.stringify([res, r.snap(), r.hud]); };
    const a = go(21);
    expect(a).toBe(go(21));
    expect(a).not.toBe(go(22));
  });
});
