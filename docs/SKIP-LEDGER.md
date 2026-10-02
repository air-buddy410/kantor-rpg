# Skip ledger (Playwright)

Audit R2 atas 9 test yang di-skip pada run penuh hardening (`docs/evidence/HARDENING/e2e-all.txt`, SHA b109cde). Prinsip: skip hanya bila kondisi uji secara fisik tidak ada di proyek tersebut, atau bila run panjang dijalankan terpisah dengan evidence.

| # | Proyek | Test | Status R2 | Alasan / evidence |
|---|---|---|---|---|
| 1 | desktop | `perf.spec.ts` benchmark 60 s | tetap gated (`KANTOR_PERF=1`) | 60 s per viewport terlalu panjang untuk setiap CI; dijalankan terpisah di ketiga viewport, `docs/evidence/R2/perf-route-*.json` |
| 2 | desktop | `world.spec.ts` joystick sentuh | tetap skip | proyek desktop tidak punya layar sentuh dan joystick tersembunyi; joystick diuji di tablet dan mobile |
| 3 | tablet | `budget.spec.ts` | dijalankan sejak hardening | `docs/evidence/HARDENING/e2e-unskipped-touch.txt`, R2 run penuh |
| 4 | tablet | `npc.spec.ts` sapa NPC | dijalankan (tap "Aksi") | sama |
| 5 | tablet | `perf.spec.ts` | gated, dijalankan terpisah | lihat #1 |
| 6 | tablet | `world.spec.ts` jalan keyboard | dijalankan sejak R2 | tablet dapat memakai keyboard fisik |
| 7 | mobile | `npc.spec.ts` sapa NPC | dijalankan (tap "Aksi") | sama dengan #4 |
| 8 | mobile | `perf.spec.ts` | gated, dijalankan terpisah | lihat #1 |
| 9 | mobile | `world.spec.ts` jalan keyboard | dijalankan sejak R2 | keyboard eksternal tetap dapat dipakai di ponsel |

Skip yang tersisa pada run default R2: `perf.spec.ts` di tiga viewport (gated, dijalankan terpisah), joystick di desktop, dan tombol sentuh "Lari" di desktop (`controls.spec.ts`; tombol tidak ada di tata letak desktop). Semuanya kondisi fisik atau run terpisah berevidence, bukan test yang dihindari.
