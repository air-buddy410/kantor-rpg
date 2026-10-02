// Agent-agent spacing shared by the CEO controller and the idle sim. Agents
// are discs; a step is refused only when it brings two discs closer than the
// gap AND closer than they already were, so overlapping agents (spawn, floor
// arrival, shared multi-seat slots) can always walk apart and never lock.
import type { Vec2 } from '../world/types';

export const AGENT_RADIUS = 0.28;
export const AGENT_GAP = AGENT_RADIUS * 2;

const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function stepBlocked(cur: Vec2, next: Vec2, other: Vec2, gap = AGENT_GAP): boolean {
  const dn = dist(next, other);
  return dn < gap && dn < dist(cur, other) - 1e-9;
}

export function firstBlocker<T extends { pos: Vec2 }>(cur: Vec2, next: Vec2, others: T[], gap = AGENT_GAP): T | null {
  for (const o of others) if (stepBlocked(cur, next, o.pos, gap)) return o;
  return null;
}
