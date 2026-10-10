# Matriks requirement

Dibuat dari `design/requirements.json` oleh `tools/req_matrix.py` (basis commit 55eb4de; evidence menunjuk file di repo).
Status hanya 'terverifikasi' bila bagian itu punya evidence file hasil eksekusi pada commit tercatat. Evidence kosong = belum diuji.

| REQ | Milestone | Bagian | Test | Evidence | Status |
|---|---|---|---|---|---|
| REQ-WORLD-01 | M1 | M0 data: reachability semua ruang non-shaft lewat navgrid + vertical link | tools/validate_world.py::nav_all_rooms_reachable_staff<br>tests/py/test_world.py::test_nav_detects_blocked_room | docs/evidence/M0/validate-world.json<br>docs/evidence/M0/pytest.txt | terverifikasi |
| REQ-WORLD-01 | M1 | M0 data: server terkunci untuk visitor | tools/validate_world.py::nav_restricted_locked_for_visitor<br>tests/py/test_world.py::test_visitor_cannot_reach_server_even_if_door_public_elsewhere | docs/evidence/M0/validate-world.json | terverifikasi |
| REQ-WORLD-01 | M1 | M1 runtime: CEO berjalan, collider, transisi lantai, safe waypoint | app/tests/unit/navgrid.test.ts<br>app/tests/e2e/world.spec.ts | docs/evidence/M1/e2e-world.txt<br>docs/evidence/M1/vitest.txt<br>docs/evidence/M1/screenshots/desktop-l2-game.jpg | terverifikasi |
| REQ-WORLD-01 | M1 | Q-01 (ADR-008): 27 fungsi program PRD v0.1 bagian 5 terlacak ke 38 ruang dan sebaliknya; ruang/fungsi tanpa pasangan menggagalkan test | tools/prd_trace.py<br>tests/py/test_prd_trace.py | docs/evidence/HARDENING/prd-trace.json<br>docs/evidence/HARDENING/pytest.txt | terverifikasi |
| REQ-CHAR-01 | M1/M2 | M0 data: actor record, role, homeSeat, simulated=true | tools/validate_world.py::actors_home_seats_exist<br>design/world.schema.json | docs/evidence/M0/validate-world.json | terverifikasi |
| REQ-CHAR-01 | M1/M2 | M1 asset: 7 GLB karakter original, registry, 13 animasi, reopen/validate | blender/validate_assets.py<br>tests/py/test_assets.py | docs/evidence/M1/blender-validate.json<br>docs/evidence/M1/blender-validate-rerun.txt<br>assets/previews/ch-ceo-sheet.png | terverifikasi |
| REQ-CHAR-01 | M1/M2 | M2 runtime: NPC spawn, label peran, animasi per aktivitas | app/tests/e2e/npc.spec.ts | docs/evidence/M2/e2e-all.txt<br>docs/evidence/M2/screenshots/desktop-npcs.jpg<br>docs/evidence/M2/e2e-npc-blueprint-rerun.txt | terverifikasi |
| REQ-CHAR-01 | M1/M2 | Hardening: atlas 1 material per karakter, LOD1 <= 5k triangle (4799-4800), 5 ekspresi wajah (blink, smile, talk, surprised, frown) sebagai morph target; dieksekusi, blend/GLB dibuka ulang dan divalidasi; runtime memakai LOD1 > 8 m dan ekspresi saat bicara | blender/validate_assets.py<br>tests/py/test_assets.py<br>app/tests/e2e/npc.spec.ts<br>app/tests/e2e/budget.spec.ts | docs/evidence/HARDENING/blender-characters-validate.txt<br>docs/evidence/HARDENING/pytest-blender.txt<br>assets/previews/character-expressions.png<br>assets/previews/character-lod.png<br>docs/evidence/HARDENING/e2e-all.txt | terverifikasi |
| REQ-CHAR-01 | M1/M2 | M3: 54 keluarga furniture original + shell bangunan, registry 63 aset generated+validated | blender/furniture/validate_furniture.py<br>tests/py/test_furniture_assets.py | docs/evidence/M3/furniture-validate.json<br>assets/previews/furniture-sheet.png | terverifikasi |
| REQ-INTERACT-01 | M2 | M2: E/Aksi/Temui membuka satu panel persona, locomotion berhenti, Escape menutup dan focus kembali, NPC pause/resume | app/tests/e2e/npc.spec.ts<br>app/tests/e2e/world.spec.ts | docs/evidence/M2/e2e-all.txt<br>docs/evidence/M2/screenshots/desktop-npc-dialog.jpg<br>docs/evidence/M2/e2e-npc-blueprint-rerun.txt | terverifikasi |
| REQ-INTERACT-01 | M2 | M2: interaksi furnitur (duduk, workstation, biliar, game, gym) dengan reservasi bersama NPC; kursi terpakai ditolak dengan pesan | app/tests/e2e/activity.spec.ts | docs/evidence/M2/e2e-all.txt<br>docs/evidence/M2/screenshots/desktop-billiards.jpg | terverifikasi |
| REQ-INTERACT-01 | M2 | Boundary: public hanya fixture; adapter private M4 melempar AdapterDisabledError | app/tests/unit/adapter.test.ts | docs/evidence/M2/vitest.txt | terverifikasi |
| REQ-IDLE-01 | M2 | M0 data: activity slots ber-capacity dan approachable | tools/validate_world.py::nav_activity_slots_approachable | docs/evidence/M0/validate-world.json | terverifikasi |
| REQ-IDLE-01 | M2 | M2: simulasi berseed, reservasi tanpa overcapacity (soak 2 jam), cap aktivitas, stuck recovery, nol fetch | app/tests/unit/idle.test.ts | docs/evidence/M2/vitest.txt | terverifikasi |
| REQ-IDLE-01 | M2 | Hardening: CEO dan persona tidak saling tembus; NPC memberi jalan, detour, reservasi kursi tetap saat menunggu; tidak ada NPC diam > 10 s (seed 3/11/23, soak 2 jam); bug lama NPC membeku di sel sudut diperbaiki | app/tests/unit/collision.test.ts<br>app/tests/unit/idle.test.ts | docs/evidence/HARDENING/vitest.txt | terverifikasi |
| REQ-IDLE-01 | M2 | R2: nol langkah NPC berjalan yang masuk ke cakram agen lain (CEO termasuk) pada soak seed 42 (2 jam), 11 dan 3 (sebelumnya 401); give-way untuk saling-tunggu | app/tests/unit/collision.test.ts | docs/evidence/R2/npc-overlap-red.txt<br>docs/evidence/R2/vitest.txt | terverifikasi |
| REQ-STUDIO-01 | M3 | M3: Office Studio edit/undo/redo/save/load/publish/rollback, validasi overlap/pintu/navigasi, import terjaga | app/tests/unit/studio.test.ts<br>app/tests/e2e/studio.spec.ts | docs/evidence/M3/vitest.txt<br>docs/evidence/M3/e2e-all.txt<br>docs/evidence/M3/screenshots/desktop-studio.jpg | terverifikasi |
| REQ-AVATAR-01 | M3 | M3: Avatar Studio preview/save/reset, persist, fallback default untuk pilihan tanpa aset | app/tests/e2e/studio.spec.ts | docs/evidence/M3/e2e-all.txt<br>docs/evidence/M3/screenshots/desktop-avatar-studio.jpg | terverifikasi |
| REQ-BLUEPRINT-01 | M0/M3 | M0: schema satu sumber, ruang tanpa overlap/gap, pintu di dinding bersama, fixture dalam ruang | tools/validate_world.py<br>tests/py/test_world.py | docs/evidence/M0/validate-world.json<br>docs/evidence/M0/pytest.txt | terverifikasi |
| REQ-BLUEPRINT-01 | M0/M3 | M0: capability CAD dilaporkan; native DWG (15 DWG R2018 AutoCAD 2025: reopen, AUDIT 0 error, unit mm, jumlah entitas cocok DXF). Plot PDF native AutoCAD dikeluarkan dari lingkup atas keputusan Budi 2026-10-10 (tanpa akun Autodesk); PDF resmi = PDF vektor generator | docs/evidence/M0/capability-report.md | docs/evidence/M0/capability-report.md<br>docs/evidence/MAX/native-dwg/report.json | terverifikasi |
| REQ-BLUEPRINT-01 | M0/M3 | M1: A-101/A-102 DXF+PDF konsisten dengan dataset (reopen, audit, luas, ID pintu/fixture, skala) | tests/py/test_cad.py | docs/evidence/M1/cad-pytest.txt<br>drawings/register.json | terverifikasi |
| REQ-BLUEPRINT-01 | M0/M3 | M3: 15 sheet DXF+PDF, paket gabungan; GLB bangunan konsisten dengan dataset (dinding, bukaan, slab, axis) | tests/py/test_cad_m3.py<br>blender/building/validate_building.py<br>tests/py/test_building.py | docs/evidence/M3/cad-pytest.txt<br>docs/evidence/M3/building-validate.json<br>drawings/register.json | terverifikasi |
| REQ-BLUEPRINT-01 | M0/M3 | P03: arah bukaan pintu dan 39 jendela konsep satu sumber di world.json, dibaca CAD (denah, tampak, potongan, jadwal pintu/jendela), Blender (bukaan, kaca, daun pintu) dan runtime (dinding terpotong jendela) | tests/py/test_openings.py<br>tests/py/test_cad_openings.py<br>tests/py/test_building.py<br>blender/building/validate_building.py<br>app/tests/unit/openings.test.ts | docs/evidence/HARDENING/pytest.txt<br>docs/evidence/HARDENING/pytest-cad.txt<br>docs/evidence/HARDENING/blender-building-validate.txt<br>docs/evidence/HARDENING/vitest.txt | terverifikasi |
| REQ-BLUEPRINT-01 | M0/M3 | R2: daun pintu runtime dari derivasi yang sama dengan navgrid Python/TS, busur CAD dan engsel LEAF-* Blender; buka otomatis, posisi terbuka solid, terkunci pada mode visitor; Studio menolak furniture di area ayun | tests/py/test_door_leaves.py<br>app/tests/unit/doors.test.ts<br>app/tests/e2e/doors.spec.ts | docs/evidence/R2/door-leaves-red.txt<br>docs/evidence/R2/doors-ts-red.txt<br>docs/evidence/R2/pytest.txt<br>docs/evidence/R2/vitest.txt | terverifikasi |
| REQ-BLUEPRINT-01 | M0/M3 | R2: semua teks 15 sheet A/I/ICT >= 2,5 mm saat dicetak A3 (ukuran font, pembacaan longgar ISO 3098), tanpa tumpang tindih; tag pendek dengan tabel lookup | tests/py/test_cad_legibility.py | docs/evidence/R2/cad-legibility-all-red.txt<br>docs/evidence/R2/cad-legibility-sizes.json<br>docs/evidence/R2/pytest-cad.txt | terverifikasi |
| REQ-ICT-01 | M0/M3 | M0: FK outlet/device/rack, rack U collision, kamera tidak di area basah | tools/validate_world.py::ict_foreign_keys<br>tests/py/test_ict.py | docs/evidence/M0/validate-world.json<br>docs/evidence/M0/pytest.txt | terverifikasi |
| REQ-ICT-01 | M0/M3 | M0: port map tanpa duplikat, panjang dari route tray, <= 90 m target, spare switch >= 20% | tools/ict_derive.py<br>tests/py/test_ict.py | design/derived/ict-portmap.json<br>docs/evidence/M0/failure-paths/ict-switch-spare-below-target.txt | terverifikasi |
| REQ-ICT-01 | M0/M3 | PoE budget per switch (SW-ACC-01 508,75/600 W), UPS W/VA (74% dari 2700 W/3000 VA), panas ruang server 2,0 kW sebagai input MEP: model referensi konsep, datasheet vendor 2026-10-04 (Nova) | tests/py/test_ict_power.py<br>tools/ict_power.py | design/derived/ict-power.json<br>docs/evidence/MAX/ict-sources/<br>docs/evidence/R2/ict-power-rerun.txt | terverifikasi |
| REQ-ICT-01 | M0/M3 | Runtime UPS >= 10 menit (target Budi 2026-10-05) pada beban 1609 W: kurva vendor + 1 EBM 35,9 menit, x0,8 penuaan = 28,7 menit; baterai internal saja 7,1 menit (gagal, dicatat) | tests/py/test_ict_power.py | design/derived/ict-power.json<br>docs/evidence/MAX/ict-sources/ups-runtime-chart-ebm.json<br>docs/evidence/MAX/ict-sources/ups-runtime-chart.json | terverifikasi |
| REQ-ICT-01 | M0/M3 | M3: gambar ICT-001/101/102/201/301/401 konsisten dengan port map (ID, panjang total, U rack) | tests/py/test_cad_m3.py | docs/evidence/M3/cad-pytest.txt | terverifikasi |
| REQ-ICT-01 | M0/M3 | Outlet ICT ikut furniture di Office Studio: pindah/hapus/tambah, undo/redo, export v2 + import menolak outlet yang diedit, publish/rollback; paritas Python/TS; ict_derive.py --layout | tests/py/test_ict_follow.py<br>app/tests/unit/ict.test.ts<br>app/tests/e2e/studio.spec.ts | docs/evidence/HARDENING/pytest.txt<br>docs/evidence/HARDENING/vitest.txt<br>docs/evidence/HARDENING/e2e-all.txt | terverifikasi |
| REQ-ACCESS-01 | M1/M2 | M1: fallback ?nogl=1, direktori keyboard, focus kembali, reduced motion (viewport emulasi) | app/tests/e2e/world.spec.ts | docs/evidence/M1/e2e-world.txt<br>docs/evidence/M1/screenshots/desktop-fallback.jpg<br>docs/evidence/M1/contrast.json | terverifikasi |
| REQ-ACCESS-01 | M1/M2 | M2: axe-core WCAG 2.1 A/AA tanpa pelanggaran (dunia, direktori, dialog, fallback; terang dan gelap) | app/tests/e2e/a11y.spec.ts<br>tools/contrast.py | docs/evidence/M2/e2e-all.txt<br>docs/evidence/M2/axe/desktop-light-world.json<br>docs/evidence/M2/contrast.json | terverifikasi |
| REQ-ACCESS-01 | M1/M2 | Perangkat mobile nyata: iPhone 13 Pro, Safari, benchmark rute tetap 3x60 s tanpa error (tablet fisik dan iOS VoiceOver belum) | app/tests/e2e/perf.spec.ts | docs/evidence/DEVICE/2026-10-04-iphone13pro-summary.json | terverifikasi |
| REQ-ACCESS-01 | M1/M2 | R2: setiap kontrol dan shortcut punya test (61, sebelumnya 25 tanpa test); jalur gagal context loss, aksi tanpa target, GLB hilang; tiga cacat fallback ditemukan dan diperbaiki | tools/control_audit.py<br>tests/py/test_control_audit.py<br>app/tests/e2e/controls.spec.ts<br>app/tests/e2e/failures.spec.ts | docs/evidence/R2/control-audit-red.txt<br>docs/evidence/R2/control-audit.json | terverifikasi |
| REQ-ACCESS-01 | M1/M2 | Screen reader nyata: macOS VoiceOver + Safari, 8 skenario DEVICE-VALIDATION §2 lewat keyboard pada release a041f5a1 (iOS VoiceOver/TalkBack belum) | tools/voiceover_probe.py<br>tools/voiceover_keyboard.py<br>tools/voiceover_round4.py | docs/evidence/MAX/voiceover/HASIL.md<br>docs/evidence/MAX/voiceover/probe-1.json<br>docs/evidence/MAX/voiceover/probe-2.json<br>docs/evidence/MAX/voiceover/probe-3.json<br>docs/evidence/MAX/voiceover/probe-4.json<br>docs/evidence/MAX/voiceover/probe-5.json<br>docs/evidence/MAX/voiceover/probe-6.json | terverifikasi |
| REQ-DATA-01 | M4 | Integrasi private M4 (AC-DATA-01): backend privat membaca Kanban/_Bersama/agent.log/omp; snapshot berisi source + observedAt per papan; sumber gagal ok=false, bukan kosong sukses (ADR-016) | server/test/api.test.mjs<br>app/tests/e2e/private.spec.ts | docs/evidence/M45/server-test.txt<br>docs/evidence/M45/e2e-private.txt | terverifikasi |
| REQ-DATA-01 | M4 | Kontrak adapter (sanitasi allowlist, stale -> unknown) diuji dengan fixture; tanpa sumber nyata | app/tests/unit/adapter.test.ts | docs/evidence/M2/vitest.txt | terverifikasi |
| REQ-DATA-01 | M4 | Boundary v0.2: build publik menolak mode private (AdapterDisabledError) dan hanya meminta origin sendiri | app/tests/unit/adapter.test.ts<br>app/tests/e2e/world.spec.ts | docs/evidence/M2/vitest.txt<br>docs/evidence/MAX/v02-public-deploy2-final-results.json | terverifikasi |
| REQ-PERF-01 | M1-M3 | Anggaran transfer/triangle: dihitung (capacity.json) lalu diukur. Muat awal 5,40 MB <= 6 MB; scene terlihat 189,6k triangle <= 250k pada kualitas tinggi dan rendah. Pass bayangan kualitas tinggi menambah 189k (total 378,6k/frame), dicatat terpisah; iPhone 13 Pro tetap 59,5 FPS | tools/capacity.py<br>app/tests/e2e/budget.spec.ts<br>app/tests/e2e/bundle.spec.ts | design/derived/capacity.json<br>docs/evidence/MAX/v02-triangle-split.json<br>docs/evidence/DEVICE/2026-10-04-iphone13pro-summary.json | terverifikasi |
| REQ-PERF-01 | M1-M3 | M1: harness rute tetap 60 s berjalan dan tercatat (container SwiftShader) | app/tests/e2e/perf.spec.ts | docs/evidence/M1/perf-route-desktop.json | terverifikasi |
| REQ-PERF-01 | M1-M3 | Target 30 FPS mobile: iPhone 13 Pro fisik, 3 run rute tetap 60 s, median 59,5 FPS (desktop Mac mini M4 179 FPS di MAX/device) | app/tests/e2e/perf.spec.ts | docs/evidence/DEVICE/2026-10-04-iphone13pro-summary.json<br>docs/evidence/DEVICE/2026-10-04-iphone13pro-run1.json<br>docs/evidence/DEVICE/2026-10-04-iphone13pro-run2.json<br>docs/evidence/DEVICE/2026-10-04-iphone13pro-run3.json | terverifikasi |
| REQ-PERF-01 | M1-M3 | Anggaran draw call mobile <= 150 dan triangle <= 250k: puncak per frame selama rute tetap 25 s, desktop/tablet/mobile (draw call dan triangle tidak bergantung kecepatan GPU) | app/tests/e2e/budget.spec.ts | docs/evidence/HARDENING/budget-desktop.json<br>docs/evidence/HARDENING/budget-mobile.json<br>docs/evidence/HARDENING/budget-tablet.json<br>docs/evidence/HARDENING/e2e-unskipped-touch.txt | terverifikasi |
| REQ-PERF-01 | M1-M3 | R2: muat awal <= 6 MB (5,40 MB, sebelumnya 9,73 MB), chunk entry <= 250 kB, three.js chunk terpisah, Studio dimuat saat dipakai; GLB terkuantisasi dengan galat <= 1 mm | app/tests/e2e/bundle.spec.ts<br>tests/py/test_asset_size.py<br>app/tests/unit/furniture-kit.test.ts | docs/evidence/R2/bundle-red.txt<br>docs/evidence/R2/bundle-desktop.json<br>docs/evidence/R2/glb-sizes-r2.json<br>docs/evidence/R2/glb-compare.json | terverifikasi |
| REQ-SAFE-01 | semua | M0: secret/URL/file allowlist scan repo | tools/safety_scan.py | docs/evidence/M0/safety-scan.txt | terverifikasi |
| REQ-SAFE-01 | semua | M1: runtime hanya request same-origin; safety scan | app/tests/e2e/world.spec.ts<br>tools/safety_scan.py | docs/evidence/M1/e2e-world.txt | terverifikasi |
| REQ-SAFE-01 | semua | Audit lisensi dependency npm/pip | tools/license_audit.py | docs/evidence/M3/license-audit.json | terverifikasi |
| REQ-SAFE-01 | semua | Provenance: setiap file app/public dipetakan ke generator repo (GLB registry, artwork make_signage, PDF hasil generate, teks lisensi); file asing gagal | tests/py/test_provenance.py | docs/evidence/HARDENING/pytest.txt | terverifikasi |
| REQ-SAFE-01 | semua | Keamanan: safety scan teks repo, npm audit runtime + dev, audit lisensi | tools/safety_scan.py<br>tools/license_audit.py | docs/evidence/HARDENING/safety-scan.txt<br>docs/evidence/HARDENING/npm-audit-runtime.txt<br>docs/evidence/HARDENING/npm-audit-all.txt<br>docs/evidence/HARDENING/license-audit.json<br>docs/evidence/HARDENING/e2e-csp-desktop.txt<br>docs/evidence/HARDENING/e2e-csp-desktop-run1.txt | terverifikasi |
| REQ-SAFE-01 | semua | R2: audit Must per AC/test/failure/boundary untuk 12 REQ PRD bagian 12, referensi diperiksa ada | tools/must_audit.py<br>tests/py/test_must_audit.py | docs/MUST-AUDIT.md | terverifikasi |
| REQ-BOARD-01 | M4 | Papan Handoff: tiap tugas Kanban HANDOFF muncul sekali dengan dari/ke/status/umur/badan, rantai kerja, >24 jam belum diterima berlabel Perlu perhatian | server/test/api.test.mjs<br>app/tests/e2e/private.spec.ts | docs/evidence/M45/server-test.txt<br>docs/evidence/M45/e2e-private.txt | terverifikasi |
| REQ-BOARD-02 | M4 | Daftar Pekerjaan: filter bot/badan/status, urutan diblokir-jalan-antre-selesai, drop omp aktif, profil pribadi tersamar | server/test/api.test.mjs<br>app/tests/e2e/private.spec.ts | docs/evidence/M45/server-test.txt<br>docs/evidence/M45/e2e-private.txt | terverifikasi |
| REQ-BOARD-03 | M4 | Log Aktivitas: 24 jam terurut waktu, kuota 50 tugas + 110 alat, kata kerja Indonesia, tanpa path/token/isi obrolan; baris tugas membuka tugas terkait | server/test/api.test.mjs<br>app/tests/e2e/private.spec.ts | docs/evidence/M45/server-test.txt<br>docs/evidence/M45/e2e-private.txt | terverifikasi |
| REQ-BOARD-04 | M4 | Visitor: papan berlabel Demo, API menolak tanpa login, bundle dan respons publik tanpa judul tugas nyata | server/test/api.test.mjs<br>app/tests/e2e/private.spec.ts | docs/evidence/M45/server-test.txt<br>docs/evidence/M45/e2e-private.txt | terverifikasi |
| REQ-BOARD-05 | M4 | Sumber gagal tampil Tidak diketahui; pembaruan gagal tampil Basi dengan waktu observasi terakhir | server/test/api.test.mjs<br>app/tests/e2e/private.spec.ts | docs/evidence/M45/server-test.txt<br>docs/evidence/M45/e2e-private.txt | terverifikasi |
| REQ-CMD-01 | M5 | Owner login memberi tugas dari karakter (Bicara & beri tugas) atau directory (Beri tugas); profil tujuan menerima tepat pesan itu; riwayat profil lain terpisah | server/test/api.test.mjs<br>app/tests/e2e/private.spec.ts | docs/evidence/M45/server-test.txt<br>docs/evidence/M45/e2e-private.txt | terverifikasi |
| REQ-CHOICE-01 | M5 | Tepat tiga opsi berbeda + Ketik manual, tanpa auto-submit; opsi dikirim sesuai turn ID; opsi lama/palsu ditolak | server/test/api.test.mjs<br>app/tests/e2e/private.spec.ts | docs/evidence/M45/server-test.txt<br>docs/evidence/M45/e2e-private.txt | terverifikasi |
| REQ-MANUAL-01 | M5 | Teks manual diteruskan utuh; fokus input menghentikan locomotion; Escape menutup tanpa mengirim | server/test/api.test.mjs<br>app/tests/e2e/private.spec.ts | docs/evidence/M45/server-test.txt<br>docs/evidence/M45/e2e-private.txt | terverifikasi |
| REQ-CMD-02 | M5 | Status queued/working/waiting_owner/completed/failed/unknown dari server dengan sumber dan waktu; pembatalan | server/test/api.test.mjs<br>app/tests/e2e/private.spec.ts | docs/evidence/M45/server-test.txt<br>docs/evidence/M45/e2e-private.txt | terverifikasi |
| REQ-CMD-03 | M5 | Aksi berisiko menunggu approval terpisah, terikat tugas, 15 menit, sekali pakai; tolak/kedaluwarsa/replay/salah tugas = nol dispatch | server/test/api.test.mjs<br>app/tests/e2e/private.spec.ts | docs/evidence/M45/server-test.txt<br>docs/evidence/M45/e2e-private.txt | terverifikasi |
| REQ-CMD-04 | M5 | Visitor/tanpa header proxy/tanpa CSRF/origin asing ditolak; nol dispatch | server/test/api.test.mjs<br>app/tests/e2e/private.spec.ts | docs/evidence/M45/server-test.txt<br>docs/evidence/M45/e2e-private.txt | terverifikasi |
| REQ-CMD-05 | M5 | Idempotency key: klik ganda dan kirim ulang tidak membuat tugas kedua; gagal dan unknown ditampilkan jujur tanpa retry otomatis | server/test/api.test.mjs<br>app/tests/e2e/private.spec.ts | docs/evidence/M45/server-test.txt<br>docs/evidence/M45/e2e-private.txt | terverifikasi |
| REQ-AUTH-01 | M4/M5 | Login sandi scrypt + TOTP RFC 6238, setup sekali pakai, rate limit, logout | server/test/api.test.mjs<br>app/tests/e2e/private.spec.ts | docs/evidence/M45/server-test.txt<br>docs/evidence/M45/e2e-private.txt | terverifikasi |
| REQ-PRESENCE-01 | M6 | NPC dengan bukti kerja (tugas RPG, Kanban running/claimed, agent.log <=5 menit) duduk di mejanya dan mengetik sampai bukti hilang; visitor tetap simulasi. | server/test/api.test.mjs<br>app/tests/unit/idle.test.ts | docs/evidence/M6/server-test.txt<br>docs/evidence/M45/vitest.txt | terverifikasi |
| REQ-CHATKEY-01 | M6 | Daftar semua agen dengan lane + status; memilih membuka profil yang benar; menu HUD HP tidak terpotong. | app/tests/e2e/private.spec.ts | docs/evidence/M45/e2e-private.txt | terverifikasi |
| REQ-TGSYNC-01 | M6 | Transkrip Telegram tampil; kirim dari RPG melanjutkan sesi Telegram aktif; /new diikuti; balasan ikut ke Telegram; pilihan kedaluwarsa bila obrolan Telegram berlanjut. | server/test/api.test.mjs<br>app/tests/e2e/private.spec.ts | docs/evidence/M6/server-test.txt<br>docs/evidence/M6/desktop-agent-telegram-sync.jpg | terverifikasi |
| REQ-SHARE-01 | M6 | Ekspor repo komunitas + INSTALL + pindai | - | - | target |
| REQ-CHATFEEL-01 | M7 | Mengetik dari tugas RPG berjalan atau pesan Telegram Budi belum dibalas (maks 10 menit); centang sent/delivered/read; aktif X menit lalu; pemisah tanggal WITA; Balas/Salin; bunyi + (n) di judul tab. | server/test/chat-state.test.mjs<br>server/test/api.test.mjs<br>app/tests/e2e/private.spec.ts | docs/evidence/M7/server-test.txt<br>docs/evidence/M7/desktop-agent-telegram-sync.jpg | terverifikasi |
| REQ-CHATPUSH-01 | M7 | Web Push RFC 8291 + VAPID ES256 dari backend sendiri; izin lewat tombol; bisu per bot per perangkat; ketuk membuka chat; manifest PWA + ikon. | server/test/media-push.test.mjs<br>app/tests/e2e/private.spec.ts | docs/evidence/M7/server-test.txt | terverifikasi |
| REQ-CHATMEDIA-01 | M7 | Lampiran <=10 MB, <=5/pesan, daftar putih + magic bytes; agen menerima path lokal format gateway Telegram; suara -> mlx-whisper lokal; URL bertanda tangan HMAC; lampiran Telegram tampil; cari seluruh riwayat sesi; retensi 30 hari. | server/test/media-push.test.mjs<br>server/test/api.test.mjs<br>app/tests/e2e/private.spec.ts | docs/evidence/M7/server-test.txt<br>docs/evidence/M7/desktop-agent-media-search.jpg | terverifikasi |

Ringkasan status bagian: target 1, terverifikasi 69.

## Story, AC, failure dan boundary

### REQ-WORLD-01 (M1)

Sebagai CEO, saya ingin menjelajahi dua lantai agar memahami kantor.

AC-WORLD-01: Given world valid, When CEO berjalan dan memakai transisi lantai, Then semua ruang wajib dapat dicapai tanpa menerobos collider.

Failure: stuck -> safe waypoint. Boundary: server room visitor tetap terkunci.

### REQ-CHAR-01 (M1/M2)

Sebagai CEO, saya ingin mengenali persona agar menemui peran tepat.

AC-CHAR-01: Given asset registry, When NPC spawn/talk, Then label peran dan animasi konsisten tanpa memakai IP pihak lain.

Failure: missing GLB -> honest placeholder. Boundary: tidak mengarang likeness manusia.

### REQ-INTERACT-01 (M2)

Sebagai CEO, saya ingin menyapa dan membuka panel agar memahami aktivitas.

AC-INTERACT-01: Given NPC dekat, When E/tap, Then satu panel terbuka dan locomotion berhenti; Escape menutup dan mengembalikan focus.

Failure: target hilang -> pesan jelas. Boundary: public hanya fixture.

### REQ-IDLE-01 (M2)

Sebagai visitor, saya ingin aktivitas beragam agar kantor terasa hidup.

AC-IDLE-01: Given seed dan NPC, When idle simulation berjalan, Then reservasi tidak overcapacity, NPC tidak stuck permanen dan task status tidak dipalsukan.

Failure: route gagal -> cancel/release. Boundary: nol LLM/API calls akibat idle.

### REQ-STUDIO-01 (M3)

Sebagai designer, saya ingin mengedit draft kantor agar menata ruang.

AC-STUDIO-01: Given valid layout, When edit/undo/save/load, Then perubahan pulih deterministik dan invalid overlap/pintu ditolak.

Failure: JSON rusak -> original tetap utuh. Boundary: tidak eksekusi script/file path import.

### REQ-AVATAR-01 (M3)

Sebagai CEO, saya ingin memilih avatar agar punya tampilan sendiri.

AC-AVATAR-01: Given varian tersedia, When preview/save/reset, Then pilihan persist dan reset kembali default.

Failure: asset missing -> default. Boundary: tidak memakai Pokemon atau wajah manusia tanpa sumber.

### REQ-BLUEPRINT-01 (M0/M3)

Sebagai CEO, saya ingin melihat denah CAD/PDF/3D agar memahami rancangan.

AC-BLUEPRINT-01: Given design schema, When generate, Then dimensi/pintu/fixture ID konsisten dalam DXF, PDF dan GLB, source CAD availability dilaporkan.

Failure: AutoCAD unavailable -> native DWG blocked, bukan sukses palsu. Boundary: konsep bukan signed construction.

### REQ-ICT-01 (M0/M3)

Sebagai designer ICT, saya ingin schedule endpoint/rack/route agar instalasi dapat dibaca.

AC-ICT-01: Given device schedule, When derive ports/BOM, Then tidak ada orphan ID/duplicate port dan panjang memakai route.

Failure: spec missing -> belum divalidasi. Boundary: no real ISP topology/device access.

### REQ-ACCESS-01 (M1/M2)

Sebagai visitor, saya ingin directory tanpa 3D agar tetap memakai kantor.

AC-ACCESS-01: Given WebGL unavailable/reduced motion, When membuka app, Then DOM directory/dokumen dapat dipakai lewat keyboard dan tap.

Failure: render context loss -> fallback. Boundary: aksesible view tidak bypass private policy.

### REQ-DATA-01 (M4)

Sebagai owner private, saya ingin status tersanitasi agar melihat kerja real.

AC-DATA-01: Given approved adapter, When snapshot fresh/stale/offline, Then status/time/source benar dan unknown saat timeout.

Failure: disconnect -> stale/unknown. Boundary: visitor/unauth tidak menerima payload private. Disabled sebelum izin..

### REQ-PERF-01 (M1-M3)

Sebagai CEO, saya ingin navigasi stabil agar bermain nyaman.

AC-PERF-01: Given benchmark tercatat, When fixed route 60 detik berjalan, Then measured frame-time/load/assets memenuhi target tier atau degrade jujur.

Failure: memory/context loss -> low quality/fallback. Boundary: tidak klaim FPS tanpa benchmark.

### REQ-SAFE-01 (semua)

Sebagai pemilik, saya ingin publikasi aman agar data private/produksi tidak bocor.

AC-SAFE-01: Given staged files and app build, When scanning and public negative tests, Then no secrets/private payload/copyright asset and no production endpoint/cost/control path.

Failure: suspect -> stop publish. Boundary: no merge/deploy/paid upgrade.

### REQ-BOARD-01 (M4)

PRD v1.1 bagian 18.5

Lihat PRD-v1.1.md 18.5

Failure: lihat AC. Boundary: owner login saja; visitor Demo.

### REQ-BOARD-02 (M4)

PRD v1.1 bagian 18.5

Lihat PRD-v1.1.md 18.5

Failure: lihat AC. Boundary: owner login saja; visitor Demo.

### REQ-BOARD-03 (M4)

PRD v1.1 bagian 18.5

Lihat PRD-v1.1.md 18.5

Failure: lihat AC. Boundary: owner login saja; visitor Demo.

### REQ-BOARD-04 (M4)

PRD v1.1 bagian 18.5

Lihat PRD-v1.1.md 18.5

Failure: lihat AC. Boundary: owner login saja; visitor Demo.

### REQ-BOARD-05 (M4)

PRD v1.1 bagian 18.5

Lihat PRD-v1.1.md 18.5

Failure: lihat AC. Boundary: owner login saja; visitor Demo.

### REQ-CMD-01 (M5)

PRD v1.1 bagian 17.5

Lihat PRD-v1.1.md 17.5

Failure: lihat AC. Boundary: owner login saja; visitor Demo.

### REQ-CHOICE-01 (M5)

PRD v1.1 bagian 17.5

Lihat PRD-v1.1.md 17.5

Failure: lihat AC. Boundary: owner login saja; visitor Demo.

### REQ-MANUAL-01 (M5)

PRD v1.1 bagian 17.5

Lihat PRD-v1.1.md 17.5

Failure: lihat AC. Boundary: owner login saja; visitor Demo.

### REQ-CMD-02 (M5)

PRD v1.1 bagian 17.5

Lihat PRD-v1.1.md 17.5

Failure: lihat AC. Boundary: owner login saja; visitor Demo.

### REQ-CMD-03 (M5)

PRD v1.1 bagian 17.5

Lihat PRD-v1.1.md 17.5

Failure: lihat AC. Boundary: owner login saja; visitor Demo.

### REQ-CMD-04 (M5)

PRD v1.1 bagian 17.5

Lihat PRD-v1.1.md 17.5

Failure: lihat AC. Boundary: owner login saja; visitor Demo.

### REQ-CMD-05 (M5)

PRD v1.1 bagian 17.5

Lihat PRD-v1.1.md 17.5

Failure: lihat AC. Boundary: owner login saja; visitor Demo.

### REQ-AUTH-01 (M4/M5)

Sebagai Budi, saya login dengan sandi + 2FA di aplikasi sendiri (keputusan 2026-10-10).

Sandi salah/kode salah/kode dipakai ulang ditolak; 5 gagal per 15 menit dikunci; setup sekali pakai; owner.json 0600 tanpa sandi polos; logout mematikan sesi.

Failure: backend mati -> papan Demo, perintah tidak tersedia. Boundary: rahasia tidak pernah dikirim ke browser.

### REQ-PRESENCE-01 (M6)

Sebagai Budi, karakter agen yang sedang bekerja terlihat bekerja (status nyata).

NPC dengan bukti kerja (tugas RPG, Kanban running/claimed, agent.log <=5 menit) duduk di mejanya dan mengetik sampai bukti hilang; visitor tetap simulasi.

Failure: sumber tidak terbaca -> status tidak diketahui, bukan bekerja. Boundary: profil pribadi tidak muncul; ringkasan disaring.

### REQ-CHATKEY-01 (M6)

Sebagai Budi, saya membuka chat agen mana pun dengan tombol C / Chat agen.

Daftar semua agen dengan lane + status; memilih membuka profil yang benar; menu HUD HP tidak terpotong.

Failure: visitor mendapat penjelasan khusus owner. Boundary: tanpa data nyata untuk visitor.

### REQ-TGSYNC-01 (M6)

Sebagai Budi, chat agen di RPG = percakapan Telegram DM yang sama (ADR-017).

Transkrip Telegram tampil; kirim dari RPG melanjutkan sesi Telegram aktif; /new diikuti; balasan ikut ke Telegram; pilihan kedaluwarsa bila obrolan Telegram berlanjut.

Failure: riwayat tidak terbaca -> peringatan; sesi hilang -> gagal dengan alasan. Boundary: token bot hanya di server; state.db dibaca -readonly.

### REQ-SHARE-01 (M6)

Kantor RPG dibagikan gratis ke komunitas tanpa data internal.

Repo komunitas riwayat baru, konfigurasi pemakai, pindai pola nol temuan sebelum publikasi.

Failure: temuan pindai -> tidak dipublikasi. Boundary: repo kerja internal tetap privat.

### REQ-CHATFEEL-01 (M7)

Sebagai Budi, chat agen terasa seperti Telegram: mengetik, centang, terakhir aktif.

Mengetik dari tugas RPG berjalan atau pesan Telegram Budi belum dibalas (maks 10 menit); centang sent/delivered/read; aktif X menit lalu; pemisah tanggal WITA; Balas/Salin; bunyi + (n) di judul tab.

Failure: tanpa data -> baris status kosong, bukan karangan. Boundary: status diturunkan dari tugas + transkrip; tidak dikarang.

### REQ-CHATPUSH-01 (M7)

Sebagai Budi, notifikasi balasan agen walau tab ditutup.

Web Push RFC 8291 + VAPID ES256 dari backend sendiri; izin lewat tombol; bisu per bot per perangkat; ketuk membuka chat; manifest PWA + ikon.

Failure: endpoint bukan push service resmi -> 400; langganan 404/410 dihapus. Boundary: isi notifikasi nama bot + <=120 karakter; kunci VAPID 0600.

### REQ-CHATMEDIA-01 (M7)

Sebagai Budi, kirim foto/berkas/pesan suara dan cari pesan lama.

Lampiran <=10 MB, <=5/pesan, daftar putih + magic bytes; agen menerima path lokal format gateway Telegram; suara -> mlx-whisper lokal; URL bertanda tangan HMAC; lampiran Telegram tampil; cari seluruh riwayat sesi; retensi 30 hari.

Failure: jenis/isi tidak cocok -> 415; token palsu/keluar folder -> 404; berkas hilang -> 'sudah dihapus'. Boundary: path server tidak pernah ke browser; transkrip lokal tanpa API berbayar.
