import { describe, expect, it } from 'vitest';
import { detectLang } from '../../src/i18n';
import { EN } from '../../src/i18n/en';
import worldJson from '@design/world.json';
import dialogueJson from '@design/dialogue.json';

const SOURCES = import.meta.glob(['../../src/**/*.ts', '!../../src/i18n/en/**'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('language choice', () => {
  it('URL parameter wins, then the browser language', () => {
    expect(detectLang('?lang=en', ['id-ID'])).toBe('en');
    expect(detectLang('?lang=id', ['en-US'])).toBe('id');
    expect(detectLang('', ['id-ID'])).toBe('id');
    expect(detectLang('', ['en-US'])).toBe('en');
    expect(detectLang('', ['de-DE', 'id'])).toBe('en');
  });
});

describe('English dictionary', () => {
  it('has an entry for every literal passed to t()', () => {
    const missing: string[] = [];
    expect(Object.keys(SOURCES).length).toBeGreaterThan(30);
    for (const [f, s] of Object.entries(SOURCES)) {
      for (const m of s.matchAll(/\b(?:t|tr)\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) {
        const key = m[2].replace(/\\(['"\\])/g, '$1');
        if (!(key in EN)) missing.push(`${f}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('keeps every {placeholder} and uses no long dashes', () => {
    const bad: string[] = [];
    for (const [id, en] of Object.entries(EN)) {
      const a = (id.match(/\{\w+\}/g) ?? []).sort().join();
      const b = (en.match(/\{\w+\}/g) ?? []).sort().join();
      if (a !== b || /[\u2013\u2014]/.test(en)) bad.push(id);
    }
    expect(bad).toEqual([]);
  });

  it('translates every room, floor and furniture name in the world dataset', () => {
    const w = worldJson as unknown as { floors: { name: string }[]; rooms: { name: string; function: string }[]; catalog: Record<string, { label?: string }> };
    const names = [...w.floors.map((f) => f.name), ...w.rooms.flatMap((r) => [r.name, r.function]), ...Object.values(w.catalog).flatMap((c) => (c.label ? [c.label] : []))];
    expect(names.filter((n) => !(n in EN))).toEqual([]);
  });

  it('translates every Game Station card and facility title', async () => {
    const { CATALOG, FACILITY_TITLE } = await import('../../src/minigames/registry');
    const s = [...CATALOG.flatMap((i) => [i.title, i.blurb]), ...Object.values(FACILITY_TITLE)];
    expect(s.filter((n) => !(n in EN))).toEqual([]);
  });

  it('translates every mini game title, blurb, tutorial row and button name', async () => {
    const { GAMES } = await import('../../src/minigames/registry');
    const { KEY_WORDS, OFFICE_PAD_LEGEND } = await import('../../src/input/legend');
    const { GLYPH_NAMES } = await import('../../src/input/glyphs');
    const s: string[] = [...KEY_WORDS, ...GLYPH_NAMES, ...OFFICE_PAD_LEGEND.map((e) => e[1])];
    for (const load of Object.values(GAMES)) {
      const m = (await load()).default.meta;
      s.push(m.title, m.blurb, m.score.unit, ...m.tutorial, ...(m.padTutorial ?? []), ...[...m.legend, ...(m.padLegend ?? [])].map((e) => e[1]),
        ...Object.values(m.actions ?? {}) as string[], ...Object.values(m.padActions ?? {}) as string[], ...(m.pointerHint ? [m.pointerHint] : []));
    }
    expect(s.filter((n) => !(n in EN))).toEqual([]);
  });

  it('translates every persona line and floor finish', () => {
    const lines = Object.values((dialogueJson as { personas: Record<string, string[]> }).personas).flat();
    const w = worldJson as unknown as { rooms: { finish?: { floor?: string } }[] };
    const finishes = w.rooms.flatMap((r) => (r.finish?.floor && r.finish.floor !== '-' ? [r.finish.floor] : []));
    expect([...lines, ...finishes].filter((n) => !(n in EN))).toEqual([]);
  });
});
