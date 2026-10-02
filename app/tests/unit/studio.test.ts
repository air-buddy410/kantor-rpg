import { describe, expect, it } from 'vitest';
import world from '@design/world.json';
import walls from '@design/derived/walls.json';
import { deriveSlots } from '../../src/world/slots';
import { Editor } from '../../src/studio/editor';
import { geometryIssues, navIssues } from '../../src/studio/validate';
import { LayoutError, makeLayout, parseLayout, serializeLayout, MAX_IMPORT_BYTES } from '../../src/studio/layout';
import type { DerivedWalls, World } from '../../src/world/types';

const W = world as unknown as World;
const WALLS = walls as unknown as DerivedWalls;
const byType = (t: string, room: string) => W.fixtures.find((f) => f.type === t && f.room === room)!;

describe('Office Studio core (REQ-STUDIO-01)', () => {
  it('TS slot derivation equals the Python seed output', () => {
    expect(deriveSlots(W.fixtures, W.catalog)).toEqual(W.activitySlots);
  });

  it('the committed dataset passes the studio validator (same rules as Python)', () => {
    expect(geometryIssues(W, W.fixtures)).toEqual([]);
    expect(navIssues(W, WALLS, W.fixtures).issues).toEqual([]);
  });

  it('valid move commits; undo and redo restore exact snapshots', () => {
    const ed = new Editor(W, WALLS, W.fixtures);
    const before = JSON.stringify(ed.fixtures);
    const plant = byType('plant_small', 'L1-MEET');
    const res = ed.apply({ kind: 'move', id: plant.id, pos: [1.0, 1.0] });
    expect(res).toMatchObject({ ok: true });
    const after = JSON.stringify(ed.fixtures);
    expect(after).not.toBe(before);
    expect(ed.undo()).toBe(true);
    expect(JSON.stringify(ed.fixtures)).toBe(before);
    expect(ed.redo()).toBe(true);
    expect(JSON.stringify(ed.fixtures)).toBe(after);
  });

  it('is deterministic for the same operation sequence', () => {
    const run = () => {
      const ed = new Editor(W, WALLS, W.fixtures);
      ed.apply({ kind: 'add', type: 'plant_small', floor: 'L2', pos: [5.0, 12.0] });
      ed.apply({ kind: 'rotate', id: byType('bench', 'L2-GARDEN').id, delta: 90 });
      return JSON.stringify(ed.fixtures);
    };
    expect(run()).toBe(run());
  });

  it('rejects overlap, wall intrusion, door blocking and leaves the draft untouched', () => {
    const ed = new Editor(W, WALLS, W.fixtures);
    const snap = JSON.stringify(ed.fixtures);
    const sofa = byType('sofa', 'L1-LOBBY');
    const desk = byType('reception_desk', 'L1-LOBBY');
    const r1 = ed.apply({ kind: 'move', id: sofa.id, pos: desk.pos });
    expect(r1.ok).toBe(false);
    expect(r1.issues.map((i) => i.code)).toContain('overlap');
    const r2 = ed.apply({ kind: 'move', id: sofa.id, pos: [14.0, 0.25] });
    expect(r2.ok).toBe(false);
    expect(r2.issues.some((i) => i.code === 'wall' || i.code === 'door' || i.code === 'outside')).toBe(true);
    const plant = byType('plant_small', 'L1-MEET');
    const r3 = ed.apply({ kind: 'move', id: plant.id, pos: [4.0, 7.5] }); // in front of D-L1-03
    expect(r3.ok).toBe(false);
    expect(r3.issues.map((i) => i.code)).toContain('door');
    expect(JSON.stringify(ed.fixtures)).toBe(snap);
    expect(ed.canUndo()).toBe(false);
  });

  it('rejects the edit that seals a room even when no door zone is touched', () => {
    const ed = new Editor(W, WALLS, W.fixtures);
    expect(ed.apply({ kind: 'add', type: 'storage_shelf', floor: 'L2', pos: [1.5, 11.75] }).ok).toBe(true);
    expect(ed.apply({ kind: 'add', type: 'storage_shelf', floor: 'L2', pos: [4.75, 11.75] }).ok).toBe(true);
    const snapshot = JSON.stringify(ed.fixtures);
    const r = ed.apply({ kind: 'add', type: 'storage_shelf', floor: 'L2', pos: [3.25, 12.25] });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'slot' || i.code === 'unreachable')).toBe(true);
    expect(JSON.stringify(ed.fixtures)).toBe(snapshot);
  });

  it('locks structural, sanitary and ICT rack fixtures', () => {
    const ed = new Editor(W, WALLS, W.fixtures);
    expect(ed.apply({ kind: 'delete', id: byType('stair_u', 'L1-CORE').id }).ok).toBe(false);
    expect(ed.apply({ kind: 'move', id: byType('rack_42u', 'L1-SERVER').id, pos: [26, 20] }).ok).toBe(false);
    expect(ed.apply({ kind: 'add', type: 'wc', floor: 'L1', pos: [10, 9] }).ok).toBe(false);
  });

  it('adds new fixtures with stable draft ids and derived slots', () => {
    const ed = new Editor(W, WALLS, W.fixtures);
    const r = ed.apply({ kind: 'add', type: 'armchair', floor: 'L2', pos: [12.0, 11.75] });
    expect(r).toMatchObject({ ok: true, id: 'FX-L2-D001' });
    const slots = deriveSlots(ed.fixtures, W.catalog).filter((s) => s.fixture === 'FX-L2-D001');
    expect(slots).toHaveLength(1);
    expect(slots[0].room).toBe('L2-GARDEN');
  });
});

describe('layout import is guarded (no script/path execution)', () => {
  const good = serializeLayout(makeLayout(W, W.fixtures, 'test'));

  it('round-trips save/load exactly', () => {
    expect(parseLayout(good, W).fixtures).toEqual(W.fixtures);
  });

  const bad: [string, string, RegExp][] = [
    ['broken json', '{"format":', /JSON rusak/],
    ['wrong format', JSON.stringify({ format: 'x' }), /Bukan file layout/],
    ['wrong version', JSON.stringify({ format: 'kantor-rpg-layout', version: 9 }), /Versi/],
    ['wrong revision', JSON.stringify({ format: 'kantor-rpg-layout', version: 1, worldRevision: 'P00', fixtures: [] }), /revisi/],
    ['too deep', JSON.stringify({ format: 'kantor-rpg-layout', version: 1, worldRevision: W.revision.id, fixtures: [{ a: { b: { c: { d: { e: { f: {} } } } } } }] }), /terlalu dalam/],
    ['unknown type', JSON.stringify({ format: 'kantor-rpg-layout', version: 1, worldRevision: W.revision.id, fixtures: [{ ...W.fixtures[0], type: 'rocket' }] }), /catalog/],
    ['bad rotation', JSON.stringify({ format: 'kantor-rpg-layout', version: 1, worldRevision: W.revision.id, fixtures: [{ ...W.fixtures[0], rot: 45 }] }), /kelipatan 90/],
    ['out of range', JSON.stringify({ format: 'kantor-rpg-layout', version: 1, worldRevision: W.revision.id, fixtures: [{ ...W.fixtures[0], pos: [99, 1] }] }), /rentang/],
    ['duplicate id', JSON.stringify({ format: 'kantor-rpg-layout', version: 1, worldRevision: W.revision.id, fixtures: [W.fixtures[0], W.fixtures[0]] }), /ganda/],
    ['script in id', JSON.stringify({ format: 'kantor-rpg-layout', version: 1, worldRevision: W.revision.id, fixtures: [{ ...W.fixtures[0], id: '<script>' }] }), /tidak valid/],
  ];
  for (const [name, text, re] of bad) {
    it(`rejects ${name}`, () => {
      expect(() => parseLayout(text, W)).toThrow(LayoutError);
      expect(() => parseLayout(text, W)).toThrow(re);
    });
  }

  it('rejects oversized files', () => {
    expect(() => parseLayout(' '.repeat(MAX_IMPORT_BYTES + 1), W)).toThrow(/KB/);
  });

  it('ignores asset paths and prototype keys from the file', () => {
    const evil = JSON.parse(good);
    evil.fixtures[0].asset = '../../etc/passwd';
    evil.fixtures[0].size = [99, 99, 99];
    const text = JSON.stringify(evil).replace('"format"', '"__proto__":{"polluted":true},"format"');
    const doc = parseLayout(text, W);
    expect(doc.fixtures[0].asset).toBe(W.fixtures[0].asset);
    expect(doc.fixtures[0].size).toEqual(W.fixtures[0].size);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
