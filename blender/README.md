# Blender: karakter procedural kantor-rpg

Status M1: tujuh karakter original (Budi/CEO, Max, Hugo, Nova, Bruno, Kevin, Rex) dibangun sepenuhnya oleh script dari `design/characters.json`, di-rig pada satu skeleton bersama, diberi 13 klip animasi, disimpan sebagai `.blend` sumber dan GLB runtime, lalu dibuka ulang dan divalidasi. Ini art procedural stylized semi-anime (primitif halus: superellipsoid, loft, tube), bukan sculpt tangan final. Tidak ada aset, tekstur, atau karakter pihak ketiga; semua warna adalah faktor material.

## Tool yang dipakai

- Blender 4.0.2 (paket Ubuntu `/usr/bin/blender`, Python 3.12 bawaan Blender, numpy tersedia). Exporter/importer glTF bawaan 4.0.
- Render: Cycles CPU. EEVEE dan Workbench gagal headless di mesin ini (`libEGL.so.1` tidak ada). Build Blender ini tanpa OpenImageDenoise, jadi denoise dimatikan; sample 64 (sheet) dan dither 0 agar PNG kecil.
- Test tanpa bpy: Python 3.11 sistem + pytest (`requirements-dev.txt`).

## Perintah (jalankan dari root repo, urut)

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

Waktu nyata di mesin ini (4 vCPU): build tujuh karakter sekitar 23 detik, render sekitar 2 sampai 2.5 menit, validasi sekitar 32 detik.

## Output

| Path | Isi |
|---|---|
| `design/characters.json` | sumber tunggal: proporsi, kulit, mata, gaya rambut, warna outfit, prop, klip, budget, varian avatar |
| `blender/out/<id>.blend` | sumber Blender (rig, mesh, action + NLA track per klip) |
| `app/public/assets/characters/<id>.glb` | aset runtime three.js |
| `assets/previews/<id>-sheet.png` | sheet depan/samping/belakang, ortografis |
| `assets/previews/ch-ceo-deform.png` | walk (heel strike, passing), sit di kursi 0.45 m, type di meja 0.75 m |
| `assets/previews/ch-ceo-variants.png` | 3 rambut x 3 palet Avatar Studio |
| `design/asset-registry.json` | entri per karakter, nilai terukur ditulis oleh validator |
| `docs/evidence/M1/blender-validate.json` | laporan validasi lengkap per check |

`<id>` adalah ID aset huruf kecil, misalnya `ch-ceo`, `ch-netinstall`.

## Kontrak skema (satu sumber untuk Blender dan runtime)

- Satuan meter. Origin di tengah kaki pada lantai (Z=0). Karakter menghadap Blender -Y, yang oleh exporter menjadi +Z glTF/three.js (sesuai `design/world.json` `coordinates`: gltf = [x, z, -y]).
- Skeleton bersama 18 bone: `root, hips, spine, chest, neck, head, upper_arm_L/R, forearm_L/R, hand_L/R, thigh_L/R, shin_L/R, foot_L/R`. Suffix `_L` = sisi kiri karakter (+X). Underscore, bukan titik, karena three.js `PropertyBinding` membuang titik dari nama node.
- Node mesh: `body` (satu mesh, multi-material), `hair_<style>` (mesh terpisah per gaya rambut), `prop_<id>` untuk prop yang dipegang (`prop_tablet` Nova, `prop_clipboard` Rex, `prop_sketchbook` Kevin). Semua di-skin ke rig yang sama.
- Material (nama identik di semua GLB, Principled BSDF, metallic 0, roughness 0.8; mata 0.45): `skin, eyes, eye_iris, eye_highlight, mouth, blush, hair, outfit_main, outfit_inner, outfit_bottom, outfit_accent, shoes, shoe_sole, prop_main, prop_accent, prop_detail`.
- Extras node `rig` (glTF `extras`): `kantor_id`, `kantor_default_hair`, `kantor_hair_nodes`, `kantor_height_m`, `kantor_seat_height_m`, `kantor_walk_native_speed_mps`, `kantor_run_native_speed_mps`.
- Klip (nama persis, satu glTF animation per klip): `idle` 2.0 s loop, `walk` 1.0 s loop, `run` 0.6 s loop, `wave` 1.6 s, `talk` 2.4 s loop, `sit` 2.0 s loop, `type` 1.0 s loop, `read` 2.4 s loop, `coffee` 3.0 s loop, `stretch` 3.0 s, `exercise` 0.8 s loop, `billiards` 2.4 s loop, `game` 1.6 s loop. Klip loop punya frame awal = frame akhir. Di .blend tiap klip adalah Action dengan fake user dan NLA track (mute) bernama sama; exporter memakai `export_animation_mode='ACTIONS'` (diverifikasi: 13 animasi terpisah di GLB).

### Catatan untuk runtime

- Rambut: tampilkan tepat satu node `hair_*` (default di extras `kantor_default_hair`), sembunyikan sisanya.
- Palet avatar: set warna material `outfit_main`, `outfit_inner`, `outfit_bottom`, `outfit_accent` dari `avatarVariants.CH-CEO.palettes`.
- Prop yang dipegang terlihat default; sembunyikan `prop_*` saat `type`, `game`, `coffee`, `billiards` agar tangan tidak memegang dua benda.
- Klip berjalan di tempat (in place). Kaki tumpu bergerak pada kecepatan native (`kantor_walk_native_speed_mps`, sekitar 0.80 sampai 0.87 m/s; run sekitar 2.27 sampai 2.50 m/s). Gerakkan root pada `native * timeScale`. Untuk 1.4 m/s, `timeScale` sekitar 1.7 (langkah cepat ala chibi).
- Duduk: root di lantai pada titik slot kursi; panggul turun ke permukaan duduk 0.45 m (terukur 0.442 m). Paha horizontal ke arah depan (-Y Blender), lutut sekitar 0.28 m di depan root.

## Varian avatar CEO

Pendekatan: satu GLB (`ch-ceo.glb`) berisi `hair_short_tuft`, `hair_swept`, `hair_spiky_soft`; tiga palet `forest`, `terracotta`, `oat` diterapkan runtime lewat nama material. Dipilih karena lebih kecil (sekitar 0.9 MB untuk 9 kombinasi, bukan 9 GLB), satu rig dan satu set klip, dan Avatar Studio tidak perlu memuat ulang aset saat pratinjau. Hanya kombinasi yang benar-benar dibangun yang dicantumkan di `characters.json`.

## Idempotensi

Tidak ada random tanpa seed: jitter rambut dan noda cat memakai `random.Random("kantor-rpg:<id>[:<style>]")`. Scene dimulai dari `read_factory_settings(use_empty=True)` per karakter. Diverifikasi: dua build berturut-turut menghasilkan GLB identik byte per byte (sha256 sama untuk tujuh file). File `.blend` dikompresi dan memuat metadata Blender sehingga tidak dijanjikan identik byte, tetapi isinya dibangun dari input yang sama. PNG ditulis oleh encoder deterministik di `render_sheet.py` (zlib level 9); hasil Cycles CPU dengan seed default diharapkan stabil di mesin yang sama tetapi tidak dijanjikan identik antar CPU.

## Yang divalidasi (`blender/validate_assets.py`)

Per karakter, dari `.blend` yang dibuka ulang:
- armature ada, set bone sama dengan `rig.bones`; node rambut sesuai spec/varian; extras default rambut;
- semua mesh punya modifier Armature ke `rig`, tidak ada vertex tanpa bobot, vertex group hanya nama bone;
- nama action persis 13 klip, durasi tiap klip sesuai spec (toleransi 1 frame), NLA track per klip;
- segitiga LOD0 terlihat (body + rambut default + prop) di bawah budget (NPC 15k, pemain 25k), dan untuk CEO total semua varian juga di bawah 25k;
- tinggi bounding box pose rest dalam 5 persen `heightM`, kaki pada Z 0 (toleransi 4 mm), mata di sisi -Y (arah hadap), material wajib ada;
- tiap klip: mesh tidak menembus lantai lebih dari 6 mm, ada kaki yang menyentuh lantai (klip berdiri), panggul pada kursi 0.45 m dalam 3 cm (sit/type/game);
- walk/run: kecepatan kaki tumpu terukur dibanding kecepatan native root, slip di bawah 5 persen (terukur kurang dari 0.1 persen).

Dari GLB: header/chunk GLB, nama animasi, joint skin = skeleton bersama, node rambut, material wajib, ukuran di bawah 1.5 MB, durasi klip dari accessor; lalu import ulang ke scene kosong dan ukur ulang tinggi, kaki, arah hadap, jumlah action. Preview harus PNG valid di bawah 400 KB.

## Batasan yang diketahui

- Kecepatan jalan native sekitar 0.8 m/s, bukan 1.4 m/s pada siklus 1.0 s. Kaki semi-anime (pinggul sekitar 0.6 m) tidak bisa melangkah 1.4 m per siklus tanpa slip. Runtime harus menaikkan `timeScale` atau memakai kecepatan lebih lambat.
- Di kursi 0.45 m kaki menggantung (sekitar 0.17 sampai 0.22 m di atas lantai). Disengaja sebagai stilisasi; kursi rendah atau pijakan kaki bisa ditambahkan nanti.
- Hanya LOD0. PRD meminta NPC LOD1 di bawah 5k segitiga; belum dibuat.
- Skinning rigid per bagian dengan blending di siku, lutut, leher dan torso; bola sendi bahu 0.7/0.3. Pada pose ekstrem ada interseksi kecil (ujung blazer/apron dengan paha saat sit/run, lengan dengan torso). Tidak ada pemeriksaan otomatis tangan menembus meja.
- Tangan berbentuk mitten; tidak ada pose jari. Cangkir, buku, controller dan stik biliar tidak dimodelkan (klip coffee/read/game/billiards adalah gestur). Tidak ada ekspresi wajah atau shape key; `talk` memakai anggukan kepala dan gestur tangan.
- Transisi antar klip tidak di-author; runtime perlu crossfade.
- Sheet dirender dengan outline Freestyle; tampilan three.js tanpa outline akan lebih lembut kecuali runtime menambah outline.
- Belum ada sheet ekspresi dan atlas material dari daftar character sheet PRD (warna masih faktor material per nama, tanpa tekstur).
