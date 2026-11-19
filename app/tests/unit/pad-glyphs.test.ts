import { describe, expect, it } from 'vitest';
import { facePart, padKind, partName, partSymbol } from '../../src/input/glyphs';
import { PAD_ONLY, keyText, padParts } from '../../src/input/legend';
import { PAD_PROFILES } from '../../src/input/pad-profiles';
import { GAMES } from '../../src/minigames/registry';

describe('pad glyphs (v2.3)', () => {
  it('recognises a DualSense or DualShock by vendor id or name, anything else is Xbox style', () => {
    expect(padKind('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toBe('ps');
    expect(padKind('054c-09cc-Wireless Controller')).toBe('ps');
    expect(padKind('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)')).toBe('xbox');
    expect(padKind('Test pad (STANDARD GAMEPAD)')).toBe('xbox');
  });
  it('shows the printed marks: shapes on PlayStation, letters on Xbox', () => {
    expect(partSymbol('cross', 'ps')).toBe('✕');
    expect(partSymbol('cross', 'xbox')).toBe('A');
    expect(partName('r2', 'ps')).toBe('R2');
    expect(partName('r2', 'xbox')).toBe('RT');
    expect(partName('options', 'ps')).toBe('Options');
  });
  it('the reversed profile moves A to Circle and B to Cross', () => {
    expect(facePart('a', false)).toBe('cross');
    expect(facePart('a', true)).toBe('circle');
    expect(facePart('b', true)).toBe('cross');
  });
});

describe('legend keys follow the device and the profile', () => {
  const std = PAD_PROFILES.standar;
  it('one logical key reads per device', () => {
    expect(keyText('a', 'keyboard', std, 'ps')).toBe('Spasi');
    expect(keyText('a', 'touch', std, 'ps')).toBe('A');
    expect(keyText('a', 'pad', std, 'ps')).toBe('✕');
    expect(keyText('a', 'pad', PAD_PROFILES.terbalik, 'ps')).toBe('○');
    expect(keyText('r2', 'pad', std, 'ps')).toBe('R2');
  });
  it('the left-handed profile swaps which stick walks', () => {
    expect(padParts('ls', std)).toEqual(['ls']);
    expect(padParts('ls', PAD_PROFILES.kidal)).toEqual(['rs']);
    expect(padParts('rs', PAD_PROFILES.kidal)).toEqual(['ls']);
  });
  it('pad-only keys have no keyboard or touch text, so legends leave them out there', () => {
    for (const k of PAD_ONLY) expect(keyText(k, 'keyboard', std, 'ps')).toBe('');
  });
});

describe('every mini game has a short tutorial and a legend', () => {
  it('two to three tutorial steps, a legend of real keys, placeholders the legend knows', async () => {
    const known = new Set(['a', 'b', 'x', 'y', 'arah', 'lr', 'ud', 'left', 'right', 'up', 'down', 'ls', 'rs', 'l1', 'r1', 'l2', 'r2', 'options', 'create', 'dpad']);
    for (const [id, load] of Object.entries(GAMES)) {
      const m = (await load()).default.meta;
      expect(m.tutorial.length, id).toBeGreaterThanOrEqual(2);
      expect(m.tutorial.length, id).toBeLessThanOrEqual(3);
      expect(m.legend.length, id).toBeGreaterThan(0);
      for (const line of [...m.tutorial, ...(m.padTutorial ?? [])]) {
        for (const [, k] of line.matchAll(/\{(\w+)\}/g)) expect(known.has(k), `${id}: {${k}}`).toBe(true);
      }
      // every on-screen touch button of the game is explained in its legend or button list
      const legendKeys = new Set(m.legend.flatMap(([k]) => (Array.isArray(k) ? k : [k])));
      const listed = new Set([...legendKeys, ...Object.keys(m.actions ?? {})]);
      for (const b of m.touch.filter((x) => ['a', 'b', 'x', 'y'].includes(x))) expect(listed.has(b), `${id}: ${b}`).toBe(true);
    }
  });
});
