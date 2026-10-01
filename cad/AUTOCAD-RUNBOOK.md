# Runbook AutoCAD: DXF konsep ke DWG native

## Status

Native DWG: **BLOCKED** di container cloud. Audit M0 (`docs/evidence/M0/capability-report.md`) mencatat AutoCAD tidak terpasang dan tidak ada lisensi. Generator `cad/generate.py` hanya menghasilkan DXF R2018 (ezdxf) dan PDF vektor (ReportLab). Tidak ada file `.dwg` di repo.

Aturan:

- DWG hanya sah setelah **dibuat lalu dibuka ulang** di AutoCAD berlisensi (tool native legal) dan checklist di bawah lolos dengan evidence.
- DXF yang diganti nama menjadi `.dwg` **tidak sah** dan tidak boleh di-commit.
- Konverter pihak ketiga (misalnya ODA File Converter) bukan tool native Autodesk. Hasilnya hanya boleh dicatat sebagai "DWG via konverter pihak ketiga", bukan DWG native, kecuali Budi/Max memutuskan lain secara tertulis.
- Semua lembar berstatus KONSEP, bukan untuk konstruksi.

## Isi DXF yang akan dikonversi

| Hal | Nilai |
|---|---|
| File | `cad/out/<ID>.dxf` (contoh `A-101.dxf`), pasangan hitungan `cad/out/<ID>.counts.json` |
| Versi | DXF R2018 (AC1032) |
| Unit | milimeter, `$INSUNITS = 4`; model space 1:1 (world meter x 1000) |
| Origin | (0,0) sudut barat daya L1, X timur, Y utara (Y+ = utara) |
| Layout | tab paper space bernama sama dengan ID lembar, kertas A2 lanskap 594 x 420 mm, satu viewport skala 1:100 |
| Title block | block `KR-TTLB` dengan atribut `KR_SHEET_ID`, `KR_TITLE`, `KR_REVISION`, `KR_SCALE`, `KR_STATUS` dan lain-lain; nilai yang sama ada sebagai custom property (DWGPROPS) |
| Text style | `KR-SANS` dengan font `DejaVuSans.ttf`. Bila font tidak ada, AutoCAD memakai pengganti (`FONTALT`); catat font pengganti di evidence |
| Dimstyle | `KR-100` (DIMSCALE 100, tick arsitektural, angka mm) |

Layer: `A-WALL`, `A-DOOR`, `A-DOOR-IDEN`, `A-AREA` (non-plot), `A-ANNO-RMNM`, `A-FURN`, `A-FURN-IDEN` (frozen di viewport), `A-STRS`, `A-ANNO-DIMS`, `A-GRID`, `A-GRID-IDEN`, `A-ANNO-TTLB`, `A-ANNO-NOTE`, `A-ANNO-WMRK`, `A-ANNO-VPRT` (non-plot).

ID ruang, pintu dan fixture juga tersimpan sebagai XDATA aplikasi `KANTOR_RPG` (lihat dengan `LIST` atau `XDLIST` bila Express Tools terpasang).

## Prasyarat

1. AutoCAD berlisensi (2018 atau lebih baru) di mesin operator. Catat versi, jenis lisensi dan nama operator.
2. Checkout repo pada commit yang sama dengan `drawings/register.json`.
3. Cocokkan sha256 file DXF dengan register sebelum mulai:
   `sha256sum cad/out/A-101.dxf` lalu bandingkan dengan `drawings/register.json` (`files.dxf.sha256`). Bila beda, regenerasi dulu: `python3 cad/generate.py --sheets A-101`.

## Metode A: GUI (disarankan untuk konversi pertama)

1. `OPEN` lalu pilih jenis file DXF, buka `cad/out/A-101.dxf`.
2. `UNITS`: pastikan Insertion scale = Millimeters. Ketik `INSUNITS`, harus 4.
3. `LAYER`: pastikan layer di atas ada. Jangan mengganti nama layer.
4. Tab layout `A-101`: pilih viewport, cek Properties: Standard scale 1:100. Plot preview A2 lanskap.
5. `AUDIT` lalu jawab `Y` (perbaiki). Simpan teks hasil AUDIT ke evidence.
6. `SAVEAS`, format "AutoCAD 2018 Drawing (*.dwg)", simpan sebagai `cad/out/A-101.dwg` (nama sama, ekstensi DWG).
7. Tutup file, lanjut ke checklist verifikasi.

## Metode B: script

1. Buka DXF seperti langkah A1.
2. `SCRIPT` lalu pilih `cad/autocad/convert_to_dwg.scr`. Script menjalankan `AUDIT`, lalu `SAVEAS 2018` ke folder yang sama, dan berhenti tanpa menimpa bila DWG sudah ada.
3. Opsi batch tanpa GUI: `accoreconsole.exe /i "C:\...\cad\out\A-101.dxf" /s "C:\...\cad\autocad\convert_to_dwg.scr"`. Opsi ini belum diuji di repo ini; bila AutoCAD Core Console menolak DXF sebagai input, pakai Metode A.

Script dan LISP di folder `cad/autocad/` ditulis tanpa akses ke AutoCAD dan **belum pernah dijalankan**. Laporkan bila ada prompt yang berbeda di versi AutoCAD yang dipakai.

## Checklist verifikasi DWG

Centang semua sebelum menyebut DWG "native, terverifikasi":

- [ ] `OPEN cad/out/A-101.dwg` berhasil (buka ulang file hasil, bukan sesi yang sama).
- [ ] `AUDIT` dengan `Y`: 0 error. Simpan teks command line.
- [ ] `INSUNITS` = 4 dan `UNITS` menampilkan Millimeters.
- [ ] Semua layer pada daftar di atas ada.
- [ ] `APPLOAD` lalu muat `cad/autocad/count_by_layer.lsp`, jalankan `KRCOUNT`. File `A-101.autocad-counts.txt` terbentuk di `cad/out/`.
- [ ] Bandingkan hitungan: `python3 cad/autocad/compare_counts.py cad/out/A-101.counts.json cad/out/A-101.autocad-counts.txt` harus "HASIL: cocok". Untuk A-101 revisi P02 contoh nilainya: `A-WALL LWPOLYLINE 50`, `A-WALL HATCH 50`, `A-ANNO-DIMS DIMENSION 28`, `A-ANNO-RMNM MTEXT 20`; angka acuan selalu dari file counts.json, bukan dari runbook ini.
- [ ] `LIST` pada dimensi total bawah: 32000; dimensi total kiri: 24000.
- [ ] `ATTEDIT` / Properties pada title block: `KR_SHEET_ID` = A-101, `KR_REVISION` = revisi di `design/world.json`, `KR_STATUS` = KONSEP.
- [ ] `DWGPROPS` tab Custom: properti `KR_*` sama dengan atribut title block.
- [ ] Layout `A-101` viewport skala 1:100; plot ke PDF A2 tidak memotong frame.
- [ ] Catat font pengganti untuk style `KR-SANS` bila DejaVu Sans tidak terpasang.
- [ ] `sha256sum cad/out/A-101.dwg` dicatat.

## Evidence yang wajib ditulis

Simpan di `docs/evidence/<milestone>/dwg-<ID>.md` (bahasa Indonesia), berisi: versi dan build AutoCAD, jenis lisensi (tanpa nomor serial), nama operator, tanggal UTC, sha256 DXF sumber dan DWG hasil, teks AUDIT, output `compare_counts.py`, screenshot layout, dan daftar penyimpangan. Setelah evidence ada, status di `drawings/register.json` boleh diperbarui oleh generator atau reviewer dengan menunjuk file evidence itu. Tanpa evidence, status tetap BLOCKED.
