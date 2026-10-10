# Closure Max, 2026-10-02

Pelaksana: Max sendiri. Baseline Claude R2: `27423cbafcf3d68ffce1e2e48adca0303f1c912c`. Ini bukan klaim 100% seluruh PRD.

## Hasil yang diuji ulang

- NPC: back-out sebelum detour saat diblokir NPC diam; route gagal membersihkan resume goal, hold, blocker dan floor link. Regression test ditambahkan setelah reproduksi gagal.
- CAD: posisi unit skala dan judul kunci potongan diperbaiki, bukan mematikan pemeriksaan legibilitas.
- Blender 5: exporter vertex color, smoothing mesh dan layered animation actions didukung. Semua karakter, bangunan dan furniture diregenerasi, menghasilkan 63 GLB. Sebanyak 61 GLB karakter/furniture dioptimalkan dan dibandingkan dengan export mentah; bangunan memakai validator bangunan tersendiri. Bukti validasi baru di `docs/evidence/MAX/validated-assets/`; bukti R2 lama tidak ditimpa.
- AutoCAD 2025 CoreConsole: 15 DWG R2018 asli, dibuka ulang, AUDIT 0 error, unit mm, model entity counts cocok dengan DXF, nama paper layouts tercatat. DWG/hash/layout/log ada di `cad/out/` dan `docs/evidence/MAX/native-dwg/`. Font masih memakai substitusi; native plot visual belum diterima.
- Python: 389 passed. Vitest: 114 passed. Playwright pada build baru: 160 passed, 0 failed, 5 skipped. Skip mencakup physical-device benchmark opt-in dan kontrol yang tidak berlaku di breakpoint tertentu.
- Safety scan: findings 0. License audit: violations 0. Pemeriksaan token warna light/dark: PASS. Hasil ini bukan screen-reader manual atau acceptance semua kondisi fisik.
- Desktop nyata: Mac mini M4 16GB, Chrome terlihat, renderer Metal Apple M4, 3 rute 60 detik, 1366x820. Median throughput 179 FPS, median p95 frame 6.9 ms. Ini pengukuran lingkungan tersebut, bukan FPS ponsel atau jaminan refresh monitor pengguna. JSON dan screenshot: `docs/evidence/MAX/device/`.
- Cloudflare: header `Cache-Control: public, no-transform` hanya pada vhost employee-rpg menghilangkan injeksi beacon di HTML publik. Backup: `/var/backups/employee-rpg-before-max-no-transform.conf`. Tidak mematikan analytics satu zona.
- Verifikasi publik menemukan download GLB tidak selesai dalam batas waktu sehingga Avatar Studio masih memakai placeholder, meski semua hash dan tes localhost lulus. Gzip di origin, hanya pada vhost ini, menurunkan transfer CEO dari 620612 ke 225811 byte (level 5). `Content-Encoding: gzip` publik terverifikasi; 12 tes regression publik lulus tanpa mengubah assertion atau timeout. Backup konfigurasi: `/var/backups/employee-rpg-before-max-gzip.conf`.
- Clean worktree source `ae1ea8e`: Python 389 dan Vitest 114 lulus; npm audit 0. Semua hasil build identik kecuali timestamp `generated` di `docs/manifest.json`.
- Release pertama Max `ae1ea8ea3bfa3e3798259dafd4ce5776cd896b5e`: 133/133 SHA256-match. PR implementasi: https://github.com/air-buddy410/kantor-rpg/pull/6. Situs main/about/enterprise/farsight tetap HTTPS 200.
- Full suite publik pertama setelah gzip: 151 passed, 9 failed, 5 skipped. Failure bukan di-whitelist: karakter/NPC belum selesai dimuat ketika puluhan request furniture berebut bandwidth. Batas concurrency furniture 4 ditambahkan dengan regression test yang sebelumnya gagal (12 request sekaligus). Vitest baru 116 passed; 9 regression browser lokal desktop/tablet/mobile lulus. Hasil public rerun versi antrean wajib dibuktikan sebelum mengklaim semua tes publik hijau. Probe isolasi satu browser, assertion dan timeout tetap: 18/18 regression publik lulus (dua pengulangan desktop/tablet/mobile). Ini membuktikan fungsi pada satu browser, bukan menutup kegagalan stress dua browser. Full suite publik dengan satu worker berjalan terpisah; lihat `public-isolated-full-stats.json` setelah selesai.

## Verifikasi lanjutan publik, 2026-10-03

- Full suite publik dua worker selesai: 160 passed, 0 failed, 5 skipped, 0 flaky. Assertion dan timeout tidak diubah. Bukti: `docs/evidence/MAX/resume-public-full-results.json` dan `resume-public-full.log`.
- Avatar Studio publik dua worker: 3/3 passed pada desktop/tablet/mobile. Bukti: `docs/evidence/MAX/resume-parallel.log`.
- Kegagalan paralel sebelumnya tidak terulang pada full rerun ini; ini bukan bukti beban 40/200 visitor atau FPS ponsel fisik.
- Preview baru tersedia di `docs/evidence/MAX-RESUME-FULL/screenshots/`. Avatar mobile menampilkan model berambut dan pakaian terakota; screenshot spawn diambil sebelum karakter lengkap terpasang, sehingga bukan bukti visual karakter final.
- Native plot menggunakan layout A-101 dan device yang dienumerasi `DWG To PDF.pc3`. Probe tidak menghasilkan PDF, log berhenti saat memilih device; native plotting/font tetap BLOCKED. DWG asli tidak disimpan ulang.
- M4 tetap demo/disabled; target HP dan keputusan integrasi private belum diisi oleh pemilik.

## Lanjutan v0.2: clearance HUD, 2026-10-03

- V1.0/M5 dijeda atas koreksi Budi. Scope aktif hanya acceptance v0.2; belum commit/deploy baru.
- Reproduksi test-first pada publik: label `Kevin · ngobrol` menabrak HUD. Setelah perbaikan pertama, tes kedua mereproduksi label `Lobby & resepsi` tertutup joystick. Log RED: `docs/evidence/MAX/v02-hud-red.log`, `v02-touch-red.log`.
- Label dunia/NPC sekarang tidak ditampilkan ketika proyeksinya berpotongan dengan HUD, joystick, tombol sentuh, prompt atau activity chip; margin 6 px. Ini tidak memindahkan NPC atau menonaktifkan directory. Isi label hanya diubah saat aktivitas berubah, bukan setiap frame.
- Build final/TypeScript lulus; Vitest 116 lulus; Python 389 lulus. Enam tes clearance final lulus pada desktop/tablet/mobile. Bukti: `v02-build-final.log`, `v02-unit-final.log`, `v02-python.log`, `v02-hud-final.log` dalam `docs/evidence/MAX/`.
- Screenshot final `docs/evidence/MAX-V02-HUD-FINAL/screenshots/mobile-hud-label-clearance.jpg` ditinjau: label Bruno berada di bawah menu; label lobby yang sebelumnya tertutup joystick tidak lagi muncul di bawah kontrol. Ini review AI, bukan persetujuan Budi atau benchmark HP fisik.
- Safety scan 722 berkas teks: 0 temuan; audit lisensi: runtimeProblems=0, devNotAllowListed=0; contrast light/dark lulus. Bukti `v02-safety.log`, `v02-license.json`, `v02-contrast.log`.
- Full suite perbaikan awal: 163 lulus, 5 skipped, 0 gagal/flaky (`v02-regression-results.json`). Full suite versi final sempat terputus batas tool 420 detik, bukan hasil lulus. Rerun final selesai: **166 lulus, 5 skipped, 0 gagal, 0 flaky**, durasi 455942.364 ms; hasil dibaca dari `v02-final-complete-results.json`. Skip bukan PASS perangkat fisik.
- Budi memberi full-auto/full-approve untuk menuntaskan v0.2. Review visual/keputusan konsep teknis boleh ditangani Max dan spesialis; ini bukan bukti tes manusia/HP fisik. M4 status privat baca-saja masuk scope penyelesaian, tetapi tidak mengizinkan endpoint bot publik atau M5.
- Handoff resmi berjalan: Nova ICT `t_31bfb910`, Hugo native CAD `t_38108d8c`, Bruno exporter status privat/security `t_61e76661`. Artefak di `/Users/air_buddy/Hermes/_Bersama/2026-10-03-employee-rpg-v02-closure/`. Max memverifikasi sebelum integrasi/deploy.
- Host tidak melaporkan iPhone/iPad pada inventaris USB; `xcrun devicectl` tidak tersedia. Benchmark HP fisik masih memerlukan akses perangkat, bukan sekadar izin.
- Native plot/font, model/datasheet ICT, HP fisik, screen reader nyata dan sign-off masih terbuka seperti daftar di bawah. M4 tetap gated/disabled; M5 tidak dikerjakan.

## Review visual oleh Max (AI, bukan sign-off manusia)

- Ekspresi dan pose karakter: mata, mulut, kacamata/headset dan rambut tidak menunjukkan pecahan mesh besar pada preview yang diperiksa. Ekspresi smile/talk/frown relatif halus; preview bukan bukti semua frame di runtime.
- ICT-401 halaman 2: tabel port berbaris rapi; teks kecil tetapi tidak tampak tumpang tindih pada preview.
- ICT-401 halaman 3: BOM, PoE, total kabel dan asumsi diberi label konsep. Model switch, server/storage, UPS dan daya termal belum dipilih; watt PoE tidak dapat dianggap kapasitas perangkat yang telah diverifikasi.
- Blueprint tetap berlabel konsep, bukan gambar izin/konstruksi fisik.

## Yang belum memenuhi acceptance penuh

1. Benchmark ponsel fisik. Tidak ada perangkat yang dapat diuji melalui tool host saat ini; emulasi mobile bukan pengganti.
2. Pengujian screen reader nyata dan sign-off manusia. Akses System Events/VoiceOver tidak berhasil diverifikasi; pemeriksaan keyboard/axe bukan penggantinya.
3. Native plot DWG/font visual. Reopen/AUDIT/counts/layouts lulus, tetapi bukan bukti hasil cetak native.
4. Pilihan model dan datasheet PoE/UPS/thermal untuk rancangan ICT. Dataset sengaja mempertahankan nilai TBD dan asumsi yang belum disetujui.
5. M4/private Hermes: ditutup 2026-10-10 atas perintah Budi (lihat bagian M4 + M5 di bawah).

Tidak ada Rex/Bruno/worker baru yang mengerjakan implementasi ini. Tidak ada perubahan perangkat produksi ISP, DNS, tunnel, VM atau situs lain.

## Reproduksi

`npm ci --prefix app --ignore-scripts`; `npm test --prefix app`; `npm run build --prefix app`; `KANTOR_MILESTONE=MAX npx playwright test --workers=2` dari `app/`.

Python: `.venv/bin/python -m pytest tests/py -q`. Setelah mengubah/regenerasi DXF, ulangi `cad/autocad/native_batch.py --core <CoreConsole>`; hash DWG lama tidak lagi berlaku. Setelah mengubah GLB, ulangi optimizer dan `tools/glb_compare.py`. Report asset aktif ada di `docs/evidence/current/`.

## Lanjutan v0.2: penutupan 2026-10-05

- Release publik `f3240780` (commit f324078), backup vhost `/var/backups/employee-rpg-before-f3240780.conf`, release lama `a041f5a1` disimpan.
- Gerbang akhir publik: 166 pass / 0 fail / 5 skip / 0 flaky (`docs/evidence/MAX/v02-public-deploy2-final-results.json`). Run sebelumnya 161/5 gagal dan 156/10 gagal tetap disimpan; sebagian terjadi saat tunnel Cloudflare memberi 502 ke semua situs air-buddy.site (QUIC "failed to dial", sekitar 01:19 UTC).
- Keputusan Budi: M4 ditunda ke M5; target otonomi UPS 10 menit (1 EBM, 28,7 menit setelah penuaan).
- Bukti perangkat: iPhone 13 Pro fisik median 59,5 FPS; macOS VoiceOver asli 8 skenario.
- Matriks: 48 bagian terverifikasi, 2 tidak didukung (M4 ditunda; plot native AutoCAD belum ada). Review manusia gambar karakter dan ICT-401 belum tercatat.

## M4 + M5: papan kerja dan perintah agen, 2026-10-10

Perintah Budi: "M4 + M5 sekaligus", login sandi + 2FA di aplikasi sendiri, lalu autopilot sampai PRD selesai. Keputusan teknis yang belum diisi pemilik dikunci Max di ADR-016.

- Backend privat `server/` (Node 24, `node:sqlite`, satu dependensi `qrcode`): login sandi + TOTP, tiga papan (Kanban, `_Bersama`, `agent.log`, sesi omp), percakapan per profil lewat `hermes chat --oneshot`, approval aksi berisiko, idempotensi, retensi.
- UI: tombol `Papan kerja` (B), papan di dunia, `Bicara & beri tugas` di kartu persona, `Beri tugas` di directory (termasuk Atlas, Clara, Stella). Pengunjung melihat papan `Demo` dan tidak bisa mengirim apa pun.
- Tes: `server/test/api.test.mjs` 14 lulus; `app/tests/e2e/private.spec.ts` 12 lulus (desktop/tablet/mobile) dengan backend asli + runner palsu. Bukti `docs/evidence/M45/`.
- Uji asap runner nyata (profil leo, Claude): dua giliran pada satu sesi Hermes; giliran kedua mengingat giliran pertama dan memberi tepat tiga pilihan yang lolos validasi.
- Matriks: REQ-DATA-01 sekarang terverifikasi; REQ-BOARD-01..05, REQ-CMD-01..05, REQ-CHOICE-01, REQ-MANUAL-01, REQ-AUTH-01 ditambahkan dan terverifikasi. Satu bagian tetap `tidak didukung`: plot native AutoCAD.

Yang masih terbuka setelah M4/M5 (tidak bisa ditutup pelaksana):
1. Setup akun owner: Budi membuka tautan setup sekali pakai, memindai QR, dan memilih sandi. Max tidak memegang sandi atau seed.
2. Uji perintah nyata pertama dari HP Budi, termasuk satu approval.
3. Item lama: plot native AutoCAD, screen reader/HP pada fitur baru, model/datasheet ICT, sign-off manusia.

## Keputusan lingkup CAD, 2026-10-10

Budi tidak punya akun Autodesk, dan AutoCAD 2025 di Mac mini menolak plot karena belum login. Atas keputusan Budi ("hapus"), plot PDF native AutoCAD dikeluarkan dari lingkup PRD. DWG native 15 sheet (reopen, AUDIT 0 error, mm, entitas cocok) tetap berlaku; PDF vektor generator menjadi PDF resmi. Matriks: 63/63 bagian terverifikasi.

Masih terbuka di luar matriks: uji di HP fisik, VoiceOver nyata, dan sign-off manusia.
