// Notifikasi push (Tahap 2 "rasa Telegram"): Web Push standar (RFC 8291
// aes128gcm + VAPID RFC 8292) dengan node:crypto saja, tanpa layanan pihak
// ketiga selain push service bawaan browser. Isi notifikasi hanya nama bot +
// potongan pendek; teks lengkap tetap di balik login.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const b64u = (b) => Buffer.from(b).toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url');

/** VAPID key pair, generated once and kept in the data folder (0600). */
export function loadVapid(dataDir) {
  const file = path.join(dataDir, 'vapid.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  const ec = crypto.createECDH('prime256v1');
  ec.generateKeys();
  const v = { publicKey: b64u(ec.getPublicKey()), privateKey: b64u(ec.getPrivateKey()), subject: 'mailto:owner@employee-rpg.invalid' };
  fs.writeFileSync(file, JSON.stringify(v), { mode: 0o600 });
  return v;
}

function vapidJwt(audience, v, now) {
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: v.subject }));
  const pub = unb64u(v.publicKey);
  const key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: v.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${header}.${body}.${b64u(sig)}`;
}

const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));

/** RFC 8291 payload encryption (single record, aes128gcm). */
export function encryptPayload(sub, plaintext, { salt = crypto.randomBytes(16), ecdh } = {}) {
  const uaPub = unb64u(sub.keys.p256dh);
  const auth = unb64u(sub.keys.auth);
  const as = ecdh ?? crypto.createECDH('prime256v1');
  if (!ecdh) as.generateKeys();
  const asPub = as.getPublicKey();
  const shared = as.computeSecret(uaPub);
  const ikm = hkdf(auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, body]);
}

/** Only real browser push services; an attacker-chosen endpoint would turn us into an SSRF relay. */
const PUSH_HOSTS = /^(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[\w-]+\.push\.apple\.com|[\w-]+\.notify\.windows\.com|push\.services\.mozilla\.com)$/;
export function validSubscription(s) {
  try {
    const u = new URL(s.endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.test(u.hostname) && unb64u(s.keys?.p256dh).length === 65 && unb64u(s.keys?.auth).length === 16;
  } catch { return false; }
}

export function createPush({ dataDir, q, now, fetchImpl = fetch }) {
  const vapid = loadVapid(dataDir);
  async function sendOne(row, payload) {
    const sub = JSON.parse(row.sub);
    const u = new URL(sub.endpoint);
    const r = await fetchImpl(sub.endpoint, {
      method: 'POST',
      headers: { TTL: '3600', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: `vapid t=${vapidJwt(`${u.protocol}//${u.host}`, vapid, now())}, k=${vapid.publicKey}` },
      body: encryptPayload(sub, JSON.stringify(payload)),
    }).catch(() => null);
    // 404/410: the browser dropped this subscription; forget it.
    if (r && (r.status === 404 || r.status === 410)) q('delete from push_subs where id=?').run(row.id);
    return !!r?.ok;
  }
  return {
    publicKey: vapid.publicKey,
    subscribe(sub, ua) {
      const id = crypto.createHash('sha256').update(sub.endpoint).digest('hex').slice(0, 24);
      q('insert into push_subs(id,sub,ua,muted,created_at) values(?,?,?,?,?) on conflict(id) do update set sub=excluded.sub, ua=excluded.ua').run(id, JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys }), String(ua ?? '').slice(0, 120), '[]', now());
      return id;
    },
    unsubscribe(endpoint) { q('delete from push_subs where id=?').run(crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 24)); },
    setMuted(endpoint, muted) {
      q('update push_subs set muted=? where id=?').run(JSON.stringify(muted.slice(0, 20)), crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 24));
    },
    muted(endpoint) {
      const r = q('select muted from push_subs where id=?').get(crypto.createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 24));
      return r ? JSON.parse(r.muted) : null;
    },
    /** One notification per new agent reply; bots muted on a device are skipped there. */
    async notify(profile, payload) {
      const rows = q('select * from push_subs').all().filter((r) => !JSON.parse(r.muted).includes(profile));
      const res = await Promise.all(rows.map((r) => sendOne(r, payload)));
      return res.filter(Boolean).length;
    },
  };
}
