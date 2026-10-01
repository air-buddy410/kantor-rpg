# Room schedule dan adjacency

Turunan `design/world.json` revisi P03 oleh `tools/room_schedule.py`. Status: proposal konsep, bukan program ruang yang disahkan.
Luas diukur pada garis as dinding (AS-DIM-02). Kursi = slot duduk dari fixture (AS-OCC-02).

## Lantai 1 (kerja & kunjungan)

| ID | Nama | Kategori | Akses | Bising | Luas m2 | Kursi | Pintu | Terhubung pintu | Outlet/port ICT | Lantai finish |
|---|---|---|---|---|---|---|---|---|---|---|
| L1-MEET | Ruang rapat besar | work | public | moderate | 64.0 | 10 | D-L1-02, D-L1-03 | L1-CORR, L1-LOBBY | 2/3 | karpet tile matte |
| L1-LOBBY | Lobby & resepsi | public | public | moderate | 96.0 | 5 | D-L1-ENT, D-L1-01, D-L1-02, D-L1-04 | EXT, L1-CORR, L1-GALLERY, L1-MEET | 4/5 | vinyl motif kayu |
| L1-GALLERY | Galeri portofolio | public | public | quiet | 48.0 | 2 | D-L1-04, D-L1-05 | L1-CORR, L1-LOBBY | 0/0 | vinyl motif kayu |
| L1-PANTRY | Pantry kerja | wet | staff | moderate | 28.0 | 2 | D-L1-06 | L1-CORR | 0/0 | keramik anti-slip |
| L1-SHAFT-W | Shaft basah | shaft | restricted | quiet | 2.5 | 0 | D-L1-08 | L1-WC | 0/0 | - |
| L1-WC | Toilet aksesibel | wet | public | quiet | 17.5 | 0 | D-L1-07, D-L1-08 | L1-CORR, L1-SHAFT-W | 0/0 | keramik anti-slip |
| L1-CORR | Koridor utama L1 | circulation | public | moderate | 80.0 | 0 | D-L1-01, D-L1-03, D-L1-05, D-L1-06, D-L1-07, D-L1-EXW, D-L1-EXE, D-L1-09, D-L1-10, D-L1-11, D-L1-12, D-L1-13 | EXT, L1-CORE, L1-DISC, L1-GALLERY, L1-IMPL, L1-LAB, L1-LOBBY, L1-MEET, L1-NOVA, L1-PANTRY, L1-WC | 2/2 | vinyl motif kayu |
| L1-DISC | Ruang diskusi | quiet | staff | quiet | 36.0 | 4 | D-L1-09 | L1-CORR | 0/0 | karpet tile matte |
| L1-IMPL | Ruang implementasi & review | work | staff | moderate | 48.0 | 6 | D-L1-10 | L1-CORR | 8/14 | karpet tile matte |
| L1-CORE | Inti tangga & lift L1 | circulation | public | moderate | 36.0 | 0 | D-L1-11, D-L1-14 | L1-CORR, L1-NCORR | 0/0 | vinyl motif kayu |
| L1-NOVA | Area Nova (spesifikasi ICT) | work | staff | quiet | 36.0 | 2 | D-L1-12 | L1-CORR | 2/4 | karpet tile matte |
| L1-LAB | Lab ICT | work | staff | moderate | 36.0 | 1 | D-L1-13, D-L1-22 | L1-CORR, L1-NCORR | 4/14 | vinyl anti-statik (target) |
| L1-NCORR | Koridor utara L1 | circulation | staff | moderate | 64.0 | 0 | D-L1-14, D-L1-22, D-L1-EXN, D-L1-15, D-L1-16, D-L1-17, D-L1-18, D-L1-20, D-L1-21 | EXT, L1-BRUNO, L1-CEO, L1-CORE, L1-HUGO, L1-KEVIN, L1-LAB, L1-RISER, L1-STORE | 2/2 | vinyl motif kayu |
| L1-CEO | Ruang CEO | quiet | staff | quiet | 38.5 | 5 | D-L1-15 | L1-NCORR | 1/2 | karpet tile matte |
| L1-HUGO | Studio Hugo | work | staff | quiet | 38.5 | 2 | D-L1-16 | L1-NCORR | 2/4 | vinyl motif kayu |
| L1-KEVIN | Studio Kevin | work | staff | quiet | 33.0 | 1 | D-L1-17 | L1-NCORR | 1/2 | vinyl motif kayu |
| L1-BRUNO | Area Bruno | work | staff | moderate | 27.5 | 1 | D-L1-18, D-L1-19 | L1-NCORR, L1-SERVER | 2/3 | vinyl anti-statik (target) |
| L1-SERVER | Ruang server | restricted | restricted | moderate | 22.0 | 0 | D-L1-19 | L1-BRUNO | 0/0 | vinyl anti-statik (target) |
| L1-RISER | Riser ICT | shaft | restricted | quiet | 1.5 | 0 | D-L1-20 | L1-NCORR | 0/0 | - |
| L1-STORE | Gudang & utilitas | service | staff | quiet | 15.0 | 0 | D-L1-21 | L1-NCORR | 0/0 | epoxy |

## Lantai 2 (rekreasi)

| ID | Nama | Kategori | Akses | Bising | Luas m2 | Kursi | Pintu | Terhubung pintu | Outlet/port ICT | Lantai finish |
|---|---|---|---|---|---|---|---|---|---|---|
| L2-READ | Perpustakaan / reading nook | quiet | staff | quiet | 64.0 | 4 | D-L2-02 | L2-CORR | 0/0 | karpet tile matte |
| L2-LOUNGE | Lounge & coffee bar | recreation | staff | moderate | 96.0 | 9 | D-L2-01, D-L2-04 | L2-CORR, L2-DINE | 1/1 | vinyl motif kayu |
| L2-DINE | Ruang makan & pantry | recreation | staff | moderate | 48.0 | 8 | D-L2-03, D-L2-04 | L2-CORR, L2-LOUNGE | 2/2 | keramik anti-slip |
| L2-SHOWER | Shower & ruang ganti | wet | staff | quiet | 28.0 | 2 | D-L2-05 | L2-CORR | 0/0 | keramik anti-slip |
| L2-SHAFT-W | Shaft basah L2 | shaft | restricted | quiet | 2.5 | 0 | D-L2-07 | L2-WC | 0/0 | - |
| L2-WC | Toilet L2 | wet | staff | quiet | 17.5 | 0 | D-L2-06, D-L2-07 | L2-CORR, L2-SHAFT-W | 0/0 | keramik anti-slip |
| L2-CORR | Koridor utama L2 | circulation | staff | moderate | 80.0 | 0 | D-L2-01, D-L2-02, D-L2-03, D-L2-05, D-L2-06, D-L2-EXE, D-L2-08, D-L2-09, D-L2-10, D-L2-11 | EXT, L2-CHAT, L2-CORE, L2-DINE, L2-GAME, L2-GARDEN, L2-LOUNGE, L2-READ, L2-SHOWER, L2-WC | 2/2 | vinyl motif kayu |
| L2-CHAT | Diskusi santai | quiet | staff | quiet | 36.0 | 4 | D-L2-08 | L2-CORR | 0/0 | karpet tile matte |
| L2-GARDEN | Taman dalam | recreation | staff | quiet | 48.0 | 2 | D-L2-09 | L2-CORR | 0/0 | deck komposit |
| L2-CORE | Inti tangga & lift L2 | circulation | staff | moderate | 36.0 | 0 | D-L2-10, D-L2-12 | L2-CORR, L2-NCORR | 0/0 | vinyl motif kayu |
| L2-GAME | Ruang game | recreation | staff | loud | 72.0 | 8 | D-L2-11, D-L2-19 | L2-CORR, L2-NCORR | 5/7 | vinyl motif kayu |
| L2-NCORR | Koridor utara L2 | circulation | staff | moderate | 64.0 | 0 | D-L2-12, D-L2-19, D-L2-13, D-L2-14, D-L2-15, D-L2-16, D-L2-17, D-L2-18 | L2-BALCONY, L2-BILLIARD, L2-CORE, L2-GAME, L2-GYM, L2-RISER, L2-SERVICE, L2-STORE | 2/2 | vinyl motif kayu |
| L2-BALCONY | Balkon taman | outdoor | staff | moderate | 38.5 | 2 | D-L2-13 | L2-NCORR | 0/0 | deck komposit |
| L2-BILLIARD | Ruang biliar | recreation | staff | loud | 38.5 | 0 | D-L2-14 | L2-NCORR | 1/1 | karpet tile matte |
| L2-GYM | Ruang olahraga | recreation | staff | loud | 49.5 | 3 | D-L2-15 | L2-NCORR | 2/2 | lantai karet olahraga |
| L2-STORE | Gudang L2 | service | staff | quiet | 33.0 | 0 | D-L2-16 | L2-NCORR | 0/0 | epoxy |
| L2-RISER | Riser ICT L2 | shaft | restricted | quiet | 1.5 | 0 | D-L2-17 | L2-NCORR | 0/0 | - |
| L2-SERVICE | Area servis L2 | service | staff | quiet | 15.0 | 0 | D-L2-18 | L2-NCORR | 0/0 | epoxy |

## Furnishing per ruang

- L1-MEET: chair x10, meeting_table x1, plant_small x2, wall_display x1, whiteboard x1
- L1-LOBBY: chair x1, coffee_table x1, directory_sign x1, plant_large x3, poster x1, reception_desk x1, sofa x2
- L1-GALLERY: bench x1, gallery_panel x5, plant_small x1
- L1-PANTRY: fridge x1, high_table x1, pantry_counter x1, stool x2
- L1-WC: partition x1, sink x1, wc x2
- L1-CORR: plant_small x2, poster x1
- L1-DISC: bookshelf x1, chair_guest x4, plant_small x1, round_table x1, whiteboard x1
- L1-IMPL: chair x6, desk x6, plant_small x1, wall_display x1
- L1-CORE: lift x1, stair_u x1
- L1-NOVA: bookshelf x1, chair x2, desk x2, plan_table x1
- L1-LAB: lab_bench x3, lab_rack_open x1, stool x1
- L1-NCORR: plant_small x1, poster x1
- L1-CEO: bookshelf x1, chair x1, chair_guest x2, desk_exec x1, plant_large x1, sofa x1
- L1-HUGO: chair x2, desk x2, drafting_table x1, model_shelf x1, plant_small x1
- L1-KEVIN: chair x1, desk x1, easel x1, poster x1, work_table x1
- L1-BRUNO: chair x1, desk x1, plant_small x1, tool_cabinet x1
- L1-SERVER: rack_42u x2
- L1-STORE: storage_shelf x2
- L2-READ: armchair x2, bench x1, bookshelf x3, coffee_table x1, plant_large x1, plant_small x1
- L2-LOUNGE: armchair x1, beanbag x2, coffee_bar x1, coffee_table x1, high_table x1, plant_large x1, poster x1, sofa x2, stool x2
- L2-DINE: chair x8, dining_table x2, fridge x1, pantry_counter x1, wall_display x1
- L2-SHOWER: bench x1, locker x1, shower_stall x3
- L2-WC: partition x1, sink x1, wc x2
- L2-CORR: plant_small x1, poster x1
- L2-CHAT: armchair x2, coffee_table x1, plant_small x1, sofa x1
- L2-GARDEN: bench x1, planter_box x3, tree_planter x1
- L2-CORE: lift x1, stair_u x1
- L2-GAME: arcade_cabinet x2, beanbag x4, board_table x1, media_console x2, stool x4
- L2-NCORR: plant_small x1
- L2-BALCONY: bench x1, planter_box x3, round_table x1
- L2-BILLIARD: billiard_table x1, cue_rack x1, wall_display x1
- L2-GYM: bench x1, dumbbell_rack x1, exercise_bike x1, exercise_mat x2, treadmill x2, wall_display x1
- L2-STORE: storage_shelf x2
- L2-SERVICE: sink x1, storage_shelf x1

## Aturan adjacency (hasil validator)

| ID | Aturan | Hasil | Detail |
|---|---|---|---|
| ADJ-01 | Resepsi dekat entrance | lolos | "D-L1-ENT" |
| ADJ-02 | Rapat dicapai visitor tanpa melewati server | lolos | "path L1-LOBBY->L1-MEET avoiding ['L1-SERVER', 'L1-RISER']" |
| ADJ-03 | Bruno dekat rack, akses rack terbatas | lolos | {"path_m": 0.0, "max_m": 6.0} |
| ADJ-04 | Bruno dekat lab ICT | lolos | {"path_m": 6.39, "max_m": 12.0} |
| ADJ-05 | Ruang basah jauh dari rack | lolos | {"min_m": 10.5, "required": 8.0} |
| ADJ-06 | Game/biliar/gym tidak berbagi dinding dengan area tenang | lolos | [] |
| ADJ-07 | Area basah ditumpuk (konsep shaft) | lolos | {"overlap_m2": 17.5} |
| ADJ-08 | Pantry L1 di bawah shower L2 (zona basah) | lolos | {"overlap_m2": 28.0} |
| ADJ-09 | Pintu server hanya dari area Bruno | lolos | [] |
| ADJ-10 | Dua jalur keluar konsep L1 (perlu kajian profesional) | lolos | {"exits": 4} |
| ADJ-11 | Gym provisional (Q-03) tidak di atas ruang sensitif (tenang, rapat, server); risiko getaran/akustik ke studio di bawah tetap perlu kajian | lolos | {"below": ["L1-BRUNO", "L1-KEVIN"], "sensitive": []} |

Aturan jalur keluar hanya menghitung pintu exit konsep; kepatuhan peraturan tidak diklaim (AS-EXIT-01).
