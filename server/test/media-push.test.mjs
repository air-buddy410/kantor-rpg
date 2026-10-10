import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { encryptPayload, validSubscription, createPush } from '../push.mjs';
import { createMedia } from '../media.mjs';
import { openStore } from '../store.mjs';

const b64u = (b) => Buffer.from(b).toString('base64url');

/** Browser side of RFC 8291, to prove the server's ciphertext decrypts. */
function decrypt(body, ua, auth) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPub = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const shared = ua.computeSecret(asPub);
  const hk = (s, k, i, l) => Buffer.from(crypto.hkdfSync('sha256', k, s, i, l));
  const ikm = hk(auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPub]), 32);
  const cek = hk(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hk(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(pt[pt.length - 1], 2, 'delimiter record terakhir');
  return pt.subarray(0, pt.length - 1).toString();
}

function fakeBrowser() {
  const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ua, auth, sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) } } };
}

test('push: payload RFC 8291 bisa didekripsi browser, VAPID ES256 sah', async () => {
  const { ua, auth, sub } = fakeBrowser();
  assert.equal(decrypt(encryptPayload(sub, '{"title":"Max"}'), ua, auth), '{"title":"Max"}');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-'));
  const store = openStore(dir);
  const sent = [];
  const push = createPush({ dataDir: dir, q: store.q, now: () => Date.now(), fetchImpl: async (url, init) => { sent.push({ url, init }); return { ok: true, status: 201 }; } });
  push.subscribe(sub, 'uji');
  assert.equal(await push.notify('default', { title: 'Max', body: 'halo' }), 1);
  const auth0 = sent[0].init.headers.Authorization;
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(auth0);
  const [h, b, s] = jwt.split('.');
  const pub = Buffer.from(k, 'base64url');
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: 'jwk' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${b}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), 'tanda tangan VAPID');
  assert.equal(JSON.parse(Buffer.from(b, 'base64url')).aud, 'https://fcm.googleapis.com');
  assert.equal(JSON.parse(decrypt(sent[0].init.body, ua, auth)).body, 'halo');
  // Dibisukan untuk bot ini = tidak dikirim; 410 = langganan dihapus.
  push.setMuted(sub.endpoint, ['default']);
  assert.equal(await push.notify('default', { title: 'x' }), 0);
  assert.equal(await push.notify('sales', { title: 'x' }), 1);
  const gone = createPush({ dataDir: dir, q: store.q, now: () => Date.now(), fetchImpl: async () => ({ ok: false, status: 410 }) });
  await gone.notify('sales', { title: 'x' });
  assert.equal(store.q('select count(*) n from push_subs').get().n, 0);
  assert.ok((fs.statSync(path.join(dir, 'vapid.json')).mode & 0o077) === 0, 'kunci VAPID hanya pemilik');
});

test('push: hanya endpoint push service resmi (bukan relay SSRF)', () => {
  const { sub } = fakeBrowser();
  assert.ok(validSubscription(sub));
  assert.ok(validSubscription({ ...sub, endpoint: 'https://web.push.apple.com/QGx' }));
  for (const e of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://fcm.googleapis.com.evil.io/x', 'https://evil.io/fcm.googleapis.com']) assert.equal(validSubscription({ ...sub, endpoint: e }), false, e);
  assert.equal(validSubscription({ ...sub, keys: { p256dh: 'AAAA', auth: sub.keys.auth } }), false);
});

test('media: tipe & isi divalidasi, token tidak bisa dipalsukan/keluar folder, path tidak bocor', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-'));
  const home = path.join(dir, 'home');
  fs.mkdirSync(path.join(home, '.hermes', 'cache', 'images'), { recursive: true });
  fs.writeFileSync(path.join(home, '.hermes', 'state.db'), 'rahasia');
  const store = openStore(path.join(dir, 'data'));
  const media = createMedia({ dataDir: path.join(dir, 'data'), home, secret: 's3cret', q: store.q, now: () => Date.now(), transcriber: async () => 'halo max' });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  assert.match((await media.save('conv_x', 'text/html', 'a.html', Buffer.from('<script>'))).error, /tidak didukung/);
  assert.match((await media.save('conv_x', 'image/png', 'a.png', Buffer.from('<svg onload=1>'))).error, /tidak cocok/);
  const ok = await media.save('conv_x', 'image/png', '../../etc/passwd.png', png);
  assert.equal(ok.upload.kind, 'image');
  assert.ok(!ok.upload.url.includes(dir) && !JSON.stringify(ok.upload).includes(dir), 'path asli tidak dikirim ke browser');
  assert.ok(!ok.upload.name.includes('/'));
  const tok = ok.upload.url.split('/').pop();
  assert.ok(media.resolveToken(tok).endsWith('.png'));
  assert.equal(media.resolveToken(tok.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))), null, 'tanda tangan salah ditolak');
  assert.equal(media.resolveToken(media.sign(path.join(home, '.hermes', 'state.db'))), null, 'berkas di luar cache/uploads ditolak walau bertanda tangan');
  const other = createMedia({ dataDir: path.join(dir, 'data'), home, secret: 'lain', q: store.q, now: () => Date.now() });
  assert.equal(other.resolveToken(tok), null, 'kunci server lain menolak');
  // Suara: transkrip masuk ke teks untuk agen, format seperti gateway Telegram.
  const v = await media.save('conv_x', 'audio/webm', 'rekaman', Buffer.from('webmdata'));
  assert.equal(v.upload.kind, 'voice');
  const rows = store.q('select * from uploads where id in (?,?) order by created_at, rowid').all(ok.upload.id, v.upload.id);
  const txt = await media.agentText(rows);
  assert.match(txt, /\[Image attached at: .+\.png\]/);
  assert.match(txt, /Transkrip otomatis: "halo max"/);
  // Penanda di transkrip Telegram jadi lampiran, teks bersih.
  const imgPath = path.join(home, '.hermes', 'cache', 'images', 'img_1.jpg');
  fs.writeFileSync(imgPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
  const parsed = media.fromTranscript(`ini denah apa?\n\n[Image attached at: ${imgPath}]`);
  assert.equal(parsed.text, 'ini denah apa?');
  assert.equal(parsed.attachments[0].kind, 'image');
  assert.ok(media.resolveToken(parsed.attachments[0].url.split('/').pop()), 'lampiran Telegram bisa dibuka owner');
  const doc = media.fromTranscript("[The user sent a document: 'rab.pdf'. It is saved at: /tidak/ada/rab.pdf. If the user's request involves what the document contains, read it yourself.]");
  assert.equal(doc.text, '');
  assert.equal(doc.attachments[0].url, null, 'berkas yang sudah hilang tampil sebagai dihapus');
  // Retensi: berkas lama ikut terhapus.
  media.purge(Date.now() + 1000);
  assert.equal(store.q('select count(*) n from uploads').get().n, 0);
  assert.equal(fs.readdirSync(path.join(dir, 'data', 'uploads')).filter((f) => !f.startsWith('.')).length, 0);
});
