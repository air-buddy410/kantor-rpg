# Rebuild dari clean clone

Semua artefak dibuat ulang dari `design/world.json` dengan satu perintah:

```
./tools/rebuild_all.sh
```

Urutan dan alasannya:

1. `pip install -r requirements-dev.txt`: versi Python toolchain dipin.
2. `python3 tools/build_design.py`: seed dataset, validasi (gagal = berhenti), derivasi runtime (`walls.json`, `nav-counts.json`), kapasitas, room schedule, port map ICT, matriks requirement, PDF PRD.
3. `python3 cad/generate.py --all-available`: semua sheet DXF (mm) + PDF vektor + preview + `drawings/register.json`. DWG native tidak dibuat (BLOCKED, lihat `cad/AUTOCAD-RUNBOOK.md`).
4. `python3 tools/make_signage.py`: artwork poster original dan poster proyek A3 (angka dibaca dari dataset).
5. Blender 4.0.2 (bila tersedia): bangunan, furniture, karakter, lalu validasi reopen/re-import. Tanpa Blender, GLB/blend yang sudah di-commit dipakai dan langkah ini dilaporkan SKIP.
6. Test Python, safety scan, audit lisensi, contrast.
7. App: `npm ci`, unit test, build, lalu E2E Playwright (desktop, tablet, mobile).

Prasyarat sistem: Python 3.11, Node 22, `poppler-utils` (pdftoppm/pdftotext), paket huruf `fonts-alegreya-sans` (opsional; tanpa itu PDF memakai Helvetica), Blender 4.0.x untuk langkah 3D, Chromium untuk Playwright.

Determinisme: dataset dan port map identik antar run; GLB karakter byte-identik antar build (dicek oleh build log); PDF/DXF memuat waktu render sehingga sha256 berubah, tetapi `cad/out/*.counts.json` stabil. Simulasi NPC berseed (`?seed=` di URL, default 20261001).
