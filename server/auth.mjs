// Login owner: sandi (scrypt) + TOTP RFC 6238 (PRD 17.4, keputusan Budi
// 2026-10-10: "login sandi + 2FA di app sendiri"). Rahasia hanya di berkas
// owner.json (mode 0600) di luar repo; tidak pernah dikirim ke browser.
import crypto from 'node:crypto';
import fs from 'node:fs';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s) {
  const clean = s.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0, value = 0; const out = [];
  for (const c of clean) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error('base32 tidak valid');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function totp(secretB32, timeMs = Date.now(), step = 30, digits = 6) {
  const counter = Math.floor(timeMs / 1000 / step);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secretB32)).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const code = ((h.readUInt32BE(off) & 0x7fffffff) % 10 ** digits).toString().padStart(digits, '0');
  return code;
}

/** Accepts the current code and one step either side (clock drift). */
export function verifyTotp(secretB32, code, timeMs = Date.now()) {
  if (!/^\d{6}$/.test(String(code ?? ''))) return false;
  for (const d of [-1, 0, 1]) {
    const want = Buffer.from(totp(secretB32, timeMs + d * 30_000));
    if (crypto.timingSafeEqual(want, Buffer.from(String(code)))) return true;
  }
  return false;
}

export function hashPassword(pw, salt = crypto.randomBytes(16)) {
  const key = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(pw, stored) {
  const [kind, saltB64, keyB64] = String(stored).split('$');
  if (kind !== 'scrypt' || !saltB64 || !keyB64) return false;
  const want = Buffer.from(keyB64, 'base64');
  const got = crypto.scryptSync(String(pw ?? ''), Buffer.from(saltB64, 'base64'), want.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(want, got);
}

export function loadOwner(file) {
  const st = fs.statSync(file);
  if ((st.mode & 0o077) !== 0) throw new Error(`${file} harus mode 0600`);
  const o = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!o.username || !o.passwordHash || !o.totpSecret) throw new Error('owner.json tidak lengkap');
  return o;
}

export const token = (n = 24) => crypto.randomBytes(n).toString('base64url');
