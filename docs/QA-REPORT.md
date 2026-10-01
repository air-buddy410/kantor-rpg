# QA report (M0 sampai M3 + hardening)

Disusun oleh pelaksana (Claude Code cloud) dari hasil eksekusi di container ini, bukan verdict review. Max dan CI memeriksa ulang. Semua angka di bawah berasal dari file evidence yang disebut. CI hijau bukan acceptance.

## Hardening (branch claude/kantor-rpg-m3-hardening, PR draft air-buddy410/kantor-rpg#5)

Basis c9c278a. SHA yang diuji tercatat di `docs/progress.md` bagian Hardening dan di kepala `docs/evidence/HARDENING/clean-clone-rebuild.txt`.

### Terverifikasi (dieksekusi, evidence di repo)

| Item | Hasil | Evidence |
|---|---|---|
| Clean clone + `tools/rebuild_all.sh` (Python, CAD, signage, Blender build + validate, test, app, E2E) | exit 0, 19 menit | `docs/evidence/HARDENING/clean-clone-rebuild.txt` |
| Validator dataset P03 | 46/46 | `docs/evidence/HARDENING/validate-world.txt` |
| Python | 316 lolos | `docs/evidence/HARDENING/pytest.txt` |
| Vitest | 53 lolos | `docs/evidence/HARDENING/vitest.txt` |
| Playwright penuh desktop/tablet/mobile | 117 lolos, 0 gagal, 9 skip | `docs/evidence/HARDENING/e2e-all.txt` |
| Test yang sebelumnya di-skip (sapa NPC di sentuh, budget tablet) | 10/10 lolos | `docs/evidence/HARDENING/e2e-unskipped-touch.txt` |
| Rebuild clean clone E2E (termasuk states + budget) | 120 lolos, 3 skip | `clean-clone-rebuild.txt` |
| axe WCAG 2.1 A/AA tiga viewport, dua tema | 0 pelanggaran | `docs/evidence/HARDENING/axe/` |
| Contrast dihitung | 31/31 | `docs/evidence/HARDENING/contrast.json` |
| Safety scan, npm audit runtime + dev, audit lisensi | 0 temuan, 0 kerentanan, 0 masalah runtime | `safety-scan.txt`, `npm-audit-*.txt`, `license-audit.json` |
| Provenance file yang dikirim app | setiap file `app/public` terpetakan ke generator; file asing gagal | `tests/py/test_provenance.py` |
| CSP preview yang diusulkan | versi 1 salah (memblokir tekstur blob GLTF, 2 gagal); diperbaiki, 24/24 | `e2e-csp-desktop-run1.txt`, `e2e-csp-desktop.txt` |
| Draw call dan triangle puncak, rute tetap 25 s | desktop 53 / 185k, tablet 49 / 185k, mobile 50 / 189k (target 150 / 250k) | `budget-*.json` |
| Karakter: 1 material atlas, LOD1, 5 ekspresi, dibuka ulang | 1151 cek lolos; LOD0 7 karakter 125 draw call menjadi 17 | `blender-characters-validate.txt`, `assets/previews/character-*.png` |
| Bangunan: jendela + daun pintu dari dataset | 1529 cek lolos | `blender-building-validate.txt` |
| CAD: arah bukaan + jendela + jadwal pintu/jendela dari dataset | 107 test CAD lolos (7 negatif) | `pytest-cad.txt`, `cad-generate.txt` |
| Outlet ICT ikut furniture (Studio undo/export/rollback, paritas Python/TS) | lolos | `tests/py/test_ict_follow.py`, `app/tests/unit/ict.test.ts`, E2E studio |
| Collision CEO/persona, tidak ada NPC beku | lolos; bug lama NPC beku di sel sudut (seed 11) ditemukan dan diperbaiki | `app/tests/unit/collision.test.ts` |
| Q-01 trace fungsi PRD ke ruang | 27 fungsi, 38 ruang, 0 masalah | `prd-trace.json` |

### Target (belum terbukti, berlabel)

- FPS perangkat: harness 60 s di container SwiftShader memberi 5,6 FPS rata-rata, median 160 ms (M3: 3,2 FPS, 320 ms); ini bukan FPS perangkat (ADR-011). Target 60/30 FPS tetap target sampai diukur di perangkat Budi.
- Transfer awal 9,73 MB (M3: 7,83 MB), masih di bawah anggaran 10 MB tetapi dekat; kenaikan dari UV atlas, LOD1 dan data morph karakter.

### Blocked / tidak didukung

- DWG native: BLOCKED (AutoCAD tidak tersedia); DXF + runbook.
- M4 data private: disabled.

### Belum diuji

- Perangkat mobile/tablet nyata dan screen reader.
- Header CSP di host nyata (hanya diuji di server lokal `app/scripts/serve-csp.mjs`).

### Reproducibility clean clone

Rebuild menghasilkan perbedaan terhadap tree commit hanya pada: timestamp/GUID di DXF, PDF dan register; baris commit di requirements matrix; urutan entri registry aset (isi identik, urutan rebuild diadopsi); dan noise float pada 2 GLB karakter (sekitar 10 nilai vertex supervisor dan 2 visual, selisih maksimum 0,008 mm, struktur JSON identik). Path absolut di laporan validator diganti path relatif repo.

### Known issues hardening

- Daun pintu ada di DXF dan Blender, belum di runtime (runtime hanya ambang + jendela) agar navgrid Python/TS tetap paritas.
- Tiga karakter (Nova, Kevin, Rex) punya 3 primitive LOD0 karena prop dipegang terpisah.
- LOD1 menghilangkan highlight mata; CEO LOD1 selalu rambut default (CEO selalu LOD0 di runtime).
- NPC prioritas tinggi yang sedang berjalan tidak menunggu NPC prioritas rendah yang berjalan; tumpang tindih singkat masih mungkin tetapi dibatasi test soak (<= 0,2 persen langkah pasangan).
- Tag jendela 5 pt di tampak 1:200 kecil saat dicetak A3.

## M3 (arsip)

### Gerbang mutu CLAUDE.md (M3)

| Gerbang | Status | Bukti |
|---|---|---|
| Identitas khas, alasan tiap keputusan | ada | `docs/decisions.md`, `DESIGN.md`, sheet karakter dan furniture di `assets/previews/` |
| Tidak ada klaim/testimoni angka palsu | dicek | angka PRD/poster dibaca dari dataset (`tests/py/test_prd_numbers.py`), FPS hanya dari benchmark berlabel container |
| Semua target berlabel | dicek | `docs/assumptions.md`, label KONSEP di 15 sheet, badge SIMULASI di HUD |
| Tanpa em dash | test | `tests/py/test_prd_numbers.py::test_no_em_dash_in_docs`, cek teks PDF di `test_cad_m3.py` |
| Tanpa template marketing cards | ditinjau | UI adalah HUD dunia + panel fungsional; tidak ada halaman landing |
| Semua kontrol bekerja | E2E | `docs/evidence/M3/e2e-all.txt` (100 lolos); tombol yang butuh 3D disembunyikan pada fallback |
| Data view loading/empty/error | E2E | `docs/evidence/M3/e2e-states.txt` (12 lolos) |
| Keyboard, focus, Escape | E2E | dialog, direktori, Studio, aktivitas (`world.spec.ts`, `npc.spec.ts`, `studio.spec.ts`) |
| Contrast teks >= 4,5, besar >= 3, kontrol >= 3 | dihitung | `docs/evidence/M3/contrast.json` (31/31), axe 0 pelanggaran (`docs/evidence/M2/axe/`) |
| Tap target >= 44 px | E2E | `world.spec.ts` tap target test, 3 viewport |
| Layout mobile/tablet berbeda | E2E | bottom sheet mobile, side sheet tablet, panel kanan desktop |
| Reduced motion | E2E | pindah lantai instan, animasi sekunder mati |
| Kedua tema diuji | E2E + axe | tema gelap dan terang, screenshot `*-dark.jpg` |
| UI built/run + walkthrough | E2E | screenshot per milestone di `docs/evidence/M*/screenshots/` |
| Skema CAD/Blender/runtime satu sumber | test | parity navgrid TS/Python, slot TS/Python, validator bangunan, test CAD terhadap world.json |

## Ringkasan test (run terakhir di branch M3)

- Python: 219 lolos (`python3 -m pytest tests/py`).
- Vitest: 36 lolos (`docs/evidence/M3/vitest.txt`).
- Playwright: 100 lolos, 5 skip by design (`docs/evidence/M3/e2e-all.txt`); state 12 lolos.
- Blender: karakter 7/7 PASS, bangunan 1053 cek PASS, furniture 654 cek PASS.
- Safety scan 0 temuan; audit lisensi 0 masalah runtime.

## Performa (container tanpa GPU, SwiftShader)

| Milestone | FPS rata-rata | Median frame | p95 frame | Transfer awal |
|---|---|---|---|---|
| M1 (furniture prosedural, 1 karakter) | 5,6 | 166 ms | 396 ms | 1,1 MB |
| M3 (furniture GLB, 7 karakter) | 3,2 | 320 ms | 687 ms | 7,83 MB |

Angka ini menggambarkan CPU rendering container, bukan perangkat Budi. Transfer awal M3 di bawah batas 10 MB hasil hitungan target cold start. Draw call terukur 161 di koridor L1, di atas target mobile 150: target belum terpenuhi.

## Blocker dan keputusan yang dibutuhkan

- BLOCKED: DWG native (AutoCAD tidak tersedia). DXF + runbook siap.
- NEEDS_INPUT: Q-01 keragaman ruang, Q-02 jalur keluar L2, Q-03 gym di atas ruang kerja, Q-04 perangkat benchmark.
- M4 (data private) tetap disabled.

## Known issues

- Draw call di atas target mobile (karakter multi-material); usulan atlas material dan LOD1.
- Tidak ada collision antar-agent.
- Dataset belum menyimpan arah bukaan pintu dan jendela.
- Outlet ICT tidak ikut berpindah saat meja dipindah di Office Studio (layout lokal tidak mengubah port map).
