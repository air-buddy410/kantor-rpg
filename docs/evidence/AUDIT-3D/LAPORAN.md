# Audit 3D Kantor RPG: bobot dan kedip (branch max/audit-3d)

Video HP Budi (e480894) menunjukkan kedip di beberapa tempat: tangga GLB (dinding pembatas, kaca biru, rel), kusen/daun pintu koridor, partisi merah ruang server, dan bayangan meja. Audit ini mencakup **semua** poligon dunia: GLB furniture dan building, serta geometri prosedural (dinding, pelat, ambang, kaca, daun pintu).

## Alat yang dipakai (semuanya di repo)
- `tools/glb_audit.mjs`: ukuran, gzip, segitiga, primitive, material, dan tekstur per GLB. Hasilnya `glb-audit-{before,after}.json`.
- `app/tests/unit/coplanar-scan.ts` + `coplanar.test.ts` (gate vitest). Isinya:
  - Membangun dunia L1/L2 yang sebenarnya, dalam mode prosedural dan GLB, dengan pintu tertutup maupun terbuka (instance daun pintu ikut dihitung).
  - Mencari pasangan face sebidang yang beririsan antar mesh/material, termasuk face dua sisi yang berhadapan.
  - Juga memindai setiap GLB furniture/building secara terpisah. Hasilnya `after/coplanar-*.json`.
- `tools/flicker_probe.mjs`: Chromium + SwiftShader dengan driver rAF/`performance.now` manual. Rute ditempuh per 1/60 s. Kedip diukur dari 8 micro-frame (1/4000 s): gerak di sana sub-piksel, jadi perubahan A→B→A berarti z-fight, sortir, atau toggle, bukan gerak kamera.
  - Profil: desktop 1280x720 (high dan low), serta HP portrait 464x848 dpr 3 (auto, yang di SwiftShader jatuh ke low).
  - 11 skenario, termasuk tangga, koridor, pintu NCORR, dan ruang server.

## Temuan dan perbaikan
| Kategori | Temuan | Perbaikan |
|---|---|---|
| Koplanar GLB (sumber utama) | Hampir semua kit Blender menaruh beberapa material di bidang yang sama, misalnya `stair_u` (dinding pembatas vs anak tangga, 7,8 m²), rack, meja resepsionis, media console, cue rack, shower, dan treadmill. Total 54 GLB, 38 di antaranya punya pasangan. | `furniture-kit.ts separateCoplanar`: part terbesar dibiarkan tetap. Tiap part berikutnya mengambil offset shell mitered terkecil (0 / 1,5 / 3 … mm) yang bebas bentrok dari semua part yang sudah ditaruh. Tidak ada retak di tepi. |
| Koplanar prosedural | Panel belakang rak vs sisi, strip poster, top arcade, dan seam lift. | Inset/sempitkan 2–6 mm di `furniture.ts`. |
| Pelat lantai vs matras/ambang | Pelat naik sampai +24 mm, menyamai matras gym (20 mm) dan ambang. | Pelat +4..+18 mm (step 2 mm). Puncak ambang +34 mm. |
| Daun pintu vs dinding terpotong | Daun pintu tidak ikut cutaway, sehingga tetap utuh di dalam dinding yang sudah dipotong (tampak "berganti bentuk"). | Daun pintu kini memakai material occluder. Shader menangani `instanceMatrix`. |
| Kaca transparan | Material kaca biasa menulis depth, sehingga urutan sortir kaca shower vs jendela bisa flip. | `depthWrite:false` untuk semua kaca. |
| Shadow shimmer | Matahari mengikuti CEO secara sub-texel, sehingga tepi bayangan dinding tipis, pintu, dan meja di-rasterisasi ulang setiap frame. | Posisi matahari di-snap ke texel shadow map (`followSun`). `normalBias` 0,03 tetap dipakai. |
| LOD/emissive | Histeresis LOD dari ad07752 masih berlaku. Emissive statis, tidak ada animasi intensitas. | Tidak ada perubahan. |
| GLB building | `building-L*.glb` tidak dimuat runtime (geometri dibangun prosedural). | Hanya dicatat. |

Hasil scan koplanar (face terlihat, gap < 2 mm, beda warna):
- Sebelum: L1-glb 53, L2-glb 27, L1-proc 40, L2-proc 28 pasangan.
- Sesudah: **0 di semua 8 kombinasi** (lantai × mode × pintu). Gate tetap lolos pada gap 1 mm dan 2 mm.

## Probe kedip (piksel "hot" = berosilasi ≥2 kali; detail di `flicker-summary.json`)
| Profil | Hot sebelum | Hot sesudah | Rata-rata osilasi |
|---|---|---|---|
| desktop high | 2481 | 44 | 0,0058 % → 0,0001 % |
| desktop low | 2962 | 42 | 0,0066 % → 0,0001 % |
| HP 464x848 dpr3 | 7465 | 2603 | 0,0118 % → 0,0054 % |

- Per skenario di desktop high: tangga rotate 685 → 2, koridor rotate 1079 → 11, pintu NCORR 76 → 7, server 73 → 1.
- Heatmap sebelum/sesudah ada di `*/<profil>/*-heat.jpg`.
- Sisa di HP: titik tersebar di tepi silhouette, yaitu aliasing render low tanpa AA pada 1392x2544 px fisik. Tidak ada lagi pita z-fight pada permukaan datar (dicek visual pada heatmap).

## Bobot
- Total GLB runtime 5,92 MB (gzip 2,10 MB), characters 4,54 MB. Budget ADR-015 4,6/6,0 MB terpenuhi.
- Tidak ada aset yang diubah: hasil glb_audit before = after.
- Yang dicoba lalu ditolak:
  - weld: 5,887 → 5,961 MB, gzip juga naik.
  - Tekstur karakter sudah 32x32 dan signage 360x504 JPG (8–11 KB), jadi tidak ada yang berlebihan untuk di-resize.
  - Meshopt/Draco sengaja tidak dipakai (CSP tanpa wasm-unsafe-eval, lihat `glb_optimize.mjs`). Quantize, dedup, dan prune sudah dijalankan di pipeline lama.
- Segitiga dunia (scan): L1 GLB 122.822 → 123.098, L2 100.068 → 100.248. Kenaikan +0,2 % berasal dari instance daun pintu yang kini ikut dihitung. Draw call tidak berubah: tetap 1 mesh per warna per lantai, dan daun pintu tetap ≤2 per lantai.

## Sisa risiko (butuh GPU/HP fisik)
- Depth buffer 16-bit di sebagian GPU mobile: resolusi sekitar 12 mm pada jarak 20 m. Offset 1,5–2 mm bisa kalah pada zoom terjauh. Mitigasi berikutnya bila masih terlihat: `logarithmicDepthBuffer` hanya di HP (ada biaya fill-rate), atau naikkan step offset.
- SwiftShader bukan GPU HP: presisi depth/rasterisasi dan PCF shadow bisa berbeda. FPS tidak diukur karena di SwiftShader tidak representatif.
- Face koplanar di dalam satu material, misalnya muka bawah, tidak terlihat karena pitch kamera dan memang tidak dihitung.
