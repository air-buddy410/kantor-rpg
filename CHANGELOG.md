**Bahasa Indonesia** · [English](CHANGELOG.en.md)

# Catatan perubahan

Semua perubahan penting kantor-rpg, dari yang terbaru. Setiap rilis dipasang di [demo publik](https://employee-rpg.air-buddy.site) setelah tes dan CI lulus. Kode rilis adalah commit di `main`.

## v2.7.2, 20 November 2026

**Multiplayer lebih jelas, Arena Bom 4 pemain diperbaiki**

- Arena Bom: Pemain 2 sampai 4 tidak lagi ikut digerakkan komputer. Sebelumnya stik pemain dan komputer berebut menyetir karakter yang sama, jadi karakter jalan dan pasang bom sendiri.
- Arena Bom: posisi awal searah jarum jam sesuai urutan kartu di atas (P1 kiri atas, P2 kanan atas, P3 kanan bawah, P4 kiri bawah), tertulis juga di layar pembuka.
- Semua game multiplayer (Arena Bom, Bola Meja, Ular Kabel, Teknisi Kilat, Lomba 17-an, Hoki Meja): baju karakter pemain memakai warna pemainnya (merah, biru, hijau, kuning), plus label P1 sampai P4 berwarna di atas kepala dan cincin warna di kaki.
- Warna pemain sedikit lebih gelap supaya tulisan putih di atasnya terbaca.
- Lomba 17-an: nama tiap jalur di atas label terang (sebelumnya tulisan hijau di atas rumput).
- Hoki Meja: garis tengah netral, tidak lagi merah seperti warna Pemain 1.

## v2.7.1, 19 November 2026 (rilis `d488398`)

**Kontroler HP lebih gampang dipakai**

- Selalu mendatar: HP yang dipegang tegak menampilkan stik sudah diputar, cukup miringkan HP ke kiri. Di Android, sentuhan pertama membuka layar penuh dan mengunci posisi mendatar.
- Tidak bisa ter-zoom: cubit, dobel ketuk, dan geser tidak lagi memperbesar halaman di iPhone.
- Tata letak DualSense yang muat di semua HP: L1 di atas D-pad dan stik kiri, R1 di atas tombol aksi dan stik kanan, Create dan Options di tengah.
- Stik kanan baru, untuk bidik halus biliar dan efek bola.
- Stik kiri mengikuti jempol: sentuh di mana saja di area kiri, stik muncul di situ.
- HP Android bergetar pendek saat tombol ditekan.

## v2.4 sampai v2.7, 19 November 2026 (rilis `da54a01`)

**Daftar game, biliar 2 pemain, HP jadi stik, 5 game multiplayer baru**

- Daftar game (tombol Game di HUD, tombol G): semua 20 game di kantor dalam dua tab, Multiplayer dan Single player. Tiap game menyebut jumlah pemain serta ruang dan lantainya. Tekan Main: avatar pindah ke ruang itu dan game langsung terbuka, termasuk game di Lantai 1 dari Lantai 2.
- Game Station: 10 mesin, semuanya bisa dimainkan. Multiplayer di atas, Single player di bawah, jumlah pemain tertulis di tiap mesin.
- Biliar:
  - Bidik stik kanan dua kali lebih pelan dari v2.3. Tahan L2: 8 kali lebih halus.
  - Pengaturan > Kontroler punya slider Kecepatan bidik stik (25% sampai 200%).
  - Titik merah efek bisa ditaruh di mana saja di bola putih: tahan Segitiga lalu geser stik kanan (keyboard: tahan C lalu panah, mouse: klik di gambar bola). Ketuk Segitiga untuk kembali ke tengah.
  - Efek samping membelokkan pantulan bola putih di bantalan.
  - 2 pemain bergantian: pakai stik kedua atau HP, atau centang "Gantian satu perangkat".
  - Aturan 8-ball: break sah, foul bola lawan kena duluan, foul tanpa bantalan, bola di tangan di mana saja setelah foul, lubang bola 8 ditandai otomatis.
  - Suara benturan ikut kerasnya pukulan.
- Main pakai HP: layar menampilkan QR untuk membuka stik di HP. HP jadi Pemain 2 sampai 5 tanpa memasang aplikasi. Jalur langsung (WebRTC) bila satu jaringan, lewat server bila tidak. QR WiFi tamu tampil bila SSID dan sandi diisi di panel itu; sandi hanya tersimpan di PC tersebut.
- 5 game multiplayer baru di Game Station:
  - Bola Meja: futsal 2 lawan 2, 1 sampai 4 pemain.
  - Ular Kabel: tarik kabel fiber, jangan menabrak, 1 sampai 4 pemain.
  - Teknisi Kilat: kerja sama memperbaiki gangguan pelanggan sebelum SLA habis, 1 sampai 4 pemain.
  - Lomba 17-an: balap karung, makan kerupuk, tarik tambang, 1 sampai 4 pemain.
  - Hoki Meja: air hockey 1 lawan 1.
- Angka di dalam game memakai angka tegak (0 tidak lagi terlihat seperti huruf o).
- Chat agen: kolom Cari pesan yang sudah dibuka tidak lagi tertutup sendiri saat balasan baru masuk.
- Total game multiplayer sekarang 9 dari 20 game.

## v2.3, 19 November 2026

**Ramah stik DualSense**

- Begitu stik tersambung atau ditekan, semua petunjuk tombol di layar memakai tombol stik itu. DualSense dan DualShock memakai simbol PlayStation (Silang, Lingkaran, Kotak, Segitiga, L1/R1, L2/R2, Options, Create); stik lain memakai huruf A/B/X/Y. Pakai keyboard, mouse atau layar sentuh lagi, petunjuknya ikut kembali.
- Kantor: strip tombol stik di kanan bawah (jalan, kamera, interaksi, kembali, lari, zoom, peta, pengaturan), petunjuk aksi seperti "Silang Sapa", joystick layar disembunyikan, dan dialog Kontrol berisi daftar tombol stik. Profil Tombol terbalik dan Kidal ikut terbaca.
- Biliar dengan stik:
  - Stik kiri menunjuk arah bidikan, stik kanan memutar bidikan halus (dorongan kecil bergerak sangat pelan, makin miring makin cepat).
  - Tahan L2 untuk bidik presisi, empat kali lebih pelan.
  - Tarik R2 untuk tenaga, makin dalam makin kuat, lepas untuk memukul. Tarikan terlalu pelan dibatalkan, Lingkaran membatalkan tarikan.
  - Getar singkat saat memukul dan saat bola masuk (Chrome dan Edge; mati bila Kurangi gerak dinyalakan).
  - Profil Santai membuat bidikan lebih pelan.
- Semua 15 mini game: kartu pembuka berisi tutorial singkat 2 sampai 3 langkah dan daftar tombol untuk keyboard, stik dan layar sentuh. Selama main, legenda tombol tampil di bawah layar game. Petunjuk di dalam game (misalnya "Silang: ANGKAT!") ikut tombol perangkat yang dipakai.

## v2.2, 14 Oktober 2026

**Main bareng dengan beberapa stik (multiplayer lokal)**

- Tiga mini game bisa dimainkan bersama di satu layar, misalnya di TV kantor dengan beberapa stik:
  - **Tarung Kantor:** Pemain 1 lawan Pemain 2. Masing-masing memilih karakter, lalu satu pertandingan sampai menang 2 ronde.
  - **Arena Bom:** sampai 4 pemain. Sudut yang kosong diisi komputer, dan yang terakhir bertahan menang ronde.
  - **Catur Kantor:** Pemain 1 memegang putih, Pemain 2 memegang hitam, bergantian di papan yang sama.
- Cara ikut: di kartu pembuka game, sambungkan stik lain lalu tekan **A**. Daftar pemain langsung bertambah. Tekan **B** di stik itu untuk batal.
- Pemain 1 tetap bisa memakai keyboard, layar sentuh, atau stik pertama. Setiap pemain punya antrean tekan sendiri, jadi tidak ada tekan yang hilang.
- Hasil pertandingan berdua menyebut pemenangnya dan tidak masuk papan skor.
- Kalau hanya satu stik yang tersambung, game berjalan seperti biasa melawan komputer.

**Perbaikan**

- Tombol A di stik yang menekan **Mulai** tidak lagi ikut terkirim ke game. Sebelumnya, di Tarung Kantor tekan itu langsung memilih karakter tanpa sempat memilih.

## v2.1.1, 14 Oktober 2026 (rilis `84a8678`)

**Animasi di ruang olahraga**

- Karakter yang memakai treadmill sekarang berlari di atas sabuk treadmill sambil menghadap panelnya. Sebelumnya karakter itu berdiri di lantai, di sela-sela dua treadmill.
- Karakter yang memakai sepeda statis sekarang duduk di sadel, mengayuh pedal, dan memegang setang. Sebelumnya karakter itu hanya berdiri di samping sepeda.
- Model sepeda statis dibuat ulang di Blender supaya ukurannya pas dengan karakter: sadel setinggi 0,45 m (tinggi duduk animasi karakter), pedal tepat di bawah kaki, dan setang setinggi tangan. Model lama terlalu tinggi, jadi kaki karakter tidak sampai ke pedal.

## v2.1, 13 Oktober 2026 (rilis `5049ff0`)

**Catur pindah ke meja**

- **Catur Kantor** dimainkan di meja board game di Ruang game, Lantai 2, bukan lagi dari slot 6 Game Station. Ada papan catur 8x8 di atas meja.
- Catur bisa dibuka dari meja maupun dari keempat bangkunya. Avatar duduk di bangku kosong yang paling dekat, dan selama kamu main, NPC melihat bangku itu terpakai.
- Catur memakai aturan lengkap (rokade, en passant, promosi, skak mat, remis) melawan rekan tim dengan tiga tingkat kesulitan.
- Slot 6 Game Station kosong lagi. Total mini game sekarang 15: 10 di fasilitas kantor dan 5 di Game Station.

**Tombol mini game lebih responsif**

- Di layar 120 Hz (iPhone Pro, iPad Pro, Mac ProMotion), tekanan tombol yang cepat dulu bisa hilang. Dalam uji 30 kali tekan, v2.0 menerima 0 tekanan; v2.1 menerima 30, juga di layar 144 Hz.
- Setiap tekanan sekarang diantrekan dan diberikan ke game satu per satu, jadi dua tekan cepat tetap dihitung dua.
- Satu tekan membuka satu lapis. Tombol A di stik atau Enter yang masih ditahan tidak lagi langsung memilih slot Game Station atau menekan **Mulai**.
- Esc saat layar "Memuat permainan..." menutup game.
- Game Station mengikuti profil kontroler **Tombol terbalik**.
- Setelah mini game ditutup, fokus kembali ke tombol yang membukanya, jadi pemakai keyboard dan pembaca layar tidak kehilangan posisi.

**Mini game dipoles**

- Setiap game punya tutorial sesuai perangkat (keyboard, stik game, layar sentuh) dengan nama tombol yang benar.
- Tombol sentuh di HP menangkap ketukan yang sangat singkat.
- Fisika biliar dirombak: bola meluncur lalu menggelinding, dan efek bola bawah dan atas membuat bola putih berhenti, mundur, atau ikut maju.
- Animasi tegur di 3D dipoles: ayunan dengan ancang-ancang, jejak gerak, jeda saat kena, tulisan kartun ("PLAK!", "TUK!", "POK!"), dan bola kertas yang memantul.
- Musik latar baru bergaya game santai: 12 lagu original, 6 untuk area kantor dan 6 untuk mini game.

**Tampilan HUD dan HP**

- Di lebar 600 sampai 959 px (HP landscape, tablet kecil), menu atas menjadi ikon saja. Sebelumnya tombol Pengaturan dan Kontrol terpotong di tepi layar.
- Dialog Kontrol terbuka dari atas, tidak lagi langsung tergulir ke bawah.
- Notifikasi tidak lagi menutupi tombol Aksi, Game Station, atau kartu mini game.
- Daftar orang di Peta tidak berganti saat sedang disentuh, jadi tombol **Temui** tidak meleset.

## v2.0, 13 Oktober 2026 (rilis `18c7044`)

Dokumen kebutuhan: [PRD v2.0](PRD/PRD-v2.0.md).

- **14 mini game.** Sembilan fasilitas kantor membuka game sendiri: treadmill, rak dumbel, matras, meja biliar, mesin kopi, rak server, meja gambar, easel, dan rak buku perpustakaan.
- **Game Station.** Kabinet arcade dan TV di Ruang game membuka menu 10 slot dengan 5 game: Balap Drone, Tarung Kantor, Lompat Lantai, Sambung Kabel, dan Arena Bom.
- Game baru diunduh saat dibuka, jadi kantor tetap ringan. Skor 10 besar disimpan di browser.
- **Suara tanpa berkas audio.** Langkah kaki, pintu, lift, dan musik latar per area dibuat langsung di browser. Efek di sekitar makin keras saat didekati. Atur di Pengaturan > Suara, bisukan dengan **V**.
- **Animasi baru.** 11 klip baru: mulai jalan, berhenti, berbalik, angkat beban, bersepeda, menggambar, memasang kabel, mengetik cepat, kaget, mengusap kepala, dan kabur. Jalan dan lari kini menyatu mulus sesuai kecepatan, badan condong saat berlari dan berbelok, dan karakter menoleh ke CEO yang lewat.
- **Tegur.** Di kartu profil NPC ada tiga cara menegur: tepuk gulungan kertas, ketuk palu mainan, atau lempar bola kertas. Ini hanya animasi; tidak ada yang dikirim ke agen. NPC yang agennya sedang bekerja tidak bisa ditegur.

## v1.1, 11 sampai 13 Oktober 2026

- **Peta dan minimap** (`ff2cd1e`): lokasi semua karakter per lantai, lencana beda lantai, dan **Temui** lintas lantai.
- **English** (`725a516`): tampilan dua bahasa dengan pilihan di Pengaturan.
- **HUD HP** (`e7d001a`): menu ikon satu baris; menu dan minimap bisa dilipat, dan pilihannya tersimpan.
- **Stik game** (`1f6becc`): jalan, kamera, tombol A/B/X/Y, LB/RB, Select, Start, dan navigasi D-pad di semua menu.
- **Profil kontroler** (`bedba72`): Standar, Kidal, Santai, dan Tombol terbalik gaya Jepang, dengan gambar stik yang menyalakan tombol yang ditekan.
- **Tembus NPC** (`a7cb594`): dorong terus 2 detik, atau lari, dan avatar menembus NPC yang menghalangi.
- **Chat agen** (`dd5b12b`): tombol Suara berfungsi; perintah `/new`, `/stop`, `/status`, `/telegram`, `/help` dijalankan server.
- **Dinding utuh** (`ac604d0`): efek dinding tembus pandang dihapus.
- **Riser ICT dihapus** (`627f00d`): avatar bisa terjebak di shaft, jadi areanya digabung ke gudang dan ruang servis. Jumlah ruang dari 38 menjadi 36.
- Perbaikan kecil: refresh papan tidak lagi menghapus isian login (`18258d0`), dan tombol Tutup dialog dipisah ke footer (`ff6ef86`).

## v1.0 dan sebelumnya, 3 sampai 10 Oktober 2026

- **Chat rasa Telegram** (`e480894`): indikator mengetik, centang, notifikasi push, PWA, foto, berkas, dan pesan suara jadi teks.
- **Persona Echo dan Leo** (`671accd2`): dua karakter baru, total 8 NPC.
- **Jendela tidak berkedip** (`cad7bc4`).
- **v0.2** (`fa666c9a`): dunia 3D dua lantai, NPC berseed, Office Studio, Avatar Studio, direktori, papan kerja, login pemilik dengan 2FA, dan 15 sheet gambar kerja dari satu dataset.
