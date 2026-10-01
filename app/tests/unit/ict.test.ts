import { describe, expect, it } from 'vitest';
import world from '@design/world.json';
import walls from '@design/derived/walls.json';
import cases from '../fixtures/ict-follow-cases.json';
import { deriveOutlets } from '../../src/world/ict';
import { Editor } from '../../src/studio/editor';
import { makeLayout, parseLayout, serializeLayout, LayoutError } from '../../src/studio/layout';
import type { DerivedWalls, Fixture, World } from '../../src/world/types';

const W = world as unknown as World;

type CaseOp = { kind: 'move'; id: string; pos: [number, number] } | { kind: 'delete'; id: string } | { kind: 'add'; fixture: Fixture };

function applyOps(fixtures: Fixture[], ops: CaseOp[]): Fixture[] {
  let f = fixtures.map((x) => ({ ...x, pos: [...x.pos] as [number, number] }));
  for (const op of ops) {
    if (op.kind === 'move') f.find((x) => x.id === op.id)!.pos = [...op.pos];
    else if (op.kind === 'delete') f = f.filter((x) => x.id !== op.id);
    else f.push({ ...op.fixture });
  }
  return f;
}

describe('ICT outlets follow furniture (parity with tools/kantor/ict_follow.py)', () => {
  it('case file matches the current dataset revision', () => {
    expect(cases.worldRevision).toBe(W.revision.id);
    expect(cases.cases.length).toBeGreaterThanOrEqual(7);
  });
  for (const c of cases.cases) {
    it(`case ${c.name}`, () => {
      const got = deriveOutlets(W, applyOps(W.fixtures, c.ops as CaseOp[]));
      expect(got).toEqual(c.expected);
    });
  }
});

describe('Studio editor keeps outlets in step with furniture', () => {
  it('move, undo, redo and delete update the derived outlets', () => {
    const ed = new Editor(W, walls as unknown as DerivedWalls, W.fixtures);
    const outletOf = () => ed.outlets().find((o) => o.serves === 'FX-L1-053');
    const before = outletOf()!.pos;
    const r = ed.apply({ kind: 'move', id: 'FX-L1-053', pos: [7.75, 13.25] });
    expect(r.ok, JSON.stringify(r.issues)).toBe(true);
    expect(outletOf()!.pos).toEqual([7.75, 13.25]);
    ed.undo();
    expect(outletOf()!.pos).toEqual(before);
    ed.redo();
    expect(outletOf()!.pos).toEqual([7.75, 13.25]);
    expect(ed.apply({ kind: 'delete', id: 'FX-L1-053' }).ok).toBe(true);
    expect(outletOf()).toBeUndefined();
    ed.undo();
    expect(outletOf()).toBeDefined();
  });

  it('export carries outlets; import re-derives and rejects tampered outlets', () => {
    const ed = new Editor(W, walls as unknown as DerivedWalls, W.fixtures);
    expect(ed.apply({ kind: 'move', id: 'FX-L1-053', pos: [7.75, 13.25] }).ok).toBe(true);
    const doc = makeLayout(W, ed.fixtures, 'ict');
    expect(doc.version).toBe(2);
    expect(doc.outlets.find((o) => o.serves === 'FX-L1-053')!.pos).toEqual([7.75, 13.25]);
    const text = serializeLayout(doc);
    const back = parseLayout(text, W);
    expect(back.outlets).toEqual(doc.outlets);
    const tampered = JSON.parse(text);
    tampered.outlets[0].pos = [1, 1];
    expect(() => parseLayout(JSON.stringify(tampered), W)).toThrow(LayoutError);
    // v1 files (no outlets) still import, with outlets derived.
    const v1 = { ...JSON.parse(text), version: 1 };
    delete v1.outlets;
    expect(parseLayout(JSON.stringify(v1), W).outlets).toEqual(doc.outlets);
  });
});
