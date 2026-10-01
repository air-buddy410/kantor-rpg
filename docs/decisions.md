# Keputusan teknis (ADR ringkas) dan batas

Keputusan pemilik (D-01 sampai D-07) ada di PRD. Daftar di bawah adalah keputusan pelaksana yang dapat ditinjau Max; masing-masing menyebut alasan dan cara membatalkannya.

## ADR-001 Dataset satu sumber
`design/world.json` adalah satu-satunya sumber ruang, pintu, fixture, slot aktivitas, waypoint, aktor dan ICT. Script `design/authoring/seed_world.py` adalah editor-of-record untuk layout seed; validator gagal bila JSON berbeda dari output script (`world_matches_authoring_seed`). Alasan: tiga denah manual (CAD, Blender, runtime) pasti melenceng. Office Studio menyimpan draft sebagai overlay, bukan menulis ulang dataset.

## ADR-002 Dinding diturunkan, bukan digambar
Dinding = gabungan tepi polygon ruang per garis grid dikurangi bukaan pintu (`tools/kantor/geometry.py::derive_walls`). Polygon ruang dibatasi ortogonal. Alasan: pintu, dinding dan bukaan identik di DXF, Blender dan runtime tanpa sinkronisasi manual. Batasan: dinding miring/lengkung butuh revisi schema.

## ADR-003 Kontrak navgrid
Sel 0,1 m, radius agen 0,25 m, BFS 4-tetangga untuk reachability, Dijkstra 8-tetangga tanpa memotong sudut untuk panjang jalan. Mode visitor menutup pintu `restricted`. Runtime wajib mengikuti aturan raster yang sama dan diuji terhadap jumlah sel walkable Python.

## ADR-004 Toolchain CAD dan PDF
AutoCAD tidak tersedia (capability report), maka DXF R2018 lewat ezdxf dan PDF vektor lewat ReportLab. Native DWG BLOCKED; tidak ada konversi ekstensi. Runbook AutoCAD menjelaskan konversi di mesin berlisensi.

## ADR-005 Huruf
Alegreya Sans (SIL OFL 1.1, humanist). Untuk PDF, OTF dikonversi ke TrueType dengan figur lining dan diberi nama "KantorRPG Sans" sesuai aturan Reserved Font Name; file hasil konversi tidak di-commit. Web memakai paket npm `@fontsource/alegreya-sans` (OFL) tanpa modifikasi.

## ADR-006 Port map ICT diturunkan
Kabel tidak disimpan sebagai angka bebas; `tools/ict_derive.py` menghitung route tray, port patch panel dan switch. Port disebar rata ke tiga access switch agar spare per switch di atas 20 persen; uji kegagalan membuktikan pemeriksaan spare aktif bila switch ketiga dihapus.

## ADR-007 Branch per milestone
Branch `claude/kantor-rpg-m0`, `-m1`, `-m2`, `-m3` dibuat bertumpuk. PR selalu ke main tanpa merge, sesuai PRD 14; PR milestone berikutnya mencantumkan bahwa diff memuat milestone sebelumnya bila belum di-merge. Branch sesi `claude/amazing-brahmagupta-mrq4mc` tidak dipakai untuk kerja karena Budi meminta nama branch milestone secara eksplisit.

## Batas yang tidak diputuskan pelaksana
Lahan, lokasi, luas sah, okupansi manusia, biaya, hosting, integrasi Hermes, client benchmark, logo. Pertanyaan terbuka Q-01 sampai Q-04 ada di PRD v0.2 bagian 2.
