# Preview handoff (disiapkan, tidak di-deploy)

Status: runbook saja. Pelaksana (Claude Code cloud) tidak men-deploy, tidak mengubah domain/VM/hosting dan tidak memegang secret. Preview yang sekarang dipin ke `c9c278a1e5afdca4547a36fb49b1f0ad0dd61e42` adalah milik tugas Bruno `t_99cdde23`; runbook ini baru dipakai setelah deployment awal itu selesai dan pemilik hosting menyetujui pergantian SHA.

## Kandidat

- Branch: `claude/kantor-rpg-m3-hardening` (PR draft air-buddy410/kantor-rpg#5, tidak di-merge).
- SHA kandidat: SHA terakhir yang tercatat di `docs/progress.md` bagian Hardening, dengan CI hijau pada SHA yang sama. Jangan memakai SHA lain tanpa memeriksa ulang bagian "Cek sebelum ganti SHA".
- Perbedaan terhadap c9c278a yang terlihat di preview: jendela konsep di dinding luar, CEO dan persona tidak saling tembus, ekspresi wajah saat bicara, LOD persona jauh, outlet ICT ikut furniture di Office Studio, export layout versi 2.

## Build (mesin mana pun dengan Node 22)

```
git clone https://github.com/air-buddy410/kantor-rpg.git && cd kantor-rpg
git checkout <SHA kandidat>
cd app && npm ci && npm run build
```

Output statis ada di `app/dist/` (HTML, JS, CSS, font OFL, GLB, JPG artwork, PDF konsep, teks lisensi). Tidak ada server-side code, tidak ada environment variable, tidak ada API key. Aplikasi hanya meminta file dari origin yang sama (diuji `tests/e2e/world.spec.ts` "only same-origin requests").

## Kebutuhan hosting statis (diputuskan pemilik hosting, bukan pelaksana)

- Sajikan `app/dist/` apa adanya; path relatif, jadi subpath juga bisa.
- MIME `model/gltf-binary` untuk `.glb` dan `application/pdf` untuk `.pdf` (keduanya default di hosting statis umum).
- Header yang disarankan (belum diuji pelaksana karena `vite preview` tidak memasang header; jalankan smoke test di bawah setelah header dipasang): `Content-Security-Policy: default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:` (GLTFLoader memakai blob URL untuk tekstur tertanam), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- Cache panjang hanya untuk `assets/*-<hash>.js|css`; GLB dan PDF tanpa hash, jadi cache pendek atau revalidasi.

## Cek sebelum ganti SHA (di mesin build)

```
python3 -m pytest -q tests/py
cd app && npx vitest run && npx playwright test
```

Hasil yang diharapkan = angka di `docs/QA-REPORT.md` bagian Hardening. Bila berbeda, jangan ganti SHA; catat perbedaannya di PR.

## Smoke test terhadap preview yang sudah jalan

Tidak memerlukan kredensial bila preview publik. Jalankan dari checkout SHA yang sama:

```
cd app && KANTOR_BASE_URL=https://<url-preview>/ npx playwright test tests/e2e/world.spec.ts tests/e2e/states.spec.ts tests/e2e/budget.spec.ts
```

`KANTOR_BASE_URL` membuat Playwright memakai URL itu dan tidak menyalakan server lokal. Budget draw call/triangle tidak bergantung GPU sehingga tetap bermakna; FPS dari mesin runner bukan FPS perangkat Budi (ADR-011).

## Rollback

Sajikan kembali build dari `c9c278a1e5afdca4547a36fb49b1f0ad0dd61e42` dengan langkah build yang sama. Penyimpanan browser: layout Studio versi 1 tetap terbaca oleh versi baru; layout versi 2 (dengan outlet) ditolak oleh build c9c278a dengan pesan "Versi layout 2 tidak didukung" dan dataset dipakai, tanpa kehilangan data di repo.

## Di luar runbook ini

DNS, domain, sertifikat, VM, CDN, kredensial hosting, analytics, dan integrasi data real (M4 tetap disabled) tidak disentuh pelaksana.
