# Kantor RPG

## PRD v1.1: kantor RPG, papan kerja tim, dan perintah privat ke agen Hermes

Pemilik produk: Budi. Penulis v1.0: Max (Air Buddy). Badan: PRIBADI. Tanggal revisi: 2026-10-05 (v1.1; v1.0 2026-10-03). Baseline desain: PRD v0.2, dipertahankan untuk program ruang, aset, CAD dan ICT. Rencana tambahan ini berasal dari permintaan langsung Budi: memerintah agen Hermes dari RPG, dengan tiga pilihan dari agen dan satu pilihan ketik manual.

Status dokumen: rencana produk v1.0, bukan klaim aplikasi sudah v1.0 atau acceptance 100%. Demo sudah tersedia; hasil terbaru ada di `docs/MAX-CLOSURE.md`. Integrasi perintah belum dibangun atau diuji. Persetujuan memasukkan fitur ke PRD bukan izin otomatis mengaktifkan backend, memublikasikan percakapan, mengubah perangkat ISP, membuka kredensial atau membayar layanan.

Catatan baseline: angka dan audit M0 pada bagian berikut adalah riwayat desain, bukan inventaris host terkini. AutoCAD native sudah menghasilkan DWG sesuai laporan closure, tetapi plot/font masih terbuka. Max menjadi pelaksana saat ini sesuai arahan Budi; penugasan Claude pada baseline adalah riwayat, bukan instruksi menjalankan worker baru.

## 0B. Perubahan v1.1 (2026-10-05)

- D-13: kantor RPG mendapat tiga papan kerja seperti kantor 3D (`employee-3d.air-buddy.site`): Papan Handoff, Daftar Pekerjaan, dan Log Aktivitas. Rincian di bagian 18.
- D-14: sumber data papan sama dengan kantor 3D (Kanban, berkas handoff `_Bersama`, ekor `agent.log`, sesi omp), dibaca server, SELECT saja. Tidak ada sumber kedua yang bisa berbeda isi.
- D-15: papan masuk tahap M4 (baca-saja). Isi nyata hanya untuk owner yang login. Situs publik menampilkan papan berisi data simulasi berlabel `Demo`.
- D-16: papan bukan alat perintah. Menyetujui, memindah, atau menutup tugas dari papan adalah fitur M5 dan mengikuti bagian 17.4.
- REQ-BOARD-01 sampai 05 dan AC-nya ditambahkan ke bagian 18.5; tahap M4 di bagian 14 diperluas.

## 0A. Keputusan v1.0 dan perubahan scope

- D-08: Budi dapat berbicara dan memberi tugas kepada agen Hermes nyata melalui karakter atau directory di RPG, setelah login privat.
- D-09: setiap giliran yang meminta keputusan menyediakan tepat tiga pilihan kontekstual dan pilihan keempat `Ketik manual`. Tidak ada pilihan yang dikirim otomatis.
- D-10: memilih agen mengikat percakapan ke profil aslinya. Jobdesk, izin alat dan batas produksi tetap berlaku, baik dari RPG maupun Telegram.
- D-11: kontrol privat adalah Must v1.0 tahap M5. M4 tetap tahap adapter status baca-saja; M4 sendiri tidak memenuhi kebutuhan perintah.
- D-12: demo publik tetap terpisah dan tidak dapat mengirim pekerjaan ke agen nyata. Pengunjung tidak melihat percakapan atau payload privat.
- Keputusan terbuka: metode login/2FA, lokasi backend, API/transport Hermes yang benar-benar tersedia, batas retensi, perangkat HP target dan rincian sumber status. Tentukan sebelum aktivasi M4/M5.
- Izin update employee-rpg dengan backup/rollback yang sudah diberikan tetap hanya untuk situs ini. Tidak mencakup perangkat produksi atau layanan lain.

## 0. Perubahan dari v0.1

- Dataset satu sumber `design/world.json` (revisi P03: P02 ditambah arah bukaan pintu, 39 jendela konsep dan aturan ADJ-11) dan schema `design/world.schema.json` dibuat; CAD, Blender, runtime dan ICT wajib membacanya.
- Program ruang dua lantai dikunci sebagai proposal: 20 ruang di L1, 18 ruang di L2, termasuk sirkulasi, shaft dan riser, total 1536 m2 gross.
- Validator `tools/validate_world.py` menjalankan 46 pemeriksaan (schema, overlap, coverage, pintu, arah bukaan, jendela, fixture, clearance, navigasi staff/visitor, adjacency, foreign key ICT). Test negatif membuktikan validator menolak data rusak.
- Kapasitas dihitung oleh `tools/capacity.py`; temuan baru: target cold start 8 s pada 10 Mbps hanya mengizinkan sekitar 10 MB awal, bukan 25 MB.
- ICT diturunkan oleh `tools/ict_derive.py`: 45 outlet, 72 port, panjang kabel dari route tray, tiga access switch agar spare tetap di atas 20 persen.
- Audit tool: Blender 4.0.2 tersedia di container; AutoCAD tidak tersedia sehingga native DWG BLOCKED.
- Matriks requirement memakai status per bagian (target, asumsi, belum diuji, terverifikasi, tidak didukung) dengan path evidence.

## 1. Tujuan

Budi bergerak sebagai CEO dalam kantor dua lantai layaknya RPG. Kantor menjadi tempat memahami tim, membuka tugas dan dokumen demo, serta melihat blueprint rancangan bangunan dan ICT yang konsisten dengan dunia 3D. Agent memiliki perilaku idle yang beragam, tetapi animasi tidak boleh dianggap bukti bahwa agent sedang bekerja. Dunia harus menyenangkan dijelajahi tanpa mengorbankan aksesibilitas atau keamanan.

Indikator keberhasilan adalah tindakan yang benar-benar bisa dilakukan: bergerak, berpindah lantai, menemui persona, membuka panel, menata ruang, mengganti tampilan avatar, mengikuti aktivitas rekreasi, dan membaca paket denah. Angka FPS, hasil uji, ukuran file dan status tugas hanya ditampilkan jika terukur atau diberi label simulasi/target.

## 2. Keputusan pemilik dan hal terbuka

D-01 sampai D-07 dari v0.1 tetap berlaku: dua lantai dengan kerja terpisah dari rekreasi; keragaman navigasi setara kantor pixel lama tanpa konversi tile ke meter; visual semi-anime original; inspirasi fitur publik Holixora tanpa menyalin kode/aset; CAD, Blender, ICT dan PDF satu proyek; repo publik kantor-rpg dikerjakan Claude Code cloud dan disupervisi Max; tidak menyentuh produksi ISP dan tidak memakai biaya tambahan.

Belum diputuskan: lahan fisik, lokasi, luas yang disahkan, target okupansi manusia, biaya pembangunan dan perangkat HP benchmark. Situs publik sudah tersedia sesuai closure. Budi menyetujui rencana kontrol privat di v1.0; sumber, hosting backend, login dan privasi tetap gerbang aktivasi. Default runtime saat ini: demo, integrasi private disabled.

Butuh masukan Budi (NEEDS_INPUT, tidak memblokir M1 sampai M3). Max mencatat keputusan provisional untuk keempatnya (ADR-008 sampai ADR-011 di `docs/decisions.md`); Budi tetap dapat membatalkannya:
- Q-01: apakah 34 ruang bernama (tanpa shaft) dan 117 slot aktivitas cukup mewakili "keragaman setara" 47 area kantor pixel, atau perlu sub-zona tambahan? Provisional: keragaman ruang dipertahankan karena 27 fungsi PRD bagian 5 terlacak ke 38 ruang dan sebaliknya (`tools/prd_trace.py`).
- Q-02: apakah L2 boleh bergantung pada satu tangga utama, lift dan penanda tangga darurat konsep di sisi timur, atau perlu tangga kedua di dalam envelope? Provisional: tangga dan lift internal untuk gameplay; tangga darurat timur hanya penanda konsep tertaut, tanpa klaim kepatuhan peraturan.
- Q-03: apakah ruang gym di atas studio Kevin/area Bruno dapat diterima secara konsep, mengingat isu getaran/akustik yang harus dikaji profesional? Provisional: gym tetap, dengan risiko getaran/akustik tercatat dan aturan ADJ-11 (tidak di atas ruang tenang, rapat atau server).
- Q-04: perangkat client benchmark untuk target FPS (desktop dan mobile). Provisional: harness performa reproducible; FPS perangkat nyata belum diuji sampai diukur.

## 3. Riset dan batas bukti

Holixora menampilkan kontrol WASD, Shift, E, drag kamera, R, panduan teks, mode ringan, departemen dan akses ruang terbatas; halaman demo menyatakan tidak ada pekerjaan atau data pelanggan asli [1]. Pembuat menyebut prototype/data contoh serta tur 3D, percakapan persona, Office Studio dan Avatar Studio [2]. Fitur tersebut menjadi target proyek ini, bukan klaim sudah berjalan, dan tidak ada kode/aset Holixora yang disalin.

Baseline kantor pixel lokal: 77 kolom, 44 baris (3388 sel), 47 area, 297 instance furniture. Dataset P03 memiliki 34 ruang non-shaft (rasio 0,72), 199 fixture (rasio 0,67), 117 slot aktivitas dan sekitar 1000 m2 area walkable pada navgrid. Angka ini perbandingan kompleksitas eksplorasi, bukan spesifikasi bangunan.

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

Aturan adjacency yang diuji: ADJ-01 resepsi di entrance; ADJ-02 jalur visitor lobby ke rapat menghindari server; ADJ-03 Bruno ke server maksimal 6 m jalan; ADJ-04 Bruno ke lab maksimal 12 m; ADJ-05 ruang basah minimal 8 m dari server; ADJ-06 ruang bising tidak berbagi dinding dengan ruang tenang; ADJ-07 dan ADJ-08 ruang basah bertumpuk; ADJ-09 pintu server hanya dari area Bruno; ADJ-10 minimal dua exit konsep L1; ADJ-11 gym tidak di atas ruang sensitif (Q-03). Hasil: 11 dari 11 lolos pada revisi P03.

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

Hasil derivasi P03: 45 outlet, 72 port (desk 2 port, bench lab 4 port, AP dan kamera 1 port), 4 patch panel 24 port (96 port, 72 terpakai), 3 access switch 48 port PoE dengan 4 uplink dicadangkan per switch (spare 45,5 persen per switch), 11 AP placeholder (AS-ICT-01), 5 kamera konsep opsional tanpa kamera di toilet/shower. Panjang kabel = route tray + naik rack 1,2 m + riser 4,0 m untuk L2 + drop ke outlet + slack 3,3 m (AS-ICT-02); total 2074,8 m, terpanjang 50,6 m, semua di bawah target 90 m (AS-ICT-03). PoE worst-case 407 W dari kelas IEEE (AS-ICT-04); budget PoE switch belum divalidasi karena datasheet belum dipilih. Tidak ada harga (AS-ICT-05).

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
M4: adapter status privat baca-saja setelah persetujuan sumber/hosting/auth/privasi, termasuk tiga papan kerja bagian 18 (Handoff, Pekerjaan, Log). Papan demo boleh rilis lebih dulu dengan data simulasi berlabel.
M5: perintah privat melalui RPG dengan tiga pilihan + ketik manual, routing profil, receipt, audit, approval dan uji isolasi. Detail wajib ada pada bagian 17.

Setiap milestone: commit kecil, PR ke main tanpa merge, `docs/progress.md` dan `docs/evidence/` berisi perintah, hasil, versi dan SHA. Dua kegagalan dengan sebab sama berhenti di checkpoint.

## 15. Risiko dan closure

AutoCAD tidak tersedia: DWG native ditahan, DXF/PDF konsep dan runbook tersedia. Container tanpa GPU: angka performa dari container bukan benchmark perangkat Budi. Kompleksitas eksplorasi di bawah baseline pixel pada rasio ruang (0,72): kompensasi lewat slot aktivitas, menunggu Q-01. L2 hanya satu tangga dalam envelope: ditandai AS-EXIT-01 dan Q-02. Gym di atas ruang kerja: Q-03. Art terlalu berat: LOD, atlas, instancing dan streaming per lantai. Repo publik bocor: safety scan, allowlist URL runtime, tanpa salinan JS/gambar pihak ketiga. Limit worker: checkpoint SHA tanpa fallback berbayar.

## 16. Definition of done

Dapat dijalankan dari clean clone dengan dependency terpin dan perintah nyata; semua Must M0 sampai M3 dipetakan ke test dan evidence; tidak ada tombol mati; walkthrough desktop/tablet/mobile/keyboard tercatat; tidak ada error console/aset/network kritis; aset legal dan original; sumber blueprint dan PDF terbuka/terbaca dengan data konsisten; status CAD native jujur; performa diukur; isolasi publik dan secret scan bersih; PR ditinjau supervisor. Demo M0-M3 boleh dirilis terpisah dengan M4/M5 disabled. Produk penuh v1.0 baru selesai setelah seluruh Must M5 memiliki bukti acceptance, selain gerbang manusia/perangkat yang tetap dicatat terbuka. Rencana saja tidak memenuhi definition of done.

## 17. Perintah agen Hermes dari RPG (M5, Must v1.0)

### 17.1 Pengalaman Budi

Budi login sebagai owner, mendekati karakter agen, lalu menekan E/tap `Bicara & beri tugas`. Directory menyediakan akses identik tanpa 3D. Panel menunjukkan nama agen, profil, lane dan mode privat sebelum Budi mengirim apa pun. Percakapan Max tidak otomatis menjadi percakapan Nova, Hugo atau bot lain.

Budi mengetik permintaan pertama. Agen membalas dengan isi yang relevan, kemudian menawarkan tiga langkah atau jawaban kontekstual dan satu pilihan `Ketik manual`. Pola yang sama berlaku saat agen meminta keputusan lanjutan. Contoh ilustratif, bukan hasil agen nyata:

1. Periksa progres tugas ini.
2. Tinjau hasil yang sudah ada.
3. Susun langkah berikutnya.
4. Ketik manual.

Pilihan berasal konteks dan kemampuan lane, bukan menu tetap yang dipaksakan untuk setiap tugas. Pilihan pertama boleh ditandai rekomendasi, tetapi tidak dipilih atau dieksekusi otomatis. `Ketik manual` membuka input bebas dan tidak menyalin teks contoh sebagai perintah Budi. Budi dapat mengubah maksud tanpa terikat tiga pilihan agen.

Tiga pilihan merupakan alternatif tindakan/keputusan yang bermakna, berbeda dan aman. Jika bahan kurang, agen memberi tiga cara melengkapi bahan atau memperjelas scope, bukan mengarang fakta atau menawarkan aksi yang dilarang. Jawaban akhir, error dan pemberitahuan progres boleh tanpa menu apabila tidak meminta keputusan.

Klik pilihan mengirim ID pilihan, teks yang ditampilkan, agen tujuan, conversation ID dan turn ID. Backend memvalidasi bahwa pilihan berasal giliran tersebut; pilihan lama kedaluwarsa dan tidak boleh diterjemahkan menjadi tindakan lain. Input manual melalui validasi dan kebijakan izin yang sama dengan pilihan tombol.

### 17.2 Alur tugas dan hasil

Alur: owner terautentikasi -> pilih agen -> susun pesan atau pilih salah satu alternatif -> kirim eksplisit -> server memvalidasi -> adapter meneruskan ke profil Hermes -> receipt -> progres -> hasil.

Status pengiriman dan status pekerjaan dipisahkan. `Diterima` berarti backend menerima pesan, bukan pekerjaan selesai. Status pekerjaan: queued, working, waiting_owner, blocked, completed, failed, cancelled, unknown. Masing-masing membawa task ID, sumber dan waktu observasi. Status selesai berasal hasil runtime/receipt dan pemeriksaan artefak sesuai tugas, bukan animasi karakter atau asumsi sukses.

Panel menampilkan laporan ringkas, file/link hasil yang diizinkan dan langkah lanjutan. Link unduhan privat membutuhkan otorisasi setiap akses; path lokal/secret tidak disebarkan ke publik. Reconnect melanjutkan berdasarkan task/conversation ID tanpa mengirim tugas yang sama lagi. Idempotency key mencegah double click membuat dua pekerjaan.

Jika agen offline atau timeout, UI menyatakan belum diterima/unknown sesuai receipt yang tersedia. Tidak boleh mengklaim berhasil lalu melakukan retry diam-diam pada tindakan berisiko. Budi dapat melihat progres tanpa membuat panggilan LLM baru setiap polling. Tombol berhenti tersedia hanya bila kemampuan runtime telah terbukti; stop tidak dianggap membatalkan efek eksternal yang sudah terjadi.

### 17.3 Arsitektur yang direncanakan dan discovery

Browser -> backend privat berautentikasi -> adapter Hermes -> profil agen. Browser tidak memegang token gateway, kredensial model, sandi atau akses shell. Endpoint/transport implementasi belum dikunci: verifikasi dokumentasi resmi dan capability versi terpasang sebelum memilih REST, event stream, WebSocket atau control API. Jangan mengarang endpoint Hermes dari nama fitur dalam PRD.

Kontrak proposal terdiri dari AgentDirectory, Conversation, SendMessage, DecisionOptions, TaskReceipt, TaskEvent, ArtifactRef dan ApprovalRequest. DecisionOptions memuat tepat tiga entri {id,label,message,intent,requiresApproval}, manualEnabled=true, turnId dan expiry. Output agen dianggap data tidak tepercaya: validasi schema, sanitize Markdown/link, larang HTML/script dan cegah text action menjadi shell mentah.

Roster berasal profil yang memang aktif dan boleh diakses Budi, bukan label NPC yang diasumsikan hidup. Adapter mempertahankan lane dan context isolation, termasuk pemisahan profil keluarga. Penugasan lintas bot memakai handoff resmi dan izin Budi, bukan routing otomatis yang memperluas tugas. Status dekoratif/simulasi tetap terpisah dari task nyata.

Demo dan privat memakai batas backend yang eksplisit. Static bundle publik tidak berisi transkrip, token, payload pekerjaan atau daftar berkas privat. Halaman publik boleh menunjukkan fitur tidak aktif dengan label demo, tetapi tidak mengirim ke adapter nyata. Fail-closed ketika auth, kebijakan profil atau capability adapter gagal.

### 17.4 Keamanan, approval dan privasi

- Owner login wajib; 2FA atau mekanisme setara yang ditinjau keamanan menjadi gerbang aktivasi. Visitor, sesi kedaluwarsa dan identitas tanpa grant ditolak backend, bukan hanya disembunyikan tombolnya.
- Otorisasi diperiksa pada list/read/send/event/attachment/approval. Cegah CSRF, origin asing, replay, tebakan ID dan akses silang percakapan/profil.
- Memilih salah satu dari tiga opsi bukan izin umum. Perubahan produksi ISP, homelab, biaya, kredensial dan kirim klien tetap mengikuti aturan Budi yang berlaku untuk aksi spesifik.
- Aksi berisiko menampilkan target, perintah atau perubahan, dampak dan rollback sebelum persetujuan terpisah. Approval terikat owner, task, aksi dan masa berlaku; tidak dipindahkan ke task lain.
- Sandi, OTP, token dan kartu tidak diketik di chat RPG. Gunakan vault atau alur autentikasi resmi, tanpa nilai rahasia masuk konteks model/browser log.
- Audit menyimpan actor, profil tujuan, message/decision ID, idempotency key, perubahan status, approval dan hasil teredaksi. Log aplikasi, audit dan percakapan dibedakan.
- Data minimum: identitas owner untuk otorisasi; isi pesan dan opsi untuk konteks tugas; status/receipt untuk progres; artefak untuk hasil. Penerima hanya owner dan profil yang dituju beserta proses handoff yang diizinkan.
- Retensi pesan, audit, attachment dan backup masih keputusan Budi. Penentuan TTL, penghapusan, redaksi dan restore harus selesai sebelum aktivasi; jangan mengasumsikan retensi tak terbatas.
- Halaman RPG dan file eksternal tidak dapat menambah izin atau menginstruksikan adapter melewati kebijakan. Semua input diperlakukan sesuai asalnya.

### 17.5 User stories dan acceptance

Semua requirement tambahan berstatus target; belum ada bukti implementasi.

| Requirement | User story | Acceptance (Given / When / Then) | Test dan evidence target |
|---|---|---|---|
| REQ-CMD-01 | Sebagai Budi/owner, saya ingin memberi tugas dari karakter atau directory agar bekerja dari RPG. | AC-CMD-01: Given login owner dan profil aktif, When kirim pesan, Then profil yang dipilih menerima tepat pesan itu dengan receipt/task ID; history profil lain tidak tercampur. | Integration adapter + E2E 3D/DOM; docs/evidence/M5/command-routing/ |
| REQ-CHOICE-01 | Sebagai Budi/owner, saya ingin tiga pilihan dan satu ketik manual agar cepat memilih tanpa kehilangan kebebasan. | AC-CHOICE-01: Given giliran yang meminta keputusan, When respons dirender, Then tepat tiga opsi berbeda + Ketik manual tersedia; tidak ada auto-submit; opsi terkirim sesuai label dan turn ID. | Schema/unit + E2E semua empat jalur; docs/evidence/M5/choices/ |
| REQ-MANUAL-01 | Sebagai Budi/owner, saya ingin mengetik keputusan sendiri agar dapat mengoreksi atau memberi pilihan lain. | AC-MANUAL-01: Given panel keputusan, When pilih manual dan kirim teks, Then teks owner diteruskan utuh dalam batas validasi, fokus input menghentikan locomotion, Escape menutup tanpa mengirim. | Unit + keyboard/mobile E2E; docs/evidence/M5/manual/ |
| REQ-CMD-02 | Sebagai Budi/owner, saya ingin receipt dan progres nyata agar tahu tugas diterima atau selesai. | AC-CMD-02: Given task diterima, When queued/working/waiting/complete/failure events datang, Then UI menunjukkan status sumber/waktu dan hasil, bukan animasi; reconnect tidak membuat tugas ganda. | Integration event replay/dedupe/offline + E2E; docs/evidence/M5/task-lifecycle/ |
| REQ-CMD-03 | Sebagai Budi/owner, saya ingin batas izin tetap berlaku agar opsi dialog tidak mengubah produksi tanpa izin. | AC-CMD-03: Given aksi berisiko, When opsi/manual meminta aksi, Then tidak ada eksekusi sebelum approval aksi spesifik yang valid; expired/replayed/wrong-owner approval ditolak. | Policy unit + negative integration; docs/evidence/M5/approval/ |
| REQ-CMD-04 | Sebagai visitor, saya ingin demo tetap aman agar tidak dapat memerintah atau membaca agen nyata. | AC-CMD-04: Given visitor/tanpa login, When mencoba send/read/event/file API secara langsung, Then backend menolak dan tidak ada dispatch; bundle/cache publik tidak mengandung payload privat. | Security integration + public negative E2E; docs/evidence/M5/isolation/ |
| REQ-CMD-05 | Sebagai Budi/owner, saya ingin percakapan dan hasil aman saat gagal agar tidak kehilangan maksud atau membuat eksekusi ganda. | AC-CMD-05: Given jaringan putus/adapter offline/double click, When kirim/reconnect, Then receipt menentukan retry aman; unknown ditampilkan jujur; satu idempotency key tidak membuat dua pekerjaan. | Fault injection + dedupe + restart tests; docs/evidence/M5/failure/ |

Happy path: owner memilih salah satu opsi atau teks manual, agen yang benar menerima dan hasil tercatat. Failure path: respons opsi tidak valid, giliran kedaluwarsa, offline, timeout, quota limit, event terlambat atau attachment hilang memberi error jujur dan retry yang aman. Permission boundary: visitor, owner logout, profil tanpa grant, bot lain, opsi lama dan approval tidak cocok menghasilkan nol dispatch atau nol aksi terlarang. Setiap baris requirement diuji pada jalur normal, gagal dan batas izin; evidence path di atas masih target, bukan artefak yang sudah ada.

Aksesibilitas: semua opsi minimal 44 px, Tab/Enter/Space berfungsi, focus trap dan Escape benar, panel tidak menutupi tombol kirim pada HP, pembaca layar membedakan label opsi dan input manual. Halaman chat/command harus tetap berfungsi ketika WebGL hilang.

### 17.6 Kapasitas dan biaya (asumsi perencanaan)

Budi adalah satu owner pengirim; visitor publik tidak diberi command access. Target awal: satu pekerjaan aktif per profil, sisanya antre; batas lintas profil dan antrean dikunci setelah discovery runtime. Tidak ada LLM call untuk frame animasi, polling progres atau membuka ulang panel.

Worst case wajib diuji: beberapa tab owner reconnect bersamaan, seluruh profil offline kemudian pulih, tugas selesai saat tab tertutup, double click send dan approval dikirim ulang. Queue bounded, backpressure, deduplication dan cursor event wajib sebelum aktivasi. Tentukan byte limit pesan/event/attachment, batas antrean, frekuensi status, retensi dan RAM/disk dari pengukuran adapter sebelum sizing backend; angka yang belum diukur tetap asumsi.

Rumus sizing: dispatch_rate = owner_active_tabs * sends_per_tab_per_second (dibatasi server); status_egress = sanitized_event_bytes * event_rate * authorized_viewers; log_growth = records_per_day * bytes_per_record * retention_days; total_storage = conversations + audit + artifacts + backup_copies. Gunakan worst-case correlated reconnect untuk burst, bukan rata-rata idle. Setiap angka input harus tercatat pada ADR discovery dan dihitung alat sebelum rilis.

Tidak ada izin top-up/provider berbayar baru. Request eksplisit owner yang benar-benar membutuhkan agen mengikuti provider yang disetujui dan batas kuota; ketika kuota habis tampil blocked, tanpa pindah ke provider berbayar diam-diam. Tambahan estimasi pemeliharaan M5 belum dikunci sebelum adapter dipilih; cakupan wajib mencakup auth/approval audit, redaction, restore test dan regression pilihan/manual.

### 17.7 Rencana implementasi dan gerbang rilis

M5-A: capability discovery read-only Hermes, ADR transport/auth/queue, roster/lane dan privacy/retention; belum membuka command publik.
M5-B: dialog 3+1 serta manual input pada adapter test berlabel simulasi; uji keyboard/mobile, turn expiry dan invalid schema.
M5-C: backend privat dan routing ke profil nyata dalam lingkungan uji yang disetujui; receipt, idempotency, progres/hasil dan artifact auth. Buktikan satu pesan sampai profil yang tepat tanpa membuka lane lain.
M5-D: approval, negative security tests, reconnect/offline/restore dan quota handling. Tidak menyentuh perangkat ISP untuk membuktikan kebijakan; gunakan assertion dispatch ditolak.
M5-E: owner acceptance pada desktop/HP yang ditentukan, preview dan review keamanan; backup/rollback situs dan backend sesuai scope yang Budi setujui sebelum aktivasi.

Definition of done M5: semua requirement di atas dipetakan ke bukti eksekusi nyata; tiga pilihan + manual bekerja, tugas diterima profil tepat tanpa duplikasi, progres/hasil jujur, visitor benar-benar ditolak, izin produksi tidak berubah, secret scan bersih, recovery diuji, perangkat target diuji dan Budi menyetujui preview. M5 belum selesai hanya karena panel tampil atau API mocked lulus. Dokumen ini tidak menyalakan integrasi.

### 17.8 Bukti keputusan dan batas riset

Sumber fitur: pesan langsung Budi pada 2026-10-03 di chat ini, meminta rencana PRD v1.0 agar dapat memerintah agen dari RPG dengan tiga pilihan dan satu ketik manual. Kontrak dan keamanan pada bagian 17 adalah usulan desain, bukan klaim endpoint/capability vendor sudah tersedia. Dokumentasi resmi untuk discovery Hermes: https://hermes-agent.nousresearch.com/docs/ . Pilihan library auth, transport dan endpoint harus didukung kutipan sumber versi terkini pada ADR M5-A sebelum kode integrasi ditulis.

## 18. Papan kerja tim: handoff, pekerjaan, log (M4, v1.1)

Tujuan: Budi bisa membaca keadaan tim dari dalam kantor tanpa membuka Telegram satu per satu. Polanya meniru kantor 3D yang sudah live: papan tugas Kanban, feed "X meminta Y", dan aksi alat per bot. Kantor RPG menambah tempat fisik untuk tiap papan dan papan khusus handoff.

### 18.1 Letak di dunia dan akses tanpa 3D

- **Papan Handoff**: papan dinding di ruang rapat/koordinasi L1, dekat meja Max. Interaksi E/tap membuka panel.
- **Daftar Pekerjaan**: papan tulis di area kerja tiap lantai; panel bisa disaring per lane.
- **Log Aktivitas**: layar besar di lobby atau ruang server (ruang server tetap terkunci untuk visitor; layar lobby menampilkan versi demo).
- Ketiganya juga ada di DOM directory dan menu HUD, sehingga tetap bisa dipakai saat WebGL gagal, dengan keyboard, dan dengan pembaca layar.
- Karakter boleh berjalan ke papan saat tugasnya berubah, tetapi animasi tetap dekoratif (bagian 8). Status yang sah hanya yang tertulis di panel beserta sumber dan waktunya.

### 18.2 Papan Handoff

Isi per kartu: proyek, badan usaha (ISP/ENT/LABS/PRIBADI), dari bot, ke bot, ringkasan satu baris, status, umur, dan tautan berkas handoff.

- Kolom status: `Dikirim` -> `Diterima` -> `Dikerjakan` -> `Diblokir` / `Selesai` / `Dibatalkan`. Status berasal dari tugas Kanban yang dibuat `serah-terima`; kartu tanpa tugas Kanban tampil `Belum tercatat`.
- Rantai kerja ditampilkan sebagai jalur (contoh Hugo -> Nova -> Clara -> Stella) dengan langkah aktif disorot, sesuai PETA-JOBDESK.
- Penanda: handoff lebih dari 24 jam tanpa `Diterima`, atau diblokir, diberi label `Perlu perhatian`. Batas jam bisa diatur.
- Berkas handoff (`~/Hermes/_Bersama/<proyek>/`) hanya dibaca: judul, pengirim, penerima, tanggal, dan bagian "Yang diminta". Isi lengkap dibuka di panel privat, bukan disalin ke bundle.

### 18.3 Daftar Pekerjaan

- Sumber: tabel `tasks` Kanban (todo, running/claimed, blocked, done 7 hari terakhir), ditambah drop omp yang sedang jalan (SUN, MOON, MARS, JUPITER, NEPTUNE, dan agen lain) dari sesi omp.
- Isi per baris: judul (dipotong sekitar 56 karakter), pemilik lane, peminta, status, umur, dan tingkat model bila tercatat di log tangga-model.
- Filter: per bot, per badan usaha, per status. Urutan bawaan: diblokir, sedang jalan, antre, selesai.
- Tugas profil pribadi (yupus, wealth) hanya tampil sebagai `Tugas pribadi` tanpa judul, sama dengan aturan kantor 3D.

### 18.4 Log Aktivitas

- Gabungan peristiwa Kanban (dibuat, diambil, selesai, diblokir) dan aksi alat dari `agent.log` 24 jam terakhir, diurutkan waktu.
- Kuota terpisah supaya peristiwa tugas tidak tenggelam: bawaan 50 peristiwa tugas + 110 aksi alat.
- Nama alat dipetakan ke kata kerja Indonesia (terminal -> "Menjalankan perintah"). Isi perintah, argumen, path privat, dan isi obrolan tidak ditampilkan.
- Satu baris: waktu, bot, kata kerja, objek singkat. Klik baris membuka tugas terkait bila ada.

### 18.5 Kebutuhan dan acceptance

- REQ-BOARD-01: Sebagai owner, saya ingin melihat semua handoff aktif dan macetnya di satu papan. AC: Given ada tugas Kanban berjudul HANDOFF, When papan dibuka, Then setiap tugas muncul sekali dengan dari/ke/status/umur yang sama dengan `hermes kanban show`; yang berumur >24 jam tanpa diterima berlabel `Perlu perhatian`.
- REQ-BOARD-02: Sebagai owner, saya ingin daftar pekerjaan per lane. AC: Given filter lane X, When diterapkan, Then hanya tugas milik X tampil dan jumlahnya cocok dengan query SELECT pembanding.
- REQ-BOARD-03: Sebagai owner, saya ingin log yang bisa dibaca cepat. AC: When log dibuka, Then baris terurut waktu, kuota tugas/alat dipatuhi, dan tidak ada argumen perintah, path rumah, token, atau isi obrolan (diuji dengan secret scan pada payload).
- REQ-BOARD-04: Sebagai visitor publik, saya hanya melihat papan demo. AC: Given tanpa login, When papan dibuka, Then data berlabel `Demo`, bundle statis dan respons API publik tidak memuat judul tugas, nama berkas, atau peristiwa nyata (diuji dengan pencarian string pada build dan respons).
- REQ-BOARD-05: Sumber gagal tidak boleh tampil sebagai sukses. AC: Given Kanban/log tidak terbaca atau lebih tua dari TTL, Then papan menampilkan `Tidak diketahui` / `Basi` beserta waktu observasi terakhir.

### 18.6 Arsitektur dan kapasitas

- Pakai ulang adaptor kantor 3D (`lib/hermes/state.mjs`): field `todos`, `feed`, `runs` sudah tersedia. Tambahan: `handoffs[]` (gabungan tugas Kanban HANDOFF dan indeks berkas `_Bersama`), dan `source` + `observedAt` per papan.
- Server membaca sumber sekali per TTL (bawaan 5 detik) lalu membagikan snapshot ke semua viewer. Viewer tidak memicu baca sumber atau panggilan LLM.
- Kanban dibaca dengan `sqlite3` SELECT biasa (bukan `-readonly`, karena DB WAL bisa memberi hasil kosong tanpa pesan).
- Ukuran payload papan: sasaran di bawah 40 KB per snapshot (sekitar 50 tugas + 160 baris log). Angka pasti diukur saat M4.

### 18.7 Bukan bagian v1.1

- Menyetujui, memindah, menugaskan ulang, atau menutup tugas dari papan (M5, mengikuti 17.4).
- Notifikasi keluar (Telegram/email) dari papan.
- Riwayat lebih lama dari 7 hari untuk tugas selesai dan 24 jam untuk log.

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
