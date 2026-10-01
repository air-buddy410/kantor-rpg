# Matriks requirement

Dibuat dari `design/requirements.json` oleh `tools/req_matrix.py` (basis commit 8522f03; evidence menunjuk file di repo).
Status hanya 'terverifikasi' bila bagian itu punya evidence file hasil eksekusi pada commit tercatat. Evidence kosong = belum diuji.

| REQ | Milestone | Bagian | Test | Evidence | Status |
|---|---|---|---|---|---|
| REQ-WORLD-01 | M1 | M0 data: reachability semua ruang non-shaft lewat navgrid + vertical link | tools/validate_world.py::nav_all_rooms_reachable_staff<br>tests/py/test_world.py::test_nav_detects_blocked_room | docs/evidence/M0/validate-world.json<br>docs/evidence/M0/pytest.txt | terverifikasi |
| REQ-WORLD-01 | M1 | M0 data: server terkunci untuk visitor | tools/validate_world.py::nav_restricted_locked_for_visitor<br>tests/py/test_world.py::test_visitor_cannot_reach_server_even_if_door_public_elsewhere | docs/evidence/M0/validate-world.json | terverifikasi |
| REQ-WORLD-01 | M1 | M1 runtime: CEO berjalan, collider, transisi lantai, safe waypoint | app/tests/unit/navgrid.test.ts<br>tests/e2e/world.spec.ts | - | belum diuji |
| REQ-CHAR-01 | M1/M2 | M0 data: actor record, role, homeSeat, simulated=true | tools/validate_world.py::actors_home_seats_exist<br>design/world.schema.json | docs/evidence/M0/validate-world.json | terverifikasi |
| REQ-CHAR-01 | M1/M2 | M1/M2 asset: GLB karakter original, registry, animasi | tests/py/test_assets.py<br>tests/e2e/npc.spec.ts | - | belum diuji |
| REQ-INTERACT-01 | M2 | M2 runtime | tests/e2e/interact.spec.ts | - | belum diuji |
| REQ-IDLE-01 | M2 | M0 data: activity slots ber-capacity dan approachable | tools/validate_world.py::nav_activity_slots_approachable | docs/evidence/M0/validate-world.json | terverifikasi |
| REQ-IDLE-01 | M2 | M2 simulasi berseed + soak | app/tests/unit/idle.test.ts | - | belum diuji |
| REQ-STUDIO-01 | M3 | M3 Office Studio | app/tests/unit/studio.test.ts<br>tests/e2e/studio.spec.ts | - | belum diuji |
| REQ-AVATAR-01 | M3 | M3 Avatar Studio | tests/e2e/avatar.spec.ts | - | belum diuji |
| REQ-BLUEPRINT-01 | M0/M3 | M0: schema satu sumber, ruang tanpa overlap/gap, pintu di dinding bersama, fixture dalam ruang | tools/validate_world.py<br>tests/py/test_world.py | docs/evidence/M0/validate-world.json<br>docs/evidence/M0/pytest.txt | terverifikasi |
| REQ-BLUEPRINT-01 | M0/M3 | M0: capability CAD dilaporkan; native DWG | docs/evidence/M0/capability-report.md | docs/evidence/M0/capability-report.md | tidak didukung |
| REQ-BLUEPRINT-01 | M0/M3 | M1/M3: DXF/PDF/GLB konsisten | tests/py/test_cad.py<br>tests/py/test_blender.py | - | belum diuji |
| REQ-ICT-01 | M0/M3 | M0: FK outlet/device/rack, rack U collision, kamera tidak di area basah | tools/validate_world.py::ict_foreign_keys<br>tests/py/test_ict.py | docs/evidence/M0/validate-world.json<br>docs/evidence/M0/pytest.txt | terverifikasi |
| REQ-ICT-01 | M0/M3 | M0: port map tanpa duplikat, panjang dari route tray, <= 90 m target, spare switch >= 20% | tools/ict_derive.py<br>tests/py/test_ict.py | design/derived/ict-portmap.json<br>docs/evidence/M0/failure-paths/ict-switch-spare-below-target.txt | terverifikasi |
| REQ-ICT-01 | M0/M3 | PoE budget switch, rating UPS, thermal | - | - | asumsi |
| REQ-ICT-01 | M0/M3 | M3: gambar ICT PDF + review | tests/py/test_cad.py | - | belum diuji |
| REQ-ACCESS-01 | M1/M2 | M1 runtime fallback | tests/e2e/fallback.spec.ts | - | belum diuji |
| REQ-DATA-01 | M4 gated | M4 disabled sampai izin Budi | - | - | tidak didukung |
| REQ-PERF-01 | M1-M3 | M0: anggaran transfer/triangle dihitung | tools/capacity.py | design/derived/capacity.json | asumsi |
| REQ-PERF-01 | M1-M3 | M1: perf harness rute tetap | tests/e2e/perf.spec.ts | - | belum diuji |
| REQ-SAFE-01 | semua | M0: secret/URL/file allowlist scan repo | tools/safety_scan.py | docs/evidence/M0/safety-scan.txt | terverifikasi |
| REQ-SAFE-01 | semua | M1+: build output network assertions, license audit dependency | tests/e2e/network.spec.ts<br>tools/license_audit.py | - | belum diuji |

Ringkasan status bagian: asumsi 2, belum diuji 11, terverifikasi 8, tidak didukung 2.

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
