# kantor-rpg
Kantor virtual dua lantai, CEO playable, persona original, blueprint CAD/Blender/ICT dari satu dataset.

Badan usaha: PRIBADI, eksperimen visual. Status: M0 (PRD v0.2, dataset dunia, room schedule, kapasitas, port map ICT) di branch `claude/kantor-rpg-m0`; aplikasi, gambar CAD dan model Blender menyusul per milestone. Pelaksana: Claude Code cloud, Opus 5.5 High. Supervisor: Max.

Mulai dari [PRD v0.2](PRD/PRD-v0.2.md) ([PDF](PRD/PRD-v0.2.pdf); baseline [v0.1](PRD/PRD-v0.1.md)), [progress](docs/progress.md), [prompt cloud](handoff/PROMPT-CLAUDE.md), dan [register deliverable](docs/DELIVERABLES.md).

Rebuild artefak desain dari clean clone:

```
pip install -r requirements-dev.txt
python3 tools/build_design.py     # seed, validasi, kapasitas, room schedule, ICT, matriks, PDF PRD
python3 -m pytest tests/py -q
```

PDF memakai Alegreya Sans dari paket Debian `fonts-alegreya-sans` bila ada, jika tidak jatuh ke Helvetica.

Semua angka ukuran dan performa adalah proposal/target, kecuali baseline yang jelas disebut hasil pembacaan. Demo wajib memakai simulasi berlabel. Integrasi private, hosting, merge, deploy dan penggunaan berbayar butuh izin tersendiri. Tidak menyentuh produksi ISP.

Repo tidak berisi aset/kode Holixora, Pokemon, chat pribadi atau kredensial. Referensi eksternal untuk inspirasi, bukan lisensi redistribusi. Lisensi proyek belum ditentukan pemilik; public visibility bukan izin menggunakan semua konten tanpa batas.
