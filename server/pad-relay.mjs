// pad-relay: rooms that pair one PC screen with up to 4 phone controllers
// (REQ-HP-05/06). Carries WebRTC signalling and, when no direct channel opens,
// the input itself. Dependency-free: hand-written RFC 6455 server, text frames
// only, no fragmentation. Nothing is stored or logged except live counts.
//   PAD_RELAY_PORT=8791 PAD_RELAY_ORIGINS=https://employee-rpg.air-buddy.site node pad-relay.mjs
import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_PHONES = 4;
export const MAX_MSG = 2048;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_ROOMS = 2000;
const RATE = 120; // tokens per second
const BURST = 240;
const ABUSE = BURST * 2; // drops since the bucket was last full before the socket is closed
const HEARTBEAT_MS = 30_000;
// Only these types pass; anything else is dropped so the relay cannot be used as a generic pipe.
const FROM_PHONE = new Set(['hello', 'ping', 'pong', 'offer', 'answer', 'ice', 'input', 'bye']);
const FROM_SCREEN = new Set(['seat', 'ping', 'pong', 'rumble', 'offer', 'answer', 'ice', 'bye']);
const utf8 = new TextDecoder('utf-8', { fatal: true });

export const acceptKey = (key) => crypto.createHash('sha1').update(key + GUID).digest('base64');

function frame(op, payload) {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | op, n]) : Buffer.from([0x80 | op, 126, n >> 8, n & 255]);
  return Buffer.concat([head, payload]);
}

function newCode(rooms) {
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
}

/** Start the relay. Resolves once listening; `port` is the bound port (0 picks a free one). */
export function start({ port = Number(process.env.PAD_RELAY_PORT || 8791), host = '127.0.0.1', idleMs = 30 * 60_000,
  origins = (process.env.PAD_RELAY_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean) } = {}) {
  const rooms = new Map(); // code -> { screen, phones: Map<id, conn>, last }
  const conns = new Set();

  const send = (c, obj) => { if (!c.closed) c.sock.write(frame(1, Buffer.from(JSON.stringify(obj)))); };

  function close(c, code = 1000) {
    if (c.closed) return;
    c.closed = true;
    const p = Buffer.alloc(2); p.writeUInt16BE(code);
    c.sock.end(frame(8, p));
    setTimeout(() => c.sock.destroy(), 1000).unref();
  }

  function gone(c) {
    if (c.gone) return;
    c.gone = true; c.closed = true;
    conns.delete(c);
    const r = c.room;
    if (!r) return;
    if (c.role === 'screen') {
      rooms.delete(r.code);
      for (const p of r.phones.values()) { send(p, { t: 'bye' }); close(p, 1000); }
    } else if (r.phones.delete(c.id)) send(r.screen, { t: 'phone-leave', from: c.id });
  }

  function onText(c, text) {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    const r = c.room;
    r.last = Date.now();
    if (c.role === 'phone') {
      if (!FROM_PHONE.has(m.t)) return;
      m.from = c.id; delete m.to;
      send(r.screen, m);
    } else {
      if (!FROM_SCREEN.has(m.t)) return;
      const to = m.to; delete m.to;
      for (const [id, p] of r.phones) if (to === undefined || to === id) send(p, m);
    }
  }

  function onFrame(c, op, data) {
    c.alive = true;
    if (op === 1) {
      let s;
      try { s = utf8.decode(data); } catch { return close(c, 1007); }
      onText(c, s);
    } else if (op === 8) close(c, data.length >= 2 ? data.readUInt16BE(0) : 1000);
    else if (op === 9) { if (!c.closed) c.sock.write(frame(10, data)); }
    else if (op === 10) { /* heartbeat answer */ }
    else close(c, 1003); // binary or reserved opcodes
  }

  // Token bucket per connection: excess frames are dropped, sustained abuse closes.
  function allow(c) {
    const now = performance.now();
    c.tokens = Math.min(BURST, c.tokens + ((now - c.at) / 1000) * RATE);
    c.at = now;
    if (c.tokens >= BURST - 1) c.dropped = 0;
    if (c.tokens >= 1) { c.tokens -= 1; return true; }
    if (++c.dropped > ABUSE) close(c, 1008);
    return false;
  }

  function onData(c, chunk) {
    c.buf = c.buf.length ? Buffer.concat([c.buf, chunk]) : chunk;
    while (!c.closed) {
      const b = c.buf;
      if (b.length < 2) return;
      const fin = b[0] & 0x80, rsv = b[0] & 0x70, op = b[0] & 0x0f, masked = b[1] & 0x80;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = b.readUInt32BE(2) ? Infinity : b.readUInt32BE(6); off = 10; }
      if (rsv || !masked) return close(c, 1002); // clients must mask (RFC 6455 5.1)
      if (len > MAX_MSG) return close(c, 1009);
      if (!fin || op === 0) return close(c, 1003); // fragmented messages are not supported
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const data = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      c.buf = b.subarray(off + 4 + len);
      if (op === 8 || allow(c)) onFrame(c, op, data); // a close always gets through
    }
  }

  function reject(sock, status) {
    sock.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }

  function onUpgrade(req, sock, head) {
    sock.on('error', () => {});
    const u = new URL(req.url, 'http://x');
    const key = req.headers['sec-websocket-key'];
    if (u.pathname !== '/pad-relay' || req.method !== 'GET' || (req.headers.upgrade || '').toLowerCase() !== 'websocket'
      || typeof key !== 'string' || req.headers['sec-websocket-version'] !== '13') return reject(sock, '400 Bad Request');
    if (origins.length && !origins.includes(req.headers.origin)) return reject(sock, '403 Forbidden');
    const role = u.searchParams.get('role');
    if (role !== 'screen' && role !== 'phone') return reject(sock, '400 Bad Request');
    sock.setNoDelay(true);
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
    const c = { sock, role, buf: Buffer.alloc(0), tokens: BURST, at: performance.now(), dropped: 0, closed: false, gone: false, alive: true, room: null, id: '' };
    conns.add(c);
    sock.on('data', (d) => onData(c, d));
    sock.on('close', () => gone(c));
    sock.on('end', () => gone(c));
    if (head?.length) onData(c, head);
    if (c.closed) return;
    if (role === 'screen') {
      if (rooms.size >= MAX_ROOMS) { send(c, { t: 'refused', reason: 'busy' }); return close(c, 1013); }
      const code = newCode(rooms);
      c.room = { code, screen: c, phones: new Map(), last: Date.now() };
      rooms.set(code, c.room);
      return send(c, { t: 'room', code });
    }
    const code = (u.searchParams.get('code') || '').toUpperCase();
    const r = rooms.get(code);
    const reason = !/^[A-Z2-9]{6}$/.test(code) ? 'bad-code' : !r ? 'no-room' : r.phones.size >= MAX_PHONES ? 'full' : '';
    if (reason) { send(c, { t: 'refused', reason }); return close(c, 4000); }
    let id;
    do id = 'p' + crypto.randomBytes(3).toString('hex'); while (r.phones.has(id));
    c.id = id; c.room = r; r.phones.set(id, c); r.last = Date.now();
    send(c, { t: 'joined', id });
    send(r.screen, { t: 'phone-join', from: id });
  }

  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (req.method === 'GET' && path === '/pad-relay/health') {
      let phones = 0;
      for (const r of rooms.values()) phones += r.phones.size;
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, rooms: rooms.size, phones }));
    }
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  });
  server.on('upgrade', onUpgrade);

  const beat = setInterval(() => {
    for (const c of conns) {
      if (!c.alive) { c.sock.destroy(); continue; }
      c.alive = false;
      if (!c.closed) c.sock.write(frame(9, Buffer.alloc(0)));
    }
  }, HEARTBEAT_MS);
  beat.unref();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const r of rooms.values()) if (now - r.last > idleMs) close(r.screen, 1001);
  }, Math.max(50, Math.min(60_000, idleMs / 4)));
  sweep.unref();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve({
      server,
      port: server.address().port,
      stats: () => ({ rooms: rooms.size, conns: conns.size }),
      close: () => new Promise((done) => {
        clearInterval(beat); clearInterval(sweep);
        for (const c of conns) c.sock.destroy();
        server.close(() => done());
      }),
    }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().then((s) => console.log(`pad-relay listening on 127.0.0.1:${s.port}`), (e) => { console.error(e.message); process.exit(1); });
}
