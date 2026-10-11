# Panduan instalasi Kantor RPG

Kantor RPG punya dua bagian:

1. **App 3D** (`app/`): Vite + three.js, hasil build berupa file statis (`app/dist`). Bagian ini cukup untuk jalan-jalan di kantor, NPC simulasi, direktori, dan dokumen.
2. **Backend privat** (`server/`): Node tanpa framework. Dipakai untuk chat agen yang tersambung ke Telegram lewat Hermes Agent, push notifikasi, dan lampiran. Opsional; tanpa backend, app tetap jalan dalam mode simulasi.

Ada tiga jalur: (A) coba di laptop, (B) pasang situs statis, (C) sambungkan backend privat.

---

## Prasyarat

| Untuk | Butuh |
|---|---|
| App | Node.js 22+ (diuji di 24 dan 26), npm, Git |
| Backend | Node.js 24+ (`server/package.json` engines), OpenSSL |
| Tes E2E | Chromium Playwright (`npx playwright install chromium`) |
| Rebuild aset desain (opsional) | Python 3.11+, `poppler-utils`, Blender 4.0.x; lihat [docs/REBUILD.md](docs/REBUILD.md) |

GLB, gambar, dan PDF hasil build sudah di-commit, jadi Python/Blender **tidak** diperlukan untuk menjalankan app.

---

## A. Coba di laptop (5 menit)

```bash
git clone https://github.com/air-buddy410/kantor-rpg.git
cd kantor-rpg/app
npm ci
npm run dev            # http://localhost:5173
```

Build produksi dan pratinjau:

```bash
npm run build          # tsc + vite build -> app/dist
npm run preview        # http://127.0.0.1:4173
```

Kontrol: WASD/panah untuk jalan, Shift untuk lari, Q/Z untuk memutar kamera, R untuk meluruskan kamera, +/- untuk zoom, E/Enter untuk interaksi, H untuk bantuan. Di HP: joystick sentuh. Simulasi NPC berseed (`?seed=20261001`).

Pengaturan kualitas (ikon roda gigi): `auto`, `low`, atau `high`. Mode `auto` memilih `low` (tanpa bayangan) bila GPU terdeteksi sebagai renderer software.

### Cek sebelum dipakai

```bash
cd app
npx tsc --noEmit
npx vitest run                         # unit, termasuk gate z-fighting (coplanar.test.ts)
npx playwright install chromium        # sekali saja
npx playwright test                    # E2E desktop/tablet/mobile pada port 4173
```

Port 4173 harus bebas, atau sudah berisi `vite preview` dari folder yang sama (`reuseExistingServer`). Tes server: `cd server && npm ci && npm test`.

---

## B. Pasang situs statis (nginx)

`app/dist` bisa disajikan oleh web server statis apa pun. Contoh nginx dengan rilis per commit, supaya rollback cukup dengan mengganti satu baris:

```bash
# di mesin build
cd app && npm ci && npm run build
SHA=$(git rev-parse --short=7 HEAD)
rsync -az --delete dist/ server:/tmp/staging-$SHA/

# di server
sudo cp -a /tmp/staging-$SHA /var/www/kantor-rpg/releases/$SHA
```

Vhost minimal:

```nginx
server {
  listen 80;
  server_name kantor.contoh.id;
  root /var/www/kantor-rpg/releases/<SHA>;
  index index.html;
  gzip on;
  gzip_types application/javascript text/css application/json application/octet-stream model/gltf-binary;
  add_header Cache-Control "public, no-transform" always;
  add_header X-Content-Type-Options nosniff always;
  location ^~ /assets/ { try_files $uri =404; }
  location / { try_files $uri $uri/ =404; }
}
```

Untuk ganti rilis: ubah baris `root` ke SHA baru, jalankan `sudo nginx -t && sudo systemctl reload nginx`. Rilis lama tetap ada untuk rollback.

Catatan:
- Aktifkan gzip untuk `.glb` (model sekitar 5,9 MB mentah, sekitar 2,1 MB gzip).
- `Cache-Control: no-transform` mencegah CDN (mis. Cloudflare) menyisipkan skrip; app punya tes "same-origin only".
- Situs harus diakses lewat HTTPS agar PWA dan push notifikasi berfungsi.

---

## C. Backend privat (chat agen, push, lampiran)

Backend membaca sesi Telegram Hermes di mesin tempat Hermes berjalan, jadi dipasang di mesin itu (misalnya Mac mini), lalu diproksikan oleh nginx situs.

### Jalankan manual

```bash
cd server
npm ci --omit=dev
KANTOR_RPG_DATA=~/.hermes/kantor-rpg \
KANTOR_RPG_BIND=127.0.0.1 \
KANTOR_RPG_PORT=3242 \
KANTOR_RPG_ORIGIN=https://kantor.contoh.id \
node main.mjs
```

| Variabel | Default | Arti |
|---|---|---|
| `KANTOR_RPG_DATA` | `~/.hermes/kantor-rpg` | Folder data (mode 0700): sesi, `proxy-secret`, `vapid.json`, lampiran |
| `KANTOR_RPG_PORT` | `3242` | Port HTTP |
| `KANTOR_RPG_BIND` | `127.0.0.1` | Alamat bind; pakai IP Tailscale/LAN bila nginx di mesin lain |
| `KANTOR_RPG_ORIGIN` | situs demo | Origin yang boleh POST (CSRF) |
| `KANTOR_RPG_PROXY_SECRET` | isi berkas `proxy-secret` | Header wajib dari nginx; request tanpa header ini ditolak |

Kunci VAPID untuk push dibuat otomatis sekali di folder data. Jangan commit folder data.

### macOS + launchd (cara yang dipakai produksi)

```bash
server/deploy/pasang-mac.sh <sha>   # salin ke ~/.hermes/kantor-rpg/releases/<sha>, buat proxy-secret, pasang LaunchAgent
server/deploy/muat-launchd.sh       # mulai ulang layanan id.perumnet.kantor-rpg-api
```

Log tersimpan di `~/.hermes/log/kantor-rpg-api.log`. Rollback: arahkan symlink `~/.hermes/kantor-rpg/current` ke rilis lama, lalu jalankan `launchctl kickstart -k gui/$UID/id.perumnet.kantor-rpg-api`.

`pasang-mac.sh` bind ke `KANTOR_RPG_BIND` bila di-set, kalau tidak ke IP Tailscale mesin itu (`tailscale ip -4`), dan terakhir ke contoh `192.168.1.10`. `sambung-nginx.sh` memakai urutan yang sama untuk upstream (`KANTOR_RPG_UPSTREAM`).

### Sambungkan nginx ke backend

```bash
KANTOR_RPG_UPSTREAM=http://<ip-backend>:3242 server/deploy/sambung-nginx.sh
```

Skrip ini menulis `/etc/nginx/snippets/kantor-rpg-api.conf` (0600, berisi header rahasia), menyisipkan `include` ke vhost, mencadangkan vhost, lalu menjalankan `nginx -t`. Bila gagal, vhost dikembalikan otomatis. Nama host dan path vhost di bagian atas skrip mengikuti server demo; ganti untuk server Anda.

Cek: `curl https://kantor.contoh.id/api/me` harus membalas 200.

---

## Masalah umum

- **Layar hitam / 3D tidak muncul**: browser tanpa WebGL. App jatuh ke mode direktori; coba Chrome/Safari terbaru, atau `?nogl=1` untuk memaksa mode tanpa 3D.
- **Permukaan berkedip (z-fighting)**: sudah ditangani di sumbernya (lihat [docs/evidence/AUDIT-3D/LAPORAN.md](docs/evidence/AUDIT-3D/LAPORAN.md)). Bila menambah furnitur/GLB baru, jalankan `npx vitest run tests/unit/coplanar.test.ts`; tes gagal bila ada dua permukaan berbeda warna yang menempel.
- **Masih memuat versi lama setelah deploy**: service worker PWA. Tutup semua tab situs lalu buka ulang, atau hapus data situs.
- **E2E gagal `ERR_CONNECTION_REFUSED`**: server preview di 4173 mati di tengah run. Jalankan `npm run preview` terpisah, lalu ulangi dengan `npx playwright test --last-failed`.
- **Chat agen tidak muncul**: periksa `/api/me`. Bila 404/502, nginx belum memuat snippet API atau backend tidak berjalan (`launchctl print gui/$UID/id.perumnet.kantor-rpg-api`).

## Bobot dan anggaran

- Model runtime sekitar 5,92 MB (karakter 4,54 MB), batas ADR-015: 4,6 MB / 6,0 MB.
- JS utama sekitar 65 kB gzip, three.js sekitar 169 kB gzip.
- Diperiksa oleh `tests/e2e/budget.spec.ts` dan `bundle.spec.ts`, serta `node tools/glb_audit.mjs`.
