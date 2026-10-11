# kantor-rpg
Kantor virtual dua lantai yang bisa dijelajahi di browser: Anda bermain sebagai CEO dan berjalan di antara NPC berpersona original, dan setiap ruangan berasal dari satu dataset yang juga menghasilkan gambar CAD, model Blender, dan rencana ICT. Gratis dipakai dan dioprek di bawah lisensi MIT.

Demo: [employee-rpg.air-buddy.site](https://employee-rpg.air-buddy.site)

## Coba di laptop

```bash
git clone https://github.com/air-buddy410/kantor-rpg.git
cd kantor-rpg/app
npm ci
npm run dev            # http://localhost:5173
```

GLB, gambar, dan PDF hasil build sudah ada di repo, jadi Python dan Blender tidak diperlukan untuk menjalankan app. Panduan lengkap (build produksi, situs statis, backend opsional): [INSTALL.md](INSTALL.md).

## Rebuild artefak desain

```
pip install -r requirements-dev.txt
python3 tools/build_design.py     # seed, validasi, kapasitas, room schedule, ICT, matriks, PDF PRD
python3 -m pytest tests/py -q
```

PDF memakai Alegreya Sans dari paket Debian `fonts-alegreya-sans` bila ada, jika tidak jatuh ke Helvetica.

## Catatan proyek

Badan usaha: PRIBADI, eksperimen visual. Pelaksana: Claude Code cloud, Opus 5.5 High. Supervisor: Max. Dokumen kerja: [PRD v0.2](PRD/PRD-v0.2.md) ([PDF](PRD/PRD-v0.2.pdf); baseline [v0.1](PRD/PRD-v0.1.md)), [progress](docs/progress.md), [prompt cloud](handoff/PROMPT-CLAUDE.md), dan [register deliverable](docs/DELIVERABLES.md).

Semua angka ukuran dan performa adalah proposal/target, kecuali baseline yang jelas disebut hasil pembacaan. Demo memakai simulasi berlabel. Integrasi private, hosting, merge, deploy dan penggunaan berbayar butuh izin tersendiri. Tidak menyentuh produksi ISP.

Repo tidak berisi aset/kode Holixora, Pokemon, chat pribadi atau kredensial. Referensi eksternal hanya untuk inspirasi.

## Lisensi

Lisensi MIT, lihat [LICENSE](LICENSE). Kode, model 3D, gambar, ikon, dan dokumen di repo ini dibuat untuk proyek ini (aset dihasilkan skrip di `blender/` dan `tools/`) dan ikut lisensi tersebut.

Pengecualian pihak ketiga, tetap dengan lisensi aslinya:

- Font Alegreya Sans (`@fontsource/alegreya-sans`, juga turunan "KantorRPG Sans" yang tertanam sebagai subset di PDF): SIL Open Font License 1.1.
- three.js (`three`): MIT.
- Dependensi npm dan Python lain diunduh saat instalasi, tidak disertakan di repo. Lisensinya tercatat di [audit lisensi](docs/evidence/HARDENING/license-audit.txt) (`python3 tools/license_audit.py`).
