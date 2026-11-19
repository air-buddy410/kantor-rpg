// pad-relay (REQ-HP-05/06): handshake, rooms, forwarding, limits, health.
// Uses the global WebSocket client (Node 22+) and raw sockets for framing cases.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import crypto from 'node:crypto';
import { start, acceptKey, CODE_ALPHABET } from '../pad-relay.mjs';

let relay; let url;
before(async () => { relay = await start({ port: 0, idleMs: 1500 }); url = `ws://127.0.0.1:${relay.port}/pad-relay`; });
after(() => relay.close());

/** WebSocket with a message queue: next() waits for the next JSON message. */
function client(q) {
  const ws = new WebSocket(`${url}?${q}`);
  const box = []; const waiters = [];
  ws.closed = new Promise((res) => ws.addEventListener('close', (e) => res(e.code)));
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); const w = waiters.shift(); if (w) w(m); else box.push(m); });
  ws.next = (ms = 2000) => box.length ? Promise.resolve(box.shift()) : new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), ms);
    waiters.push((m) => { clearTimeout(t); res(m); });
  });
  ws.count = () => box.length;
  ws.opened = new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  return ws;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function screenAndPhone() {
  const s = client('role=screen');
  const room = await s.next();
  const p = client(`role=phone&code=${room.code}`);
  const joined = await p.next();
  const join = await s.next();
  return { s, p, code: room.code, id: joined.id, join };
}

test('handshake answers with the RFC 6455 accept key', async () => {
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  const key = crypto.randomBytes(16).toString('base64');
  const head = await new Promise((res, rej) => {
    const s = net.connect(relay.port, '127.0.0.1', () => s.write(`GET /pad-relay?role=screen HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    s.once('data', (d) => { res(d.toString('latin1')); s.destroy(); });
    s.on('error', rej);
  });
  assert.match(head, /^HTTP\/1.1 101/);
  assert.ok(head.includes(`Sec-WebSocket-Accept: ${acceptKey(key)}`));
});

test('screen gets a 6 character room code', async () => {
  const s = client('role=screen');
  const m = await s.next();
  assert.equal(m.t, 'room');
  assert.equal(m.code.length, 6);
  assert.ok([...m.code].every((c) => CODE_ALPHABET.includes(c)));
  s.close(); await s.closed;
});

test('phone joins and messages flow both ways', async () => {
  const { s, p, id, join } = await screenAndPhone();
  assert.equal(join.t, 'phone-join'); assert.equal(join.from, id);
  p.send(JSON.stringify({ t: 'input', p: ['i', 1, 1, 0, 0, 0, 0, 0, 0] }));
  assert.deepEqual(await s.next(), { t: 'input', p: ['i', 1, 1, 0, 0, 0, 0, 0, 0], from: id });
  s.send(JSON.stringify({ t: 'seat', n: 2, to: id }));
  assert.deepEqual(await p.next(), { t: 'seat', n: 2 });
  s.send(JSON.stringify({ t: 'evil', to: id })); // unknown types are dropped
  s.send(JSON.stringify({ t: 'rumble', ms: 80, strong: 1, weak: 0.5, to: id }));
  assert.equal((await p.next()).t, 'rumble');
  s.close(); await p.closed;
});

test('fifth phone is refused with a reason; a wrong code too', async () => {
  const s = client('role=screen');
  const { code } = await s.next();
  const phones = [];
  for (let i = 0; i < 4; i++) { const p = client(`role=phone&code=${code}`); assert.equal((await p.next()).t, 'joined'); phones.push(p); }
  const fifth = client(`role=phone&code=${code}`);
  assert.deepEqual(await fifth.next(), { t: 'refused', reason: 'full' });
  await fifth.closed;
  const wrong = client('role=phone&code=ZZZZZZ');
  assert.deepEqual(await wrong.next(), { t: 'refused', reason: 'no-room' });
  s.close();
  await Promise.all(phones.map((p) => p.closed));
});

test('oversize frame closes the connection with 1009', async () => {
  const s = client('role=screen');
  await s.next();
  s.send('x'.repeat(3000));
  assert.equal(await s.closed, 1009);
});

test('screen leaving sends bye to its phones and closes the room', async () => {
  const { s, p } = await screenAndPhone();
  s.close();
  assert.deepEqual(await p.next(), { t: 'bye' });
  await p.closed;
  await sleep(50);
  const h = await (await fetch(`http://127.0.0.1:${relay.port}/pad-relay/health`)).json();
  assert.equal(h.rooms, 0);
});

test('rate limit drops excess messages without closing a short burst', async () => {
  const { s, p } = await screenAndPhone();
  for (let i = 0; i < 400; i++) p.send(JSON.stringify({ t: 'ping', ts: i }));
  await sleep(300);
  const got = s.count();
  assert.ok(got >= 200 && got < 400, `forwarded ${got}`);
  assert.equal(p.readyState, WebSocket.OPEN);
  s.close(); await p.closed;
});

test('idle room is closed', async () => {
  const { s, p } = await screenAndPhone();
  assert.equal(await s.closed, 1001);
  await p.closed;
});

test('health endpoint counts rooms and phones', async () => {
  const { s, p } = await screenAndPhone();
  const res = await fetch(`http://127.0.0.1:${relay.port}/pad-relay/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, rooms: 1, phones: 1 });
  s.close(); await p.closed;
});
