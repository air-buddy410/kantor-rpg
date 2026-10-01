# Capability report M0

Tanggal eksekusi: 2026-10-01 (UTC). Semua baris di bawah adalah hasil perintah nyata di container cloud ini; perintah ada di kolom kanan agar dapat diulang.

## Repo dan runtime

| Item | Hasil | Perintah/sumber |
|---|---|---|
| Repo | air-buddy410/kantor-rpg (public) | `git remote -v` |
| Default branch | main | `git ls-remote origin` |
| HEAD main saat mulai | 8522f030b163859e6d23e20971fc816214282f1b | `git rev-parse main` |
| Branch kerja M0 | claude/kantor-rpg-m0 (dari main) | `git checkout -b` |
| Model sesi (runtime) | session_context.model = claude-opus-5-5, effort_level = high, last_served_model = claude-opus-5-5 | tool `get_session` |
| Status rate limit yang ditampilkan runtime | rateLimitType seven_day, status "rejected", isUsingOverage false, resetsAt 2026-10-03 16:00 UTC | tool `get_session` |

Catatan rate limit: runtime menampilkan status "rejected" untuk jendela tujuh hari sementara turn tetap dilayani. Tidak ada top-up, auto-reload atau pergantian model yang dilakukan. Bila layanan berhenti, checkpoint terakhir ada di docs/progress.md.

## OS dan hardware

| Item | Hasil | Perintah |
|---|---|---|
| OS | Ubuntu 24.04.4 LTS, kernel 6.18.44 x86_64 | `cat /etc/os-release`, `uname -a` |
| CPU / RAM | 4 vCPU Intel Xeon 2.80GHz / 15 GiB | `nproc`, `free -g` |
| GPU | Tidak ada (/dev/dri tidak ada, nvidia-smi tidak ada). Render headless memakai CPU/software. | `ls /dev/dri` |
| Disk kerja | 30 GB tersedia saat audit | `df -h` |

## Tool desain

| Tool | Status | Bukti |
|---|---|---|
| Blender | TERSEDIA: Blender 4.0.2 (paket Ubuntu `blender 4.0.2+dfsg-1ubuntu8`, GPL), Python 3.12.3, add-on glTF 4.0.44. Background save .blend, reopen dan export GLB berhasil pada uji kubus. Butuh `python3-numpy` untuk exporter glTF (gagal pertama: `ModuleNotFoundError: No module named 'numpy'`, lalu dipasang). | `blender -b --factory-startup -noaudio --python bt.py` |
| Unduhan Blender resmi | DIBLOKIR proxy: `curl https://download.blender.org/release/` -> `CONNECT tunnel failed, response 403` | `curl -sSI` |
| AutoCAD (native DWG) | BLOCKED. Tidak ada AutoCAD di Linux container ini, tidak ada lisensi, dan AutoCAD tidak dirilis untuk Linux. | `which`, `apt-cache search` |
| ODA File Converter / Teigha | Tidak terpasang, tidak ada di apt. Tidak dipakai (lisensi proprietary perlu persetujuan). | `apt-cache search -n oda` |
| LibreDWG | Tidak ada di indeks apt (`apt-cache policy libredwg-tools` kosong). Walau ada, bukan tool native AutoCAD. | `apt-cache policy` |
| LibreCAD / FreeCAD / QCAD | Tidak ada di indeks apt container ini. | `apt-cache search` |
| ezdxf | 1.4.4 (MIT), dipakai menulis dan membaca ulang DXF R2018 | `pip freeze` |
| ReportLab | 5.0.1 (BSD), PDF vektor | `pip freeze` |
| pypdf | 6.19.0, ekstraksi teks PDF untuk test | `pip freeze` |
| matplotlib | 3.11.2, render preview DXF via ezdxf drawing add-on | `pip freeze` |
| LibreOffice | 24.2.7.2 tersedia, belum dipakai | `soffice --version` |
| Font | Alegreya Sans (SIL OFL 1.1) via `fonts-alegreya-sans`; dikonversi OTF ke TTF hanya di `.cache/` untuk ReportLab, tidak didistribusikan | `/usr/share/doc/fonts-alegreya-sans/copyright` |

Keputusan CAD: native DWG BLOCKED. Paket M1/M3 menghasilkan DXF (ezdxf) dan PDF vektor (ReportLab) berlabel KONSEP, ditambah runbook AutoCAD (`cad/AUTOCAD-RUNBOOK.md`) untuk mengubah DXF menjadi DWG di mesin berlisensi. Tidak ada file DXF yang diganti ekstensinya menjadi DWG. `tools/safety_scan.py` menandai file .dwg apa pun sebagai temuan.

## Web runtime

| Tool | Status |
|---|---|
| Node.js | v22.22.0, npm 10.9.4, pnpm tersedia |
| npm registry | dapat diakses; versi terbaru saat audit: three 0.186.1, vite 8.3.1, @playwright/test 1.63.0, typescript 7.0.2, vitest 5.0.3 (`npm view`) |
| Browser | Chromium 141.0.7390.37 (Playwright build 1194) di /opt/pw-browsers, headless; tanpa GPU sehingga WebGL berjalan lewat SwiftShader/software bila tersedia |
| PyPI | dapat diakses lewat proxy |

## Python toolchain

`requirements-dev.txt` mem-pin versi di atas. Python 3.11.15 untuk generator/test; Blender memakai Python 3.12.3 bawaannya sehingga `tools/kantor/geometry.py` sengaja tanpa dependency pihak ketiga.

## Batasan yang mempengaruhi bukti

- Tidak ada GPU: angka FPS dari container ini bukan benchmark perangkat Budi. Perf harness mencatat environment dan diberi label "software rendering container".
- Tidak ada perangkat fisik mobile/tablet: viewport emulasi Playwright, bukan uji perangkat nyata.
- Native DWG tetap BLOCKED sampai ada mesin AutoCAD berlisensi.
