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
];
const docs = [];
for (const [src, name, label] of candidates) {
  const from = join(repo, src);
  if (!existsSync(from)) continue;
  copyFileSync(from, join(out, name));
  docs.push({ href: `docs/${name}`, label, bytes: statSync(from).size });
}
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ generated: new Date().toISOString(), docs }, null, 1));
console.log(`synced ${docs.length} docs`);
