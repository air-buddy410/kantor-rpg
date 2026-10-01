# Kantor RPG

## PRD v0.1: brief implementasi dan gerbang pembuktian

Pemilik produk: Budi. Penulis: Max (Air Buddy). Badan usaha: PRIBADI, eksperimen visual kantor tim. Bukan aplikasi operasi ISP, bukan paket gambar konstruksi yang disahkan. Pelaksana berikutnya: Claude Code cloud, Opus 5.5, effort High. Semua hasil berada dalam repo kantor-rpg. Versi ini adalah baseline perencanaan; app, CAD, Blender dan koneksi Hermes belum diuji.

## 1. Tujuan

Budi bergerak sebagai CEO dalam kantor dua lantai layaknya RPG. Kantor menjadi tempat memahami tim, membuka tugas dan dokumen, serta melihat blueprint rancangan bangunan dan ICT yang konsisten dengan dunia 3D. Agent memiliki perilaku idle yang beragam, tetapi animasi tidak boleh dianggap bukti bahwa agent sedang bekerja. Dunia harus menyenangkan untuk dijelajahi tanpa mengorbankan aksesibilitas atau keamanan.

Indikator keberhasilan adalah tindakan yang benar-benar bisa dilakukan: bergerak, berpindah lantai, menemui persona, membuka panel, menata ruang, mengganti tampilan avatar, mengikuti aktivitas rekreasi, dan membaca paket denah. Angka FPS, hasil uji, ukuran file dan status tugas hanya ditampilkan jika terukur atau diberi label simulasi/target.

## 2. Keputusan pemilik dan hal terbuka

D-01: gedung dua lantai, area kerja terpisah dari rekreasi.
D-02: luas navigasi dan keragaman area setara pengalaman kantor pixel lama; tidak mengonversi tile langsung menjadi meter.
D-03: visual semi-anime RPG, referensi Story of Seasons: A Wonderful Life, Final Fantasy, dan Pokemon Pokopia. Karakter dan aset harus original.
D-04: mengambil inspirasi fitur publik Holixora, bukan menyalin kode atau asetnya.
D-05: CAD 2D, Blender 3D, rencana ICT dan PDF gambar masuk satu proyek.
D-06: repo publik kantor-rpg pada akun Air_Buddy; implementasi dikerjakan Claude Code cloud, Opus 5.5 High; Max supervisi lewat OpenCLI.
D-07: tidak mengakses atau mengubah produksi ISP. Tidak mengaktifkan pemakaian berbayar, top-up atau auto-reload.

Belum diputuskan: lahan fisik, lokasi, luas yang disahkan, target okupansi manusia, biaya pembangunan, spesifikasi client benchmark, hosting publik dan izin integrasi data real Hermes. Repo publik tidak sama dengan izin memublikasikan data tim. Default aman: demo simulasi offline; integrasi private disabled. Tidak ada janji bangunan dapat dibangun dari dokumen konsep ini tanpa survey, engineer struktur/MEP, regulasi dan pemeriksaan profesional.

## 3. Riset dan batas bukti

Holixora menampilkan kontrol WASD, Shift, E, drag kamera, R, panduan teks, mode ringan, departemen dan akses ruang terbatas. Halaman demo menyatakan tidak ada pekerjaan atau data pelanggan asli [1]. Pembuat menyebut prototype/data contoh serta tur 3D, percakapan persona, Office Studio dan Avatar Studio [2]. Keberadaan kontrol/teks teramati; seluruh alur Studio dan dialog belum terbukti berhasil diuji. Fitur tersebut menjadi target proyek ini, bukan klaim sudah berjalan.

Baseline kantor pixel lokal: 77 kolom, 44 baris, 47 area, 297 instance furniture. Area tidak otomatis ruang fisik; tile tidak otomatis meter. Angka ini hanya baseline kompleksitas eksplorasi, bukan spesifikasi bangunan atau instruksi menggandakan seluruh furniture.

Pokopia memberi referensi dunia yang dapat dibangun bersama dan suasana santai [7]. Story of Seasons memberi referensi keseharian dan kehidupan komunitas [5]. Final Fantasy adalah arahan rasa RPG dari pemilik, bukan sumber aset. Blender mendukung ekspor glTF dengan animasi keyframe, shape key dan skinning [3]. Three.js GLTFLoader dan AnimationMixer adalah kandidat pipeline, bukan bukti kompatibilitas semua aset. Ekstensi WebGL bergantung client [4], maka fallback diperlukan. Riset Context7 Three.js, Playwright dan Better Auth telah dilakukan lokal; worker harus memperbarui versi library dan menyimpan ADR, bukan menyalin snippet tanpa pemeriksaan.

## 4. Pengguna, peran, batas wewenang

CEO: mengendalikan avatar Budi, melihat demo dan membuka panel. Owner private kelak dapat membaca data yang diizinkan, bukan mendapat akses perangkat produksi.
Visitor: tur publik dan simulasi saja. Tidak melihat nama file private, isi chat, kredensial, pelanggan, network map operasional atau tugas real.
Designer: menyunting layout, avatar dan aset demo dalam draft; publish layout membutuhkan review.
Supervisor: Max memeriksa laporan worker, commit, PR dan hasil uji, lalu mengembalikan koreksi.
Worker cloud: Claude membuat dokumentasi, model, app dan tes dalam repo ini. Tidak merge, deploy, menambah biaya atau menyentuh sistem lain tanpa izin terpisah.

Representasi keahlian tim: Hugo untuk karakter, aset, arsitektur, sipil dan interior; Nova untuk spesifikasi dan gambar kebutuhan ICT; Bruno untuk penataan/instalasi jaringan, server dan workstation; Kevin untuk pamflet, iklan dan materi visual; Rex untuk review implementasi/QA bila ditugaskan. Ini pembagian brief dan review, bukan klaim mereka sudah membuat output. Claude menangani pengerjaan proyek ini sesuai arahan terbaru, tanpa menjalankan bot lain atau memberi mereka pekerjaan otomatis.

## 5. Konsep bangunan dan program ruang

Proposal awal, bukan keputusan luas: footprint modular 32 m x 24 m tiap lantai, tinggi antar lantai 4 m. Luas harus dihitung dari dataset dan dievaluasi lagi setelah blocking. Unit sumber meter; CAD dapat memakai milimeter dengan konversi eksplisit. Origin (0,0,0) sudut barat daya lantai dasar, X timur, Y utara, Z tinggi; runtime Three.js Y-up membutuhkan mapping terdokumentasi.

Lantai 1: kerja dan kunjungan. Zona depan lobby/resepsi/gallery portofolio; pusat sirkulasi dengan tangga dan akses vertikal yang bisa digunakan avatar; sayap tenang ruang CEO/diskusi; studio Hugo; studio Kevin; area Nova; area Bruno/lab ICT terpisah dari server; ruang kerja implementasi/review; ruang rapat besar; toilet aksesibel; pantry kerja; gudang dan utilitas. Server rack tidak menjadi jalur umum dan tidak satu ruang dengan shower atau pantry basah.

Lantai 2: rekreasi. Ruang game, lounge, olahraga, biliar, diskusi santai, perpustakaan/reading nook, makan/pantry, shower dan toilet, balkon/taman, gudang dan area servis. Kebisingan game/biliar dipisahkan dari reading nook/diskusi. Area basah ditumpuk dekat shaft yang sesuai; proposal belum menyatakan desain plumbing selesai.

Adjacency wajib: resepsi dekat entrance; rapat dapat dicapai visitor tanpa melewati server; Bruno dekat lab/rack tetapi akses rack terbatas; semua meja mendapat route sirkulasi; ruang basah jauh dari rack atau punya pemisahan yang divalidasi; rekreasi tidak memotong jalur evakuasi; titik kembali aman di setiap lantai. Dua jalur keluar pada konsep harus dikaji, bukan diberi label memenuhi peraturan sebelum review profesional.

Claude menghasilkan room schedule dengan ID stabil, nama, lantai, polygon, luas, fungsi, kapasitas target, pintu, furnishing, ICT, finish, adjacency dan status asumsi. Setiap polygon harus berada dalam envelope, tidak overlap, dan setiap pintu punya jalur navigasi. Sisa area dikelompokkan sirkulasi/shaft/teras, bukan hilang dalam hitungan luas. Ukuran meja, lapangan biliar, shower, rack clearance dan tangga bersumber katalog/standar yang dikutip atau ditandai target konsep. Jangan mengarang radius Wi-Fi efektif atau menyatakan tangga layak konstruksi dari tampilan game.

## 6. Art direction, karakter dan aset

Style: bentuk tebal dan mudah dibaca, sudut furniture lembut, detail secukupnya, proporsi semi-anime stylized, material matte, warna lingkungan hangat, tanaman dan ruang komunal. Bukan fotorealistik, bukan pixel sprite, bukan clone Pokemon. Persona adalah karakter original berlabel representasi virtual, bukan foto atau likeness manusia yang diklaim akurat. Budi menjadi avatar CEO original, tanpa menebak detail wajah fisik.

Karakter perlu silhouette berbeda, pakaian sesuai peran, palet dan aksesori yang relevan. Nama persona berasal brief, bukan testimonial. Character sheet: depan/samping/belakang, tinggi relatif, rig spec, ekspresi, palette, deform test dan atlas material. Shared skeleton bila cocok, bukan memaksa semua proporsi. Animasi minimum: idle, walk, sit/stand, typing, wave, talk; tambahan stretch, read, coffee, controller, exercise, billiards. Transition diuji agar kaki tidak meluncur dan tangan tidak menembus meja.

Asset families: shell/dinding/pintu/jendela/tangga; meja/kursi/sofa/rak; monitor/laptop/keyboard; rack/switch/AP/patch panel/cable tray; pantry/shower/toilet; game console/sport/biliar; tanaman/signage/pamflet. Asset registry berisi ID, pembuat, sumber/lisensi, source blend, GLB, dimensi, pivot, collider, material, triangle count, LOD dan preview. Aset original procedural diperbolehkan; primitifs blocking tidak disebut final art. Logo baru belum disahkan: gunakan nama kantor-rpg sebagai teks.

Budget awal target: karakter utama <=25k triangles, NPC LOD0 <=15k dan LOD1 <=5k; prop kecil <=2k; atlas 1k default dan 2k hanya bila dibutuhkan; visible scene mobile <=250k triangles dan <=150 draw calls. Semua target wajib diukur dan disesuaikan dengan perangkat, bukan dianggap performa terbukti.

## 7. Gameplay, kamera dan UX

Desktop: WASD/arrows bergerak relatif kamera, Shift berlari, E berinteraksi, R recenter, Escape menutup dialog, drag kamera hanya di area dunia. Kamera 3/4 top-down adjustable, cutaway bangunan per lantai, zoom bounded, obstacle occlusion fade. CEO punya spawn jelas di lobby. Floor switch hanya di titik tangga/lift/portal yang ditandai; tidak teleport tak sengaja. Modal/input fokus harus menonaktifkan locomotion agar mengetik tidak menggerakkan avatar.

Mobile: joystick kiri dan tombol interaksi kanan >=44 px, camera gesture yang tidak bentrok dengan joystick, panel bottom sheet dengan safe area; landscape nyaman tetapi portrait tetap bisa dipakai. Tablet punya layout sendiri. HUD hanya room name, mode data, interaksi kontekstual dan menu; bukan dashboard template yang menutupi dunia.

Interaksi: menyapa NPC, melihat peran/status/tugas demo, duduk, memakai workstation, melihat artwork/signage, membaca denah/ICT, kegiatan lounge/game/biliar/olahraga. Aktivitas dekoratif tanpa backend diberi label aktivitas virtual. Minigame bukan engine olahraga/biliar penuh pada MVP, tetapi aksi nyata/feedback, bukan tombol mati.

Office Studio: edit draft dengan grid snapping, rotate/place/delete fixture milik draft, validasi overlap/pintu/navigation, undo/redo, save/load JSON terversi, preview, publish/rollback lokal. Tidak membuka script arbitrary dari layout import. Avatar Studio: pilih varian karakter original, warna/pakaian yang tersedia, preview animasi, reset/save; jangan tampilkan pilihan yang tidak punya asset.

Panduan aksesibel: DOM directory semua ruang dan persona, tombol lompat/fokus yang nyata, jalur alternatif penggunaan panel tanpa 3D; text labels, focus trap dialog, reduced motion, mute/sound opt-in, pilihan quality. Jika WebGL gagal, directory dan dokumen tetap dapat dipakai.

## 8. NPC idle dan pemisahan status real

Empat layer terpisah: workStatus dari adapter; activityState untuk tampilan; position/navigation; interactionState. workStatus adalah working/waiting/blocked/done/unknown dengan timestamp sumber. activityState adalah desk/coffee/chat/read/stretch/game/billiards/exercise/rest/walk. Avatar bermain bukan bukti bot berhenti bekerja, dan avatar mengetik bukan bukti tool dipanggil.

Utility selector berseed memilih aktivitas berdasarkan room availability, cooldown, role preference dan durasi idle. Hindari semua NPC memilih kopi bersama. Reservasi kursi, meja biliar dan alat gym; kapasitas, expiry dan cancel saat pemain menginteraksi. Pathfinding per lantai, cross-floor route eksplisit, stuck detector dan kembali ke safe waypoint; timeout tidak menghapus NPC. Group chat dijadwalkan dengan target/slot, bukan agent sungguhan berbicara atau menghabiskan token. Tidak ada LLM call per frame, tiap tick idle atau animasi.

Prioritas: interaksi CEO > status critical visual > transisi animasi > aktivitas idle. Waktu kerja baru dapat memicu kembali desk namun tidak menimpa dialog pemain. Reduced motion menurunkan animasi sekunder, bukan menghilangkan akses informasi. Simulasi memiliki badge teks permanen dan dataset fixture, bukan payload palsu yang menyerupai status real tanpa label.

## 9. Arsitektur aplikasi dan data

Kandidat v1: TypeScript, Three.js WebGL2, Vite dan DOM UI. React hanya jika ADR membuktikan kebutuhan; jangan menambah kompleksitas karena template. Playwright untuk browser, unit tests untuk math/state/navigation/schema. glTF/GLB dari Blender menjadi runtime assets. WebGPU opsional setelah WebGL fallback terbukti.

Modules: world renderer; controller/camera; interaction; NPC state/navigation; studio; blueprint viewer; data adapter; safety/auth (phase private); telemetry performance lokal. Satu source dataset design/world.json untuk rooms/furniture/ports/routes/characters. Generator CAD, Blender dan runtime membaca schema yang sama, bukan tiga denah manual berbeda.

World schema: version, units, coordinates, floor envelopes, rooms, doors, circulation, fixtures, assetRefs, colliders, waypoints, interactions dan ICT refs. Actor record: id, displayName, role, avatarAsset, allowedPublicFields. Adapter contract: mode demo/private, snapshot version, observedAt, freshnessTTL, actor summaries dan sanitized task summaries. Kesalahan adapter membuat unknown/stale, bukan done. Import JSON membatasi ukuran/kedalaman, menolak field executable dan path traversal, tidak memuat URL arbitrary.

Private Hermes hanya fase berikut setelah Budi mengizinkan sumber dan hosting. Browser tidak memegang credential. Server adapter allowlist dan redaksi, auth owner kuat/2FA untuk private, CSRF/origin/rate-limit, audit terbatas. Public route tidak boleh memuat API private, session chat atau isi task sensitif. Tidak ada public webhook atau control produksi. Tidak perlu multi-tenant SaaS/DB kompleks untuk demo static; jika scope berubah, ADR auth/DB/privacy wajib sebelum implementasi.

## 10. CAD, Blender dan paket gambar

CAD target: native DWG melalui AutoCAD yang legal/tersedia, DXF interchange, PDF vektor. Linux cloud tidak diasumsikan punya AutoCAD. Worker harus melaporkan OS/version/license/command capability. Jika AutoCAD unavailable: kerjakan DXF/PDF konsep melalui tool tersedia dan sediakan AutoCAD script/runbook; status native DWG tetap BLOCKED, jangan mengubah extension DXF menjadi DWG atau mengaku file berasal AutoCAD.

Blender target: file blend source, GLB export, render PNG, script generator idempotent. Buktikan executable/version, background generation, open/load kembali blend dan runtime GLB; jangan hanya menyimpan script. Mapping units, normals, pivot, textures, animations dan colliders diuji. Blender tidak menggantikan CAD native.

Drawing register: A-001 cover/index/notes; A-101 lantai 1; A-102 lantai 2; A-103 room schedule; A-201 furniture; A-301 elevation; A-401 sections; I-101 interior/material; ICT-001 topology; ICT-101 outlet/AP/camera per lantai; ICT-201 rack elevation; ICT-301 pathway/riser; ICT-401 port/device schedule. Sheet ID, revisi, skala dan scale bar, unit, legenda, asumsi, watermark konsep, title block dan tanggal render otomatis. Ukuran sheet A3/A2 sesuai detail; jangan mengklaim siap konstruksi. Sediakan consolidated PDF dan PDF per disiplin bila perlu; total/page labels diverifikasi.

## 11. ICT sebagai rancangan virtual

Nova specification brief: kebutuhan tiap ruang, perangkat/port, AP, rack/UPS, kabel/pathway, monitor/game display, CCTV opsional untuk konsep dan privacy area basah. Bruno installation brief: placement, riser/backbone, label kabel, rack/patch mapping, clearance/service route dan commissioning checklist. Tidak ada hubungan dengan IP/server/router produksi sebenarnya.

Schema ICT: device ID, type, room, x/y/z, port count, uplink, medium, power estimate dengan source, rackU, outletID, cableID/route, endpoint pair, estimated length dan slack formula. Proposed network domains office/demo/guest/lab/server dengan abstract IDs, bukan subnet produksi. AP quantity placeholder sampai simulation site model/material dan target coverage diketahui. Wi-Fi heatmap harus berlabel model estimasi, bukan survey RF lapangan.

Model costs/power: unit price only cited dated quote; no fabricated procurement prices. Count copper ports by endpoint schedule; switch selection counts uplinks/spares explicitly. PoE draw dari datasheet mode worst case, UPS dari W/VA/runtime manufacturer, thermal/AC memerlukan sizing profesional. Cable lengths dari route polyline + vertical drops + labeled slack, bukan garis lurus dinding. Game/gym/lounge membutuhkan ICT yang sesuai fungsi; showers/toilets tidak diberi kamera. Port mapping dan BOM punya foreign-key consistency tests.

## 12. Kebutuhan wajib dan acceptance

Semua status awal: target, kecuali fakta brief yang dicatat sebagai keputusan. Tiap REQ memiliki story, AC dan task/test/evidence di matriks. Evidence kosong berarti belum diuji, bukan terverifikasi.

REQ-WORLD-01 (M1): Sebagai CEO, saya ingin menjelajahi dua lantai agar memahami kantor. AC-WORLD-01: Given world valid, When CEO berjalan dan memakai transisi lantai, Then semua ruang wajib dapat dicapai tanpa menerobos collider. Test: navigation unit + E2E floor routes. Failure: stuck -> safe waypoint; boundary: server room visitor tetap terkunci.
REQ-CHAR-01 (M1/M2): Sebagai CEO, saya ingin mengenali persona agar menemui peran tepat. AC-CHAR-01: Given asset registry, When NPC spawn/talk, Then label peran dan animasi konsisten tanpa memakai IP pihak lain. Test: asset validation + manual silhouette/deform review. Failure: missing GLB -> honest placeholder; boundary: tidak mengarang likeness manusia.
REQ-INTERACT-01 (M2): Sebagai CEO, saya ingin menyapa dan membuka panel agar memahami aktivitas. AC-INTERACT-01: Given NPC dekat, When E/tap, Then satu panel terbuka dan locomotion berhenti; Escape menutup dan mengembalikan focus. Test: E2E desktop/mobile/keyboard. Failure: target hilang -> pesan jelas; boundary: public hanya fixture.
REQ-IDLE-01 (M2): Sebagai visitor, saya ingin aktivitas beragam agar kantor terasa hidup. AC-IDLE-01: Given seed dan NPC, When idle simulation berjalan, Then reservasi tidak overcapacity, NPC tidak stuck permanen dan task status tidak dipalsukan. Test: seeded simulation + soak. Failure: route gagal -> cancel/release; boundary: nol LLM/API calls akibat idle.
REQ-STUDIO-01 (M3): Sebagai designer, saya ingin mengedit draft kantor agar menata ruang. AC-STUDIO-01: Given valid layout, When edit/undo/save/load, Then perubahan pulih deterministik dan invalid overlap/pintu ditolak. Test: schema/unit + E2E. Failure: JSON rusak -> original tetap utuh; boundary: tidak eksekusi script/file path import.
REQ-AVATAR-01 (M3): Sebagai CEO, saya ingin memilih avatar agar punya tampilan sendiri. AC-AVATAR-01: Given varian tersedia, When preview/save/reset, Then pilihan persist dan reset kembali default. Test: E2E + asset load. Failure: asset missing -> default; boundary: tidak memakai Pokemon atau wajah manusia tanpa sumber.
REQ-BLUEPRINT-01 (M0/M3): Sebagai CEO, saya ingin melihat denah CAD/PDF/3D agar memahami rancangan. AC-BLUEPRINT-01: Given design schema, When generate, Then dimensi/pintu/fixture ID konsisten dalam DXF, PDF dan GLB, source CAD availability dilaporkan. Test: CAD reopen/parse, PDF extract/render, GLB validator and coordinate checks. Failure: AutoCAD unavailable -> native DWG blocked, bukan sukses palsu; boundary: konsep bukan signed construction.
REQ-ICT-01 (M0/M3): Sebagai designer ICT, saya ingin schedule endpoint/rack/route agar instalasi dapat dibaca. AC-ICT-01: Given device schedule, When derive ports/BOM, Then tidak ada orphan ID/duplicate port dan panjang memakai route. Test: schema/count/rack capacity unit + PDF review. Failure: spec missing -> belum divalidasi; boundary: no real ISP topology/device access.
REQ-ACCESS-01 (M1/M2): Sebagai visitor, saya ingin directory tanpa 3D agar tetap memakai kantor. AC-ACCESS-01: Given WebGL unavailable/reduced motion, When membuka app, Then DOM directory/dokumen dapat dipakai lewat keyboard dan tap. Test: forced context failure + accessibility E2E. Failure: render context loss -> fallback; boundary: aksesible view tidak bypass private policy.
REQ-DATA-01 (M4 gated): Sebagai owner private, saya ingin status tersanitasi agar melihat kerja real. AC-DATA-01: Given approved adapter, When snapshot fresh/stale/offline, Then status/time/source benar dan unknown saat timeout. Test: contract/integration + public isolation. Failure: disconnect -> stale/unknown; boundary: visitor/unauth tidak menerima payload private. Disabled sebelum izin.
REQ-PERF-01 (M1-M3): Sebagai CEO, saya ingin navigasi stabil agar bermain nyaman. AC-PERF-01: Given benchmark tercatat, When fixed route 60 detik berjalan, Then measured frame-time/load/assets memenuhi target tier atau degrade jujur. Test: browser perf + manual real-device. Failure: memory/context loss -> low quality/fallback; boundary: tidak klaim FPS tanpa benchmark.
REQ-SAFE-01 (semua): Sebagai pemilik, saya ingin publikasi aman agar data private/produksi tidak bocor. AC-SAFE-01: Given staged files and app build, When scanning and public negative tests, Then no secrets/private payload/copyright asset and no production endpoint/cost/control path. Test: secret scan, dependency/license audit, URL allowlist, network assertions. Failure: suspect -> stop publish; boundary: no merge/deploy/paid upgrade.

Should: soundscape opt-in, day/night ambience, pose photo mode tanpa real private data, richer sports/billiards mini-actions, LOD polish. Could: multi-player private, collaborative editor, custom avatar uploads after moderation/security. Won't v1: combat, commerce, public execution of bot commands, live network management, procurement orders, deployment production, architectural signoff.

## 13. Kapasitas, biaya dan pemeliharaan

Asumsi sizing demo: 1 local player, 12 persona maximum simulated per client, 40 concurrent public visitors pada static hosting kelak, 200 peak jika dibagikan. Angka bukan pengguna actual. Render adalah client-side, backend demo nol. Target initial transfer <=25 MB mobile and <=60 MB desktop; source blend/CAD bukan payload app. Cache immutable asset hashes; lazy load lantai dan props; batasi texture memory/DPR/shadows, instancing static props dan dispose resource.

Private planning only: 12 actors, snapshot setiap 5 s, 1 KB/actor payload assumed. Broadcast server 1 shared source read/5 s, bukan per viewer. Formula egress = actor_count * bytes_per_actor * viewers / interval; reconnect burst cap/jitter/backoff. Simpan perubahan task saja, bukan position/frame tiap tick. Retention usulan status history 7 hari untuk private, butuh izin. Demo tidak menyimpan chat/IP/PII dan tidak punya DB/history real. Analytics disabled default.

Targets: desktop 60 FPS median, mobile 30 FPS median; laporan p95 frame time, drop rate, GC, GPU settings, device/browser/version dan scene route. Cold start target <=8 s pada profil jaringan 10 Mbps dengan cache kosong; bila initial transfer 25 MB tidak memenuhi, first playable lebih kecil dan remainder lazy load. Core route dapat berjalan sebelum semua props dimuat. Target memory harus diukur pada client pilihan Budi, belum dijanjikan.

Budget: bonus cloud only if available, paid usage off. Hosting/domain/storage berbiaya belum disetujui; local demo dan public repo bukan live deployment. Tidak menghitung ekuivalen API sebagai saldo bonus. Library open-source license review, AutoCAD license prerequisite, Blender gratis bukan bukti sudah terpasang. Model/resource exhaustion -> checkpoint dan BLOCKED, no model substitution/no paid switch tanpa izin.

Maintenance estimate proposal: dependency/security review bulanan 2 jam; asset/perf regression 2 jam; layout/ICT consistency 1 jam; backup/restore design source 1 jam; total dihitung alat, bukan observed hours. Rebuild from clean clone dan deterministic seed tiap milestone. Source/binary copies punya checksum; backup dan Git history bukan alasan menerbitkan private payload.

## 14. Tahapan, dependency dan supervisi

M0 planning + tool audit: perbaiki asumsi/blocker; room schedule/adjacency/design schema; capacity calculation; sheet register; CAD/Blender availability. Deliver PRD v0.2, PDF, source schema, capability report. Jika native CAD unavailable, tetap lanjut bagian bebas dependency, dokumentasikan blocker.
M1 vertical slice: dua lantai blockout, CEO controls/collision, one original character asset, one room/ICT sheet from shared source, directory fallback, asset loading/perf harness. Belum final polish.
M2 life: persona roster, idle reservations/pathfinding, NPC panel, sofa/game/gym/biliar interactions, responsiveness/accessibility. Uji happy/failure/boundary.
M3 authoring + deliverables: Office Studio, Avatar Studio, final original asset families, full drawings/PDF, Blender source/GLB, port/BOM consistency, screenshot/video evidence.
M4 private integration: hanya setelah approval source/hosting/auth/privacy, adapter read-only + negative security tests. Tidak memblokir completion demo standalone.

Setiap milestone: branch claude/kantor-rpg-<milestone>; commit kecil, PR ke main tanpa merge; docs/progress.md dan docs/evidence/ berisi commands/exit results, versions, screenshots, requirements mapped to tests and exact SHA. Laporan DONE_M0/NEEDS_INPUT/BLOCKED eksplisit. Max memeriksa repository dan CI sendiri; worker report bukan verdict review. Jangan menunggu persetujuan tambahan untuk pekerjaan aman dalam M0-M3, tetapi jangan melompati izin produksi/biaya/hosting/private.

Dua kegagalan dengan sebab sama: catat reproduction/expected/actual, alternatif yang aman, checkpoint; berhenti retry identik. Jangan mengambil ulang semua dependencies/docs tiap turn. Jangan menyatakan semua selesai jika hanya satu milestone selesai.

## 15. Risiko dan closure

AutoCAD cloud tidak tersedia: DWG native ditahan, DXF/PDF alternatif berlabel dan runbook tersedia. Blender install/export tidak berhasil: source script tidak disebut model; lanjut doc/layout sambil melaporkan exact error. Art asset terlalu berat: LOD, atlas, instancing dan floor streaming diuji. NPC overcomplex: deterministic utility state first, no LLM per NPC. Scope real-office dianggap legal blueprint: watermark konsep, review engineer wajib. Public repo bocor: explicit file allowlist, secret scan, no raw copied JS/images, no private logs. Worker limit: checkpoint current SHA dan blockers tanpa paid fallback. Private connection scope creep: gate M4 disabled. Visual mobile gagal: quality fallback dan DOM path bukan menutupi issue.

## 16. Definition of done

Dapat dijalankan dari clean clone dengan version-pinned dependencies dan command nyata; semua Must M0-M3 dipetakan ke tests/evidence; tidak ada tombol mati; walkthrough desktop/tablet/mobile/keyboard; no critical console/asset/network error; assets legal dan original; blueprint sources dan PDFs terbuka/terbaca serta data konsisten; CAD native status jujur; performance measured not guessed; public isolation/secret scan clean; PR ditinjau supervisor. M4 boleh deferred dengan disabled UI dan keputusan tertulis. Hasil konsep tidak berubah menjadi izin merge/deploy/produksi atau sertifikat desain fisik.

## Sumber

[1] https://voffice.holixora.com/ : demo menyatakan simulasi, bukan data pekerjaan nyata.
[2] https://www.threads.com/@wiradm_/post/Dd6cHbLER-p : pernyataan pembuat prototype, data contoh dan daftar fitur.
[3] https://docs.blender.org/manual/en/latest/addons/import_export/scene_gltf2.html : ekspor glTF dan dukungan animasi.
[4] https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices : ketersediaan WebGL bergantung client dan praktik pengelolaan resource.
[5] https://storyofseasons.com/awl : referensi resmi suasana kehidupan komunitas, bukan aset untuk redistribusi.
[6] https://www.better-auth.com/docs/reference/security : kandidat mekanisme auth untuk fase private, bukan dependency wajib demo static.
[7] https://pokopia.pokemon.com/en-us/ : referensi resmi suasana membangun dunia bersama, bukan izin menggunakan Pokemon/IP.
[8] https://threejs.org/docs/pages/GLTFLoader.html : loader runtime glTF.
[9] https://www.autodesk.com/products/autocad/features : produk CAD; tidak membuktikan tersedianya runtime/lisensi cloud.
