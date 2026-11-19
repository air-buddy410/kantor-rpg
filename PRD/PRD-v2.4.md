# PRD v2.4 sampai v2.7: daftar game, biliar 2 pemain, HP jadi kontroler, 5 game multiplayer

- Badan usaha: PRIBADI. Pemilik produk: Budi. Penyusun: Max (default). Status: approved (Budi, 2026-11-19, "gas kerjakan v2.4 sampai v2.7").
- Baseline: main 5d1f20f (v2.3). Sumber keputusan: `~/Hermes/_Bersama/brainstorm/2026-11-19-kantor-rpg-multiplayer-hp-kontroler.md`.
- Dokumen induk: PRD-v2.0.md (REQ-FAC, REQ-ARC, REQ-MG), PRD-v1.1.md (REQ-PAD). Disusun di model harian atas permintaan Budi, belum diaudit Fable.

## 1. Kondisi sekarang

- 15 mini game. Multiplayer lokal: Tarung Kantor 2P, Arena Bom 4P, Catur 2P. Sisanya single player.
- Game hanya bisa dibuka dengan berjalan ke fasilitasnya. Game Station (Ruang game L2) berisi 10 slot, 5 terisi, 5 "segera hadir".
- Biliar: bidik stik kanan penuh 0,8 rad/dtk, L2 4x lebih halus, efek hanya tengah/atas/bawah, lawan selalu komputer, foul hanya bola putih masuk, bola di tangan ke titik kepala.
- Pemain 2 sampai 4 hanya lewat stik fisik. Situs statis di nginx webserver-101, tanpa server realtime.

## 2. Tujuan dan ukuran berhasil

1. Semua game bisa dibuka dari satu daftar di HUD, dikelompokkan Multiplayer dan Single player, lengkap dengan ruang dan lantai.
2. Biliar enak dengan DualSense (bidik lambat dan presisi), efek bola bebas, bisa 2 pemain, aturan 8-ball yang benar.
3. Pengunjung memakai HP sebagai stik tanpa memasang aplikasi: scan QR, main.
4. Game Station berisi 10 game; semua slot baru multiplayer 2 sampai 4 pemain.

## 3. Daftar game di HUD (v2.4, REQ-GL)

- REQ-GL-01 Tombol "Game" di HUD (keyboard G, stik lewat menu HUD D-pad) membuka dialog Daftar game.
- REQ-GL-02 Dua tab: Multiplayer dan Single player. Tiap baris: nama, satu kalimat, jumlah pemain ("1 sampai 4 pemain"), ruang dan lantai ("Ruang game · Lantai 2"), tombol Main.
- REQ-GL-03 Ruang dan lantai diambil dari data dunia (fixture yang membuka game itu), bukan ditulis tangan. Game di beberapa ruang (Kuis) menampilkan ruang utama dan "+N ruang lain".
- REQ-GL-04 Main: avatar pindah ke fasilitas itu (transisi yang sama dengan Direktori), kursi/slot ditandai terpakai, game langsung terbuka. Slot dipakai persona lain: pakai slot lain yang bebas; semua penuh: pesan "Sedang dipakai".
- REQ-GL-05 Game Station dikelompokkan: Multiplayer di atas, Single player di bawah, lencana jumlah pemain di tiap kabinet.
- Kriteria: e2e membuka dialog, kedua tab berisi 15 game (20 setelah v2.7) tanpa duplikat, Main pada game L1 dan L2 memindahkan avatar ke ruang yang benar dan membuka game.

## 4. Biliar (v2.4 dan v2.5, REQ-BIL)

- REQ-BIL-01 Bidik stik kanan penuh 0,4 rad/dtk (setengah dari v2.3), kurva kuadrat. L2 ditahan: 8x lebih halus. Stik kiri tetap menunjuk arah.
- REQ-BIL-02 Slider "Kecepatan bidik stik" di Pengaturan > Kontroler (25% sampai 200%, standar 100%), dikalikan dengan profil (Santai 0,6).
- REQ-BIL-03 Efek bebas: titik merah di mana saja dalam lingkaran bola putih (radius maks 0,8). Stik: tahan Segitiga lalu geser stik kanan; ketuk Segitiga = kembali ke tengah. Keyboard: tahan C lalu panah. Mouse/sentuh: ketuk atau geser di gambar bola putih.
- REQ-BIL-04 Fisika efek: atas/bawah seperti sekarang; efek samping (kiri/kanan) membelokkan pantulan bola putih di bantalan (running/reverse english) dan sedikit membelokkan arah awal (squirt). Efek berkurang perlahan selama bola bergulir.
- REQ-BIL-05 2 pemain bergantian: Pemain 2 lewat stik kedua/HP (lobi biasa), atau "Gantian satu perangkat" di kartu pembuka. Tanpa Pemain 2: lawan komputer seperti sekarang. Hasil versus tanpa papan skor.
- REQ-BIL-06 (v2.5) Aturan 8-ball: break wajib 4 bola menyentuh bantalan atau ada bola masuk (kalau tidak, foul); meja terbuka setelah break; foul bila bola pertama yang disentuh bukan grupnya (atau bola 8 sebelum grupnya habis), tidak ada bola kena, atau tidak ada bola menyentuh bantalan sesudah kontak dan tidak ada yang masuk, atau bola putih masuk/keluar meja.
- REQ-BIL-07 (v2.5) Bola di tangan setelah foul: lawan menaruh bola putih di mana saja (setelah break: di belakang garis kepala), tidak boleh menumpuk bola lain. Komputer memilih posisi terbaik.
- REQ-BIL-08 (v2.5) Bola 8: lubang yang dituju ditandai otomatis dari garis bidik (lubang terdekat dengan jalur bola sasaran); masuk ke lubang lain = kalah. Bola 8 masuk saat break: bola 8 ditaruh kembali di titik kaki, giliran lanjut.
- REQ-BIL-09 (v2.5) Suara benturan bola dan bantalan ikut kecepatan benturan (volume dan nada).

## 5. HP jadi kontroler (v2.6, REQ-HP)

- REQ-HP-01 Panel "Main pakai HP" di Game Station dan di Daftar game: dua QR berdampingan. QR 1 menyambung WiFi tamu (`WIFI:T:WPA;S:...;P:...;;`). QR 2 membuka `/pad.html#<kode>` dan langsung tersambung ke layar ini.
- REQ-HP-02 SSID dan sandi WiFi tamu diisi di Pengaturan PC tampilan dan hanya disimpan di browser PC itu (localStorage). Tidak ada sandi di repo, build, atau server. Tanpa sandi: QR WiFi tidak tampil, hanya QR main.
- REQ-HP-03 Halaman HP: stik analog kiri, D-pad, tombol ✕ ○ □ △, L1/R1, L2/R2 (geser), Options. Mode lanskap, layar tetap menyala (Wake Lock bila ada), getar bila game mengirim rumble (Android).
- REQ-HP-04 Di PC, tiap HP tampil sebagai stik standar (Gamepad virtual indeks 4 sampai 7), jadi semua game multiplayer, lobi, HUD dan profil tombol langsung berlaku tanpa kode khusus per game.
- REQ-HP-05 Jalur data: WebRTC DataChannel langsung HP ke PC (satu jaringan, jeda rendah); kalau gagal tersambung dalam 4 detik, lewat relay WebSocket server. Sinyal WebRTC lewat relay yang sama.
- REQ-HP-06 Relay `pad-relay` (Node tanpa dependensi) di webserver-101, di belakang nginx `/pad-relay`. Ruang dengan kode acak 6 karakter, maks 4 HP per layar, pesan maks 2 kB, batas laju, ruang ditutup bila layar pergi atau 30 menit diam. Tidak menyimpan apa pun.
- REQ-HP-07 Lencana di panel: daftar HP tersambung (Pemain 2 sampai 5), jalur (langsung/relay) dan jeda (ms).
- Batas: browser HP tidak bisa menyambung WiFi sendiri, karena itu QR WiFi terpisah. iPhone tidak mendukung getar web.

## 6. Lima game multiplayer baru (v2.7, REQ-MP)

REQ-MP-01: semua di Game Station slot 6 sampai 10, 1 sampai 4 pemain kecuali disebut lain, kursi kosong diisi komputer, tutorial + legenda seperti game lain, deterministik dengan seed, modul terpisah maks 150 kB gzip.

| Slot | Game | Isi |
|---|---|---|
| 6 | Bola Meja | Futsal tampak atas 2 lawan 2. Tim Oranye (P1, P3) lawan Biru (P2, P4). Tendang, operan, lari cepat. 3 menit atau 5 gol |
| 7 | Ular Kabel | Tiap pemain menarik kabel fiber di grid. Tabrak kabel atau dinding = keluar. Terakhir bertahan menang ronde, 3 ronde menang |
| 8 | Teknisi Kilat | Co-op: tiket gangguan muncul di rumah pelanggan, ambil alat yang tepat di gudang, perbaiki sebelum SLA habis. 3 menit, skor tim |
| 9 | Lomba 17-an | Tiga lomba berurutan: balap karung, makan kerupuk, tarik tambang. Poin per lomba, juara umum |
| 10 | Hoki Meja | Air hockey 1 lawan 1 (2 pemain), fisika keping dan pemukul. 7 gol |

## 7. Di luar cakupan

- Multiplayer online antar lokasi (selain HP di jaringan yang sama atau lewat relay ke layar yang sama).
- Membuat SSID "PerumNet Gaming": dikerjakan Budi sendiri.
- Touchpad, sensor gerak, trigger adaptif DualSense.

## 8. Rencana rilis

| Rilis | Isi | Gerbang |
|---|---|---|
| A (v2.4 + v2.5) | Daftar game, Game Station berkelompok, biliar lengkap | unit + e2e desktop/mobile + CI hijau, deploy dengan backup vhost |
| B (v2.6) | HP jadi kontroler + relay | uji 2 browser nyata (PC + HP emulasi), relay systemd di webserver-101, backup vhost |
| C (v2.7) | 5 game baru di slot 6 sampai 10 | unit tiap game + e2e semua game + CI hijau |

Rollback tiap rilis: kembalikan root vhost ke rilis sebelumnya dari `/var/backups/employee-rpg-before-<sha>.conf`. Relay: `systemctl disable --now kantor-pad-relay`, hapus location `/pad-relay`.

## 9. Pertanyaan terbuka

- Tidak ada. SSID dibuat Budi; sandi diisi Budi di Pengaturan PC tampilan.
