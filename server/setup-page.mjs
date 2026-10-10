// Halaman setup owner satu kali: QR TOTP + isian sandi. HTML statis tanpa
// skrip (CSP default-src 'none'); rahasia TOTP hanya tampil di halaman ini.
import QRCode from 'qrcode';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const shell = (body) => `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Setup owner kantor-rpg</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;background:#f4f1ea;color:#1f2420;margin:0;padding:24px}
main{max-width:440px;margin:0 auto;background:#fff;border:1px solid #d8d2c4;border-radius:10px;padding:24px}
h1{font-size:22px;margin:0 0 12px}label{display:block;margin:14px 0 4px;font-weight:600}
input{width:100%;box-sizing:border-box;font:inherit;padding:10px;border:1px solid #8a8576;border-radius:6px;min-height:44px}
button{margin-top:18px;width:100%;min-height:44px;font:inherit;font-weight:700;background:#24533f;color:#fff;border:0;border-radius:6px}
code{background:#eee8da;padding:2px 6px;border-radius:4px;word-break:break-all}.err{color:#9b2c1f;font-weight:600}.muted{color:#55594f;font-size:14px}
img{display:block;margin:12px auto;width:220px;height:220px}
</style></head><body><main>${body}</main></body></html>`;

export function setupPage({ secret, username, token, error, done } = {}) {
  if (done) return shell('<h1>Owner siap</h1><p>Akun owner dibuat. Tutup halaman ini, lalu login dari tombol <b>Panel privat</b> di employee-rpg.air-buddy.site.</p>');
  if (!secret) return shell(`<h1>Setup owner</h1><p class="err">${esc(error)}</p>`);
  const uri = `otpauth://totp/kantor-rpg:${encodeURIComponent(username)}?secret=${secret}&issuer=kantor-rpg&algorithm=SHA1&digits=6&period=30`;
  return QRCode.toDataURL(uri, { margin: 1, width: 440 }).then((qr) => shell(`
<h1>Setup owner kantor-rpg</h1>
<p>Langkah 1. Pindai QR ini dengan aplikasi authenticator (Google Authenticator, 1Password, Authy).</p>
<img alt="QR kode 2FA kantor-rpg" src="${qr}">
<p class="muted">Tidak bisa memindai? Ketik kunci ini: <code>${esc(secret)}</code></p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="setup">
<input type="hidden" name="t" value="${esc(token ?? '')}" id="t">
<label for="u">Nama login</label><input id="u" value="${esc(username)}" disabled>
<label for="p">Langkah 2. Sandi baru (minimal 12 karakter)</label><input id="p" name="password" type="password" autocomplete="new-password" minlength="12" required>
<label for="p2">Ulangi sandi</label><input id="p2" name="password2" type="password" autocomplete="new-password" minlength="12" required>
<label for="c">Langkah 3. Kode 6 digit dari aplikasi</label><input id="c" name="code" inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" required>
<button type="submit">Simpan owner</button>
</form>
<p class="muted">Tautan ini hanya sekali pakai. Sandi disimpan sebagai hash scrypt di Mac mini; Max dan bot lain tidak melihatnya.</p>`));
}

/** The token must survive into the POST: GET fills it from the query string. */
export function withToken(html, t) { return html.replace('id="t" value=""', `id="t" value="${esc(t)}"`); }
