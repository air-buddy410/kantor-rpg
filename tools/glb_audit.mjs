#!/usr/bin/env node
// Weight audit of every shipped runtime asset: bytes (raw and gzip -6), triangles,
// primitives (= draw calls when loaded unbatched), materials, textures, animation
// bytes and which accessors carry the bytes. Read-only; writes one JSON report.
//
//   node tools/glb_audit.mjs [--out docs/evidence/AUDIT-3D/glb-audit.json]
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'app', 'package.json'));
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');

const args = process.argv.slice(2);
const OUT = resolve(ROOT, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'docs/evidence/AUDIT-3D/glb-audit.json');
const ASSETS = join(ROOT, 'app', 'public', 'assets');
// Building GLBs are not loaded by the app (README in blender/): reported, not budgeted.
const RUNTIME = new Set(['characters', 'furniture', 'signage']);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const files = [];
for (const kind of readdirSync(ASSETS).filter((d) => statSync(join(ASSETS, d)).isDirectory()).sort()) {
  for (const f of readdirSync(join(ASSETS, kind)).sort()) {
    const p = join(ASSETS, kind, f);
    const raw = readFileSync(p);
    const row = { kind, file: f, runtime: RUNTIME.has(kind), bytes: raw.byteLength, gzip6: gzipSync(raw, { level: 6 }).byteLength };
    if (f.endsWith('.glb')) {
      const doc = await io.readBinary(new Uint8Array(raw));
      const r = doc.getRoot();
      let tris = 0, prims = 0, idx = 0, anim = 0, transparent = 0;
      const attr = {};
      for (const m of r.listMeshes()) for (const p of m.listPrimitives()) {
        prims++;
        const ix = p.getIndices();
        tris += (ix ? ix.getCount() : p.getAttribute('POSITION').getCount()) / 3;
        idx += ix ? ix.getByteLength() : 0;
        for (const s of p.listSemantics()) attr[s] = (attr[s] ?? 0) + p.getAttribute(s).getByteLength();
        for (const t of p.listTargets()) for (const s of t.listSemantics()) attr[`morph_${s}`] = (attr[`morph_${s}`] ?? 0) + t.getAttribute(s).getByteLength();
      }
      for (const a of r.listAnimations()) for (const s of a.listSamplers()) anim += s.getInput().getByteLength() + s.getOutput().getByteLength();
      for (const m of r.listMaterials()) if (m.getAlphaMode() === 'BLEND') transparent++;
      Object.assign(row, {
        triangles: tris, primitives: prims, materials: r.listMaterials().length, transparentMaterials: transparent,
        textures: r.listTextures().map((t) => ({ mime: t.getMimeType(), size: t.getSize(), bytes: t.getImage().byteLength })),
        animations: r.listAnimations().length, animationBytes: anim, indexBytes: idx, attributeBytes: attr,
      });
    }
    files.push(row);
  }
}
const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
const byKind = {};
for (const r of files) {
  const k = (byKind[r.kind] ??= { files: 0, bytes: 0, gzip6: 0, triangles: 0, primitives: 0 });
  k.files++; k.bytes += r.bytes; k.gzip6 += r.gzip6; k.triangles += r.triangles ?? 0; k.primitives += r.primitives ?? 0;
}
const runtimeGlb = files.filter((r) => r.runtime && r.file.endsWith('.glb'));
const report = {
  tool: 'tools/glb_audit.mjs',
  budget: { adr: 'ADR-015', charactersTargetBytes: 4_600_000, runtimeGlbTargetBytes: 6_000_000 },
  totals: { byKind, runtimeGlbBytes: sum(runtimeGlb, 'bytes'), runtimeGlbGzip6: sum(runtimeGlb, 'gzip6'), allBytes: sum(files, 'bytes') },
  heaviest: [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 12).map((r) => `${r.kind}/${r.file} ${r.bytes}`),
  files,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.totals, null, 1));
console.log(`AUDIT_DONE files=${files.length} out=${relative(ROOT, OUT)}`);
