import { describe, expect, it } from 'vitest';
import { run, type Run } from './mg-harness';
import lomba, { BITES, CHOKE_T, MASH_MAX, STEP, STRONG, WEAK, ZONE, ON_BEAT } from '../../src/minigames/games/lomba-17an';
import type { Btn } from '../../src/minigames/types';
import { EN_LOMBA_17AN } from '../../src/i18n/en/mg/lomba-17an';
import SRC from '../../src/minigames/games/lomba-17an.ts?raw';

type P = { id: string; cpu: boolean; doneT: number; x: number; hopT: number; stumble: number; stumbles: number; bites: number; swing: number; chew: number; choke: number; misses: number; chokes: number; slot: number; pulls: number; strong: number };
type Snap = { phase: string; ev: number; event: string; playT: number; humans: number; versus: boolean; points: number[]; bonus: number[]; standings: number[]; rope: number; beatDist: number; beatSlot: number; lastOrder: number[]; lastPts: number[]; tugWinner: number; players: P[] };
const S = (r: Run) => r.snap() as unknown as Snap;

/** Idle until event `ev` is live (title card and 3-2-1 done). */
function reach(r: Run, ev: number) {
  for (let i = 0; i < 60 * 200 && !(S(r).ev === ev && S(r).phase === 'play'); i++) r.step(1);
  expect(S(r)).toMatchObject({ ev, phase: 'play' });
}

/** Pemain 1 plays every event well; reads only what the screen shows. */
function good() {
  let foot = 0;
  return (f: number, raw: Record<string, unknown>): { press?: Btn[] } => {
    const s = raw as unknown as Snap;
    if (s.phase !== 'play') return {};
    const me = s.players[0];
    if (s.ev === 0) {
      if (f % 15) return {};
      foot ^= 1;
      return { press: [foot ? 'left' : 'right'] };
    }
    if (s.ev === 1) return me.chew === 0 && me.choke === 0 && Math.abs(me.swing) < ZONE * 0.5 ? { press: ['a'] } : {};
    return Math.abs(s.beatDist) < 0.04 && me.slot !== s.beatSlot ? { press: ['a'] } : {};
  };
}

describe('mini game: lomba-17an', () => {
  it('meta: 4 local players, left/right/a, legend groups the hop keys', () => {
    const m = lomba.meta;
    expect(m.id).toBe('lomba-17an');
    expect(m.players).toBe(4);
    expect(m.touch).toEqual(['left', 'right', 'a']);
    expect(m.tutorial.length).toBeGreaterThanOrEqual(2);
    expect(m.tutorial.length).toBeLessThanOrEqual(3);
    expect(m.legend[0][0]).toEqual(['left', 'right']);
    expect(['gym', 'arcade']).toContain(m.music);
    const r = run(lomba);
    expect(S(r)).toMatchObject({ phase: 'title', ev: 0, humans: 1, versus: false, points: [0, 0, 0, 0] });
    expect(S(r).players.map((p) => p.cpu)).toEqual([false, true, true, true]);
    expect(r.hud).toBe('Lomba 1/3 · Poin 0');
    // every source string has English with the same placeholders (the shared i18n test sees it after integration)
    const keys = [...SRC.matchAll(/\bt\(\s*'((?:\\.|[^'])*)'/g)].map((x) => x[1]);
    const all = [...keys, m.title, m.blurb, m.score.unit, m.playersHint!, ...m.tutorial, ...m.legend.map((e) => e[1]), ...Object.values(m.actions!), 'Balap Karung', 'Makan Kerupuk', 'Tarik Tambang'];
    expect(keys.length).toBeGreaterThan(25);
    expect(all.filter((k) => !(k in EN_LOMBA_17AN))).toEqual([]);
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    expect(Object.entries(EN_LOMBA_17AN).filter(([id, en]) => ph(id) !== ph(en) || /[\u2013\u2014]/.test(en))).toEqual([]);
  });

  it('balap karung: alternating left/right hops further than repeating one key, which stumbles', () => {
    const go = (keys: (k: number) => Btn) => {
      const r = run(lomba, 3);
      reach(r, 0);
      for (let k = 0; k < 12; k++) { r.step(1, [], [keys(k)]); r.step(15); }
      return S(r).players[0];
    };
    const alt = go((k) => (k % 2 ? 'right' : 'left'));
    const same = go(() => 'left');
    const slow = go(() => 'a');
    expect(alt.stumbles).toBe(0);
    // hop, stumble, press ignored while down, hop again
    expect(same.stumbles).toBe(4);
    expect(slow.stumbles).toBe(0);
    expect(alt.x).toBeCloseTo(12 * 0.9, 5);
    expect(slow.x).toBeCloseTo(12 * 0.6, 5);
    expect(same.x).toBeLessThan(slow.x);
    console.log('karung x after 12 presses:', { alt: alt.x, a: slow.x, same: same.x });
  });

  it('makan kerupuk: a bite over the mouth counts, off-centre misses, mashing chokes', () => {
    const r = run(lomba, 5);
    reach(r, 1);
    const wait = (ok: (p: P) => boolean) => { for (let i = 0; i < 300 && !ok(S(r).players[0]); i++) r.step(1); };
    wait((p) => Math.abs(p.swing) < ZONE * 0.4);
    r.step(1, [], ['a']);
    expect(S(r).players[0]).toMatchObject({ bites: 1, misses: 0 });
    wait((p) => p.chew === 0 && Math.abs(p.swing) > 0.85);
    r.step(1, [], ['a']);
    expect(S(r).players[0]).toMatchObject({ bites: 1, misses: 1 });
    r.step(30);
    // more than MASH_MAX presses inside one second
    for (let k = 0; k <= MASH_MAX; k++) { r.step(1, [], ['a']); r.step(4); }
    const p = S(r).players[0];
    expect(p.chokes).toBe(1);
    expect(p.choke).toBeGreaterThan(CHOKE_T - 0.2);
    expect(r.sfx).toContain('breath');
    // choking: presses do nothing
    const b = p.bites;
    wait((q) => Math.abs(q.swing) < ZONE * 0.4);
    if (S(r).players[0].choke > 0) { r.step(1, [], ['a']); expect(S(r).players[0].bites).toBe(b); }
  });

  it('tarik tambang: each on-beat press moves the rope toward Merah by a strong pull, off-beat by a weak one', () => {
    // CPU play draws the same random numbers whatever Pemain 1 does, so the difference is Pemain 1 alone
    const tug = (mode: 'idle' | 'on' | 'off') => {
      const r = run(lomba, 8);
      reach(r, 2);
      for (let f = 0; f < 60 * 4; f++) {
        const s = S(r);
        const d = s.beatDist;
        const want = mode === 'on' ? Math.abs(d) < 0.03 : mode === 'off' ? d > ON_BEAT + 0.1 && d < ON_BEAT + 0.15 : false;
        r.step(1, [], want && s.players[0].slot !== s.beatSlot ? ['a'] : []);
      }
      const s = S(r);
      return { rope: s.rope, pulls: s.players[0].pulls, strong: s.players[0].strong };
    };
    const idle = tug('idle'), on = tug('on'), off = tug('off');
    expect(on.pulls).toBeGreaterThanOrEqual(6);
    expect(on.strong).toBe(on.pulls);
    expect(off.strong).toBe(0);
    expect(on.rope - idle.rope).toBeCloseTo(on.pulls * STRONG * STEP, 6);
    expect(off.rope - idle.rope).toBeCloseTo(off.pulls * WEAK * STEP, 6);
    expect(on.rope).toBeGreaterThan(off.rope);
    console.log('rope after 4 s:', { idle: idle.rope, onBeat: on.rope, offBeat: off.rope, pulls: on.pulls });
  });

  it('solo run: a good player finishes all three events, the podium shows, a numeric score ends it', () => {
    const totals: number[] = [];
    for (const seed of [1, 2, 3, 4]) {
      const r = run(lomba, seed);
      const huds = new Set<string>();
      const pol = good();
      const res = r.play((f, s) => { huds.add(r.hud); return pol(f, s); }, 200);
      expect(res).not.toBeNull();
      const s = S(r);
      expect(s.phase).toBe('over');
      expect(s.ev).toBe(2);
      expect([...huds].some((x) => x.startsWith('Lomba 3/3'))).toBe(true);
      // places 3+2+1+0 twice, then the tug: 3+3 or 1 each on a draw
      expect(s.points.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(16);
      expect(Number.isFinite(res!.score)).toBe(true);
      expect(res!.score).toBe(s.points[0] * 100 + s.bonus[0]);
      expect(s.bonus[0]).toBeLessThan(100);
      expect(res!.versus).toBeFalsy();
      expect(res!.won).toBe(s.standings[0] === 0);
      totals.push(res!.score);
      console.log(`seed ${seed}: score ${res!.score}, points ${s.points.join('/')}, won ${res!.won}, ${res!.summary}`);
    }
    expect(Math.max(...totals)).toBeGreaterThanOrEqual(700);
    // an idle player still reaches the end, with a low score
    const idle = run(lomba, 1);
    const ri = idle.play(() => ({}), 200)!;
    expect(ri).not.toBeNull();
    expect(ri.won).toBe(false);
    expect(ri.score).toBeLessThan(Math.min(...totals));
  });

  it('kerupuk: a CPU eats all eight in time and finishes', () => {
    const r = run(lomba, 6);
    reach(r, 1);
    r.step(60 * 20);
    expect(S(r).players.slice(1).some((p) => p.bites === BITES)).toBe(true);
  });

  it('two players: versus match, Merah is P1+P3 seat, ends with score 0', () => {
    const r = run(lomba, 4, 2);
    expect(S(r)).toMatchObject({ versus: true, humans: 2 });
    expect(S(r).players.map((p) => p.cpu)).toEqual([false, false, true, true]);
    // Pemain 2 hops with its own pad
    for (let i = 0; i < 60 * 6 && S(r).phase !== 'play'; i++) r.stepPlayers(1, [{}, {}]);
    for (let k = 0; k < 6; k++) { r.stepPlayers(1, [{}, { press: [k % 2 ? 'right' : 'left'] }]); r.stepPlayers(15, [{}, {}]); }
    expect(S(r).players[1].x).toBeCloseTo(6 * 0.9, 5);
    expect(S(r).players[0].x).toBe(0);
    for (let i = 0; i < 60 * 200 && !r.result; i++) r.stepPlayers(1, [{}, {}]);
    expect(r.result).not.toBeNull();
    expect(r.result!.versus).toBe(true);
    expect(r.result!.score).toBe(0);
    expect(r.result!.summary).toMatch(/^Juara umum: /);
    console.log('versus:', r.result!.summary, S(r).points);
  });

  it('is deterministic for a seed', () => {
    const a = run(lomba, 42), b = run(lomba, 42);
    const ra = a.play(good(), 200), rb = b.play(good(), 200);
    expect(ra).toEqual(rb);
    expect(a.snap()).toEqual(b.snap());
    expect(a.sfx).toEqual(b.sfx);
  });
  it('the legend under the game follows the event (Budi 2026-11-20: all three showed at once)', () => {
    const r = run(lomba, 5, 1);
    const keys = () => JSON.stringify((r.legend as [unknown, string][] | null)?.map((e) => e[0]));
    expect(keys()).toBe(JSON.stringify([['left', 'right']]));
    const ev = () => (r.snap() as { ev: number }).ev;
    for (let f = 0; f < 60 * 240 && ev() === 0; f++) r.step(1, f % 2 ? ['left'] : ['right']);
    expect(ev()).toBe(1);
    expect(keys()).toBe(JSON.stringify(['a']));
  });
});
