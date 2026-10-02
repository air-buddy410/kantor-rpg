# Blender: generator aset kantor-rpg

Semua aset 3D proyek ini dibuat oleh script dari data proyek (`design/world.json`, `design/derived/walls.json`, `design/characters.json`, palet `app/src/world/palette.ts`), lalu dibuka ulang dan divalidasi. Tidak ada aset, tekstur, model atau karakter pihak ketiga. Geometri gedung adalah konsep, bukan model konstruksi dan bukan pengganti gambar CAD native.

## Clean rebuild (urutan wajib, dari root repo)

```bash
python3 tools/export_runtime.py                                                   # 0. walls.json + nav-counts.json dari world.json
blender -b --factory-startup -noaudio --python blender/building/build_building.py # 1. gedung: building.blend + building-L1/L2.glb
blender -b --factory-startup -noaudio --python blender/furniture/build_furniture.py   # 2. 54 tipe furnitur
blender -b --factory-startup -noaudio --python blender/characters/build_characters.py -- --variants  # 3. karakter
node tools/glb_optimize.mjs                                                       # 3a. export -> GLB yang dikirim (perlu app/node_modules: cd app && npm ci)
python3 tools/glb_compare.py                                                      # 3b. bandingkan GLB kirim dengan export Blender
blender -b --factory-startup -noaudio --python blender/building/render_building.py    # 4. render gedung (memakai furniture.blend)
blender -b --factory-startup -noaudio --python blender/furniture/render_furniture.py  # 5. contact sheet furnitur
blender -b --factory-startup -noaudio --python blender/characters/render_sheet.py     # 6. sheet karakter
blender -b --factory-startup -noaudio --python blender/building/validate_building.py  # 7. validasi (tulis evidence + registry)
blender -b --factory-startup -noaudio --python blender/furniture/validate_furniture.py
blender -b --factory-startup -noaudio --python blender/validate_assets.py
python3 -m pytest tests/py -q                                                      # 8. test stdlib tanpa Blender
```

Langkah 3a dan 3b wajib setelah build furnitur atau karakter: builder kini menulis export Blender ke `blender/out/raw-glb/<kind>/`, bukan ke `app/public/assets/`. Validator membaca file yang dikirim (hasil 3a). Lihat bagian "Optimasi GLB (R2)".

Validator menulis nilai terukur ke `design/asset-registry.json` (karakter, `BLD-L1/L2`, satu entri `AST-*` per tipe furnitur) dan evidence ke `docs/evidence/HARDENING/` (karakter: `blender-characters-validate.json/.txt`, gedung: `blender-building-validate.json/.txt`) serta `docs/evidence/M3/` (furnitur). Evidence M1/M3 lama untuk karakter dan gedung dibiarkan sebagai catatan historis. Status `generated+validated` hanya ditulis bila validator lulus.

Tool: Blender 4.0.2 (paket Ubuntu, Python 3.12 bawaan), Cycles CPU tanpa denoise (build ini tanpa OpenImageDenoise; EEVEE/Workbench tidak jalan headless karena `libEGL.so.1` tidak ada). Render memakai median 3x3 (yang mempertahankan garis outline) dan kuantisasi ringan agar PNG di bawah 400 KB. Kode bersama ada di `blender/lib/` (`kantor_blender.py` untuk bpy, `glb_read.py` dan `registry.py` stdlib murni).

## Optimasi GLB (R2)

Tujuan: memperkecil unduhan awal app (target proyek R2: GLB karakter + furnitur paling banyak 4.5 MB, karakter 3.0 MB, furnitur 1.5 MB; diuji `tests/py/test_asset_size.py`). Hanya `KHR_mesh_quantization` yang dipakai: three.js GLTFLoader membacanya tanpa decoder dan tanpa WebAssembly, sehingga CSP usulan tanpa `'wasm-unsafe-eval'` tetap berlaku. Draco dan meshopt sengaja tidak dipakai.

- Alur: builder Blender -> `blender/out/raw-glb/{characters,furniture}/*.glb` (export, tidak dimuat runtime) -> `node tools/glb_optimize.mjs` -> `app/public/assets/{characters,furniture}/*.glb` (yang dikirim) -> `python3 tools/glb_compare.py` -> validator Blender + pytest. GLB gedung tidak diproses (tidak dimuat runtime, tidak masuk budget) dan tetap diekspor langsung ke `app/public/assets/building/`.
- Library: `@gltf-transform/core`, `extensions`, `functions` 4.5.1 (MIT), devDependencies di `app/package.json` dengan versi pasti. Dependensi turunan `sharp` membawa binary libvips LGPL-3.0-or-later; hanya dev, tidak dikirim, dan fungsi tekstur tidak dipakai (lihat audit lisensi).
- Yang dilakukan, deterministik (tanpa jam dan acak; dua kali jalan memberi sha256 identik):
  - POSITION int16 16 bit. Karakter: satu volume kuantisasi untuk semua mesh sehingga tetap satu skin bersama; posisi dan delta morph disimpan sebagai short tanpa normalisasi dan faktor dekuantisasi masuk ke inverse bind matrix. Furnitur: short ternormalisasi, node `FURN-<type>` mendapat scale seragam + translation (satu-satunya transform yang diizinkan validator).
  - NORMAL int8, TEXCOORD_0 uint16 (pusat sel atlas bergeser paling jauh sekitar 0.0002 texel), WEIGHTS_0 uint8 yang dinormalisasi ulang agar jumlahnya tepat 1, morph tetap sparse.
  - Klip: channel yang semua key-nya sama dengan TRS rest node dihapus (518 dari 702 per karakter). Di three.js AnimationMixer properti tanpa track memakai nilai asli node untuk sisa bobot, jadi hasilnya sama; satu channel dengan waktu akhir terpanjang selalu disimpan agar durasi klip tetap. Output rotasi disimpan int16 ternormalisasi. Resample key tidak dipakai: toleransi 1e-5 justru membesarkan total (3,574,292 byte) dan 1e-4 hanya menghemat 65 KB untuk tujuh karakter sambil lossy.
  - dedup + prune; nama node, extras node/scene/mesh/material, nama material dan sampler NEAREST tidak berubah.
- Dua batasan glTF-Transform 4.5.1 yang ditangani: (1) penulis sparse membaca nilai lewat `getElement()` yang mendekuantisasi, sehingga delta morph int16 ternormalisasi tertulis 0 (terukur 70 mm); karena itu posisi karakter tidak dinormalisasi. (2) penulis menghapus komponen TRS yang selisihnya di bawah 1e-5 dari default (Blender meninggalkan scale 0.9999957 pada `upper_arm_*`); compare mengizinkan 1e-5 dan mencatat selisih terbesar.
- `tools/glb_compare.py` (pembaca stdlib `blender/lib/glb_read.py`, bukan glTF-Transform) membandingkan tiap pasangan: struktur identik (nama/parent/extras node, material, sampler, byte gambar, nama joint, nama dan durasi klip, daftar indeks) dan error terukur: posisi rest, delta morph, sel atlas UV, rotasi/translasi/scale joint pada setiap waktu key dan titik tengahnya, serta posisi vertex ter-skin pada setiap pose key setiap klip. Laporan: `docs/evidence/R2/glb-compare.json` (dibaca pytest lewat sha256 file yang dikirim).
- Blender 4.0.2 mengimpor file terkuantisasi dengan benar (diuji: bbox rest karakter dan furnitur sama dengan export dalam 0.02 mm, lima shape key, 13 action), jadi validator Blender langsung membuka file yang dikirim. `glb_read.py` kini membaca integer ternormalisasi dan menyediakan `node_positions`, `node_world_bounds`, `morph_deltas` (meter, lewat transform node atau bind matrix skin).
- Catatan runtime: `app/src/world/furniture-kit.ts` memotong `attribute.array` sebagai Float32Array dan memanggil `applyMatrix4` pada atribut int16/int8; atribut perlu didekuantisasi ke Float32 dulu (`runtimeNotes` di `docs/evidence/R2/glb-sizes-r2.json`). Karakter tidak membaca array atribut.

## Gedung (M3)

- Sumber: `blender/building/building_spec.py` (Python murni, dipakai builder, validator Blender dan pytest). Koordinat identik dengan world (meter, Z atas, x timur, y utara). Mesh disimpan dalam koordinat world dengan transform objek identitas, sehingga posisi glTF tepat world (x, y, z) -> glTF (x, z, -y); ini diuji pada vertex sampel dari buffer biner.
- Nama objek stabil (tambahan P03: jendela dan daun pintu, lihat di bawah): `SLAB-<lantai>` (pelat 0.3 m, sisi atas pada elevasi 0 / 4, ekstensi 32 x 24 m, lantai 2 punya void di atas tangga dan lift), `ROOM-<roomId>` (pelat finish 6 mm, material `floor_<finish>` dengan warna `FINISH_COLOR`), `WALL-<lantai>-<nnn>` (indeks ke `walls.json`, tinggi penuh 3.0 m, tebal 0.3 eksterior / 0.15 interior), `OPEN-<doorId>` (ambang 2 cm selebar bukaan), `LINTEL-<doorId>` (2.1 sampai 3.0 m), `STAIR-<fixtureId>` (tangga U 24 riser konsep, riser 0.167 m), `STAIRWELL-<fixtureId>` (pagar void lantai 2), `LIFT-<fixtureId>` (shaft konsep per lantai), `FASCIA-<lantai>` (pita fasad 3.0 sampai 3.7 m), `ROOF` (pelat atap, sisi atas +8.0 m, dengan parapet; ada di `building-L2.glb` sebagai node terpisah agar runtime bisa menyembunyikannya).
- Ujung dinding: `tools/kantor/geometry.py::wall_rect` memberi cap persegi t/2 di kedua ujung. Bila diterapkan apa adanya, cap itu masuk t/2 ke setiap bukaan pintu. Di Blender, ujung yang menyentuh bukaan tidak diberi cap sehingga celah pintu tepat selebar pintu (divalidasi dalam 1 cm untuk 46 pintu). Dinding eksterior sumbu X memiliki keempat sudut gedung (cap penuh t/2), dinding eksterior sumbu Y berhenti di muka dalam dinding X tersebut, dan ujung lain diberi cap t/2 dikurangi 2 mm. Tujuannya agar tidak ada muka koplanar yang bertumpuk (di Cycles itu menimbulkan garis gelap di sudut). Catatan untuk runtime: `app/src/world/build.ts` saat ini memakai panjang `to - from + t` sehingga bukaannya t/2 lebih sempit di tiap sisi.
- Jendela (world.json `windows`, revisi P03): dinding eksterior dipecah di sekitar tiap jendela menjadi pier setinggi penuh, bagian di bawah ambang (sill) dan bagian di atas kepala (head), sehingga bukaan benar-benar kosong (tanpa boolean; potongan kotak lebih mudah divalidasi dan tidak membuat segitiga tipis). Node kaca bernama persis ID jendela (`W-L1-001`, material `glass_clear` alpha 0.35 atau `glass_obscured` alpha 0.85, alpha blend), kusen sederhana `FRAME-<id>` (bingkai 5 cm, satu mullion bila lebar di atas 1.2 m, material `window_frame` warna `wallCap`). Kaca dan kusen mengisi bukaan persis sill..head dan selebar jendela di garis tengah dinding. Reveal, ambang atas dan soffit memakai `wall_interior`; tutup gelap `wall_top` hanya pada bagian setinggi penuh.
- Daun pintu: tiap pintu swing (`single`/`double` dengan `swing`) mendapat `LEAF-<doorId>-1` (dan `-2` untuk `hinge: both`, masing-masing setengah lebar; `-1` di kusen rendah, `-2` di kusen tinggi) dalam posisi tertutup, rata dengan muka dinding di sisi `into`, tebal 4 cm, dari 0.02 m sampai 2.09 m. Origin objek tepat di kusen engsel (koordinat sepanjang dinding = `center -/+ width/2` sesuai `hinge`), jadi node glTF punya `translation` (satu-satunya pengecualian dari aturan transform identitas). Extras: `kantor_door`, `kantor_leaf`, `kantor_hinge`, `kantor_into`, `kantor_leaf_width`, `kantor_open_deg` (rotasi terhadap Blender +Z = glTF +Y yang membuka daun 90 derajat ke sisi `into`; diuji di pytest). Pintu `opening`, `hatch` dan `sliding` (`D-L2-13`) tidak punya daun.
- Output: `blender/out/building.blend`, `app/public/assets/building/building-L1.glb`, `building-L2.glb`, render `assets/previews/building-exterior.png`, `building-L1-interior.png`, `building-L2-interior.png` (berlabel konsep; interior memuat furnitur dari `furniture.blend` pada posisi fixture).
- Validasi (`validate_building.py`): jumlah node jendela per lantai sama dengan dataset, pusat/lebar/sill/head/garis tiap kaca dalam 1 cm (dihitung langsung dari world.json, bukan dari spec), `FRAME-*` ada, tidak ada poligon/segitiga dinding di dalam prisma bukaan jendela (seluruh tebal dinding, toleransi 2 mm), jumlah daun dan posisi engsel sama dengan data swing (origin .blend dan translation GLB dalam 1 cm), daun tertutup mengisi bagiannya; set objek per lantai sama dengan spec; kotak tiap dinding (panjang, tebal, posisi, tinggi) dalam 1 cm; tiap bukaan ada, lebarnya dan celah bersih antar dinding dalam 1 cm, tidak ada dinding di bawah kepala pintu; slab 32 x 24 dan elevasi; posisi tangga/lift pada fixture; nama node dan batas GLB; pemetaan sumbu; round trip importer; jumlah segitiga per lantai.

## Furnitur (M3)

- `blender/furniture/build_furniture.py` membangun satu GLB per tipe katalog (`app/public/assets/furniture/<type>.glb`, 54 tipe) dan `blender/out/furniture.blend` (objek `FURN-<type>`, semua di origin). Frame: origin di tengah tapak di lantai, depan = lokal -Y Blender = +Z glTF, sama dengan `fixtureFront` world.json. Ukuran bbox = ukuran katalog dalam 2 cm (builder hanya memusatkan ulang, tidak menskala).
- Gaya: bentuk tebal bersudut lembut (rounded box dengan radius tetap, silinder ber-bevel, blob untuk tanaman/bantal), material matte. Satu palet bersama: nama material = kunci `ENV` di `palette.ts` (`wood`, `fabricGreen`, ...), ditambah `art_a/b/c` untuk komposisi poster/galeri (runtime bisa mewarnai ulang per `ARTWORK`). Kaca shower memakai alpha blend.
- Item dinding (`whiteboard` 0.9 m, `wall_display` 1.1 m, `poster` 1.2 m, `directory_sign` 1.0 m) tetap ber-bbox katalog dari z = 0; tinggi pasang ada di extras `kantor_mount_height_m` dan registry `mountHeightM`, sama dengan nilai `panel()` di `app/src/world/furniture.ts`.
- Budget: prop kecil (dimensi maksimum 1.0 m atau kurang) 2k segitiga, lainnya 5k. Contact sheet `assets/previews/furniture-sheet.png`.
- Validasi (`validate_furniture.py`, pada file yang dikirim): file memakai `KHR_mesh_quantization`, satu node mesh yang transformnya hanya dekuantisasi (scale seragam + translation), bbox = katalog dalam 2 cm, tapak terpusat dan di lantai, probe orientasi depan per tipe (`FRONT_RULES`; tipe simetris dideklarasikan di `SYMMETRIC`), budget segitiga, material hanya dari palet, extras, round trip importer.

## Karakter (M1)

Status M1: tujuh karakter original (Budi/CEO, Max, Hugo, Nova, Bruno, Kevin, Rex) dibangun sepenuhnya oleh script dari `design/characters.json`, di-rig pada satu skeleton bersama, diberi 13 klip animasi, disimpan sebagai `.blend` sumber dan GLB runtime, lalu dibuka ulang dan divalidasi. Ini art procedural stylized semi-anime (primitif halus: superellipsoid, loft, tube), bukan sculpt tangan final. Tidak ada aset, tekstur, atau karakter pihak ketiga; semua warna adalah faktor material.

### Tool yang dipakai

- Blender 4.0.2 (paket Ubuntu `/usr/bin/blender`, Python 3.12 bawaan Blender, numpy tersedia). Exporter/importer glTF bawaan 4.0.
- Render: Cycles CPU. EEVEE dan Workbench gagal headless di mesin ini (`libEGL.so.1` tidak ada). Build Blender ini tanpa OpenImageDenoise, jadi denoise dimatikan; sample 64 (sheet) dan dither 0 agar PNG kecil.
- Test tanpa bpy: Python 3.11 sistem + pytest (`requirements-dev.txt`).

### Perintah (jalankan dari root repo, urut)

```bash
# 1. build semua karakter (.blend + .glb); --only CH-CEO untuk satu karakter
blender -b --factory-startup -noaudio --python blender/characters/build_characters.py -- --variants

# 2. render character sheet, deform test dan grid varian avatar
blender -b --factory-startup -noaudio --python blender/characters/render_sheet.py

# 3. buka ulang .blend + import ulang .glb, tulis laporan dan registry
blender -b --factory-startup -noaudio --python blender/validate_assets.py

# 4. cek GLB dengan stdlib (tanpa Blender)
python3 -m pytest tests/py/test_assets.py -q
```

`--variants` diterima demi perintah yang stabil; varian rambut CEO selalu ikut di `ch-ceo.glb` (lihat bagian varian). `validate_assets.py -- --only ID` hanya mencetak hasil tanpa menulis laporan atau registry. `render_sheet.py -- --no-extras` melewati deform/varian; `--extras-only` hanya merender deform/varian.

Waktu nyata di mesin ini (4 vCPU, hardening): build tujuh karakter sekitar 20 detik, render (termasuk sheet ekspresi dan LOD) sekitar 3 menit, validasi sekitar 24 detik.

### Output

| Path | Isi |
|---|---|
| `design/characters.json` | sumber tunggal: proporsi, kulit, mata, gaya rambut, warna outfit, prop, klip, budget, varian avatar |
| `blender/out/<id>.blend` | sumber Blender (rig, mesh, action + NLA track per klip) |
| `blender/out/raw-glb/characters/<id>.glb` | export Blender (input optimasi, tidak dimuat runtime) |
| `app/public/assets/characters/<id>.glb` | aset runtime three.js, hasil `tools/glb_optimize.mjs` |
| `assets/previews/<id>-sheet.png` | sheet depan/samping/belakang, ortografis |
| `assets/previews/ch-ceo-deform.png` | walk (heel strike, passing), sit di kursi 0.45 m, type di meja 0.75 m |
| `assets/previews/ch-ceo-variants.png` | 3 rambut x 3 palet Avatar Studio (palet lewat cat ulang sel atlas) |
| `assets/previews/character-expressions.png` | 7 karakter x netral + 5 ekspresi (pose rest, close-up kepala) |
| `assets/previews/character-lod.png` | per karakter: LOD0, LOD1 (dengan jumlah segitiga) dan atlas palet |
| `design/asset-registry.json` | entri per karakter, nilai terukur ditulis oleh validator |
| `docs/evidence/HARDENING/blender-characters-validate.json` | laporan validasi lengkap per check (`.txt` ringkasan) |

`<id>` adalah ID aset huruf kecil, misalnya `ch-ceo`, `ch-netinstall`.

### Kontrak skema (satu sumber untuk Blender dan runtime)

- Satuan meter. Origin di tengah kaki pada lantai (Z=0). Karakter menghadap Blender -Y, yang oleh exporter menjadi +Z glTF/three.js (sesuai `design/world.json` `coordinates`: gltf = [x, z, -y]).
- Skeleton bersama 18 bone: `root, hips, spine, chest, neck, head, upper_arm_L/R, forearm_L/R, hand_L/R, thigh_L/R, shin_L/R, foot_L/R`. Suffix `_L` = sisi kiri karakter (+X). Underscore, bukan titik, karena three.js `PropertyBinding` membuang titik dari nama node.
- Node mesh: `body` (satu mesh, satu primitive, dengan shape key ekspresi), `lod1` (LOD1), `hair_<style>` (mesh terpisah per gaya rambut), `prop_<id>` untuk prop yang dipegang (`prop_tablet` Nova, `prop_clipboard` Rex, `prop_sketchbook` Kevin). Semua di-skin ke rig yang sama.
- Material: satu per GLB, `kantor_atlas` (Principled BSDF, metallic 0, roughness 0.85, `doubleSided` karena ada permukaan terbuka seperti apron dan hem rambut). Base color dari PNG palet 32 x 32 px yang tertanam di GLB, sampler NEAREST (min `NEAREST_MIPMAP_NEAREST`), wrap clamp. Tiap zona (nama material lama) punya satu sel 4 x 4 px: `skin, eyes, eye_iris, eye_highlight, mouth, blush, hair, outfit_main, outfit_inner, outfit_bottom, outfit_accent, shoes, shoe_sole, prop_main, prop_accent, prop_detail`; zona ke-i ada di sel `[i % 8, i // 8]` (baris 0 = baris teratas PNG). Semua UV satu face berada tepat di pusat sel zonanya. Alasan: 16 material per karakter berarti 16 sampai 19 primitive (draw call) per karakter; dengan satu material, body menjadi satu primitive. Warna asli per zona juga ada di extras material `kantor_zone_hex`.
- Atlas contract di extras scene glTF dan extras node `rig`: `kantor_atlas = {"size": 32, "cell": 4, "zones": {"skin": [0, 0], ..., "prop_detail": [7, 1]}}`.
- Ekspresi: shape key pada `body` bernama `blink`, `smile`, `talk` (mulut terbuka untuk bicara), `surprised`, `frown`, diekspor sebagai morph target glTF (sparse, tanpa buffer basis nol; nama di mesh extras `targetNames`). Delta hanya pada vertex fitur wajah (mata, bulu mata, alis, mulut, oval mulut) yang 100 persen ber-bobot `head`; tiap ekspresi membangun ulang fitur wajah dengan topologi yang sama sehingga selisihnya bersih. Oval mulut untuk `talk`/`surprised` tersembunyi di bawah kulit saat netral (72 segitiga).
- LOD1: node `lod1`, satu mesh ter-skin ke rig yang sama (body + rambut default + prop yang dipegang, tanpa oval mulut dan tanpa morph), hasil Decimate collapse ke paling banyak 4800 segitiga (budget PRD NPC LOD1 5000, diterapkan juga pada CEO). Zona per face dibaca ulang dari atribut face `kantor_zone` setelah decimate lalu UV dipaskan lagi ke pusat sel. `hide_render` di .blend.
- Extras node `rig` (glTF `extras`): `kantor_id`, `kantor_default_hair`, `kantor_hair_nodes`, `kantor_height_m`, `kantor_seat_height_m`, `kantor_walk_native_speed_mps`, `kantor_run_native_speed_mps`, `kantor_atlas`, `kantor_lod0_tris`, `kantor_lod1_tris`, `kantor_lod1_node`, `kantor_expressions` (lima nama terakhir juga di extras scene).
- Klip (nama persis, satu glTF animation per klip): `idle` 2.0 s loop, `walk` 1.0 s loop, `run` 0.6 s loop, `wave` 1.6 s, `talk` 2.4 s loop, `sit` 2.0 s loop, `type` 1.0 s loop, `read` 2.4 s loop, `coffee` 3.0 s loop, `stretch` 3.0 s, `exercise` 0.8 s loop, `billiards` 2.4 s loop, `game` 1.6 s loop. Klip loop punya frame awal = frame akhir. Di .blend tiap klip adalah Action dengan fake user dan NLA track (mute) bernama sama; exporter memakai `export_animation_mode='ACTIONS'` (diverifikasi: 13 animasi terpisah di GLB).

### Catatan untuk runtime

- Rambut: tampilkan tepat satu node `hair_*` (default di extras `kantor_default_hair`), sembunyikan sisanya.
- LOD: three.js menampilkan semua node secara default. Runtime harus menyembunyikan `lod1` saat menampilkan LOD0, dan menyembunyikan `body`, semua `hair_*` dan `prop_*` saat memakai `lod1` (mis. NPC jauh). Tanpa itu kedua LOD tampil bertumpuk.
- Palet avatar: material tidak lagi per zona. Clone tekstur `kantor_atlas`, cat ulang sel `outfit_main`, `outfit_inner`, `outfit_bottom`, `outfit_accent` (posisi dari extras `kantor_atlas.zones`) dengan warna `avatarVariants.CH-CEO.palettes`, lalu pasang di clone material. `ch-ceo-variants.png` dirender dengan cara yang sama. Kode `applyVariant` di `app/src/game/avatar.ts` saat ini masih mengganti warna per nama material dan perlu diperbarui (di luar cakupan perubahan Blender ini).
- Ekspresi: `mesh.morphTargetDictionary` berisi lima nama di atas; set `morphTargetInfluences` (0..1) pada `body`. Morph bekerja bersama klip skeletal (divalidasi: `talk` di atas klip `talk`).
- Prop yang dipegang terlihat default; sembunyikan `prop_*` saat `type`, `game`, `coffee`, `billiards` agar tangan tidak memegang dua benda.
- Klip berjalan di tempat (in place). Kaki tumpu bergerak pada kecepatan native (`kantor_walk_native_speed_mps`, sekitar 0.80 sampai 0.87 m/s; run sekitar 2.27 sampai 2.50 m/s). Gerakkan root pada `native * timeScale`. Untuk 1.4 m/s, `timeScale` sekitar 1.7 (langkah cepat ala chibi).
- Duduk: root di lantai pada titik slot kursi; panggul turun ke permukaan duduk 0.45 m (terukur 0.442 m). Paha horizontal ke arah depan (-Y Blender), lutut sekitar 0.28 m di depan root.

### Varian avatar CEO

Pendekatan: satu GLB (`ch-ceo.glb`) berisi `hair_short_tuft`, `hair_swept`, `hair_spiky_soft`; tiga palet `forest`, `terracotta`, `oat` diterapkan runtime lewat nama material. Dipilih karena lebih kecil (satu file untuk 9 kombinasi, bukan 9 GLB; terukur R2: export 1,205,812 byte, dikirim 620,616 byte), satu rig dan satu set klip, dan Avatar Studio tidak perlu memuat ulang aset saat pratinjau. Hanya kombinasi yang benar-benar dibangun yang dicantumkan di `characters.json`.

### Idempotensi

Tidak ada random tanpa seed: jitter rambut dan noda cat memakai `random.Random("kantor-rpg:<id>[:<style>]")`. Scene dimulai dari `read_factory_settings(use_empty=True)` per karakter. Diverifikasi: dua build berturut-turut menghasilkan GLB identik byte per byte (sha256 sama untuk tujuh file). File `.blend` dikompresi dan memuat metadata Blender sehingga tidak dijanjikan identik byte, tetapi isinya dibangun dari input yang sama. PNG ditulis oleh encoder deterministik di `render_sheet.py` (zlib level 9); hasil Cycles CPU dengan seed default diharapkan stabil di mesin yang sama tetapi tidak dijanjikan identik antar CPU.

### Yang divalidasi (`blender/validate_assets.py`)

Per karakter, dari `.blend` yang dibuka ulang (tambahan hardening: satu material `kantor_atlas` di file dan di tiap mesh, gambar atlas ter-pack 32 px dengan interpolasi Closest, warna tiap sel sama dengan characters.json, semua UV di pusat sel, zona di extras mencakup semua zona terpakai, lima shape key dengan delta minimal 2 mm hanya pada vertex ber-bobot `head`, `lod1` ter-skin, paling banyak 5000 segitiga, tanpa shape key, bbox `lod1` mengikuti LOD0 dalam 3 cm pada tiap klip, `talk` di atas klip `talk` hanya menggerakkan kepala):
- armature ada, set bone sama dengan `rig.bones`; node rambut sesuai spec/varian; extras default rambut;
- semua mesh punya modifier Armature ke `rig`, tidak ada vertex tanpa bobot, vertex group hanya nama bone;
- nama action persis 13 klip, durasi tiap klip sesuai spec (toleransi 1 frame), NLA track per klip;
- segitiga LOD0 terlihat (body + rambut default + prop) di bawah budget (NPC 15k, pemain 25k), dan untuk CEO total semua varian juga di bawah 25k;
- tinggi bounding box pose rest dalam 5 persen `heightM`, kaki pada Z 0 (toleransi 4 mm), mata (zona `eye_iris`) di sisi -Y (arah hadap);
- tiap klip: mesh tidak menembus lantai lebih dari 6 mm, ada kaki yang menyentuh lantai (klip berdiri), panggul pada kursi 0.45 m dalam 3 cm (sit/type/game);
- walk/run: kecepatan kaki tumpu terukur dibanding kecepatan native root, slip di bawah 5 persen (terukur kurang dari 0.1 persen).

Dari GLB yang dikirim (posisi dibaca lewat bind matrix skin sehingga bernilai meter): `KHR_mesh_quantization` wajib, header/chunk GLB, nama animasi, joint skin = skeleton bersama, node rambut, tepat satu material dan satu PNG (didekode, warna sel dibandingkan), sampler NEAREST, satu primitive per node, primitive LOD0 terlihat = body + satu rambut (+ prop), `targetNames` dan delta morph sparse hanya pada vertex dengan JOINTS/WEIGHTS 100 persen `head`, `lod1`, extras scene dan rig, ukuran di bawah 1.5 MB, durasi klip dari accessor; lalu import ulang ke scene kosong dan ukur ulang tinggi, kaki, arah hadap (zona `eye_iris` dari UV), shape key, `lod1` dan jumlah action. Preview harus PNG valid di bawah 400 KB.

### Batasan yang diketahui

- Kecepatan jalan native sekitar 0.8 m/s, bukan 1.4 m/s pada siklus 1.0 s. Kaki semi-anime (pinggul sekitar 0.6 m) tidak bisa melangkah 1.4 m per siklus tanpa slip. Runtime harus menaikkan `timeScale` atau memakai kecepatan lebih lambat.
- Di kursi 0.45 m kaki menggantung (sekitar 0.17 sampai 0.22 m di atas lantai). Disengaja sebagai stilisasi; kursi rendah atau pijakan kaki bisa ditambahkan nanti.
- LOD1 hasil decimate otomatis: highlight mata hilang dan mata menjadi bentuk gelap sederhana (lihat `character-lod.png`); cukup untuk jarak jauh, bukan untuk close-up. LOD1 hanya membawa rambut default (CEO dengan rambut lain tetap terlihat `short_tuft` di LOD1).
- Prop yang dipegang (`prop_tablet` Nova, `prop_clipboard` Rex, `prop_sketchbook` Kevin) tetap node terpisah agar bisa disembunyikan, sehingga tiga karakter itu punya 3 primitive LOD0, bukan 2.
- Skinning rigid per bagian dengan blending di siku, lutut, leher dan torso; bola sendi bahu 0.7/0.3. Pada pose ekstrem ada interseksi kecil (ujung blazer/apron dengan paha saat sit/run, lengan dengan torso). Tidak ada pemeriksaan otomatis tangan menembus meja.
- Tangan berbentuk mitten; tidak ada pose jari. Cangkir, buku, controller dan stik biliar tidak dimodelkan (klip coffee/read/game/billiards adalah gestur). Klip `talk` tetap gestur skeletal; gerak mulut adalah morph `talk` yang diatur runtime. Pada beberapa karakter poni atau mikrofon headset menutupi sebagian alis/mulut sehingga ekspresi alis kurang terlihat.
- Transisi antar klip tidak di-author; runtime perlu crossfade.
- Sheet dirender dengan outline Freestyle; tampilan three.js tanpa outline akan lebih lembut kecuali runtime menambah outline.
- Export Blender karakter 0.94 sampai 1.21 MB (UV per vertex, vertex terpisah di batas zona, node `lod1`, morph sparse sekitar 54 KB). Setelah optimasi R2 file yang dikirim 469,056 sampai 620,616 byte, total tujuh karakter 3,551,104 byte: masih di atas target R2 3.0 MB. Sisa terbesar per karakter adalah indeks segitiga (CEO 157,608 byte) dan data per vertex yang sudah di batas bawah kuantisasi (24 byte per vertex karena padding 4 byte glTF); menurunkan lagi butuh pengurangan geometri (keputusan art) atau kompresi meshopt/Draco (ditolak karena CSP).

## Batasan M3 yang diketahui

- Gedung: jendela dan daun pintu mengikuti world.json P03 (konsep, bukan detail kusen produksi). Daun disimpan tertutup; pintu `sliding` dan `hatch` tanpa daun. GLB gedung tidak dipakai runtime saat ini (runtime membangun dinding sendiri dari world.json), jadi node jendela/daun belum menambah draw call di runtime.
- Gedung: dinding tinggi penuh 3.0 m; cutaway tetap tugas runtime. Pelat 32 x 24 m tepat pada envelope, sehingga separuh tebal dinding eksterior (0.15 m) menggantung di luar tepi pelat; runtime memakai pelat 32.3 x 24.3 m.
- Gedung: tangga U dan lift adalah geometri konsep (24 riser, landing 1.2 m), bukan desain tangga yang dihitung terhadap regulasi. Tangga darurat luar (`VL-ESC-E`) tidak dimodelkan.
- Furnitur: `desk` dan `desk_exec` tidak memuat monitor karena tinggi katalog 0.75 m tidak memberi ruang (laptop tertutup dan alas meja saja); bila monitor dibutuhkan, katalog atau aset terpisah perlu diputuskan.
- Furnitur: item di atas permukaan (laptop, bola biliar, bidak, talenan) boleh melewati tinggi katalog sampai 2 cm (toleransi validator).
- Kursi kerja dan kursi tamu dibuat dengan dudukan 0.45 m agar cocok dengan klip `sit`/`type` karakter; `stool` (0.7 m) dan `beanbag` tidak cocok dengan klip duduk 0.45 m.
- Furnitur dan gedung: hanya LOD0, tanpa tekstur atau atlas; satu material per warna palet (atlas palet saat ini hanya untuk karakter).
