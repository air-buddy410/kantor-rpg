# Progress checkpoint

Log untuk supervisor (Max). Entri terbaru di atas. Status memakai DONE_Mx / NEEDS_INPUT / BLOCKED; angka test adalah hasil eksekusi, bukan target.

## Hardening (branch claude/kantor-rpg-m3-hardening, basis c9c278a1e5afdca4547a36fb49b1f0ad0dd61e42, PR draft air-buddy410/kantor-rpg#5)

Status: DONE_HARDENING untuk item Max yang dapat dikerjakan di cloud; native DWG BLOCKED; M4 disabled; FPS perangkat dan screen reader belum diuji. Tidak ada merge atau deploy. Runtime sesi: model claude-opus-5-5, effort high (get_session; last_served_model sama). Jendela rate limit 7 hari tetap "rejected" (reset 2026-10-03 16:00 UTC) tetapi sesi tetap melayani; tanpa fallback berbayar. Preview yang dipin ke c9c278a milik tugas Bruno t_99cdde23 dan tidak disentuh; runbook pergantian SHA ada di `docs/PREVIEW-HANDOFF.md`.

SHA kandidat untuk review: commit HEAD branch ini setelah commit "QA report + progress hardening" (lihat `git log`); SHA yang direbuild dari clean clone: 185b46286a1656b1341ad62c78d67f954da81e70 (kepala `docs/evidence/HARDENING/clean-clone-rebuild.txt`); commit sesudahnya hanya evidence, dokumen, urutan registry dan path relatif di laporan validator.

Hasil (detail dan evidence: `docs/QA-REPORT.md` bagian Hardening):
- ADR-008 sampai ADR-011 (Q-01 sampai Q-04 provisional). Q-01 didukung trace 27 fungsi PRD ke 38 ruang (`tools/prd_trace.py`).
- Dataset P03: arah bukaan 35 pintu swing, 39 jendela konsep, ADJ-11 gym; validator 46 cek.
- CAD membaca swing + jendela (denah, furniture/ICT, tampak, potongan, jadwal pintu/jendela A-103 hal. 2); 107 test CAD.
- Blender: 1 material atlas per karakter, LOD1 <= 4800 tris, 5 ekspresi morph; bangunan dengan jendela dan daun pintu; 1151 + 1529 cek.
- Runtime: draw call puncak 49 sampai 53 (target 150), LOD1 > 8 m, ekspresi saat bicara, jendela di dinding, collision CEO/persona, outlet ICT ikut furniture di Studio (undo/export v2/rollback).
- Clean clone + `tools/rebuild_all.sh`: exit 0 (19 menit).
- Angka akhir: pytest 316, vitest 53, Playwright penuh 117 lolos/0 gagal/9 skip + 10/10 test yang di-unskip, rebuild E2E 120 lolos/3 skip, axe 0 pelanggaran (24 laporan), contrast 31/31, safety 0, npm audit 0, CSP 24/24.

Failure/boundary yang tercatat:
- Soak seed 11 menemukan bug lama: NPC membeku permanen karena langkah memotong sudut sel terblokir (lineWalkable sampling). Diperbaiki dengan traversal sel eksak + slide sumbu; test multi-seed.
- Soak 2 jam menemukan dua NPC memesan kursi sama setelah menunggu melebihi TTL reservasi; reservasi kini diperpanjang selama NPC bergerak atau memberi jalan.
- CI c29fa8a gagal: test jalan keyboard terhalang persona di lobby (collision baru); test kini membedakan blok persona dari collider meja (4b10b0b, CI hijau).
- CI b23a0ea gagal: matrix menunjuk evidence yang belum ada; diperbaiki 65d9513.
- CSP usulan versi 1 memblokir tekstur blob GLTF (2 test gagal); `connect-src 'self' blob:` ditambahkan, 24/24.
- Rebuild clean clone: noise float pada 2 GLB karakter (maks 0,008 mm) dan urutan registry; path absolut di laporan validator diganti relatif.

Skip yang tersisa dan alasannya: benchmark 60 s (KANTOR_PERF, dijalankan terpisah: 5,6 FPS container), joystick sentuh di desktop, jalan keyboard di tablet/mobile (lokomosi sentuh diuji joystick).

Known issues: lihat `docs/QA-REPORT.md` (daun pintu belum di runtime, 3 karakter 3 primitive, LOD1 tanpa highlight mata, tumpang tindih singkat antar-NPC berjalan, tag jendela kecil saat cetak, transfer awal 9,73 MB mendekati 10 MB).

Next safe action: review Max atas PR #5; setelah deployment awal Bruno selesai, pemilik hosting menjalankan `docs/PREVIEW-HANDOFF.md` dengan SHA kandidat; ukur FPS di perangkat Budi dengan `KANTOR_PERF=1` (ADR-011).

## M3 (branch claude/kantor-rpg-m3)

Status: DONE_M3 untuk authoring + deliverables yang dapat dibuat di cloud; native DWG BLOCKED; target draw call mobile belum terpenuhi (161 > 150 terukur); uji perangkat nyata belum.

Hasil:
- Office Studio: edit grid 0,25 m, validasi sama dengan validator Python (overlap, dinding, pintu, clearance, reachability, slot), undo/redo, draft, export/import terjaga, publish lokal + rollback 5 langkah, layout diterapkan live ke navgrid dan NPC.
- Avatar Studio: preview 3D, 3 rambut x 3 palet dari GLB, simpan/reset/batal, fallback default.
- Gambar: 15 sheet DXF + PDF vektor, paket gabungan 17 halaman (bookmark 15, page label = sheet id), paket A/I/ICT, register 15/15 produced; 69 test CAD lolos (dijalankan ulang pelaksana).
- Blender: shell bangunan per lantai (1053 cek lolos), 54 keluarga furniture original (654 cek lolos), registry 63 aset; furniture GLB dipakai runtime dengan fallback prosedural.
- Artwork poster original + poster proyek A3 berangka dari dataset.
- Audit lisensi: runtime hanya three (MIT) dan Alegreya Sans (OFL); teks lisensi ikut build.
- Rebuild: `tools/rebuild_all.sh`, `docs/REBUILD.md`; QA: `docs/QA-REPORT.md`.

Bukti: vitest 36 lolos (`docs/evidence/M3/vitest.txt`; pesan commit 0a40760 menyebut 37, angka benar 36); E2E 100 lolos, 5 skip (`docs/evidence/M3/e2e-all.txt`); state test 12 lolos; pytest 219 lolos; safety 0 temuan; perf route container 3,2 FPS rata-rata, transfer awal 7,83 MB (`docs/evidence/M3/perf-route-desktop.json`).

Known issues: draw call 161 di koridor L1 (karakter multi-material); LOD1/atlas belum; arah bukaan pintu dan jendela tidak ada di dataset; meja tanpa monitor di GLB (tinggi catalog); stool/beanbag tidak cocok clip duduk 0,45 m; posisi outlet ICT tidak ikut bila meja dipindah di Studio.

## M2 (branch claude/kantor-rpg-m2)

Status: DONE_M2 untuk persona/idle/interaksi/aksesibilitas otomatis; uji perangkat nyata dan screen reader belum dilakukan.

Hasil:
- IdleSim berseed (`app/src/sim/idle.ts`): utility selection hanya saat aktivitas selesai, reservasi slot ber-TTL, cap aktivitas setengah tim, rute lintas lantai, stuck detection dengan release/retry/safe waypoint, pause saat CEO menyapa. workStatus tetap unknown.
- 6 NPC Blender GLB hidup di dunia, label nama/aktivitas, dialog persona statis (`design/dialogue.json`), direktori "Temui".
- Aktivitas CEO di semua slot (duduk, workstation, biliar, game, gym, kopi) memakai tabel reservasi yang sama dengan NPC.
- Adapter data: demo saja; private (M4) melempar AdapterDisabledError; sanitasi allowlist; stale -> unknown.
- Vitest 15 lolos (`docs/evidence/M2/vitest.txt`): navgrid parity, idle soak 2 jam, failure path seal mid-route, adapter.
- E2E: run penuh 73 lolos, 3 gagal, 5 skip (`docs/evidence/M2/e2e-all.txt`); 3 kegagalan = assertion lama test kopi yang belum mengikuti perilaku slot baru, plus strict-mode locator; test diperbaiki dan dijalankan ulang 3/3 lolos (`docs/evidence/M2/e2e-npc-blueprint-rerun.txt`).
- axe-core WCAG 2.1 A/AA: 0 pelanggaran di dunia, direktori, dialog, fallback, tema terang dan gelap (`docs/evidence/M2/axe/`). Contrast 31/31.

Failure/boundary yang tercatat: bug fokus (E diabaikan setelah tombol direktori) ditemukan oleh test aktivitas dan diperbaiki; kursi yang dipakai NPC ditolak dengan nama; herding dibatasi cap keras setelah soak menemukan 4/6 NPC pada aktivitas sama.

Known issues: player dan NPC saling tembus (tanpa collision antar-agent); NPC hanya 6 dari maksimum 12; tidak ada suara (sengaja, opt-in belum dibuat).

## M1 (branch claude/kantor-rpg-m1, PR air-buddy410/kantor-rpg#2)

Status: DONE_M1 untuk vertical slice; native DWG tetap BLOCKED; target FPS perangkat nyata belum diuji (container tanpa GPU).

Hasil:
- Runtime `app/` (Vite 8.3.1, TypeScript 5.9.3, three 0.186.1): dua lantai dari `design/world.json`, kontrol CEO + collision navgrid, tangga/lift bertanda, cutaway dinding, direktori DOM + fallback tanpa WebGL, tema terang/gelap, joystick, mode visitor, harness perf.
- Navgrid TS = Python (parity count + probe): `docs/evidence/M1/vitest.txt`.
- E2E desktop/tablet/mobile: 33 lolos, 3 skip by design (`docs/evidence/M1/e2e-world.txt`, screenshot di `docs/evidence/M1/screenshots/`).
- Karakter original: 7 GLB dari `blender/characters/build_characters.py`, reopen/validate 83/80 cek per karakter lolos, dijalankan ulang oleh pelaksana (`docs/evidence/M1/blender-validate-rerun.txt`); sheet di `assets/previews/`.
- CAD: A-101 dan A-102 DXF + PDF A2 1:100 (`drawings/`, `cad/out/`), 16 test CAD lolos; runbook AutoCAD.
- Benchmark 60 s rute tetap (SwiftShader, tanpa GPU): 5,6 FPS rata-rata, median 166 ms, p95 396 ms; angka container, bukan perangkat (`docs/evidence/M1/perf-route-desktop.json`).
- Python tests: 93 lolos. Contrast: 31/31 pasangan lolos di kedua tema.

Failure/boundary yang tercatat:
- CI pertama gagal karena runner tidak punya `pdftoppm`; diperbaiki dengan instalasi poppler-utils di workflow.
- Run perf pertama dibuang: frame time ter-clamp 100 ms (bug metrik), diperbaiki memakai delta mentah.
- Triangle L1 awal 188k (melebihi anggaran lingkungan 135k) diturunkan ke 25k per lantai.

Known issues: walk native karakter 0,85 m/s sehingga clip dipercepat sesuai kecepatan; LOD1 NPC, sheet ekspresi dan atlas belum ada; kaki menggantung saat duduk (stilisasi); preview sheet memakai outline Freestyle yang tidak ada di runtime.

## M0 (branch claude/kantor-rpg-m0)

Status: DONE_M0 untuk lingkup data/dokumen; native DWG BLOCKED (AutoCAD tidak tersedia); NEEDS_INPUT Q-01 sampai Q-04 (tidak memblokir M1).

Hasil:
- Capability report: `docs/evidence/M0/capability-report.md` (Blender 4.0.2 tersedia; AutoCAD tidak ada; Chromium 141; Node 22).
- Dataset: `design/world.json` revisi P02 + `design/world.schema.json`; editor-of-record `design/authoring/seed_world.py`.
- Validator: `tools/validate_world.py` 40 pemeriksaan, 40 lolos (`docs/evidence/M0/validate-world.txt`, `.json`).
- Room schedule + adjacency: `docs/room-schedule.md`, `design/derived/room-schedule.{json,csv}`; 10/10 aturan adjacency lolos.
- Kapasitas: `tools/capacity.py` -> `design/derived/capacity.json`, `docs/capacity.md`.
- ICT: `tools/ict_derive.py` -> `design/derived/ict-portmap.{json,csv}`; 45 outlet, 72 port, 0 error.
- Requirement matrix: `design/requirements.json` -> `docs/requirements-matrix.md` (8 bagian terverifikasi, 11 belum diuji, 2 asumsi, 2 tidak didukung).
- Sheet register target: `design/sheets.json`.
- PRD v0.2: `PRD/PRD-v0.2.md` + `PRD/PRD-v0.2.pdf` (7 halaman A4).
- Asumsi: `docs/assumptions.md`; keputusan teknis: `docs/decisions.md`.
- Rebuild: `python3 tools/build_design.py`; receipts: `./tools/evidence_m0.sh`.

Failure/boundary paths yang dieksekusi:
- Validator pertama kali menemukan 7 kegagalan nyata pada layout awal (fixture menembus dinding, pintu terhalang, tangga menutup jalur, kunci visitor bocor karena dinding sudah terpotong di pintu). Semua diperbaiki di data/algoritma, bukan dengan melonggarkan check.
- `docs/evidence/M0/failure-paths/ict-switch-spare-below-target.txt`: dua switch hanya memberi spare 18 persen, derivasi keluar dengan exit 1; desain ditambah switch ketiga.
- Test negatif pytest: overlap ruang, ruang di luar envelope, pintu bukan di dinding, fixture menghalangi pintu, clearance biliar, ruang tersegel, server bocor ke visitor, kamera di shower, outlet orphan, tabrakan U rack, drift dataset, spare switch, panjang link berlebih.

Known issues:
- Rasio eksplorasi 0,72 ruang terhadap 47 area pixel (Q-01).
- L2 hanya satu tangga dalam envelope (AS-EXIT-01, Q-02).
- Budget PoE switch, rating UPS, thermal belum divalidasi (butuh datasheet).
- Rate limit runtime menampilkan status "rejected" jendela 7 hari (reset 2026-10-03 16:00 UTC); belum menghentikan kerja.

Next safe action: M1 vertical slice di branch claude/kantor-rpg-m1.
