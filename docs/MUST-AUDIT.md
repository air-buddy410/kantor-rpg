# Must audit (PRD v0.1 bagian 12)

Dibuat oleh `tools/must_audit.py` dari `design/must-audit.json`. Status per elemen AC, test, failure dan boundary; referensi diperiksa ada di repo. Elemen selain terverifikasi adalah gap yang terbuka, bukan selesai.

Ringkasan: asumsi 1, belum diuji 2, blocked 3, terverifikasi 44, tidak didukung 2

## REQ-WORLD-01

| Elemen | Isi | Status | Bukti | Catatan |
|---|---|---|---|---|
| AC | semua ruang wajib dapat dicapai lewat transisi lantai tanpa menerobos collider | terverifikasi | `tests/py/test_world.py` (test_committed_world_passes_all_checks)<br>`app/tests/unit/navgrid.test.ts` (walkable count and probes match Python)<br>`app/tests/e2e/world.spec.ts` (stair interaction changes floor only at the marked point)<br>`app/tests/e2e/world.spec.ts` (reception desk collider stops it) |  |
| test | navigation unit + E2E floor routes | terverifikasi | `app/tests/unit/navgrid.test.ts` (finds a staff path)<br>`app/tests/e2e/world.spec.ts` (stair interaction) |  |
| failure | stuck -> safe waypoint | terverifikasi | `app/tests/unit/idle.test.ts` (seal)<br>`app/tests/unit/collision.test.ts` (no NPC freezes) |  |
| boundary | server room visitor tetap terkunci | terverifikasi | `app/tests/e2e/world.spec.ts` (visitor mode locks the server room)<br>`app/tests/e2e/doors.spec.ts` (server door stays shut)<br>`tests/py/test_world.py` (test_visitor_cannot_reach_server) |  |

## REQ-CHAR-01

| Elemen | Isi | Status | Bukti | Catatan |
|---|---|---|---|---|
| AC | label peran dan animasi konsisten tanpa IP pihak lain | terverifikasi | `app/tests/e2e/npc.spec.ts` (never claim a work status)<br>`tests/py/test_assets.py` (def test_)<br>`tests/py/test_provenance.py` (test_registry_entries_are_original_and_scripted) |  |
| test | asset validation | terverifikasi | `tests/py/test_assets.py` (def test_)<br>`blender/validate_assets.py` (VALIDATE_DONE) |  |
| test | manual silhouette/deform review | belum diuji | `assets/previews/ch-ceo-deform.png`<br>`assets/previews/character-expressions.png` | sheet dan preview deform tersedia; review manusia (Max/Budi) belum tercatat |
| failure | missing GLB -> honest placeholder | terverifikasi | `app/tests/e2e/failures.spec.ts` (missing character GLB) |  |
| boundary | tidak mengarang likeness manusia | terverifikasi | `tests/py/test_provenance.py` (original) | karakter procedural original; review likeness manual belum tercatat |

## REQ-INTERACT-01

| Elemen | Isi | Status | Bukti | Catatan |
|---|---|---|---|---|
| AC | E/tap membuka satu panel, locomotion berhenti, Escape menutup dan mengembalikan fokus | terverifikasi | `app/tests/e2e/npc.spec.ts` (or tapping Aksi)<br>`app/tests/e2e/world.spec.ts` (dialogs trap focus, block locomotion and return focus on Escape) |  |
| test | E2E desktop/mobile/keyboard | terverifikasi | `app/tests/e2e/npc.spec.ts` (touch-interact)<br>`app/tests/e2e/npc.spec.ts` (press('e')) |  |
| failure | target hilang -> pesan jelas | terverifikasi | `app/tests/e2e/failures.spec.ts` (nothing in reach says so) |  |
| boundary | public hanya fixture | terverifikasi | `app/tests/unit/adapter.test.ts` (demo snapshot carries no work claims) |  |

## REQ-IDLE-01

| Elemen | Isi | Status | Bukti | Catatan |
|---|---|---|---|---|
| AC | reservasi tidak overcapacity, NPC tidak stuck permanen, status tidak dipalsukan | terverifikasi | `app/tests/unit/idle.test.ts` (never over-books a slot)<br>`app/tests/unit/collision.test.ts` (no NPC freezes)<br>`app/tests/unit/collision.test.ts` (no walking step ever closes in) |  |
| test | seeded simulation + soak | terverifikasi | `app/tests/unit/idle.test.ts` (is deterministic for a seed)<br>`app/tests/unit/idle.test.ts` (2 h soak) |  |
| failure | route gagal -> cancel/release | terverifikasi | `app/tests/unit/idle.test.ts` (seal) |  |
| boundary | nol LLM/API calls akibat idle | terverifikasi | `app/tests/unit/idle.test.ts` (never touches the network) |  |

## REQ-STUDIO-01

| Elemen | Isi | Status | Bukti | Catatan |
|---|---|---|---|---|
| AC | edit/undo/save/load pulih deterministik; overlap/pintu invalid ditolak | terverifikasi | `app/tests/unit/studio.test.ts` (is deterministic)<br>`app/tests/unit/studio.test.ts` (rejects overlap, wall intrusion, door blocking)<br>`app/tests/unit/doors.test.ts` (door-swing issue)<br>`app/tests/e2e/studio.spec.ts` (move, reject overlap, undo/redo)<br>`app/tests/e2e/controls.spec.ts` (Ctrl+Z/Ctrl+Y) |  |
| test | schema/unit + E2E | terverifikasi | `app/tests/unit/studio.test.ts` (round-trips save/load exactly)<br>`app/tests/e2e/studio.spec.ts` (export round-trips) |  |
| failure | JSON rusak -> original tetap utuh | terverifikasi | `app/tests/e2e/studio.spec.ts` (a broken or invalid import is rejected and changes nothing) |  |
| boundary | tidak eksekusi script/file path import | terverifikasi | `app/tests/unit/studio.test.ts` (ignores asset paths and prototype keys) |  |

## REQ-AVATAR-01

| Elemen | Isi | Status | Bukti | Catatan |
|---|---|---|---|---|
| AC | preview/save/reset persist, reset kembali default | terverifikasi | `app/tests/e2e/studio.spec.ts` (preview, save persists across reload, reset returns to default) |  |
| test | E2E + asset load | terverifikasi | `app/tests/e2e/studio.spec.ts` (Avatar Studio) |  |
| failure | asset missing -> default | terverifikasi | `app/tests/e2e/studio.spec.ts` (falls back to the default) |  |
| boundary | tidak memakai Pokemon atau wajah manusia tanpa sumber | terverifikasi | `tests/py/test_provenance.py` (original) |  |

## REQ-BLUEPRINT-01

| Elemen | Isi | Status | Bukti | Catatan |
|---|---|---|---|---|
| AC | dimensi/pintu/fixture ID konsisten di DXF, PDF, GLB; ketersediaan CAD dilaporkan | terverifikasi | `tests/py/test_cad.py` (test_dxf_door_and_fixture_ids)<br>`tests/py/test_cad_openings.py` (def test_)<br>`tests/py/test_door_leaves.py` (test_blender_leaf_nodes_hinge_where_the_runtime_hinges)<br>`tests/py/test_building.py` (def test_) |  |
| test | CAD reopen/parse, PDF extract/render, GLB validator, koordinat | terverifikasi | `tests/py/test_cad.py` (test_dxf_reopens_and_audits_clean)<br>`tests/py/test_cad.py` (test_pdf_text_content)<br>`tests/py/test_cad_legibility.py` (def test_)<br>`tests/py/test_cad.py` (test_plan_origin_maps_world_metres_to_paper) |  |
| failure | AutoCAD tidak tersedia -> native DWG BLOCKED, bukan sukses palsu | blocked | `cad/AUTOCAD-RUNBOOK.md` (DWG)<br>`docs/evidence/M0/capability-report.md` (AutoCAD) | tidak ada AutoCAD berlisensi di cloud; DXF + runbook tersedia |
| boundary | konsep bukan signed construction | terverifikasi | `tests/py/test_cad_m3.py` (KONSEP) |  |

## REQ-ICT-01

| Elemen | Isi | Status | Bukti | Catatan |
|---|---|---|---|---|
| AC | tanpa orphan ID/duplicate port, panjang memakai route | terverifikasi | `tests/py/test_ict.py` (test_portmap_unique_and_routed)<br>`tests/py/test_world.py` (test_orphan_outlet_rejected)<br>`tests/py/test_ict_follow.py` (test_port_map_follows_layout) |  |
| test | schema/count/rack capacity unit | terverifikasi | `tests/py/test_world.py` (test_rack_unit_collision_rejected) |  |
| test | PDF review | belum diuji | `drawings/pdf/ICT-401.pdf` | isi PDF diuji otomatis (total kabel); review manusia belum tercatat |
| failure | spec missing -> belum divalidasi | asumsi | `design/requirements.json` (PoE budget switch) | PoE budget/UPS/thermal menunggu datasheet |
| boundary | no real ISP topology/device access | terverifikasi | `tests/py/test_ict.py` (test_bom_has_no_prices)<br>`tools/safety_scan.py` (def ) |  |

## REQ-ACCESS-01

| Elemen | Isi | Status | Bukti | Catatan |
|---|---|---|---|---|
| AC | tanpa WebGL/reduced motion, directory dan dokumen dapat dipakai keyboard dan tap | terverifikasi | `app/tests/e2e/world.spec.ts` (fallback without WebGL)<br>`app/tests/e2e/world.spec.ts` (reduced motion makes floor changes instant)<br>`app/tests/e2e/a11y.spec.ts` (axe fallback) |  |
| test | forced context failure + accessibility E2E | terverifikasi | `app/tests/e2e/failures.spec.ts` (losing the WebGL context mid-session)<br>`app/tests/e2e/a11y.spec.ts` (axe) |  |
| test | screen reader nyata | blocked | `docs/DEVICE-VALIDATION.md` (Screen reader) | butuh NVDA/VoiceOver/TalkBack di perangkat; hook ?a11ylog=1 siap |
| failure | render context loss -> fallback | terverifikasi | `app/tests/e2e/failures.spec.ts` (falls back to the keyboard directory) |  |
| boundary | accessible view tidak bypass private policy | terverifikasi | `app/tests/unit/adapter.test.ts` (private mode is disabled) |  |

## REQ-DATA-01

| Elemen | Isi | Status | Bukti | Catatan |
|---|---|---|---|---|
| AC | status/time/source benar, unknown saat timeout | tidak didukung | `app/tests/unit/adapter.test.ts` (stale snapshots degrade to unknown) | M4 disabled sampai izin Budi; kontrak demo diuji |
| test | contract/integration + public isolation | tidak didukung | `app/tests/unit/adapter.test.ts` (sanitizer drops unknown fields) | integrasi private tidak dibangun |
| failure | disconnect -> stale/unknown | terverifikasi | `app/tests/unit/adapter.test.ts` (stale snapshots degrade to unknown) |  |
| boundary | visitor/unauth tidak menerima payload private | terverifikasi | `app/tests/unit/adapter.test.ts` (private mode is disabled) |  |

## REQ-PERF-01

| Elemen | Isi | Status | Bukti | Catatan |
|---|---|---|---|---|
| AC | frame-time/load/assets memenuhi target tier atau degrade jujur | terverifikasi | `app/tests/e2e/budget.spec.ts` (peak draw calls and triangles)<br>`app/tests/e2e/bundle.spec.ts` (first download and JS chunks) | anggaran draw call/triangle/transfer terverifikasi; FPS lihat baris manual |
| test | browser perf (container) | terverifikasi | `app/tests/e2e/perf.spec.ts` (fixed route benchmark) |  |
| test | manual real-device | blocked | `docs/DEVICE-VALIDATION.md` (FPS perangkat) | perangkat Budi belum ditentukan (Q-04) dan belum dijalankan |
| failure | memory/context loss -> low quality/fallback | terverifikasi | `app/tests/e2e/failures.spec.ts` (losing the WebGL context)<br>`app/tests/e2e/controls.spec.ts` (quality radio is stored and applied) |  |
| boundary | tidak klaim FPS tanpa benchmark | terverifikasi | `tests/py/test_prd_numbers.py` (def test_) |  |

## REQ-SAFE-01

| Elemen | Isi | Status | Bukti | Catatan |
|---|---|---|---|---|
| AC | no secrets/private payload/copyright asset/production endpoint | terverifikasi | `tools/safety_scan.py` (def )<br>`tests/py/test_provenance.py` (test_every_public_file_has_a_source)<br>`app/tests/e2e/world.spec.ts` (only same-origin requests) |  |
| test | secret scan, dependency/license audit, URL allowlist, network assertions | terverifikasi | `tools/license_audit.py` (def main)<br>`app/tests/e2e/world.spec.ts` (Content Security Policy) |  |
| failure | suspect -> stop publish | terverifikasi | `.github/workflows/ci.yml` (safety_scan) |  |
| boundary | no merge/deploy/paid upgrade | terverifikasi | `docs/PREVIEW-HANDOFF.md` (tidak men-deploy) | kebijakan proses; diperiksa di laporan, bukan test kode |
