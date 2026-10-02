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
- Full suite publik pertama setelah gzip: 151 passed, 9 failed, 5 skipped. Failure bukan di-whitelist: karakter/NPC belum selesai dimuat ketika puluhan request furniture berebut bandwidth. Batas concurrency furniture 4 ditambahkan dengan regression test yang sebelumnya gagal (12 request sekaligus). Vitest baru 116 passed; 9 regression browser lokal desktop/tablet/mobile lulus. Hasil public rerun versi antrean wajib dibuktikan sebelum mengklaim semua tes publik hijau.

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
5. M4/private Hermes: tetap dimatikan. Tugas penyelesaian umum tidak dipakai sebagai izin membuka integrasi privat atau mempublikasikan data bot.

Tidak ada Rex/Bruno/worker baru yang mengerjakan implementasi ini. Tidak ada perubahan perangkat produksi ISP, DNS, tunnel, VM atau situs lain.

## Reproduksi

`npm ci --prefix app --ignore-scripts`; `npm test --prefix app`; `npm run build --prefix app`; `KANTOR_MILESTONE=MAX npx playwright test --workers=2` dari `app/`.

Python: `.venv/bin/python -m pytest tests/py -q`. Setelah mengubah/regenerasi DXF, ulangi `cad/autocad/native_batch.py --core <CoreConsole>`; hash DWG lama tidak lagi berlaku. Setelah mengubah GLB, ulangi optimizer dan `tools/glb_compare.py`. Report asset aktif ada di `docs/evidence/current/`.
