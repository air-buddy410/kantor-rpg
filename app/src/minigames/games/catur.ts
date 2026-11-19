// Catur Kantor (board game table, L2-GAME). Full chess with legal rules against a
// teammate AI. The engine below is self contained (mailbox board, make/unmake)
// so tests can run perft and rule checks without the canvas.
import type { Btn, CastMember, GameCtx, GameInstance, GameModule, InputState } from '../types';
import { PAL, drawChar, text, roundRect } from '../cast';

// ---------------------------------------------------------------------------
// Engine
// Square index = row * 8 + col, row 0 is rank 8 (black back rank), col 0 is file a.
// Pieces: + white, - black. 1 pawn, 2 knight, 3 bishop, 4 rook, 5 queen, 6 king.
// ---------------------------------------------------------------------------

export const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
export const F_CAP = 1, F_EP = 2, F_CASTLE = 4, F_DOUBLE = 8;

export interface Move { f: number; t: number; p: number; fl: number }
export interface Pos {
  b: Int8Array;
  turn: 1 | -1;
  /** 1 white short, 2 white long, 4 black short, 8 black long */
  castle: number;
  ep: number;
  half: number;
  full: number;
  king: [number, number];
}
interface Undo { cap: number; castle: number; ep: number; half: number; full: number; capSq: number }

const KN_D = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KG_D = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK_D = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISH_D = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

function jumps(d: number[][]): number[][] {
  const out: number[][] = [];
  for (let s = 0; s < 64; s++) {
    const r = s >> 3, c = s & 7, l: number[] = [];
    for (const [dr, dc] of d) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) l.push(rr * 8 + cc); }
    out.push(l);
  }
  return out;
}
function rays(d: number[][]): number[][][] {
  const out: number[][][] = [];
  for (let s = 0; s < 64; s++) {
    const r = s >> 3, c = s & 7, all: number[][] = [];
    for (const [dr, dc] of d) {
      const l: number[] = [];
      for (let rr = r + dr, cc = c + dc; rr >= 0 && rr < 8 && cc >= 0 && cc < 8; rr += dr, cc += dc) l.push(rr * 8 + cc);
      if (l.length) all.push(l);
    }
    out.push(all);
  }
  return out;
}
const KNIGHT = jumps(KN_D), KING = jumps(KG_D), RRAYS = rays(ROOK_D), BRAYS = rays(BISH_D);
const QRAYS = RRAYS.map((r, i) => [...r, ...BRAYS[i]]);
const sideIdx = (s: number) => (s > 0 ? 0 : 1);

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const FEN_P: Record<string, number> = { p: P, n: N, b: B, r: R, q: Q, k: K };

export const sqName = (s: number) => 'abcdefgh'[s & 7] + (8 - (s >> 3));
export const sqIndex = (n: string) => (8 - +n[1]) * 8 + 'abcdefgh'.indexOf(n[0]);
export const uci = (m: Move) => sqName(m.f) + sqName(m.t) + (m.p ? ' pnbrq'[m.p] : '');

export function fromFEN(fen: string): Pos {
  const [rows, turn, cs, ep, half, full] = fen.trim().split(/\s+/);
  const b = new Int8Array(64);
  const king: [number, number] = [-1, -1];
  let s = 0;
  for (const ch of rows) {
    if (ch === '/') continue;
    if (/\d/.test(ch)) { s += +ch; continue; }
    const v = FEN_P[ch.toLowerCase()] * (ch === ch.toUpperCase() ? 1 : -1);
    b[s] = v;
    if (v === K) king[0] = s; else if (v === -K) king[1] = s;
    s++;
  }
  let castle = 0;
  if (cs && cs !== '-') { if (cs.includes('K')) castle |= 1; if (cs.includes('Q')) castle |= 2; if (cs.includes('k')) castle |= 4; if (cs.includes('q')) castle |= 8; }
  return { b, turn: turn === 'b' ? -1 : 1, castle, ep: ep && ep !== '-' ? sqIndex(ep) : -1, half: +(half ?? 0), full: +(full ?? 1), king };
}

export function toFEN(p: Pos): string {
  let out = '';
  for (let r = 0; r < 8; r++) {
    let e = 0;
    for (let c = 0; c < 8; c++) {
      const v = p.b[r * 8 + c];
      if (!v) { e++; continue; }
      if (e) { out += e; e = 0; }
      const ch = ' pnbrqk'[Math.abs(v)];
      out += v > 0 ? ch.toUpperCase() : ch;
    }
    if (e) out += e;
    if (r < 7) out += '/';
  }
  const cs = (p.castle & 1 ? 'K' : '') + (p.castle & 2 ? 'Q' : '') + (p.castle & 4 ? 'k' : '') + (p.castle & 8 ? 'q' : '');
  return `${out} ${p.turn > 0 ? 'w' : 'b'} ${cs || '-'} ${p.ep >= 0 ? sqName(p.ep) : '-'} ${p.half} ${p.full}`;
}

export function clonePos(p: Pos): Pos { return { ...p, b: p.b.slice(), king: [p.king[0], p.king[1]] }; }

/** Is square `s` attacked by side `by` (1 white, -1 black)? */
export function attacked(p: Pos, s: number, by: number): boolean {
  const b = p.b;
  const r = s >> 3, c = s & 7;
  // a white pawn attacks upward, so it sits one row below the target
  const pr = r + (by > 0 ? 1 : -1);
  if (pr >= 0 && pr < 8) {
    if (c > 0 && b[pr * 8 + c - 1] === by * P) return true;
    if (c < 7 && b[pr * 8 + c + 1] === by * P) return true;
  }
  for (const t of KNIGHT[s]) if (b[t] === by * N) return true;
  for (const t of KING[s]) if (b[t] === by * K) return true;
  for (const ray of RRAYS[s]) for (const t of ray) { const v = b[t]; if (!v) continue; if (v === by * R || v === by * Q) return true; break; }
  for (const ray of BRAYS[s]) for (const t of ray) { const v = b[t]; if (!v) continue; if (v === by * B || v === by * Q) return true; break; }
  return false;
}

export const inCheck = (p: Pos, side: number = p.turn) => attacked(p, p.king[sideIdx(side)], -side);

/** Pseudo legal moves (may leave own king in check). `capsOnly` for quiescence. */
export function pseudoMoves(p: Pos, capsOnly = false): Move[] {
  const out: Move[] = [];
  const b = p.b, me = p.turn;
  for (let s = 0; s < 64; s++) {
    const v = b[s];
    if (!v || (v > 0) !== (me > 0)) continue;
    const t = Math.abs(v);
    const r = s >> 3, c = s & 7;
    if (t === P) {
      const dir = me > 0 ? -1 : 1;
      const startRow = me > 0 ? 6 : 1, lastRow = me > 0 ? 0 : 7;
      const r1 = r + dir;
      const push = (to: number, fl: number) => {
        if ((to >> 3) === lastRow) for (const pr of [Q, R, B, N]) out.push({ f: s, t: to, p: pr, fl });
        else out.push({ f: s, t: to, p: 0, fl });
      };
      const one = r1 * 8 + c;
      if (!b[one] && (!capsOnly || r1 === lastRow)) {
        push(one, 0);
        if (r === startRow && !capsOnly && !b[one + dir * 8]) out.push({ f: s, t: one + dir * 8, p: 0, fl: F_DOUBLE });
      }
      for (const dc of [-1, 1]) {
        const cc = c + dc;
        if (cc < 0 || cc > 7) continue;
        const to = r1 * 8 + cc;
        if (b[to] && (b[to] > 0) !== (me > 0)) push(to, F_CAP);
        else if (to === p.ep) out.push({ f: s, t: to, p: 0, fl: F_CAP | F_EP });
      }
      continue;
    }
    if (t === N || t === K) {
      for (const to of (t === N ? KNIGHT : KING)[s]) {
        const w = b[to];
        if (!w) { if (!capsOnly) out.push({ f: s, t: to, p: 0, fl: 0 }); }
        else if ((w > 0) !== (me > 0)) out.push({ f: s, t: to, p: 0, fl: F_CAP });
      }
      if (t === K && !capsOnly) castleMoves(p, s, out);
      continue;
    }
    for (const ray of (t === R ? RRAYS : t === B ? BRAYS : QRAYS)[s]) for (const to of ray) {
      const w = b[to];
      if (!w) { if (!capsOnly) out.push({ f: s, t: to, p: 0, fl: 0 }); continue; }
      if ((w > 0) !== (me > 0)) out.push({ f: s, t: to, p: 0, fl: F_CAP });
      break;
    }
  }
  return out;
}

function castleMoves(p: Pos, s: number, out: Move[]) {
  const b = p.b, me = p.turn;
  const home = me > 0 ? 60 : 4;
  if (s !== home) return;
  const short = me > 0 ? 1 : 4, long = me > 0 ? 2 : 8;
  if ((p.castle & (short | long)) === 0 || attacked(p, home, -me)) return;
  if (p.castle & short && b[home + 3] === me * R && !b[home + 1] && !b[home + 2] && !attacked(p, home + 1, -me) && !attacked(p, home + 2, -me)) out.push({ f: s, t: home + 2, p: 0, fl: F_CASTLE });
  if (p.castle & long && b[home - 4] === me * R && !b[home - 1] && !b[home - 2] && !b[home - 3] && !attacked(p, home - 1, -me) && !attacked(p, home - 2, -me)) out.push({ f: s, t: home - 2, p: 0, fl: F_CASTLE });
}

const CASTLE_MASK = new Int8Array(64).fill(15);
CASTLE_MASK[60] = 12; CASTLE_MASK[63] = 14; CASTLE_MASK[56] = 13;
CASTLE_MASK[4] = 3; CASTLE_MASK[7] = 11; CASTLE_MASK[0] = 7;

export function makeMove(p: Pos, m: Move): Undo {
  const b = p.b, me = p.turn;
  const v = b[m.f];
  const capSq = m.fl & F_EP ? m.t + (me > 0 ? 8 : -8) : m.t;
  const u: Undo = { cap: b[capSq], castle: p.castle, ep: p.ep, half: p.half, full: p.full, capSq };
  if (m.fl & F_EP) b[capSq] = 0;
  b[m.t] = m.p ? me * m.p : v;
  b[m.f] = 0;
  if (v === me * K) {
    p.king[sideIdx(me)] = m.t;
    if (m.fl & F_CASTLE) {
      if (m.t > m.f) { b[m.f + 1] = b[m.f + 3]; b[m.f + 3] = 0; }
      else { b[m.f - 1] = b[m.f - 4]; b[m.f - 4] = 0; }
    }
  }
  p.castle &= CASTLE_MASK[m.f] & CASTLE_MASK[m.t];
  p.ep = m.fl & F_DOUBLE ? (m.f + m.t) >> 1 : -1;
  p.half = v === me * P || u.cap ? 0 : p.half + 1;
  if (me < 0) p.full++;
  p.turn = -me as 1 | -1;
  return u;
}

export function unmakeMove(p: Pos, m: Move, u: Undo) {
  const b = p.b;
  const me = -p.turn as 1 | -1;
  p.turn = me;
  const v = m.p ? me * P : b[m.t];
  b[m.f] = v;
  b[m.t] = 0;
  b[u.capSq] = u.cap;
  if (v === me * K) {
    p.king[sideIdx(me)] = m.f;
    if (m.fl & F_CASTLE) {
      if (m.t > m.f) { b[m.f + 3] = b[m.f + 1]; b[m.f + 1] = 0; }
      else { b[m.f - 4] = b[m.f - 1]; b[m.f - 1] = 0; }
    }
  }
  p.castle = u.castle; p.ep = u.ep; p.half = u.half; p.full = u.full;
}

export function legalMoves(p: Pos): Move[] {
  const me = p.turn;
  return pseudoMoves(p).filter((m) => {
    const u = makeMove(p, m);
    const bad = attacked(p, p.king[sideIdx(me)], -me);
    unmakeMove(p, m, u);
    return !bad;
  });
}

export function perft(p: Pos, d: number): number {
  if (d === 0) return 1;
  const me = p.turn;
  let n = 0;
  for (const m of pseudoMoves(p)) {
    const u = makeMove(p, m);
    if (!attacked(p, p.king[sideIdx(me)], -me)) n += d === 1 ? 1 : perft(p, d - 1);
    unmakeMove(p, m, u);
  }
  return n;
}

/** Repetition key; the en passant square only counts when a capture is really possible. */
export function posKey(p: Pos): string {
  let ep = -1;
  if (p.ep >= 0) {
    const pr = (p.ep >> 3) + (p.turn > 0 ? 1 : -1), c = p.ep & 7;
    for (const dc of [-1, 1]) { const cc = c + dc; if (cc >= 0 && cc < 8 && p.b[pr * 8 + cc] === p.turn * P) ep = p.ep; }
  }
  return `${p.b.join(',')}|${p.turn}|${p.castle}|${ep}`;
}

export function insufficient(p: Pos): boolean {
  const minors: { t: number; color: number }[] = [];
  for (let s = 0; s < 64; s++) {
    const v = p.b[s], t = Math.abs(v);
    if (!v || t === K) continue;
    if (t === P || t === R || t === Q) return false;
    minors.push({ t, color: ((s >> 3) + (s & 7)) & 1 });
  }
  if (minors.length <= 1) return true;
  // only bishops, all on the same square colour
  return minors.every((m) => m.t === B && m.color === minors[0].color);
}

export type Outcome = { kind: 'mate' | 'stalemate' | 'fifty' | 'material' | 'repeat'; winner: number } | null;

/** Result check for the side to move. `history` counts position keys. */
export function outcome(p: Pos, history: Map<string, number>): Outcome {
  const legal = legalMoves(p);
  if (!legal.length) return inCheck(p) ? { kind: 'mate', winner: -p.turn } : { kind: 'stalemate', winner: 0 };
  if (p.half >= 100) return { kind: 'fifty', winner: 0 };
  if (insufficient(p)) return { kind: 'material', winner: 0 };
  if ((history.get(posKey(p)) ?? 0) >= 3) return { kind: 'repeat', winner: 0 };
  return null;
}

export const VAL = [0, 100, 320, 330, 500, 900, 0];

/** White material minus black material, in centipawns. */
export function material(p: Pos): number {
  let s = 0;
  for (let i = 0; i < 64; i++) { const v = p.b[i]; if (v) s += Math.sign(v) * VAL[Math.abs(v)]; }
  return s;
}

// Piece-square tables from white's point of view, index 0 = a8.
const PST: number[][] = [
  [],
  [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
];
const KING_END = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];

/** Static evaluation from the side to move's point of view. */
export function evaluate(p: Pos, pst: boolean): number {
  let s = 0, heavy = 0;
  if (pst) for (let i = 0; i < 64; i++) { const t = Math.abs(p.b[i]); if (t >= N && t <= Q) heavy += VAL[t]; }
  const end = heavy <= 1600;
  for (let i = 0; i < 64; i++) {
    const v = p.b[i];
    if (!v) continue;
    const t = Math.abs(v);
    let x = VAL[t];
    if (pst) {
      const idx = v > 0 ? i : (7 - (i >> 3)) * 8 + (i & 7);
      x += t === K && end ? KING_END[idx] : PST[t][idx];
    }
    s += v > 0 ? x : -x;
  }
  return p.turn > 0 ? s : -s;
}

export type Level = 0 | 1 | 2;
/** Search is capped by a node budget (not wall time) so it stays deterministic and quick. */
export const LEVELS: { mult: number; depth: number; nodes: number; noise: number; pst: boolean; q: boolean; blunder: number }[] = [
  { mult: 1, depth: 1, nodes: 3000, noise: 160, pst: false, q: false, blunder: 0.25 },
  { mult: 1.5, depth: 3, nodes: 12000, noise: 18, pst: false, q: false, blunder: 0 },
  { mult: 2, depth: 4, nodes: 28000, noise: 4, pst: true, q: true, blunder: 0 },
];

const MATE = 100000;

interface Search { nodes: number; limit: number; abort: boolean; pst: boolean; q: boolean }

function order(p: Pos, ms: Move[], first?: Move): Move[] {
  const key = (m: Move) => {
    if (first && m.f === first.f && m.t === first.t && m.p === first.p) return 1e6;
    let s = 0;
    if (m.fl & F_CAP) s += 10 * VAL[Math.abs(p.b[m.t]) || P] - VAL[Math.abs(p.b[m.f])] + 1000;
    if (m.p) s += VAL[m.p];
    return s;
  };
  const k = ms.map(key);
  const idx = ms.map((_, i) => i).sort((a, b) => k[b] - k[a] || a - b);
  return idx.map((i) => ms[i]);
}

function quiesce(p: Pos, alpha: number, beta: number, S: Search, qd: number): number {
  S.nodes++;
  const stand = evaluate(p, S.pst);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (qd <= 0 || S.nodes > S.limit) return alpha;
  const me = p.turn;
  for (const m of order(p, pseudoMoves(p, true))) {
    const u = makeMove(p, m);
    if (attacked(p, p.king[sideIdx(me)], -me)) { unmakeMove(p, m, u); continue; }
    const s = -quiesce(p, -beta, -alpha, S, qd - 1);
    unmakeMove(p, m, u);
    if (s >= beta) return beta;
    if (s > alpha) alpha = s;
  }
  return alpha;
}

function negamax(p: Pos, depth: number, alpha: number, beta: number, ply: number, S: Search): number {
  if (++S.nodes > S.limit) { S.abort = true; return 0; }
  if (depth <= 0) return S.q ? quiesce(p, alpha, beta, S, 3) : evaluate(p, S.pst);
  if (p.half >= 100) return 0;
  const me = p.turn;
  let legal = 0;
  for (const m of order(p, pseudoMoves(p))) {
    const u = makeMove(p, m);
    if (attacked(p, p.king[sideIdx(me)], -me)) { unmakeMove(p, m, u); continue; }
    legal++;
    const s = -negamax(p, depth - 1, -beta, -alpha, ply + 1, S);
    unmakeMove(p, m, u);
    if (S.abort) return 0;
    if (s >= beta) return beta;
    if (s > alpha) alpha = s;
  }
  if (!legal) return attacked(p, p.king[sideIdx(me)], -me) ? -MATE + ply : 0;
  return alpha;
}

/**
 * Pick a move for the side to move, deterministic for a given `rand`.
 * Iterative deepening; the last fully searched depth decides. Small noise
 * (bounded by a search window) varies play among near equal moves.
 */
export function aiMove(pos: Pos, level: Level, rand: () => number): Move | null {
  const p = clonePos(pos);
  const legal = legalMoves(p);
  if (!legal.length) return null;
  const L = LEVELS[level];
  if (L.blunder && rand() < L.blunder) return legal[Math.floor(rand() * legal.length)];
  const S: Search = { nodes: 0, limit: L.nodes, abort: false, pst: L.pst, q: L.q };
  let best: Move = legal[0];
  let ordered = order(p, legal);
  for (let d = 1; d <= L.depth; d++) {
    const scored: { m: Move; s: number }[] = [];
    let alpha = -MATE * 2;
    for (const m of ordered) {
      const u = makeMove(p, m);
      const s = -negamax(p, d - 1, -MATE * 2, -(alpha - L.noise), 1, S);
      unmakeMove(p, m, u);
      if (S.abort) break;
      scored.push({ m, s });
      if (s > alpha) alpha = s;
    }
    // a partial deeper pass is discarded, except at depth 1 where it is all we have
    if (S.abort && d > 1) break;
    let bestV = -Infinity;
    for (const x of scored) {
      const v = x.s + (Math.abs(x.s) > MATE / 2 ? 0 : rand() * L.noise);
      if (v > bestV) { bestV = v; best = x.m; }
    }
    if (S.abort) break;
    ordered = order(p, legal, best);
  }
  return best;
}

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

export const BOARD = { x: 18, y: 18, s: 55.5 };
const PANEL = { x: 476, y: 12, w: 154, h: 456 };
export const MAX_FULL = 120;
export const RESIGN_BTN = { x: PANEL.x + 10, y: PANEL.y + PANEL.h - 50, w: PANEL.w - 20, h: 40 };

const meta: GameModule['meta'] = {
  id: 'catur', title: 'Catur Kantor', place: 'arcade', music: 'calm',
  blurb: 'Catur lawan rekan tim, tiga tingkat kesulitan.',
  view: { w: 640, h: 480 }, score: { unit: 'poin', higherIsBetter: true }, touch: ['left', 'up', 'down', 'right', 'a', 'b', 'y'],
  tutorial: [
    'Pilih tingkat lawan, lalu gerakkan kursor dengan {arah}.',
    'Tekan {a} pada bidak, lalu {a} lagi di petak tujuan. {b} untuk batal.',
    'Titik hijau menandai langkah yang sah. Tahan {y} untuk menyerah.',
  ],
  legend: [['arah', 'Kursor'], ['a', 'Pilih / taruh'], ['b', 'Batal'], ['y', 'Menyerah']],
  actions: { arah: 'Gerakkan kursor', a: 'Pilih / taruh bidak', b: 'Batal', y: 'Menyerah (tahan atau 2x)' },
  pointerHint: 'Ketuk bidak lalu ketuk petak tujuan, atau seret bidak ke petak tujuan',
  players: 2,
  playersHint: 'Berdua: Pemain 1 memegang putih, Pemain 2 memegang hitam dengan stik kedua. Bergantian di papan yang sama.',
};

type Phase = 'menu' | 'play' | 'promo' | 'over';
interface Anim { piece: number; from: number; to: number; t: number; dur: number; rook: { from: number; to: number } | null }
interface Pop { piece: number; sq: number; t: number }
interface Chip { x: number; y: number; vx: number; vy: number; life: number; c: string }

const ease = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);
export const sqXY = (s: number) => ({ x: BOARD.x + (s & 7) * BOARD.s + BOARD.s / 2, y: BOARD.y + (s >> 3) * BOARD.s + BOARD.s / 2 });
const sqAt = (x: number, y: number) => {
  const c = Math.floor((x - BOARD.x) / BOARD.s), r = Math.floor((y - BOARD.y) / BOARD.s);
  return c >= 0 && c < 8 && r >= 0 && r < 8 ? r * 8 + c : -1;
};
const inRect = (x: number, y: number, b: { x: number; y: number; w: number; h: number }) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
export const menuBoxes = () => [0, 1, 2].map((i) => ({ x: BOARD.x + 40, y: BOARD.y + 150 + i * 84, w: BOARD.s * 8 - 80, h: 72 }));

/** Full score for a win after `fullMoves` of white; draws get half, losses 0. */
export function winScore(fullMoves: number, level: Level): number {
  return Math.round(Math.max(100, 1000 - fullMoves * 5) * LEVELS[level].mult);
}

function create(ctx: GameCtx): GameInstance {
  const { g, w, h } = ctx;
  const team = ctx.cast.filter((c) => c.id !== ctx.playerId && c.id !== 'CH-CEO');
  const opp: CastMember = team[Math.floor(ctx.rand() * team.length)] ?? ctx.cast[0];
  const me = ctx.cast.find((c) => c.id === ctx.playerId) ?? ctx.cast[0];

  // Local multiplayer: white is Pemain 1, black is Pemain 2, no computer.
  const versus = ctx.players >= 2;
  let phase: Phase = versus ? 'play' : 'menu';
  let level: Level = 1;
  let menuSel = 1;
  const pos = fromFEN(START_FEN);
  const history = new Map<string, number>();
  const bump = () => { const k = posKey(pos); history.set(k, (history.get(k) ?? 0) + 1); };
  bump();
  let legal = legalMoves(pos);
  let cursor = sqIndex('e2');
  /** Each side's cursor, so Pemain 2 starts on its own pieces. */
  const cursors: Record<number, number> = { 1: sqIndex('e2'), [-1]: sqIndex('e7') };
  const sideName = (side: number) => (side > 0 ? ctx.t('Pemain 1 (putih)') : ctx.t('Pemain 2 (hitam)'));
  let sel = -1;
  let last: Move | null = null;
  let anim: Anim | null = null;
  const pops: Pop[] = [];
  const chips: Chip[] = [];
  let aiTimer = 0;
  let promo: { moves: Move[]; idx: number } | null = null;
  let result: { score: number; won: boolean; draw: boolean; msg: string; sub: string } | null = null;
  let overT = 0;
  let ended = false;
  let time = 0;
  let repeatT = 0;
  let heldDir: Btn | null = null;
  let yHold = 0, resignArm = 0;
  // drag state: armed on press over an own piece, shown once the pointer moves away
  let drag: { from: number; x: number; y: number; show: boolean; wasSel: boolean } | null = null;
  let lastPtr: { x: number; y: number } | null = null;
  const captured: { white: number[]; black: number[] } = { white: [], black: [] };
  let flash = 0;
  let shake = 0;

  const lvlName = (l: number) => (l === 0 ? ctx.t('Mudah') : l === 1 ? ctx.t('Sedang') : ctx.t('Sulit'));
  const targetsOf = (s: number) => legal.filter((m) => m.f === s);
  const whiteMoves = () => (pos.turn > 0 ? pos.full - 1 : pos.full);
  const hud = () => {
    if (versus) { ctx.setHud(ctx.t('Langkah {n}/{max} · Giliran {who}', { n: Math.min(pos.full, MAX_FULL), max: MAX_FULL, who: sideName(pos.turn) })); return; }
    if (phase === 'menu') ctx.setHud(ctx.t('Pilih tingkat'));
    else ctx.setHud(ctx.t('Langkah {n}/{max} · {lvl}', { n: Math.min(pos.full, MAX_FULL), max: MAX_FULL, lvl: lvlName(level) }));
  };
  hud();

  function startGame(l: Level) {
    level = l;
    menuSel = l;
    phase = 'play';
    ctx.sfx('start');
    hud();
  }

  function finish(won: boolean, draw: boolean, msg: string, sub: string) {
    const full = winScore(Math.max(1, whiteMoves()), level);
    const score = won ? full : draw ? Math.round(full / 2) : 0;
    result = { score, won, draw, msg, sub };
    phase = 'over';
    overT = 0;
    sel = -1; promo = null; drag = null;
    ctx.sfx(won ? 'win' : draw ? 'confirm' : 'lose');
    hud();
  }

  function applyMove(m: Move, byPlayer: boolean) {
    const piece = pos.b[m.f];
    cursors[pos.turn] = m.t;
    const capSq = m.fl & F_EP ? m.t + (pos.turn > 0 ? 8 : -8) : m.t;
    const cap = pos.b[capSq];
    makeMove(pos, m);
    bump();
    last = m;
    const rook = m.fl & F_CASTLE ? (m.t > m.f ? { from: m.f + 3, to: m.f + 1 } : { from: m.f - 4, to: m.f - 1 }) : null;
    anim = { piece: m.p ? Math.sign(piece) * m.p : piece, from: m.f, to: m.t, t: 0, dur: ctx.reducedMotion ? 0.08 : 0.22, rook };
    if (cap) {
      pops.push({ piece: cap, sq: capSq, t: 0 });
      (cap > 0 ? captured.white : captured.black).push(Math.abs(cap));
      if (!ctx.reducedMotion) {
        const c = sqXY(capSq);
        for (let i = 0; i < 10; i++) {
          const a = ctx.rand() * Math.PI * 2, sp = 60 + ctx.rand() * 120;
          chips.push({ x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: 0.5, c: cap > 0 ? '#fbf4e4' : '#3a2f25' });
        }
        shake = 0.12;
      }
      ctx.sfx('pop', { rate: 0.9 + ctx.rand() * 0.2 });
    }
    ctx.sfx('clack', { rate: byPlayer ? 1 : 0.85 });
    if (rook) ctx.sfx('clack', { rate: 1.2 });
    if (m.p) ctx.sfx('power');
    legal = legalMoves(pos);
    sel = -1;
    const out = outcome(pos, history);
    if (out) {
      if (out.kind === 'mate' && versus) {
        finish(true, false, ctx.t('Skakmat! {who} menang', { who: sideName(out.winner) }), '');
      } else if (out.kind === 'mate') {
        const wonMe = out.winner > 0;
        finish(wonMe, false, wonMe ? ctx.t('Skakmat! Kamu menang') : ctx.t('Skakmat, {n} menang', { n: opp.name }), '');
      } else {
        const sub = out.kind === 'stalemate' ? ctx.t('Tidak ada langkah legal (stalemate)') : out.kind === 'fifty' ? ctx.t('Aturan 50 langkah') : out.kind === 'material' ? ctx.t('Material tidak cukup untuk skakmat') : ctx.t('Posisi berulang 3 kali');
        finish(false, true, ctx.t('Remis'), sub);
      }
      return;
    }
    if (pos.full > MAX_FULL) {
      const d = material(pos);
      const sub = ctx.t('Batas {n} langkah, dinilai dari material', { n: MAX_FULL });
      if (versus) finish(d !== 0, d === 0, d ? ctx.t('{who} unggul material', { who: sideName(Math.sign(d)) }) : ctx.t('Remis'), sub);
      else if (d > 0) finish(true, false, ctx.t('Kamu unggul material'), sub);
      else if (d < 0) finish(false, false, ctx.t('{n} unggul material', { n: opp.name }), sub);
      else finish(false, true, ctx.t('Remis'), sub);
      return;
    }
    if (inCheck(pos)) { ctx.sfx('beep', { rate: 0.8 }); flash = 0.25; }
    if (pos.turn < 0) aiTimer = 0.35 + ctx.rand() * 0.3;
    if (versus) cursor = cursors[pos.turn];
    hud();
  }

  function tryMoveTo(to: number): boolean {
    if (sel < 0) return false;
    const ms = legal.filter((m) => m.f === sel && m.t === to);
    if (!ms.length) return false;
    if (ms.length > 1) {
      promo = { moves: ms, idx: 0 };
      phase = 'promo';
      cursor = to;
      ctx.sfx('ui');
      return true;
    }
    applyMove(ms[0], true);
    return true;
  }

  function pressSquare(s: number) {
    cursor = s;
    if (pos.turn < 0 && !versus) return;
    if (sel >= 0 && s === sel) { sel = -1; ctx.sfx('back'); return; }
    if (sel >= 0 && tryMoveTo(s)) return;
    if (pos.b[s] * pos.turn > 0) {
      if (targetsOf(s).length) { sel = s; ctx.sfx('ui'); }
      else { sel = -1; ctx.sfx('wrong'); shake = ctx.reducedMotion ? 0 : 0.08; }
      return;
    }
    if (sel >= 0) { ctx.sfx('back'); sel = -1; }
  }

  function resign() {
    if (versus) { finish(true, false, ctx.t('{who} menyerah', { who: sideName(pos.turn) }), ctx.t('{who} menang', { who: sideName(-pos.turn) })); return; }
    finish(false, false, ctx.t('Kamu menyerah'), ctx.t('{n} menang', { n: opp.name }));
  }

  function promoBoxes() {
    if (!promo) return [];
    const c = sqXY(promo.moves[0].t);
    return promo.moves.map((m, i) => ({ m, x: c.x - BOARD.s / 2, y: BOARD.y + i * BOARD.s, w: BOARD.s, h: BOARD.s }));
  }

  function choosePromo(m: Move) { promo = null; phase = 'play'; applyMove(m, true); }

  /** Pointer press (tap). Used for mouse, touch and by the headless harness. */
  function press(x: number, y: number, inp: InputState) {
    if (phase === 'menu') {
      const i = menuBoxes().findIndex((b) => inRect(x, y, b));
      if (i >= 0) startGame(i as Level);
      return;
    }
    if (phase === 'over') { if (overT > 0.5) doEnd(); return; }
    if (phase === 'promo') {
      const box = promoBoxes().find((b) => inRect(x, y, b));
      if (box) choosePromo(box.m);
      else { promo = null; phase = 'play'; ctx.sfx('back'); }
      return;
    }
    if (inRect(x, y, RESIGN_BTN)) {
      if (resignArm > 0) resign();
      else { resignArm = 2; ctx.sfx('ui'); }
      return;
    }
    const s = sqAt(x, y);
    if (s < 0) return;
    // pressing the selected piece again with a pointer may start a drag, so wait for release to deselect
    if (inp.ptr && s === sel && (versus || pos.turn > 0)) { drag = { from: s, x, y, show: false, wasSel: true }; cursor = s; return; }
    pressSquare(s);
    if (inp.ptr && sel === s) drag = { from: s, x, y, show: false, wasSel: false };
  }

  function release(x: number, y: number) {
    const d = drag;
    drag = null;
    if (!d || phase !== 'play') return;
    const s = sqAt(x, y);
    if (!d.show || s === d.from || s < 0) {
      if (d.wasSel && !d.show) { sel = -1; ctx.sfx('back'); }
      return;
    }
    if (sel === d.from && !tryMoveTo(s)) ctx.sfx('back');
  }

  function doEnd() {
    if (ended || !result) return;
    ended = true;
    if (versus) { ctx.end({ score: 0, versus: true, won: true, summary: result.sub ? `${result.msg}. ${result.sub}` : result.msg }); return; }
    ctx.end({ score: result.score, won: result.won, summary: result.sub ? `${result.msg}. ${result.sub}` : result.msg });
  }

  function dirHit(inp: InputState, dt: number): Btn | null {
    const dirs: Btn[] = ['left', 'right', 'up', 'down'];
    const hit = dirs.find((d) => inp.hit[d]);
    if (hit) { heldDir = hit; repeatT = 0.26; return hit; }
    let held: Btn | null = dirs.find((d) => inp.down[d]) ?? null;
    if (!held && Math.hypot(inp.ax, inp.ay) > 0.55) held = Math.abs(inp.ax) > Math.abs(inp.ay) ? (inp.ax > 0 ? 'right' : 'left') : (inp.ay > 0 ? 'down' : 'up');
    if (!held) { heldDir = null; return null; }
    if (held !== heldDir) { heldDir = held; repeatT = 0.26; return held; }
    repeatT -= dt;
    if (repeatT <= 0) { repeatT = 0.09; return held; }
    return null;
  }

  return {
    update(dt, inp0) {
      // versus: black moves with Pemain 2's pad; taps and drags on the shared
      // screen act for whichever side is to move
      const p2 = inp0.players?.[1];
      const inp: InputState = versus && pos.turn < 0 && p2 ? { ...p2, tap: inp0.tap, ptr: inp0.ptr } : inp0;
      time += dt;
      flash = Math.max(0, flash - dt);
      shake = Math.max(0, shake - dt);
      resignArm = Math.max(0, resignArm - dt);
      if (anim) { anim.t += dt; if (anim.t >= anim.dur + 0.12) anim = null; }
      for (const p of pops) p.t += dt;
      while (pops.length && pops[0].t > 0.35) pops.shift();
      for (const c of chips) { c.life -= dt; c.x += c.vx * dt; c.y += c.vy * dt; c.vy += 420 * dt; }
      for (let i = chips.length - 1; i >= 0; i--) if (chips[i].life <= 0) chips.splice(i, 1);

      const dir = dirHit(inp, dt);
      const ptr = inp.ptr ?? null;

      if (phase === 'menu') {
        if (dir === 'up' || dir === 'left') { menuSel = (menuSel + 2) % 3; ctx.sfx('click'); }
        if (dir === 'down' || dir === 'right') { menuSel = (menuSel + 1) % 3; ctx.sfx('click'); }
        if (inp.hit.a) startGame(menuSel as Level);
        else if (inp.tap) press(inp.tap.x, inp.tap.y, inp);
        return;
      }

      if (phase === 'over') {
        overT += dt;
        if ((inp.hit.a || inp.hit.b) && overT > 0.5) doEnd();
        else if (inp.tap) press(inp.tap.x, inp.tap.y, inp);
        if (overT > 4) doEnd();
        return;
      }

      if (phase === 'promo' && promo) {
        const n = promo.moves.length;
        if (dir === 'up' || dir === 'left') { promo.idx = (promo.idx + n - 1) % n; ctx.sfx('click'); }
        if (dir === 'down' || dir === 'right') { promo.idx = (promo.idx + 1) % n; ctx.sfx('click'); }
        if (inp.hit.a) { choosePromo(promo.moves[promo.idx]); return; }
        if (inp.hit.b) { promo = null; phase = 'play'; ctx.sfx('back'); return; }
        if (inp.tap) press(inp.tap.x, inp.tap.y, inp);
        return;
      }

      // resign: hold Y for one second, or press Y twice within two seconds
      if (inp.hit.y) {
        if (resignArm > 0) { resign(); return; }
        resignArm = 2;
        ctx.sfx('ui');
      }
      yHold = inp.down.y ? yHold + dt : 0;
      if (yHold >= 1) { resign(); return; }

      if (dir) {
        const r = cursor >> 3, c = cursor & 7;
        const nr = Math.max(0, Math.min(7, r + (dir === 'down' ? 1 : dir === 'up' ? -1 : 0)));
        const nc = Math.max(0, Math.min(7, c + (dir === 'right' ? 1 : dir === 'left' ? -1 : 0)));
        if (nr * 8 + nc !== cursor) { cursor = nr * 8 + nc; ctx.sfx('click', { rate: 1.3 }); }
      }
      if (inp.hit.a) pressSquare(cursor);
      if (inp.hit.b && sel >= 0) { sel = -1; ctx.sfx('back'); }
      if (inp.tap) press(inp.tap.x, inp.tap.y, inp);
      if (phase !== 'play') return;

      if (drag) {
        if (ptr && ptr.down) {
          drag.x = ptr.x; drag.y = ptr.y;
          const o = sqXY(drag.from);
          if (!drag.show && Math.hypot(ptr.x - o.x, ptr.y - o.y) > 12) drag.show = true;
          lastPtr = { x: ptr.x, y: ptr.y };
        } else {
          const at = ptr ?? lastPtr ?? { x: drag.x, y: drag.y };
          release(at.x, at.y);
        }
      }
      if (phase !== 'play') return;

      if (pos.turn < 0 && !versus) {
        aiTimer -= dt;
        if (aiTimer <= 0 && !anim) {
          const m = aiMove(pos, level, ctx.rand);
          if (m) applyMove(m, false);
        }
      }
    },

    render() {
      g.save();
      if (shake > 0 && !ctx.reducedMotion) g.translate(Math.sin(time * 90) * 3 * shake / 0.12, 0);
      g.fillStyle = PAL.bg;
      g.fillRect(-10, -10, w + 20, h + 20);
      drawBoard();
      drawPanel();
      if (phase === 'menu') drawMenu();
      if (phase === 'promo') drawPromo();
      if (phase === 'over') drawOver();
      g.restore();
    },

    snapshot: () => ({
      phase, versus, level, menuSel, opp: opp.id, turn: pos.turn, full: pos.full, fen: toFEN(pos), sel, cursor,
      legal: (pos.turn > 0 || versus) && phase === 'play' ? legal.map(uci) : [],
      last: last ? uci(last) : null, result: result ? { score: result.score, won: result.won, draw: result.draw, msg: result.msg } : null,
      ended, promo: promo ? promo.moves.map(uci) : null, promoIdx: promo?.idx ?? -1, resignArm: resignArm > 0, dragging: !!drag?.show,
    }),
  };

  // ------------------------------------------------------------------ drawing

  function drawBoard() {
    const { x, y, s } = BOARD;
    g.fillStyle = 'rgba(0,0,0,0.12)';
    roundRect(g, x - 8, y - 4, s * 8 + 16, s * 8 + 16, 12);
    g.fillStyle = '#6b4a32';
    roundRect(g, x - 10, y - 10, s * 8 + 20, s * 8 + 20, 12);
    const checkSq = phase !== 'menu' && inCheck(pos) ? pos.king[sideIdx(pos.turn)] : -1;
    for (let sq = 0; sq < 64; sq++) {
      const r = sq >> 3, c = sq & 7;
      const light = (r + c) % 2 === 0;
      const sx = x + c * s, sy = y + r * s;
      g.fillStyle = light ? '#f3e3c3' : '#b98a5e';
      g.fillRect(sx, sy, s + 0.5, s + 0.5);
      if (last && (sq === last.f || sq === last.t)) { g.fillStyle = 'rgba(217,164,65,0.5)'; g.fillRect(sx, sy, s, s); }
      if (sq === sel) { g.fillStyle = 'rgba(31,77,58,0.42)'; g.fillRect(sx, sy, s, s); }
      if (sq === checkSq) {
        const cx = sx + s / 2, cy = sy + s / 2;
        const gr = g.createRadialGradient(cx, cy, 4, cx, cy, s * 0.7);
        gr.addColorStop(0, 'rgba(184,69,46,0.95)');
        gr.addColorStop(1, 'rgba(184,69,46,0)');
        g.fillStyle = gr;
        g.fillRect(sx, sy, s, s);
      }
      if (c === 0) text(g, String(8 - r), sx + 7, sy + 10, 12, light ? '#9a714c' : '#f3e3c3', 'center', 800);
      if (r === 7) text(g, 'abcdefgh'[c], sx + s - 7, sy + s - 9, 12, light ? '#9a714c' : '#f3e3c3', 'center', 800);
    }
    if (sel >= 0 && (phase === 'play' || phase === 'promo')) {
      for (const m of targetsOf(sel)) {
        const p = sqXY(m.t);
        if (m.fl & F_CAP) {
          g.strokeStyle = 'rgba(31,77,58,0.75)'; g.lineWidth = 5;
          g.beginPath(); g.arc(p.x, p.y, s * 0.44, 0, Math.PI * 2); g.stroke();
        } else {
          g.fillStyle = 'rgba(31,77,58,0.55)';
          g.beginPath(); g.arc(p.x, p.y, s * 0.15, 0, Math.PI * 2); g.fill();
        }
      }
    }
    const k = anim ? ease(anim.t / anim.dur) : 1;
    for (let sq = 0; sq < 64; sq++) {
      const v = pos.b[sq];
      if (!v) continue;
      if (anim && sq === anim.to) continue;
      if (drag?.show && sq === drag.from) continue;
      const p = sqXY(sq);
      let px = p.x, py = p.y;
      if (anim?.rook && sq === anim.rook.to && anim.t < anim.dur) {
        const o = sqXY(anim.rook.from);
        px = o.x + (p.x - o.x) * k; py = o.y + (p.y - o.y) * k;
      }
      const lift = sq === sel && !ctx.reducedMotion ? -3 - Math.sin(time * 6) * 2 : 0;
      drawPiece(g, Math.abs(v), v > 0, px, py + lift, s, 1);
    }
    for (const p of pops) {
      const c = sqXY(p.sq);
      const q = p.t / 0.35;
      g.save();
      g.globalAlpha = Math.max(0, 1 - q);
      drawPiece(g, Math.abs(p.piece), p.piece > 0, c.x, c.y - q * 10, s * (1 + q * 0.5), 1);
      g.restore();
    }
    if (anim) {
      const a = sqXY(anim.from), b = sqXY(anim.to);
      const arc = ctx.reducedMotion ? 0 : Math.sin(Math.min(1, anim.t / anim.dur) * Math.PI) * 8;
      const land = anim.t > anim.dur ? (anim.t - anim.dur) / 0.12 : -1;
      const squash = land >= 0 && !ctx.reducedMotion ? 1 - Math.sin(Math.min(1, land) * Math.PI) * 0.1 : 1;
      drawPiece(g, Math.abs(anim.piece), anim.piece > 0, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k - arc, s, squash);
    }
    for (const c of chips) { g.globalAlpha = Math.max(0, c.life / 0.5); g.fillStyle = c.c; g.fillRect(c.x - 2, c.y - 2, 4, 4); }
    g.globalAlpha = 1;
    if (drag?.show && pos.b[drag.from]) {
      const v = pos.b[drag.from];
      const over = sqAt(drag.x, drag.y);
      if (over >= 0) {
        const o = sqXY(over);
        g.strokeStyle = 'rgba(31,77,58,0.8)'; g.lineWidth = 3;
        g.strokeRect(o.x - s / 2 + 2, o.y - s / 2 + 2, s - 4, s - 4);
      }
      drawPiece(g, Math.abs(v), v > 0, drag.x, drag.y - 8, s * 1.15, 1);
    }
    if (phase === 'play' || phase === 'promo') {
      const c = cursor & 7, r = cursor >> 3;
      const pulse = ctx.reducedMotion ? 0 : Math.sin(time * 7) * 1.5;
      g.strokeStyle = pos.turn > 0 ? PAL.blue : 'rgba(60,110,145,0.4)';
      g.lineWidth = 4;
      g.strokeRect(x + c * s + 3 - pulse, y + r * s + 3 - pulse, s - 6 + pulse * 2, s - 6 + pulse * 2);
    }
    if (flash > 0) { g.fillStyle = `rgba(184,69,46,${flash * 0.5})`; g.fillRect(x, y, s * 8, s * 8); }
  }

  function drawPanel() {
    const { x, y, w: pw, h: ph } = PANEL;
    g.fillStyle = 'rgba(0,0,0,0.08)';
    roundRect(g, x + 2, y + 4, pw, ph, 12);
    g.fillStyle = PAL.surface;
    roundRect(g, x, y, pw, ph, 12);
    const cx = x + pw / 2;
    g.fillStyle = PAL.sand;
    roundRect(g, x + 10, y + 10, pw - 20, 96, 10);
    const pose = result ? (result.won ? 'hurt' : result.draw ? 'idle' : 'win') : 'idle';
    drawChar(g, opp, cx, y + 102, 86, -1, pose, time);
    if (phase === 'play' && pos.turn < 0) {
      for (let i = 0; i < 3; i++) {
        const a = ctx.reducedMotion ? 0.8 : 0.35 + 0.65 * Math.max(0, Math.sin(time * 6 - i * 0.8));
        g.fillStyle = `rgba(29,42,35,${a})`;
        g.beginPath(); g.arc(cx + 32 + i * 10, y + 26, 3.6, 0, Math.PI * 2); g.fill();
      }
    }
    text(g, fit(versus ? ctx.t('Pemain 2') : opp.name, pw - 20, 20), cx, y + 122, 20, PAL.ink, 'center', 800);
    text(g, versus ? ctx.t('Hitam') : phase === 'menu' ? ctx.t('Lawan') : lvlName(level), cx, y + 143, 16, PAL.accent, 'center', 800);
    let status: string;
    let bg = PAL.sand, fg = PAL.ink;
    if (phase === 'menu') status = ctx.t('Pilih tingkat');
    else if (phase === 'over') status = result?.won ? ctx.t('Menang!') : result?.draw ? ctx.t('Remis') : ctx.t('Kalah');
    else if (phase === 'promo') status = ctx.t('Pilih promosi');
    else if (versus) { const chk = inCheck(pos); status = chk ? ctx.t('Skak! Giliran Pemain {n}', { n: pos.turn > 0 ? 1 : 2 }) : ctx.t('Giliran Pemain {n}', { n: pos.turn > 0 ? 1 : 2 }); bg = chk ? PAL.red : PAL.green; fg = PAL.surface; }
    else if (pos.turn > 0) { const chk = inCheck(pos); status = chk ? ctx.t('Skak! Giliranmu') : ctx.t('Giliranmu'); bg = chk ? PAL.red : PAL.green; fg = PAL.surface; }
    else status = ctx.t('{n} berpikir', { n: opp.name });
    g.fillStyle = bg;
    roundRect(g, x + 10, y + 158, pw - 20, 36, 8);
    text(g, fit(status, pw - 28, 17), cx, y + 176, 17, fg, 'center', 800);
    text(g, ctx.t('Langkah {n}/{max}', { n: Math.min(pos.full, MAX_FULL), max: MAX_FULL }), cx, y + 212, 16, PAL.ink2, 'center', 700);
    text(g, versus ? ctx.t('Tawanan putih') : ctx.t('Tawananmu'), x + 12, y + 236, 14, PAL.ink2, 'left', 700);
    drawCaptured(captured.black, false, x + 12, y + 256);
    text(g, versus ? ctx.t('Tawanan hitam') : ctx.t('Tawanan lawan'), x + 12, y + 282, 14, PAL.ink2, 'left', 700);
    drawCaptured(captured.white, true, x + 12, y + 302);
    const d = Math.round(material(pos) / 100);
    if (d) text(g, versus ? ctx.t('Pemain {p} +{n}', { p: d > 0 ? 1 : 2, n: Math.abs(d) }) : d > 0 ? ctx.t('Kamu +{n}', { n: d }) : ctx.t('Lawan +{n}', { n: -d }), cx, y + 328, 15, d > 0 ? PAL.green : PAL.red, 'center', 800);
    if (last) text(g, ctx.t('Terakhir: {m}', { m: `${sqName(last.f)} ${sqName(last.t)}` }), cx, y + 350, 14, PAL.ink2, 'center', 700);
    drawChar(g, me, x + 24, y + 396, 36, 1, result?.won ? 'win' : 'idle', time);
    text(g, versus ? ctx.t('Pemain 1: putih') : ctx.t('Kamu: putih'), x + 44, y + 380, 15, PAL.ink, 'left', 800);
    if (phase === 'play' || phase === 'promo') {
      const armed = resignArm > 0;
      const b = RESIGN_BTN;
      g.fillStyle = armed ? PAL.red : '#e6d6b8';
      roundRect(g, b.x, b.y, b.w, b.h, 9);
      if (yHold > 0) { g.fillStyle = 'rgba(184,69,46,0.8)'; roundRect(g, b.x, b.y, Math.max(18, b.w * Math.min(1, yHold)), b.h, 9); }
      text(g, fit(armed ? ctx.t('Yakin? Sekali lagi') : ctx.t('Menyerah'), b.w - 12, 16), b.x + b.w / 2, b.y + b.h / 2, 16, armed || yHold > 0.3 ? PAL.surface : PAL.ink, 'center', 800);
    }
  }

  function fit(s: string, maxW: number, size: number): string {
    g.font = `800 ${size}px 'Alegreya Sans', system-ui, sans-serif`;
    if (g.measureText(s).width <= maxW) return s;
    let t = s;
    while (t.length > 3 && g.measureText(t + '...').width > maxW) t = t.slice(0, -1);
    return t + '...';
  }

  function drawCaptured(list: number[], white: boolean, x0: number, y0: number) {
    const sorted = [...list].sort((a, b) => b - a);
    const step = sorted.length > 8 ? 120 / sorted.length : 15;
    sorted.forEach((t, i) => drawPiece(g, t, white, x0 + 8 + i * step, y0, 24, 1));
  }

  function drawMenu() {
    const { x, y, s } = BOARD;
    g.fillStyle = 'rgba(29,42,35,0.62)';
    g.fillRect(x, y, s * 8, s * 8);
    g.fillStyle = PAL.surface;
    roundRect(g, x + 20, y + 20, s * 8 - 40, s * 8 - 40, 16);
    text(g, ctx.t('Catur Kantor'), x + s * 4, y + 62, 32, PAL.green, 'center', 800);
    text(g, ctx.t('Lawan: {n}', { n: opp.name }), x + s * 4, y + 96, 19, PAL.ink, 'center', 700);
    text(g, ctx.t('Kamu main putih, jalan duluan'), x + s * 4, y + 122, 16, PAL.ink2, 'center', 700);
    const desc = [ctx.t('Santai, kadang ceroboh'), ctx.t('Berpikir 2 sampai 3 langkah'), ctx.t('Berpikir dalam, poin x2')];
    menuBoxes().forEach((b, i) => {
      const on = i === menuSel;
      g.fillStyle = on ? PAL.green : PAL.sand;
      roundRect(g, b.x, b.y, b.w, b.h, 12);
      text(g, lvlName(i), b.x + 18, b.y + 25, 23, on ? PAL.surface : PAL.ink, 'left', 800);
      text(g, desc[i], b.x + 18, b.y + 51, 16, on ? '#d8e6dc' : PAL.ink2, 'left', 700);
      text(g, `x${LEVELS[i].mult}`, b.x + b.w - 18, b.y + b.h / 2, 21, on ? PAL.gold : PAL.accent, 'right', 800);
    });
  }

  function drawPromo() {
    const boxes = promoBoxes();
    if (!boxes.length || !promo) return;
    g.fillStyle = 'rgba(29,42,35,0.45)';
    g.fillRect(BOARD.x, BOARD.y, BOARD.s * 8, BOARD.s * 8);
    const b0 = boxes[0];
    g.fillStyle = 'rgba(0,0,0,0.25)';
    roundRect(g, b0.x - 4, b0.y - 2, b0.w + 8, b0.h * boxes.length + 8, 10);
    boxes.forEach((b, i) => {
      g.fillStyle = i === promo!.idx ? PAL.gold : PAL.surface;
      roundRect(g, b.x - 2, b.y + 2, b.w + 4, b.h - 4, 8);
      drawPiece(g, b.m.p, true, b.x + b.w / 2, b.y + b.h / 2, BOARD.s, 1);
    });
    const right = b0.x + b0.w + 200 < BOARD.x + BOARD.s * 8;
    const lx = right ? b0.x + b0.w + 12 : b0.x - 12;
    const al: CanvasTextAlign = right ? 'left' : 'right';
    text(g, ctx.t('Promosi: pilih bidak'), lx, b0.y + 26, 18, PAL.surface, al, 800);
    text(g, ctx.t('{a} pilih, {b} batal', { a: ctx.key('a'), b: ctx.key('b') }), lx, b0.y + 50, 15, '#e7dccb', al, 700);
  }

  function drawOver() {
    if (!result) return;
    const { x, y, s } = BOARD;
    const k = ease(overT / 0.35);
    g.fillStyle = `rgba(29,42,35,${0.55 * k})`;
    g.fillRect(x, y, s * 8, s * 8);
    g.save();
    g.translate(x + s * 4, y + s * 4);
    const sc = 0.85 + 0.15 * k;
    g.scale(sc, sc);
    g.globalAlpha = k;
    g.fillStyle = PAL.surface;
    roundRect(g, -195, -92, 390, 184, 16);
    text(g, fit(result.msg, 360, 28), 0, -48, 28, result.won ? PAL.green : result.draw ? PAL.blue : PAL.red, 'center', 800);
    if (result.sub) text(g, fit(result.sub, 360, 17), 0, -14, 17, PAL.ink2, 'center', 700);
    text(g, ctx.t('{n} poin', { n: result.score }), 0, 24, 28, PAL.ink, 'center', 800);
    text(g, ctx.t('Tekan {a} untuk lanjut', { a: ctx.key('a') }), 0, 62, 15, PAL.ink2, 'center', 700);
    g.restore();
  }
}

// ---------------------------------------------------------------- piece art

/** Vector chess piece centred at (cx, cy) inside a square of `size`; `sy` squashes from the base. */
export function drawPiece(g: CanvasRenderingContext2D, t: number, white: boolean, cx: number, cy: number, size: number, sy = 1) {
  const u = size / 100;
  g.save();
  g.translate(cx, cy + 36 * u);
  g.scale(1 + (1 - sy) * 0.6, sy);
  g.translate(0, -36 * u);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.beginPath(); g.ellipse(0, 38 * u, 28 * u, 6 * u, 0, 0, Math.PI * 2); g.fill();
  const fill = white ? '#fbf4e4' : '#352b22';
  const edge = white ? '#3a2a1e' : '#0f0b08';
  const hi = white ? '#dcc6a0' : '#7a6650';
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const lw = Math.max(1, 2.8 * u);
  const set = () => { g.lineWidth = lw; g.strokeStyle = edge; g.fillStyle = fill; };
  set();
  const poly = (pts: number[]) => {
    g.beginPath();
    g.moveTo(pts[0] * u, pts[1] * u);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i] * u, pts[i + 1] * u);
    g.closePath();
    g.fill(); g.stroke();
  };
  const circ = (x: number, y: number, r: number) => { g.beginPath(); g.arc(x * u, y * u, r * u, 0, Math.PI * 2); g.fill(); g.stroke(); };
  const ell = (x: number, y: number, rx: number, ry: number) => { g.beginPath(); g.ellipse(x * u, y * u, rx * u, ry * u, 0, 0, Math.PI * 2); g.fill(); g.stroke(); };
  const base = () => {
    g.beginPath();
    const bx = -27 * u, by = 25 * u, bw = 54 * u, bh = 11 * u, r = 4 * u;
    g.moveTo(bx + r, by); g.arcTo(bx + bw, by, bx + bw, by + bh, r); g.arcTo(bx + bw, by + bh, bx, by + bh, r); g.arcTo(bx, by + bh, bx, by, r); g.arcTo(bx, by, bx + bw, by, r); g.closePath();
    g.fill(); g.stroke();
  };
  const shine = (x0: number, y0: number, x1: number, y1: number) => {
    g.strokeStyle = hi; g.lineWidth = Math.max(1, 2.4 * u);
    g.beginPath(); g.moveTo(x0 * u, y0 * u); g.lineTo(x1 * u, y1 * u); g.stroke();
    set();
  };
  if (t === P) {
    poly([-18, 27, -8, 0, 8, 0, 18, 27]);
    base();
    ell(0, 0, 14, 5);
    circ(0, -14, 13);
    shine(-6, -19, -3, -22);
  } else if (t === R) {
    poly([-18, 27, -15, -8, 15, -8, 18, 27]);
    base();
    poly([-21, -6, -21, -32, -13, -32, -13, -25, -4, -25, -4, -32, 4, -32, 4, -25, 13, -25, 13, -32, 21, -32, 21, -6]);
    shine(-10, 4, -10, 18);
  } else if (t === N) {
    base();
    poly([-16, 27, -10, 6, -22, 0, -28, -8, -24, -16, -12, -26, -8, -38, -1, -30, 10, -28, 19, -16, 22, 4, 20, 27]);
    g.fillStyle = edge;
    g.beginPath(); g.arc(-10 * u, -17 * u, 2.8 * u, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(-24 * u, -8 * u, 1.8 * u, 0, Math.PI * 2); g.fill();
    g.strokeStyle = hi; g.lineWidth = Math.max(1, 2.4 * u);
    g.beginPath(); g.moveTo(4 * u, -24 * u); g.quadraticCurveTo(15 * u, -10 * u, 13 * u, 18 * u); g.stroke();
    set();
  } else if (t === B) {
    poly([-17, 27, -7, 2, 7, 2, 17, 27]);
    base();
    ell(0, 2, 15, 5);
    g.beginPath();
    g.moveTo(0, -34 * u);
    g.bezierCurveTo(16 * u, -22 * u, 16 * u, -4 * u, 0, -2 * u);
    g.bezierCurveTo(-16 * u, -4 * u, -16 * u, -22 * u, 0, -34 * u);
    g.closePath(); g.fill(); g.stroke();
    circ(0, -37, 5);
    g.strokeStyle = edge; g.lineWidth = lw;
    g.beginPath(); g.moveTo(6 * u, -24 * u); g.lineTo(-3 * u, -13 * u); g.stroke();
  } else if (t === Q) {
    poly([-19, 27, -10, 0, 10, 0, 19, 27]);
    base();
    poly([-17, 2, -25, -24, -12, -12, -6, -30, 0, -14, 6, -30, 12, -12, 25, -24, 17, 2]);
    for (const [bx, by] of [[-25, -26], [-6, -32], [6, -32], [25, -26]]) circ(bx, by, 4.4);
    ell(0, 2, 17, 4.5);
    shine(-9, 10, -11, 20);
  } else {
    poly([-19, 27, -11, 0, 11, 0, 19, 27]);
    base();
    g.beginPath();
    g.moveTo(-17 * u, 0);
    g.bezierCurveTo(-25 * u, -20 * u, -6 * u, -26 * u, 0, -18 * u);
    g.bezierCurveTo(6 * u, -26 * u, 25 * u, -20 * u, 17 * u, 0);
    g.closePath(); g.fill(); g.stroke();
    poly([-3, -20, -3, -30, -9, -30, -9, -36, -3, -36, -3, -42, 3, -42, 3, -36, 9, -36, 9, -30, 3, -30, 3, -20]);
    ell(0, 1, 18, 4.5);
    shine(-9, 10, -11, 20);
  }
  g.restore();
}

export default { meta, create } satisfies GameModule;
