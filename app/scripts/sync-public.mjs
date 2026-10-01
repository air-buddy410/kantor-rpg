// Copies generated documents into public/docs and writes a manifest so the
// app lists only files that actually exist in this build.
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = dirname(dirname(fileURLToPath(import.meta.url)));
const repo = dirname(app);
const out = join(app, 'public', 'docs');
mkdirSync(out, { recursive: true });
const candidates = [
  ['PRD/PRD-v0.2.pdf', 'PRD-v0.2.pdf', 'PRD v0.2 (dokumen perencanaan, bukan blueprint)'],
  ['drawings/pdf/A-101.pdf', 'A-101.pdf', 'A-101 Denah Lantai 1 (konsep 1:100)'],
  ['drawings/pdf/A-102.pdf', 'A-102.pdf', 'A-102 Denah Lantai 2 (konsep 1:100)'],
  ['drawings/pdf/kantor-rpg-sheets-all.pdf', 'kantor-rpg-sheets-all.pdf', 'Paket gambar konsep lengkap (semua sheet)'],
  ['drawings/pdf/kantor-rpg-sheets-ICT.pdf', 'kantor-rpg-sheets-ICT.pdf', 'Paket gambar ICT (konsep, rancangan virtual)'],
  ['drawings/pdf/kantor-rpg-poster.pdf', 'kantor-rpg-poster.pdf', 'Poster proyek (A3)'],
];
const docs = [];
for (const [src, name, label] of candidates) {
  const from = join(repo, src);
  if (!existsSync(from)) continue;
  copyFileSync(from, join(out, name));
  docs.push({ href: `docs/${name}`, label, bytes: statSync(from).size });
}
// Licence notices for everything shipped in the bundle (three.js MIT, Alegreya Sans OFL).
const lic = join(app, 'public', 'licenses');
mkdirSync(lic, { recursive: true });
for (const [from, name, label] of [
  ['node_modules/three/LICENSE', 'three-LICENSE.txt', 'Lisensi three.js (MIT)'],
  ['node_modules/@fontsource/alegreya-sans/LICENSE', 'alegreya-sans-OFL.txt', 'Lisensi huruf Alegreya Sans (SIL OFL 1.1)'],
]) {
  const src = join(app, from);
  if (!existsSync(src)) continue;
  copyFileSync(src, join(lic, name));
  docs.push({ href: `licenses/${name}`, label, bytes: statSync(src).size });
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ generated: new Date().toISOString(), docs }, null, 1));
console.log(`synced ${docs.length} docs`);
