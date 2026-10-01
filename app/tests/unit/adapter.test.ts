import { describe, expect, it } from 'vitest';
import world from '@design/world.json';
import { AdapterDisabledError, createAdapter, demoSnapshot, effectiveStatus, PRIVATE_ENABLED, sanitizeActor } from '../../src/data/adapter';
import type { World } from '../../src/world/types';

const W = world as unknown as World;
const known = new Set(W.actors.map((a) => a.id));

describe('data adapter separation (public/demo vs private M4)', () => {
  it('private mode is disabled in this build', () => {
    expect(PRIVATE_ENABLED).toBe(false);
    expect(() => createAdapter('private', W)).toThrow(AdapterDisabledError);
  });

  it('demo snapshot carries no work claims and no private fields', () => {
    const s = createAdapter('demo', W).snapshot();
    expect(s.mode).toBe('demo');
    for (const a of s.actors) {
      expect(a.workStatus).toBe('unknown');
      expect(Object.keys(a).sort()).toEqual(['actorId', 'observedAt', 'source', 'workStatus']);
    }
    expect(JSON.stringify(s)).not.toMatch(/https?:|@|token|password|chat/i);
  });

  it('sanitizer drops unknown fields, URLs and unknown actors; bad status becomes unknown', () => {
    const now = new Date().toISOString();
    const a = sanitizeActor({ actorId: 'ACT-NOVA', workStatus: 'done', observedAt: now, source: 'x', taskSummary: 'see https://example.invalid/secret', chatLog: 'private', email: 'a@b' }, known)!;
    expect(Object.keys(a).sort()).toEqual(['actorId', 'observedAt', 'source', 'taskSummary', 'workStatus']);
    expect(a.taskSummary).not.toContain('http');
    expect(sanitizeActor({ actorId: 'ACT-NOVA', workStatus: 'hacked', observedAt: now }, known)!.workStatus).toBe('unknown');
    expect(sanitizeActor({ actorId: 'ACT-EVIL', workStatus: 'working', observedAt: now }, known)).toBeNull();
    expect(sanitizeActor([1, 2], known)).toBeNull();
    expect(sanitizeActor({ actorId: 'ACT-NOVA', workStatus: 'done' }, known)!.workStatus).toBe('unknown');
  });

  it('stale snapshots degrade to unknown, fresh ones keep their status', () => {
    const base = demoSnapshot(W);
    const snap = { ...base, mode: 'private' as const, freshnessTTL: 30 };
    const t0 = Date.parse('2026-10-01T10:00:00Z');
    const a = { actorId: 'ACT-NOVA', workStatus: 'working' as const, observedAt: '2026-10-01T10:00:00Z', source: 'test' };
    expect(effectiveStatus(a, snap, t0 + 10_000)).toEqual({ status: 'working', stale: false });
    expect(effectiveStatus(a, snap, t0 + 31_000)).toEqual({ status: 'unknown', stale: true });
    expect(effectiveStatus({ ...a, observedAt: null }, snap, t0)).toEqual({ status: 'unknown', stale: true });
  });
});
