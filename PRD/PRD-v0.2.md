# Kantor RPG

## PRD v0.2: revisi M0 dengan dataset, kapasitas dan audit tool

Pemilik produk: Budi. Penulis v0.1: Max (Air Buddy). Revisi v0.2: Claude Code cloud (pelaksana), untuk ditinjau Max dan diputuskan Budi. Badan usaha: PRIBADI, eksperimen visual kantor tim. Bukan aplikasi operasi ISP dan bukan paket gambar konstruksi yang disahkan.

Status v0.2: dataset dunia, room schedule, adjacency, perhitungan kapasitas, port map ICT dan matriks requirement sudah dihasilkan oleh script di repo dan diuji otomatis. App runtime, gambar CAD, model Blender dan koneksi Hermes belum dibuat pada revisi ini. Semua ukuran adalah proposal untuk review, bukan luas atau desain yang disahkan.

## 0. Perubahan dari v0.1

- Dataset satu sumber `design/world.json` (revisi P02) dan schema `design/world.schema.json` dibuat; CAD, Blender, runtime dan ICT wajib membacanya.
- Program ruang dua lantai dikunci sebagai proposal: 20 ruang di L1, 18 ruang di L2, termasuk sirkulasi, shaft dan riser, total 1536 m2 gross.
- Validator `tools/validate_world.py` menjalankan 40 pemeriksaan (schema, overlap, coverage, pintu, fixture, clearance, navigasi staff/visitor, adjacency, foreign key ICT). Test negatif membuktikan validator menolak data rusak.
- Kapasitas dihitung oleh `tools/capacity.py`; temuan baru: target cold start 8 s pada 10 Mbps hanya mengizinkan sekitar 10 MB awal, bukan 25 MB.
- ICT diturunkan oleh `tools/ict_derive.py`: 45 outlet, 72 port, panjang kabel dari route tray, tiga access switch agar spare tetap di atas 20 persen.
- Audit tool: Blender 4.0.2 tersedia di container; AutoCAD tidak tersedia sehingga native DWG BLOCKED.
- Matriks requirement memakai status per bagian (target, asumsi, belum diuji, terverifikasi, tidak didukung) dengan path evidence.

## 1. Tujuan

Budi bergerak sebagai CEO dalam kantor dua lantai layaknya RPG. Kantor menjadi tempat memahami tim, membuka tugas dan dokumen demo, serta melihat blueprint rancangan bangunan dan ICT yang konsisten dengan dunia 3D. Agent memiliki perilaku idle yang beragam, tetapi animasi tidak boleh dianggap bukti bahwa agent sedang bekerja. Dunia harus menyenangkan dijelajahi tanpa mengorbankan aksesibilitas atau keamanan.

Indikator keberhasilan adalah tindakan yang benar-benar bisa dilakukan: bergerak, berpindah lantai, menemui persona, membuka panel, menata ruang, mengganti tampilan avatar, mengikuti aktivitas rekreasi, dan membaca paket denah. Angka FPS, hasil uji, ukuran file dan status tugas hanya ditampilkan jika terukur atau diberi label simulasi/target.

## 2. Keputusan pemilik dan hal terbuka

D-01 sampai D-07 dari v0.1 tetap berlaku: dua lantai dengan kerja terpisah dari rekreasi; keragaman navigasi setara kantor pixel lama tanpa konversi tile ke meter; visual semi-anime original; inspirasi fitur publik Holixora tanpa menyalin kode/aset; CAD, Blender, ICT dan PDF satu proyek; repo publik kantor-rpg dikerjakan Claude Code cloud dan disupervisi Max; tidak menyentuh produksi ISP dan tidak memakai biaya tambahan.

Belum diputuskan dan tetap terbuka: lahan fisik, lokasi, luas yang disahkan, target okupansi manusia, biaya pembangunan, client benchmark, hosting publik dan izin integrasi data real Hermes. Default aman: demo simulasi offline; integrasi private disabled.

Butuh masukan Budi (NEEDS_INPUT, tidak memblokir M1 sampai M3):
- Q-01: apakah 34 ruang bernama (tanpa shaft) dan 117 slot aktivitas cukup mewakili "keragaman setara" 47 area kantor pixel, atau perlu sub-zona tambahan?
- Q-02: apakah L2 boleh bergantung pada satu tangga utama, lift dan penanda tangga darurat konsep di sisi timur, atau perlu tangga kedua di dalam envelope?
- Q-03: apakah ruang gym di atas studio Kevin/area Bruno dapat diterima secara konsep, mengingat isu getaran/akustik yang harus dikaji profesional?
- Q-04: perangkat client benchmark untuk target FPS (desktop dan mobile).

## 3. Riset dan batas bukti

Holixora menampilkan kontrol WASD, Shift, E, drag kamera, R, panduan teks, mode ringan, departemen dan akses ruang terbatas; halaman demo menyatakan tidak ada pekerjaan atau data pelanggan asli [1]. Pembuat menyebut prototype/data contoh serta tur 3D, percakapan persona, Office Studio dan Avatar Studio [2]. Fitur tersebut menjadi target proyek ini, bukan klaim sudah berjalan, dan tidak ada kode/aset Holixora yang disalin.

Baseline kantor pixel lokal: 77 kolom, 44 baris (3388 sel), 47 area, 297 instance furniture. Dataset P02 memiliki 34 ruang non-shaft (rasio 0,72), 199 fixture (rasio 0,67), 117 slot aktivitas dan sekitar 1000 m2 area walkable pada navgrid. Angka ini perbandingan kompleksitas eksplorasi, bukan spesifikasi bangunan.

Pokopia memberi referensi dunia yang dibangun bersama dan suasana santai [7]. Story of Seasons memberi referensi keseharian komunitas [5]. Final Fantasy adalah arahan rasa RPG dari pemilik, bukan sumber aset. Blender mendukung ekspor glTF dengan animasi keyframe, shape key dan skinning [3]. Three.js GLTFLoader dan AnimationMixer adalah kandidat pipeline [8]. Ketersediaan WebGL bergantung client [4], maka fallback DOM wajib.

## 4. Pengguna, peran, batas wewenang

CEO: mengendalikan avatar Budi, melihat demo dan membuka panel. Visitor: tur publik dan simulasi; ruang server, riser dan shaft terkunci (dibuktikan oleh test navigasi mode visitor). Designer: menyunting layout dan avatar dalam draft lokal; publish ke dataset membutuhkan review. Supervisor: Max memeriksa laporan, commit, PR dan hasil uji. Worker cloud: Claude membuat dokumentasi, model, app dan tes dalam repo ini; tidak merge, deploy, menambah biaya atau menyentuh sistem lain.

Persona dalam dataset: Budi (CEO, pemain), Max (supervisor), Hugo (karakter, aset, arsitektur), Nova (spesifikasi ICT), Bruno (instalasi jaringan dan server), Kevin (pamflet dan materi visual), Rex (review dan QA). Semua adalah representasi virtual original dengan flag simulated, bukan likeness manusia dan bukan klaim mereka sudah membuat output.

## 5. Konsep bangunan dan program ruang

Proposal (AS-DIM-01): footprint 32 m x 24 m tiap lantai, tinggi antar lantai 4,0 m, plafon 3,0 m, slab 0,30 m, dinding luar 0,30 m dan dalam 0,15 m (AS-DIM-03). Unit sumber meter; DXF memakai milimeter (x1000). Origin (0,0,0) di sudut barat daya lantai jadi L1, X timur, Y utara, Z atas. Runtime Three.js memakai mapping three = (x, z, -y); exporter glTF Blender melakukan konversi yang sama.

Struktur denah kedua lantai sama agar shaft, riser dan inti tangga menumpuk: pita selatan (Y 0 sampai 8), koridor utama (Y 8 sampai 10,5), pita tengah (Y 10,5 sampai 16,5) dengan inti tangga U dan lift di X 14 sampai 20, koridor utara (Y 16,5 sampai 18,5), pita utara (Y 18,5 sampai 24). Sirkulasi 23,4 persen dari gross per lantai.

Lantai 1 (kerja dan kunjungan): lobby dan resepsi dengan entrance selatan, galeri portofolio, ruang rapat besar yang dicapai visitor dari lobby tanpa melewati server, pantry kerja, toilet dan shaft basah di sisi tenggara, ruang diskusi, ruang implementasi dan review, area Nova, lab ICT, ruang CEO, studio Hugo, studio Kevin, area Bruno, ruang server yang hanya berpintu dari area Bruno, riser ICT, gudang. Empat pintu keluar konsep: entrance, ujung barat dan timur koridor utama, ujung barat koridor utara.

Lantai 2 (rekreasi): reading nook, lounge dengan coffee bar, ruang makan dan pantry, shower dan ruang ganti di atas pantry L1, toilet di atas toilet L1, diskusi santai, taman dalam sebagai penyangga akustik, ruang game, balkon taman, ruang biliar dengan clearance stik, ruang olahraga, gudang dan area servis. Ruang bising (game, biliar, gym) tidak berbagi dinding dengan ruang tenang; validator ADJ-06 membuktikan aturan ini.

Room schedule lengkap ada di `docs/room-schedule.md` dan `design/derived/room-schedule.csv`: ID stabil, nama, lantai, polygon, luas, fungsi, kursi, pintu, furnishing, ICT, finish, adjacency dan status asumsi. Ukuran meja biliar, rack clearance dan tangga ditandai target konsep (AS-DIM-04, AS-DIM-05, AS-ICT-06). Tidak ada radius Wi-Fi efektif dan tidak ada klaim tangga layak konstruksi.

Aturan adjacency yang diuji: ADJ-01 resepsi di entrance; ADJ-02 jalur visitor lobby ke rapat menghindari server; ADJ-03 Bruno ke server maksimal 6 m jalan; ADJ-04 Bruno ke lab maksimal 12 m; ADJ-05 ruang basah minimal 8 m dari server; ADJ-06 ruang bising tidak berbagi dinding dengan ruang tenang; ADJ-07 dan ADJ-08 ruang basah bertumpuk; ADJ-09 pintu server hanya dari area Bruno; ADJ-10 minimal dua exit konsep L1. Hasil: 10 dari 10 lolos pada revisi P02.

## 6. Art direction, karakter dan aset

Style: silhouette tebal, sudut furniture lembut, material matte, warna lingkungan hangat (krem, hijau tua, kayu, satu aksen terakota), tanaman dan ruang komunal. Bukan fotorealistik, bukan pixel sprite, bukan clone Pokemon. Huruf UI dan label: Alegreya Sans (SIL OFL 1.1), humanist sans dengan lisensi jelas. Palet final adalah hasil iterasi dengan contrast dihitung oleh script, bukan angka yang diputuskan Budi.

Karakter: silhouette berbeda per peran, pakaian dan prop relevan, character sheet depan/samping/belakang, rig spec, deform test. Animasi minimum: idle, walk, sit, typing, wave, talk; tambahan sesuai aktivitas. Asset registry wajib memuat ID, pembuat, lisensi, source blend, GLB, dimensi, pivot, collider, triangle count, LOD dan preview. Primitif blocking tidak disebut final art.

Budget target: karakter utama 25k triangle, NPC LOD0 15k dan LOD1 5k, prop kecil 2k, atlas 1k default; scene mobile 250k triangle dan 150 draw call. Dengan 6 NPC, anggaran karakter LOD0 = 115k sehingga sisa lingkungan 135k pada scene mobile. Semua target diukur dahulu sebelum disebut terpenuhi.

## 7. Gameplay, kamera dan UX

Desktop: WASD/panah bergerak relatif kamera, Shift lari, E interaksi, R recenter, Escape menutup dialog, drag kamera hanya di area dunia. Kamera 3/4 top-down, cutaway per lantai, zoom terbatas. CEO spawn di lobby (WP-L1-SPAWN). Pindah lantai hanya di titik tangga dan lift yang ditandai dalam `verticalLinks`; tidak ada teleport tak sengaja. Modal atau input fokus menonaktifkan locomotion.

Mobile: joystick kiri dan tombol interaksi kanan minimal 44 px, gesture kamera tidak bentrok joystick, panel bottom sheet dengan safe area. Tablet punya layout sendiri. HUD hanya nama ruang, mode data, interaksi kontekstual dan menu.

Interaksi: menyapa NPC, melihat peran/aktivitas demo, duduk, memakai workstation, melihat artwork/signage, membaca denah/ICT di meja denah, kegiatan lounge/game/biliar/olahraga sebagai aktivitas virtual berlabel. Office Studio: draft dengan grid snapping, rotate/place/delete, validasi overlap/pintu/navigasi memakai aturan yang sama dengan validator, undo/redo, save/load JSON terversi, publish/rollback lokal; import menolak field executable dan path. Avatar Studio: varian original yang memang punya asset, preview animasi, reset/save.

Aksesibilitas: DOM directory semua ruang dan persona, focus trap dialog, reduced motion, sound opt-in, pilihan kualitas. Jika WebGL gagal, directory dan dokumen tetap dapat dipakai.

## 8. NPC idle dan pemisahan status real

Empat layer terpisah: workStatus dari adapter (working/waiting/blocked/done/unknown dengan timestamp sumber); activityState untuk tampilan (desk/coffee/chat/read/stretch/game/billiards/exercise/rest/walk); posisi/navigasi; interactionState. Dataset menyediakan 117 activity slot ber-capacity dari fixture, dan setiap slot dibuktikan dapat didekati pada navgrid.

Utility selector berseed memilih aktivitas berdasarkan ketersediaan slot, cooldown, preferensi peran (field rolePreference di actor) dan durasi idle. Reservasi slot punya capacity, expiry dan cancel. Pathfinding per lantai, cross-floor lewat verticalLinks, stuck detector kembali ke safe waypoint. Tidak ada LLM call per frame, per tick idle atau per animasi. Badge simulasi permanen.

## 9. Arsitektur aplikasi dan data

Kandidat v1: TypeScript, Three.js WebGL2, Vite, DOM UI tanpa React kecuali ADR membuktikan perlu. Playwright untuk browser test, unit test untuk navigasi/state/schema. Dataset `design/world.json` dibaca oleh generator CAD (`cad/`), generator Blender (`blender/`), runtime (`app/`) dan derivasi ICT (`tools/ict_derive.py`). Dinding tidak disimpan terpisah: diturunkan dari tepi polygon ruang (gabungan per garis grid) dikurangi bukaan pintu oleh `tools/kantor/geometry.py`, sehingga semua konsumen memotong bukaan yang sama.

Kontrak navigasi: grid 0,1 m, sel terblokir bila pusatnya di dalam dinding (kecuali bukaan pintu yang terbuka untuk mode akses) atau di dalam fixture collider, lalu diinflasi radius agen 0,25 m. Runtime wajib mengimplementasikan aturan yang sama; test konsistensi membandingkan jumlah sel walkable per lantai dengan hasil Python.

Adapter contract (M4, disabled): mode demo/private, snapshot version, observedAt, freshnessTTL, actor summaries dan sanitized task summaries. Kesalahan adapter menjadi unknown/stale, bukan done. Import JSON membatasi ukuran/kedalaman dan menolak field executable, path traversal dan URL arbitrary.

## 10. CAD, Blender dan paket gambar

Hasil audit M0 (`docs/evidence/M0/capability-report.md`): AutoCAD tidak tersedia, maka native DWG BLOCKED. DXF interchange dibuat dengan ezdxf 1.4.4 dan dibaca ulang untuk test; PDF vektor dibuat dengan ReportLab 5.0.1. Runbook AutoCAD disediakan untuk konversi di mesin berlisensi. Blender 4.0.2 tersedia; model hanya disebut ada setelah script dieksekusi, file blend dibuka ulang dan GLB divalidasi.

Drawing register (target, `design/sheets.json`): A-001 cover/index/catatan (A3); A-101 denah L1 dan A-102 denah L2 (A2, 1:100); A-103 room schedule (A3); A-201 dan A-202 furniture per lantai (A2, 1:100); A-301 tampak (A3, 1:200); A-401 potongan (A3, 1:100); I-101 finish interior (A3, 1:200); ICT-001 topologi (A3); ICT-101 dan ICT-102 outlet/AP/kamera per lantai (A2, 1:100); ICT-201 elevasi rack (A3, 1:20); ICT-301 pathway/riser (A3, 1:200); ICT-401 port/device schedule (A3). Setiap sheet memuat ID, revisi, skala dan scale bar, unit, legenda, asumsi, watermark KONSEP, title block dan tanggal render otomatis. PDF PRD ini bukan blueprint.

## 11. ICT sebagai rancangan virtual

Hasil derivasi P02: 45 outlet, 72 port (desk 2 port, bench lab 4 port, AP dan kamera 1 port), 4 patch panel 24 port (96 port, 72 terpakai), 3 access switch 48 port PoE dengan 4 uplink dicadangkan per switch (spare 45,5 persen per switch), 11 AP placeholder (AS-ICT-01), 5 kamera konsep opsional tanpa kamera di toilet/shower. Panjang kabel = route tray + naik rack 1,2 m + riser 4,0 m untuk L2 + drop ke outlet + slack 3,3 m (AS-ICT-02); total 2074,8 m, terpanjang 50,6 m, semua di bawah target 90 m (AS-ICT-03). PoE worst-case 407 W dari kelas IEEE (AS-ICT-04); budget PoE switch belum divalidasi karena datasheet belum dipilih. Tidak ada harga (AS-ICT-05).

Domain jaringan office/demo/guest/lab/server adalah ID abstrak (AS-NET-01), bukan subnet atau VLAN produksi. Port map, label dua ujung dan BOM ada di `design/derived/ict-portmap.json` dan `.csv`.

## 12. Kebutuhan wajib dan acceptance

Status per bagian ada di `docs/requirements-matrix.md` (dibuat dari `design/requirements.json`). Evidence kosong berarti belum diuji.

REQ-WORLD-01 (M1): Sebagai CEO, saya ingin menjelajahi dua lantai agar memahami kantor. AC-WORLD-01: Given world valid, When CEO berjalan dan memakai transisi lantai, Then semua ruang wajib dapat dicapai tanpa menerobos collider. Failure: stuck ke safe waypoint. Boundary: server terkunci untuk visitor.

REQ-CHAR-01 (M1/M2): Sebagai CEO, saya ingin mengenali persona agar menemui peran tepat. AC-CHAR-01: Given asset registry, When NPC spawn/talk, Then label peran dan animasi konsisten tanpa memakai IP pihak lain. Failure: GLB hilang menjadi placeholder jujur. Boundary: tidak mengarang likeness manusia.

REQ-INTERACT-01 (M2): Sebagai CEO, saya ingin menyapa dan membuka panel agar memahami aktivitas. AC-INTERACT-01: Given NPC dekat, When E/tap, Then satu panel terbuka dan locomotion berhenti; Escape menutup dan mengembalikan focus. Failure: target hilang memberi pesan jelas. Boundary: public hanya fixture.

REQ-IDLE-01 (M2): Sebagai visitor, saya ingin aktivitas beragam agar kantor terasa hidup. AC-IDLE-01: Given seed dan NPC, When idle simulation berjalan, Then reservasi tidak overcapacity, NPC tidak stuck permanen dan task status tidak dipalsukan. Failure: route gagal di-cancel dan reservasi dilepas. Boundary: nol LLM/API call akibat idle.

REQ-STUDIO-01 (M3): Sebagai designer, saya ingin mengedit draft kantor agar menata ruang. AC-STUDIO-01: Given valid layout, When edit/undo/save/load, Then perubahan pulih deterministik dan overlap/pintu invalid ditolak. Failure: JSON rusak, original tetap utuh. Boundary: tidak mengeksekusi script atau path dari import.

REQ-AVATAR-01 (M3): Sebagai CEO, saya ingin memilih avatar agar punya tampilan sendiri. AC-AVATAR-01: Given varian tersedia, When preview/save/reset, Then pilihan persist dan reset kembali default. Failure: asset hilang kembali ke default. Boundary: tidak memakai Pokemon atau wajah manusia tanpa sumber.

REQ-BLUEPRINT-01 (M0/M3): Sebagai CEO, saya ingin melihat denah CAD/PDF/3D agar memahami rancangan. AC-BLUEPRINT-01: Given design schema, When generate, Then dimensi/pintu/fixture ID konsisten dalam DXF, PDF dan GLB, dan ketersediaan CAD native dilaporkan. Failure: AutoCAD tidak ada, native DWG BLOCKED. Boundary: konsep, bukan gambar konstruksi bertanda tangan.

REQ-ICT-01 (M0/M3): Sebagai designer ICT, saya ingin schedule endpoint/rack/route agar instalasi dapat dibaca. AC-ICT-01: Given device schedule, When derive ports/BOM, Then tidak ada orphan ID atau port ganda dan panjang memakai route. Failure: spesifikasi hilang berstatus belum divalidasi. Boundary: tanpa topologi atau akses perangkat ISP nyata.

REQ-ACCESS-01 (M1/M2): Sebagai visitor, saya ingin directory tanpa 3D agar tetap memakai kantor. AC-ACCESS-01: Given WebGL tidak tersedia atau reduced motion, When membuka app, Then DOM directory/dokumen dapat dipakai lewat keyboard dan tap. Failure: context loss ke fallback. Boundary: tampilan aksesibel tidak melewati kebijakan private.

REQ-DATA-01 (M4 gated): Sebagai owner private, saya ingin status tersanitasi agar melihat kerja real. AC-DATA-01: Given adapter disetujui, When snapshot fresh/stale/offline, Then status/waktu/sumber benar dan unknown saat timeout. Disabled sebelum izin Budi.

REQ-PERF-01 (M1-M3): Sebagai CEO, saya ingin navigasi stabil agar bermain nyaman. AC-PERF-01: Given benchmark tercatat, When rute tetap 60 detik berjalan, Then frame time/load/aset terukur memenuhi target tier atau degrade jujur. Boundary: tidak ada klaim FPS tanpa benchmark.

REQ-SAFE-01 (semua): Sebagai pemilik, saya ingin publikasi aman agar data private/produksi tidak bocor. AC-SAFE-01: Given file staged dan build app, When scan dan negative test publik, Then tidak ada secret, payload private, aset berhak cipta, endpoint produksi, biaya atau jalur kontrol. Failure: temuan menghentikan publish.

Should, Could dan Won't v1 tetap seperti v0.1: soundscape opt-in, day/night, photo mode, mini-aksi olahraga/biliar lebih kaya dan LOD polish sebagai Should; multi-player private, collaborative editor, upload avatar sebagai Could; combat, commerce, eksekusi bot publik, manajemen jaringan live, pengadaan, deployment produksi dan signoff arsitektur sebagai Won't.

## 13. Kapasitas, biaya dan pemeliharaan

Semua angka dihitung oleh `tools/capacity.py` dari dataset dan asumsi berlabel (`docs/capacity.md`).

- Luas: 768 m2 per lantai, 1536 m2 gross; sirkulasi 23,4 persen per lantai.
- Kursi dari fixture: L1 41 kursi dan 13 workstation; L2 42 kursi. Beban hunian pembanding (IBC 2021 Table 1004.5, AS-OCC-01): L1 110 orang, L2 302 orang. Ini pembanding egress, bukan target okupansi.
- Demo: 1 pemain lokal, 6 NPC simulasi (maksimal 12 per client), render client-side, backend demo nol.
- Transfer: 25 MB pada 10 Mbps = 20 s; 60 MB = 48 s. Target cold start 8 s hanya memberi ruang sekitar 10 MB, sehingga first playable harus 10 MB atau kurang dan sisanya lazy load per lantai/props.
- Private planning (M4 disabled): 12 aktor x 1 KB x viewer / 5 s; 40 viewer = 98304 B/s (0,354 GB/jam); 200 viewer = 491520 B/s (1,769 GB/jam). Server membaca sumber bersama 720 kali per jam, bukan per viewer.
- Pemeliharaan proposal: 2 + 2 + 1 + 1 = 6 jam per bulan, dihitung alat, bukan jam teramati.

Budget: bonus cloud hanya bila tersedia, paid usage off. Hosting, domain dan storage berbayar belum disetujui. Lisensi AutoCAD adalah prasyarat DWG native.

## 14. Tahapan, dependency dan supervisi

M0 (revisi ini): audit tool, dataset dan schema, room schedule dan adjacency, kapasitas, port map ICT, sheet register, matriks requirement, PRD v0.2 dan PDF. Branch `claude/kantor-rpg-m0`.
M1: vertical slice dua lantai, kontrol CEO dan collision dari navgrid bersama, satu karakter original dari Blender (GLB), satu sheet denah DXF/PDF dari dataset, directory fallback, perf harness. Branch `claude/kantor-rpg-m1`.
M2: roster persona, idle dengan reservasi/pathfinding, panel NPC, interaksi sofa/game/gym/biliar, responsif dan aksesibilitas. Branch `claude/kantor-rpg-m2`.
M3: Office Studio, Avatar Studio, keluarga aset original, gambar dan PDF lengkap, Blender source/GLB, konsistensi port/BOM, bukti screenshot. Branch `claude/kantor-rpg-m3`.
M4: integrasi private hanya setelah izin sumber/hosting/auth/privasi.

Setiap milestone: commit kecil, PR ke main tanpa merge, `docs/progress.md` dan `docs/evidence/` berisi perintah, hasil, versi dan SHA. Dua kegagalan dengan sebab sama berhenti di checkpoint.

## 15. Risiko dan closure

AutoCAD tidak tersedia: DWG native ditahan, DXF/PDF konsep dan runbook tersedia. Container tanpa GPU: angka performa dari container bukan benchmark perangkat Budi. Kompleksitas eksplorasi di bawah baseline pixel pada rasio ruang (0,72): kompensasi lewat slot aktivitas, menunggu Q-01. L2 hanya satu tangga dalam envelope: ditandai AS-EXIT-01 dan Q-02. Gym di atas ruang kerja: Q-03. Art terlalu berat: LOD, atlas, instancing dan streaming per lantai. Repo publik bocor: safety scan, allowlist URL runtime, tanpa salinan JS/gambar pihak ketiga. Limit worker: checkpoint SHA tanpa fallback berbayar.

## 16. Definition of done

Dapat dijalankan dari clean clone dengan dependency terpin dan perintah nyata; semua Must M0 sampai M3 dipetakan ke test dan evidence; tidak ada tombol mati; walkthrough desktop/tablet/mobile/keyboard tercatat; tidak ada error console/aset/network kritis; aset legal dan original; sumber blueprint dan PDF terbuka/terbaca dengan data konsisten; status CAD native jujur; performa diukur; isolasi publik dan secret scan bersih; PR ditinjau supervisor. M4 boleh ditunda dengan UI disabled dan keputusan tertulis.

## Sumber

[1] https://voffice.holixora.com/ : demo menyatakan simulasi, bukan data pekerjaan nyata.
[2] https://www.threads.com/@wiradm_/post/Dd6cHbLER-p : pernyataan pembuat prototype, data contoh dan daftar fitur.
[3] https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html : ekspor glTF dan dukungan animasi.
[4] https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices : ketersediaan WebGL bergantung client.
[5] https://storyofseasons.com/awl : referensi suasana kehidupan komunitas, bukan aset.
[6] https://www.better-auth.com/docs/reference/security : kandidat auth fase private, bukan dependency demo.
[7] https://pokopia.pokemon.com/en-us/ : referensi suasana membangun dunia bersama, bukan izin IP.
[8] https://threejs.org/docs/pages/GLTFLoader.html : loader runtime glTF.
[9] https://www.autodesk.com/products/autocad/features : produk CAD; tidak membuktikan runtime/lisensi cloud.
[10] International Building Code 2021, Table 1004.5 (occupant load factors): pembanding saja, bukan regulasi yang berlaku di Indonesia.
[11] IEEE 802.3af/at/bt: daya PSE per kelas PoE (Class 3 = 15,4 W, Class 4 = 30 W).
