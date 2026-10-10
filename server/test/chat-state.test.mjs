import test from 'node:test';
import assert from 'node:assert/strict';
import { chatState, TYPING_WINDOW_MS } from '../chat-state.mjs';

const T = 1_800_000_000_000;
const owner = (id, at, extra = {}) => ({ id, role: 'owner', at, text: id, taskId: null, ...extra });
const agent = (id, at) => ({ id, role: 'agent', at, text: id, taskId: null });

test('centang: dibalas = read, menunggu agen = delivered, belum diambil = sent', () => {
  const turns = [owner('a', T), agent('b', T + 1000), owner('c', T + 2000, { taskId: 't1' }), owner('d', T + 3000, { pending: true, taskId: 't2' })];
  const s = chatState(turns, [{ id: 't1', status: 'working' }, { id: 't2', status: 'queued' }], T + 4000);
  assert.deepEqual(s.turns.map((t) => t.receipt ?? null), ['read', null, 'delivered', 'sent']);
  assert.equal(s.typing, true, 'tugas berjalan = mengetik');
  assert.equal(s.lastSeen, T + 1000);
});

test('mengetik dari pesan Telegram: pesan terakhir Budi masih segar, lalu padam setelah dibalas atau kedaluwarsa', () => {
  const turns = [agent('a', T), owner('b', T + 1000, { via: 'telegram' })];
  assert.equal(chatState(turns, [], T + 60_000).typing, true);
  assert.equal(chatState(turns, [], T + 1000 + TYPING_WINDOW_MS + 1).typing, false, 'tidak mengetik selamanya kalau bot macet');
  assert.equal(chatState([...turns, agent('c', T + 5000)], [], T + 6000).typing, false);
});

test('pesan sistem tidak memicu mengetik dan tidak diberi centang', () => {
  const s = chatState([agent('a', T), { id: 's', role: 'system', at: T + 10, text: '[Kanban]', taskId: null }], [], T + 20);
  assert.equal(s.typing, false);
  assert.equal(s.turns[1].receipt, undefined);
});
