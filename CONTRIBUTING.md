# Berkontribusi

Laporan bug, ide, dan pull request diterima. Panduan ini menjelaskan cara menyiapkan repo dan apa yang diperiksa sebelum perubahan digabung.

## Menyiapkan

```bash
git clone https://github.com/air-buddy410/kantor-rpg.git
cd kantor-rpg/app
npm ci
npm run dev
```

Untuk backend, Python, Blender, dan CAD, lihat [INSTALL.md](INSTALL.md) dan [docs/REBUILD.md](docs/REBUILD.md).

## Sebelum membuka pull request

Jalankan pemeriksaan yang sama dengan CI:

```bash
cd app
npx tsc --noEmit
npx vitest run
npx playwright test
cd ../server && npm test
```

Kalau mengubah `design/`, `tools/`, `cad/`, atau `blender/`, jalankan juga:

```bash
python3 tools/build_design.py
python3 -m pytest tests/py -q
```

## Aturan yang dijaga tes

- `design/world.json` adalah satu-satunya sumber data gedung. Ubah dataset, jangan menyunting hasil turunannya (`design/derived/`, `cad/out/`, `drawings/`) secara manual.
- Aset harus dibuat sendiri atau berlisensi jelas, dan tercatat di `design/asset-registry.json`. `tests/py/test_provenance.py` gagal kalau ada berkas tanpa asal yang diketahui.
- Permukaan 3D beda warna tidak boleh menempel di bidang yang sama. `app/tests/unit/coplanar.test.ts` menangkapnya.
- Jangan commit kredensial, token, alamat server pribadi, atau data obrolan. `tools/safety_scan.py` memeriksa pola yang umum.
- Keputusan arsitektur yang baru dicatat sebagai ADR di `docs/decisions.md`.

## Melaporkan bug

Sertakan browser dan perangkat, URL lengkap (termasuk `?seed=` bila ada), langkah untuk mengulang, dan screenshot. Untuk masalah tampilan 3D, sebutkan juga pilihan kualitas grafis di Pengaturan.

## Lisensi

Dengan mengirim kontribusi, kamu setuju kontribusi itu dirilis di bawah [lisensi MIT](LICENSE) yang sama dengan proyek ini.
