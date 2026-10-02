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

## ADR-008 Q-01 provisional: keragaman ruang dipertahankan karena terlacak
Keputusan Max (provisional, menunggu Budi): 38 ruang dataset dipertahankan hanya selama setiap fungsi program PRD v0.1 bagian 5 terlacak ke ruang dan setiap ruang terlacak balik ke fungsi. Trace ada di `design/prd-function-trace.json` (27 fungsi), diperiksa `tools/prd_trace.py` dan `tests/py/test_prd_trace.py`; ruang tanpa fungsi PRD atau frasa PRD yang hilang membuat test gagal. Membatalkan: ubah trace atau hapus ruang, lalu jalankan ulang trace.

## ADR-009 Q-02 provisional: tangga/lift internal untuk gameplay, tangga darurat timur hanya konsep
Tangga U dan lift di inti (`VL-STAIR-A`, `VL-LIFT-A`) adalah satu-satunya link vertikal yang dapat dimainkan. Tangga darurat timur (`VL-ESC-E`) adalah penanda konsep tertaut di dataset, CAD dan runtime (tidak dapat dimainkan). Tidak ada klaim kepatuhan peraturan kebakaran/evakuasi; jumlah, lebar dan jarak tempuh exit perlu kajian profesional (AS-EXIT-01).

## ADR-010 Q-03 provisional: gym tetap dengan risiko tercatat
Gym L2 (14..23 x 18,5..24) tetap provisional. Di bawahnya studio Kevin dan area Bruno (ruang kerja), bukan ruang tenang, rapat atau server; aturan `ADJ-11` (`not_stacked_over`) menjaga hal itu dan test negatif memindahkan gym ke atas ruang CEO lalu gagal. Di lantai yang sama gym bersebelahan dengan biliar, gudang dan koridor (ADJ-06). Risiko getaran/akustik (impact noise treadmill, beban dinamis) ke studio di bawah tidak dihitung; butuh kajian struktur/akustik profesional sebelum dipakai di luar konsep.

## ADR-011 Q-04 provisional: harness performa reproducible, FPS perangkat belum diuji
Angka performa berasal dari harness `app/src/perf/harness.ts` + `tests/e2e/perf.spec.ts` dengan rute dan seed tetap, dijalankan di container SwiftShader tanpa GPU. Angka itu bukti reproducible metodologi dan anggaran draw call/triangle/transfer, bukan FPS perangkat. Status target FPS desktop/mobile tetap "belum diuji" sampai Budi/Max menjalankan harness yang sama di perangkat yang disebut (runbook di `docs/QA-REPORT.md`).

## ADR-012 Daun pintu runtime: buka otomatis, posisi terbuka solid
Daun pintu diturunkan sekali (`tools/kantor/geometry.py::door_leaves`, disimpan di `design/derived/walls.json`) dan dipakai runtime, navgrid Python dan TS, serta diuji terhadap engsel node `LEAF-*` Blender dan busur CAD. Pintu membuka sendiri bila ada agen dalam 1,8 m dari pusat pintu (0,3 s), pintu terbatas tetap tertutup pada mode visitor. Posisi daun terbuka diperlakukan solid di navgrid karena area ayun memang wajib bebas (validator `door_swing_clear_of_fixtures`, Studio memakai cek yang sama). Daun tertutup tidak dimasukkan ke navgrid: aturan waktu menjamin daun terbuka penuh sebelum agen masuk ambang (diuji soak 20 menit). Alasan: tanpa kunci/kartu akses pada demo, pintu otomatis paling sederhana dan tidak bisa mengurung NPC. Membatalkan: hapus pengisian `openRect` di kedua navgrid dan ekspor ulang.

## ADR-013 Antar-agen: tidak ada langkah yang menumpuk
Setiap langkah NPC yang berjalan ditolak bila berakhir di dalam cakram agen lain (NPC atau CEO) dan lebih dekat dari sebelumnya; aturan prioritas lama (NPC prioritas tinggi mengabaikan NPC berjalan lain) dan zona kedatangan dihapus. Kebuntuan diselesaikan berurutan: menunggu, detour yang menutup cakram semua agen dalam 4 m (jeda bertingkat per NPC), lalu pada saling-tunggu NPC indeks lebih tinggi mundur ke titik bebas 0,7 sampai 1,2 m, menahan 1,5 s, dan merencanakan ulang. Kedatangan di lantai lain menunggu bila titik tiba terisi. Test: soak seed 42 (2 jam), 11 dan 3 (30 menit) dengan CEO berdiri di koridor tersibuk harus 0 langkah tumpang tindih (sebelumnya 401), dan tidak ada NPC diam lebih dari 10 s (seed 3, 11, 23). Biaya: slot multi-kursi yang titik dekatnya berdempet bisa ditolak lalu NPC memilih aktivitas lain.

## Batas yang tidak diputuskan pelaksana
Lahan, lokasi, luas sah, okupansi manusia, biaya, hosting, integrasi Hermes, client benchmark, logo. Pertanyaan terbuka Q-01 sampai Q-04 ada di PRD v0.2 bagian 2.
