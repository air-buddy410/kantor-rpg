# Kapasitas dan sizing (dihitung)

Sumber: `design/world.json` revisi P03; script `tools/capacity.py`. Status: asumsi/target dihitung dari dataset, bukan observed usage.

## Luas per lantai

| Lantai | Gross m2 | Ruang | Sirkulasi | Kursi fixture | Workstation | Beban hunian pembanding | Walkable navgrid m2 | Exit |
|---|---|---|---|---|---|---|---|---|
| L1 | 768.0 | 20 | 23.4% | 41 | 13 | 110 | 483.2 | 4 |
| L2 | 768.0 | 18 | 23.4% | 42 | 0 | 302 | 498.2 | 1 |

Total gross: 1536.0 m2 (proposal AS-DIM-01).

Beban hunian pembanding memakai faktor IBC 2021 Table 1004.5 (AS-OCC-01); bukan regulasi Indonesia dan bukan target okupansi.

## Per ruang

| ID | Nama | Kategori | Luas m2 | Kursi | Workstation | Beban pembanding |
|---|---|---|---|---|---|---|
| L1-MEET | Ruang rapat besar | work | 64.0 | 10 | 0 | 47 |
| L1-LOBBY | Lobby & resepsi | public | 96.0 | 5 | 0 | 7 |
| L1-GALLERY | Galeri portofolio | public | 48.0 | 2 | 0 | 4 |
| L1-PANTRY | Pantry kerja | wet | 28.0 | 2 | 0 | 3 |
| L1-SHAFT-W | Shaft basah | shaft | 2.5 | 0 | 0 | 0 |
| L1-WC | Toilet aksesibel | wet | 17.5 | 0 | 0 | 0 |
| L1-CORR | Koridor utama L1 | circulation | 80.0 | 0 | 0 | 0 |
| L1-DISC | Ruang diskusi | quiet | 36.0 | 4 | 0 | 26 |
| L1-IMPL | Ruang implementasi & review | work | 48.0 | 6 | 6 | 4 |
| L1-CORE | Inti tangga & lift L1 | circulation | 36.0 | 0 | 0 | 0 |
| L1-NOVA | Area Nova (spesifikasi ICT) | work | 36.0 | 2 | 2 | 3 |
| L1-LAB | Lab ICT | work | 36.0 | 1 | 0 | 3 |
| L1-NCORR | Koridor utara L1 | circulation | 64.0 | 0 | 0 | 0 |
| L1-CEO | Ruang CEO | quiet | 38.5 | 5 | 1 | 3 |
| L1-HUGO | Studio Hugo | work | 38.5 | 2 | 2 | 3 |
| L1-KEVIN | Studio Kevin | work | 33.0 | 1 | 1 | 3 |
| L1-BRUNO | Area Bruno | work | 27.5 | 1 | 1 | 2 |
| L1-SERVER | Ruang server | restricted | 22.0 | 0 | 0 | 1 |
| L1-RISER | Riser ICT | shaft | 1.5 | 0 | 0 | 0 |
| L1-STORE | Gudang & utilitas | service | 15.0 | 0 | 0 | 1 |
| L2-READ | Perpustakaan / reading nook | quiet | 64.0 | 4 | 0 | 14 |
| L2-LOUNGE | Lounge & coffee bar | recreation | 96.0 | 9 | 0 | 70 |
| L2-DINE | Ruang makan & pantry | recreation | 48.0 | 8 | 0 | 35 |
| L2-SHOWER | Shower & ruang ganti | wet | 28.0 | 2 | 0 | 0 |
| L2-SHAFT-W | Shaft basah L2 | shaft | 2.5 | 0 | 0 | 0 |
| L2-WC | Toilet L2 | wet | 17.5 | 0 | 0 | 0 |
| L2-CORR | Koridor utama L2 | circulation | 80.0 | 0 | 0 | 0 |
| L2-CHAT | Diskusi santai | quiet | 36.0 | 4 | 0 | 26 |
| L2-GARDEN | Taman dalam | recreation | 48.0 | 2 | 0 | 35 |
| L2-CORE | Inti tangga & lift L2 | circulation | 36.0 | 0 | 0 | 0 |
| L2-GAME | Ruang game | recreation | 72.0 | 8 | 0 | 52 |
| L2-NCORR | Koridor utara L2 | circulation | 64.0 | 0 | 0 | 0 |
| L2-BALCONY | Balkon taman | outdoor | 38.5 | 2 | 0 | 28 |
| L2-BILLIARD | Ruang biliar | recreation | 38.5 | 0 | 0 | 28 |
| L2-GYM | Ruang olahraga | recreation | 49.5 | 3 | 0 | 11 |
| L2-STORE | Gudang L2 | service | 33.0 | 0 | 0 | 2 |
| L2-RISER | Riser ICT L2 | shaft | 1.5 | 0 | 0 | 0 |
| L2-SERVICE | Area servis L2 | service | 15.0 | 0 | 0 | 1 |

## Kompleksitas eksplorasi vs baseline pixel

- Baseline: 3388 sel tile, 47 area, 297 furniture.
- Dunia ini: 34 ruang (tanpa shaft), 199 fixture, 117 slot aktivitas, walkable 981.4 m2.
- Rasio ruang/area 0.72, fixture/furniture 0.67. Tile tidak dikonversi ke meter; perbandingan hanya untuk kompleksitas eksplorasi (D-02).

## Egress snapshot private (perencanaan, M4 disabled)

Rumus: `actors * bytes_per_actor * viewers / interval_s`.

- 40 viewer: 98304 B/s, 0.354 GB/jam, 254.8 GB/30 hari jika terus-menerus.
- 200 viewer: 491520 B/s, 1.769 GB/jam, 1274.0 GB/30 hari jika terus-menerus.
- Server membaca sumber bersama 720 kali/jam, bukan per viewer.

## Transfer awal

- 25 MB pada 10 Mbps: 20.0 s; 60 MB: 48.0 s.
- Target cold start 8 s pada 10 Mbps mengizinkan maksimal 10.0 MB awal (tanpa latency).
- Temuan: 25 MB pada 10 Mbps butuh 20 s > target 8 s; first playable harus <= 10 MB, sisanya lazy load.

## Anggaran triangle

- Karakter LOD0: 1 pemain x 25k + 6 NPC x 15k = 115000.
- Sisa untuk lingkungan pada scene mobile 250k: 135000.

## Pemeliharaan (proposal)

- dependency_security_review: 2 jam/bulan
- asset_perf_regression: 2 jam/bulan
- layout_ict_consistency: 1 jam/bulan
- backup_restore_design_source: 1 jam/bulan
- Total: 6 jam/bulan (proposal, bukan jam teramati).
