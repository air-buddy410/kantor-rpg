# Matriks requirement

Dibuat dari `design/requirements.json` oleh `tools/req_matrix.py` (basis commit b23a0ea; evidence menunjuk file di repo).
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
| REQ-CHAR-01 | M1/M2 | Hardening: atlas 1 material per karakter, LOD1 <= 5k triangle (4799-4800), 5 ekspresi wajah (blink, smile, talk, surprised, frown) sebagai morph target; dieksekusi, blend/GLB dibuka ulang dan divalidasi; runtime memakai LOD1 > 8 m dan ekspresi saat bicara | blender/validate_assets.py<br>tests/py/test_assets.py<br>app/tests/e2e/npc.spec.ts<br>app/tests/e2e/budget.spec.ts | docs/evidence/HARDENING/blender-characters-validate.txt<br>docs/evidence/HARDENING/pytest-blender.txt<br>assets/previews/character-expressions.png<br>assets/previews/character-lod.png | terverifikasi |
| REQ-CHAR-01 | M1/M2 | M3: 54 keluarga furniture original + shell bangunan, registry 63 aset generated+validated | blender/furniture/validate_furniture.py<br>tests/py/test_furniture_assets.py | docs/evidence/M3/furniture-validate.json<br>assets/previews/furniture-sheet.png | terverifikasi |
| REQ-INTERACT-01 | M2 | M2: E/Aksi/Temui membuka satu panel persona, locomotion berhenti, Escape menutup dan focus kembali, NPC pause/resume | app/tests/e2e/npc.spec.ts<br>app/tests/e2e/world.spec.ts | docs/evidence/M2/e2e-all.txt<br>docs/evidence/M2/screenshots/desktop-npc-dialog.jpg<br>docs/evidence/M2/e2e-npc-blueprint-rerun.txt | terverifikasi |
| REQ-INTERACT-01 | M2 | M2: interaksi furnitur (duduk, workstation, biliar, game, gym) dengan reservasi bersama NPC; kursi terpakai ditolak dengan pesan | app/tests/e2e/activity.spec.ts | docs/evidence/M2/e2e-all.txt<br>docs/evidence/M2/screenshots/desktop-billiards.jpg | terverifikasi |
| REQ-INTERACT-01 | M2 | Boundary: public hanya fixture; adapter private M4 melempar AdapterDisabledError | app/tests/unit/adapter.test.ts | docs/evidence/M2/vitest.txt | terverifikasi |
| REQ-IDLE-01 | M2 | M0 data: activity slots ber-capacity dan approachable | tools/validate_world.py::nav_activity_slots_approachable | docs/evidence/M0/validate-world.json | terverifikasi |
| REQ-IDLE-01 | M2 | M2: simulasi berseed, reservasi tanpa overcapacity (soak 2 jam), cap aktivitas, stuck recovery, nol fetch | app/tests/unit/idle.test.ts | docs/evidence/M2/vitest.txt | terverifikasi |
| REQ-IDLE-01 | M2 | Hardening: CEO dan persona tidak saling tembus; NPC memberi jalan, detour, reservasi kursi tetap saat menunggu; tidak ada NPC diam > 10 s (seed 3/11/23, soak 2 jam); bug lama NPC membeku di sel sudut diperbaiki | app/tests/unit/collision.test.ts<br>app/tests/unit/idle.test.ts | docs/evidence/HARDENING/vitest.txt | terverifikasi |
| REQ-STUDIO-01 | M3 | M3: Office Studio edit/undo/redo/save/load/publish/rollback, validasi overlap/pintu/navigasi, import terjaga | app/tests/unit/studio.test.ts<br>app/tests/e2e/studio.spec.ts | docs/evidence/M3/vitest.txt<br>docs/evidence/M3/e2e-all.txt<br>docs/evidence/M3/screenshots/desktop-studio.jpg | terverifikasi |
| REQ-AVATAR-01 | M3 | M3: Avatar Studio preview/save/reset, persist, fallback default untuk pilihan tanpa aset | app/tests/e2e/studio.spec.ts | docs/evidence/M3/e2e-all.txt<br>docs/evidence/M3/screenshots/desktop-avatar-studio.jpg | terverifikasi |
| REQ-BLUEPRINT-01 | M0/M3 | M0: schema satu sumber, ruang tanpa overlap/gap, pintu di dinding bersama, fixture dalam ruang | tools/validate_world.py<br>tests/py/test_world.py | docs/evidence/M0/validate-world.json<br>docs/evidence/M0/pytest.txt | terverifikasi |
| REQ-BLUEPRINT-01 | M0/M3 | M0: capability CAD dilaporkan; native DWG | docs/evidence/M0/capability-report.md | docs/evidence/M0/capability-report.md | tidak didukung |
| REQ-BLUEPRINT-01 | M0/M3 | M1: A-101/A-102 DXF+PDF konsisten dengan dataset (reopen, audit, luas, ID pintu/fixture, skala) | tests/py/test_cad.py | docs/evidence/M1/cad-pytest.txt<br>drawings/register.json | terverifikasi |
| REQ-BLUEPRINT-01 | M0/M3 | M3: 15 sheet DXF+PDF, paket gabungan; GLB bangunan konsisten dengan dataset (dinding, bukaan, slab, axis) | tests/py/test_cad_m3.py<br>blender/building/validate_building.py<br>tests/py/test_building.py | docs/evidence/M3/cad-pytest.txt<br>docs/evidence/M3/building-validate.json<br>drawings/register.json | terverifikasi |
| REQ-BLUEPRINT-01 | M0/M3 | P03: arah bukaan pintu dan 39 jendela konsep satu sumber di world.json, dibaca CAD (denah, tampak, potongan, jadwal pintu/jendela), Blender (bukaan, kaca, daun pintu) dan runtime (dinding terpotong jendela) | tests/py/test_openings.py<br>tests/py/test_cad_openings.py<br>tests/py/test_building.py<br>blender/building/validate_building.py<br>app/tests/unit/openings.test.ts | docs/evidence/HARDENING/pytest.txt<br>docs/evidence/HARDENING/pytest-cad.txt<br>docs/evidence/HARDENING/blender-building-validate.txt<br>docs/evidence/HARDENING/vitest.txt | terverifikasi |
| REQ-ICT-01 | M0/M3 | M0: FK outlet/device/rack, rack U collision, kamera tidak di area basah | tools/validate_world.py::ict_foreign_keys<br>tests/py/test_ict.py | docs/evidence/M0/validate-world.json<br>docs/evidence/M0/pytest.txt | terverifikasi |
| REQ-ICT-01 | M0/M3 | M0: port map tanpa duplikat, panjang dari route tray, <= 90 m target, spare switch >= 20% | tools/ict_derive.py<br>tests/py/test_ict.py | design/derived/ict-portmap.json<br>docs/evidence/M0/failure-paths/ict-switch-spare-below-target.txt | terverifikasi |
| REQ-ICT-01 | M0/M3 | PoE budget switch, rating UPS, thermal | - | - | asumsi |
| REQ-ICT-01 | M0/M3 | M3: gambar ICT-001/101/102/201/301/401 konsisten dengan port map (ID, panjang total, U rack) | tests/py/test_cad_m3.py | docs/evidence/M3/cad-pytest.txt | terverifikasi |
| REQ-ICT-01 | M0/M3 | Outlet ICT ikut furniture di Office Studio: pindah/hapus/tambah, undo/redo, export v2 + import menolak outlet yang diedit, publish/rollback; paritas Python/TS; ict_derive.py --layout | tests/py/test_ict_follow.py<br>app/tests/unit/ict.test.ts<br>app/tests/e2e/studio.spec.ts | docs/evidence/HARDENING/pytest.txt<br>docs/evidence/HARDENING/vitest.txt | terverifikasi |
| REQ-ACCESS-01 | M1/M2 | M1: fallback ?nogl=1, direktori keyboard, focus kembali, reduced motion (viewport emulasi) | app/tests/e2e/world.spec.ts | docs/evidence/M1/e2e-world.txt<br>docs/evidence/M1/screenshots/desktop-fallback.jpg<br>docs/evidence/M1/contrast.json | terverifikasi |
| REQ-ACCESS-01 | M1/M2 | M2: axe-core WCAG 2.1 A/AA tanpa pelanggaran (dunia, direktori, dialog, fallback; terang dan gelap) | app/tests/e2e/a11y.spec.ts<br>tools/contrast.py | docs/evidence/M2/e2e-all.txt<br>docs/evidence/M2/axe/desktop-light-world.json<br>docs/evidence/M2/contrast.json | terverifikasi |
| REQ-ACCESS-01 | M1/M2 | Perangkat mobile/tablet nyata dan screen reader | - | - | belum diuji |
| REQ-DATA-01 | M4 gated | M4 disabled sampai izin Budi | - | - | tidak didukung |
| REQ-DATA-01 | M4 gated | Kontrak adapter (sanitasi allowlist, stale -> unknown) diuji dengan fixture; tanpa sumber nyata | app/tests/unit/adapter.test.ts | docs/evidence/M2/vitest.txt | terverifikasi |
| REQ-PERF-01 | M1-M3 | M0: anggaran transfer/triangle dihitung | tools/capacity.py | design/derived/capacity.json | asumsi |
| REQ-PERF-01 | M1-M3 | M1: harness rute tetap 60 s berjalan dan tercatat (container SwiftShader) | app/tests/e2e/perf.spec.ts | docs/evidence/M1/perf-route-desktop.json | terverifikasi |
| REQ-PERF-01 | M1-M3 | Target 60 FPS desktop / 30 FPS mobile pada perangkat pilihan Budi | app/tests/e2e/perf.spec.ts | - | belum diuji |
| REQ-PERF-01 | M1-M3 | Anggaran draw call mobile <= 150 dan triangle <= 250k: puncak per frame selama rute tetap 25 s, desktop/tablet/mobile (draw call dan triangle tidak bergantung kecepatan GPU) | app/tests/e2e/budget.spec.ts | docs/evidence/HARDENING/budget-desktop.json<br>docs/evidence/HARDENING/budget-mobile.json | terverifikasi |
| REQ-SAFE-01 | semua | M0: secret/URL/file allowlist scan repo | tools/safety_scan.py | docs/evidence/M0/safety-scan.txt | terverifikasi |
| REQ-SAFE-01 | semua | M1: runtime hanya request same-origin; safety scan | app/tests/e2e/world.spec.ts<br>tools/safety_scan.py | docs/evidence/M1/e2e-world.txt | terverifikasi |
| REQ-SAFE-01 | semua | Audit lisensi dependency npm/pip | tools/license_audit.py | docs/evidence/M3/license-audit.json | terverifikasi |
| REQ-SAFE-01 | semua | Provenance: setiap file app/public dipetakan ke generator repo (GLB registry, artwork make_signage, PDF hasil generate, teks lisensi); file asing gagal | tests/py/test_provenance.py | docs/evidence/HARDENING/pytest.txt | terverifikasi |
| REQ-SAFE-01 | semua | Keamanan: safety scan teks repo, npm audit runtime + dev, audit lisensi | tools/safety_scan.py<br>tools/license_audit.py | docs/evidence/HARDENING/safety-scan.txt<br>docs/evidence/HARDENING/npm-audit-runtime.txt<br>docs/evidence/HARDENING/npm-audit-all.txt<br>docs/evidence/HARDENING/license-audit.json | terverifikasi |

Ringkasan status bagian: asumsi 2, belum diuji 2, terverifikasi 35, tidak didukung 2.

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

### REQ-DATA-01 (M4 gated)

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
