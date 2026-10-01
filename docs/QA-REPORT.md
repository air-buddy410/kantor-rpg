# QA report (M0 sampai M3)

Disusun oleh pelaksana (Claude Code cloud) dari hasil eksekusi di container ini, bukan verdict review. Max dan CI memeriksa ulang. Semua angka di bawah berasal dari file evidence yang disebut.

## Gerbang mutu CLAUDE.md

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
