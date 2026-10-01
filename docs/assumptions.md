# Asumsi dan batas

Dibuat dari `design/world.json` (`assumptions`). Setiap angka ukuran/okupansi/ICT yang dipakai generator merujuk ID di bawah.

| ID | Topik | Asumsi |
|---|---|---|
| AS-DIM-01 | dimensi | Footprint 32 m x 24 m per lantai dan tinggi antar lantai 4,0 m adalah proposal PRD, bukan luas lahan yang disahkan. |
| AS-DIM-02 | dimensi | Polygon ruang diukur pada garis as dinding; luas adalah luas as-drawn, bukan luas bersih/usable. |
| AS-DIM-03 | dimensi | Tebal dinding konsep: luar 0,30 m, dalam 0,15 m; plafon 3,0 m; slab 0,30 m. Belum ada desain struktur. |
| AS-DIM-04 | dimensi | Ukuran furniture dari catalog adalah target konsep (bukan katalog vendor). Meja biliar 9 ft memakai luas main 2,54 x 1,27 m dan clearance stik 1,47 m sebagai target ukuran umum, wajib dicek ulang ke spesifikasi produk. |
| AS-DIM-05 | dimensi | Tangga U: 24 riser x 0,1667 m, tread 0,28 m, lebar flight 1,2 m. Target konsep game; tidak menyatakan tangga layak konstruksi. |
| AS-OCC-01 | okupansi | Faktor beban hunian memakai IBC 2021 Table 1004.5 sebagai pembanding, bukan regulasi Indonesia yang berlaku. Perhitungan egress resmi butuh profesional. |
| AS-OCC-02 | okupansi | Kapasitas kursi dihitung dari fixture; bukan target okupansi manusia yang diputuskan Budi. |
| AS-EXIT-01 | keselamatan | Tangga darurat timur L2 hanya penanda konsep di luar envelope; jalur keluar belum dinilai memenuhi peraturan. |
| AS-ICT-01 | ict | Jumlah AP adalah placeholder; belum ada model site/material dan target coverage. Tidak ada radius Wi-Fi efektif yang diklaim. |
| AS-ICT-02 | ict | Slack kabel: 3,0 m sisi rack + 0,3 m sisi outlet; tray pada 3,2 m di atas lantai jadi; outlet meja 0,3 m; outlet plafon 3,0 m. Asumsi proyek, bukan standar. |
| AS-ICT-03 | ict | Batas panjang permanent link 90 m dipakai sebagai target konsep (praktik umum kabel tembaga terstruktur), wajib diverifikasi ke standar yang dipilih. |
| AS-ICT-04 | ict | Daya PoE worst-case per kelas memakai nilai PSE IEEE 802.3af/at/bt (Class 3 = 15,4 W, Class 4 = 30 W). Kelas perangkat placeholder sampai datasheet dipilih. |
| AS-ICT-05 | ict | Rating UPS, thermal/AC dan harga belum ditentukan; tidak ada harga pengadaan dalam paket ini. |
| AS-ICT-06 | ict | Clearance rack depan 1,2 m / belakang 0,9 m adalah target konsep; verifikasi ke standar/panduan yang dipilih. |
| AS-NET-01 | ict | Domain jaringan office/demo/guest/lab/server adalah ID abstrak; bukan subnet, VLAN atau perangkat produksi. |
| AS-PERF-01 | performa | Target FPS/transfer/triangle adalah target PRD; angka hanya disebut terukur setelah benchmark tercatat. |
| AS-SITE-01 | lahan | Lahan fisik, lokasi, budget, hosting dan okupansi manusia belum diputuskan. |
