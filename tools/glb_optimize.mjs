#!/usr/bin/env node
// Post-process the Blender GLB exports into the files the app ships.
//
//   node tools/glb_optimize.mjs [--kind characters|furniture] [--in DIR] [--out DIR]
//
// Reads blender/out/raw-glb/<kind>/*.glb (what the Blender builders export) and
// writes app/public/assets/<kind>/*.glb. Only KHR_mesh_quantization is used:
// three.js GLTFLoader reads it without a decoder or WebAssembly, so the
// proposed CSP (no 'wasm-unsafe-eval') still holds. Draco and meshopt are not
// used on purpose.
//
// Steps per file (deterministic: no clock, no randomness, fixed order):
//   1. characters: drop animation channels whose every key equals the target
//      node's rest TRS (exact no-op in three.js and Blender, see below), then
//      store rotation outputs as normalized int16 (KHR_mesh_quantization).
//   2. quantize vertex data: POSITION int16 (16 bits), NORMAL int8, TEXCOORD_0
//      uint16, WEIGHTS_0 uint8 (renormalised to sum 255). Characters use one
//      quantization volume for every mesh so all meshes keep one shared skin
//      (the dequantization lands in the inverse bind matrices); furniture gets
//      a uniform scale + translation on its single mesh node.
//   3. morph target deltas stay sparse; dedup + prune unused data.
// The checks that the result still matches the export live in
// tools/glb_compare.py (independent stdlib reader), not here.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The libraries are dev dependencies of app/ (one lockfile for the repo).
const require = createRequire(join(ROOT, 'app', 'package.json'));
const { NodeIO, VertexLayout, PropertyType } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { quantize, dedup, prune } = require('@gltf-transform/functions');
const VERSION = JSON.parse(readFileSync(join(ROOT, 'app', 'node_modules', '@gltf-transform', 'core', 'package.json'), 'utf8')).version;

const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const KINDS = opt('--kind', null) ? [opt('--kind')] : ['characters', 'furniture'];
const IN = resolve(ROOT, opt('--in', 'blender/out/raw-glb'));
const OUT = resolve(ROOT, opt('--out', 'app/public/assets'));

// Bits per attribute. Sizes are fixed by the component type, so 16-bit
// positions and UVs cost the same bytes as 14 or 12 bits and keep more precision
// (character positions: 0.03 mm steps over a 1.6 m volume; UV cell centres
// stay within 1e-4 of their 4 x 4 texel cell centre).
const QUANT = {
  quantizePosition: 16,
  quantizeNormal: 8,
  quantizeTexcoord: 16,
  quantizeWeight: 8,
  normalizeWeights: true,
  pattern: /^(POSITION|NORMAL|TEXCOORD_0|JOINTS_0|WEIGHTS_0)$/,
  patternTargets: /^POSITION$/,
  cleanup: true,
};
const REST_EPS = 1e-6;

function restValue(node, path) {
  if (path === 'translation') return node.getTranslation();
  if (path === 'rotation') return node.getRotation();
  if (path === 'scale') return node.getScale();
  return null;
}

function sameAs(values, rest, path) {
  const n = rest.length;
  for (let i = 0; i < values.length; i += n) {
    let d = 0;
    let dNeg = 0;
    for (let k = 0; k < n; k++) {
      d = Math.max(d, Math.abs(values[i + k] - rest[k]));
      dNeg = Math.max(dNeg, Math.abs(values[i + k] + rest[k]));
    }
    // q and -q are the same rotation
    if (!(d <= REST_EPS || (path === 'rotation' && dNeg <= REST_EPS))) return false;
  }
  return true;
}

function maxTime(sampler) {
  const t = sampler.getInput().getArray();
  return t[t.length - 1];
}

/**
 * A channel whose every key equals the node's rest value changes nothing: with
 * no track, three.js AnimationMixer blends the node's original (rest) state
 * with the remaining weight, which is the same result as blending the rest
 * value from a track; Blender keeps the bone at rest. The channel with the
 * latest end time is always kept so each clip keeps its duration.
 */
function stripRestChannels(doc) {
  let removed = 0;
  for (const anim of doc.getRoot().listAnimations()) {
    const channels = anim.listChannels();
    const end = Math.max(...channels.map((c) => maxTime(c.getSampler())));
    const keep = new Set();
    const drop = [];
    for (const ch of channels) {
      const path = ch.getTargetPath();
      const rest = restValue(ch.getTargetNode(), path);
      const out = ch.getSampler().getOutput();
      if (rest && !out.getNormalized() && sameAs(out.getArray(), rest, path)) drop.push(ch);
      else keep.add(ch);
    }
    if (![...keep].some((c) => maxTime(c.getSampler()) === end)) {
      const anchor = drop.find((c) => maxTime(c.getSampler()) === end);
      drop.splice(drop.indexOf(anchor), 1);
    }
    for (const ch of drop) {
      const s = ch.getSampler();
      ch.dispose();
      if (!s.listParents().some((p) => p.propertyType === PropertyType.ANIMATION_CHANNEL)) s.dispose();
      removed++;
    }
  }
  return removed;
}

/** Rotation outputs as normalized int16 (KHR_mesh_quantization allows it for animation samplers). */
function quantizeRotations(doc) {
  const done = new Set();
  for (const anim of doc.getRoot().listAnimations()) {
    for (const ch of anim.listChannels()) {
      if (ch.getTargetPath() !== 'rotation') continue;
      const out = ch.getSampler().getOutput();
      if (done.has(out) || out.getNormalized()) continue;
      const src = out.getArray();
      const dst = new Int16Array(src.length);
      for (let i = 0; i < src.length; i++) dst[i] = Math.round(Math.max(-1, Math.min(1, src[i])) * 32767);
      out.setArray(dst).setNormalized(true);
      done.add(out);
    }
  }
  return done.size;
}

/**
 * glTF-Transform 4.5.1 writes sparse values through Accessor.getElement(), which
 * dequantizes normalized integers, and stores the floats back into an Int16Array:
 * normalized int16 morph deltas come out as 0 (measured: 70 mm error on every
 * expression). Character positions and morph deltas therefore stay integer
 * (non-normalized short, also allowed by KHR_mesh_quantization) and the 1/32767
 * factor moves into the inverse bind matrices. Same grid, same precision.
 */
function integerPositions(doc) {
  const SHORT = 5122;
  const k = 1 / 32767;
  const skins = new Set();
  for (const node of doc.getRoot().listNodes()) {
    if (!node.getMesh()) continue;
    if (!node.getSkin()) throw new Error(`integerPositions: mesh node ${node.getName()} is not skinned`);
    skins.add(node.getSkin());
  }
  if (skins.size !== 1) throw new Error(`integerPositions: expected one shared skin, found ${skins.size}`);
  const accessors = new Set();
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      accessors.add(prim.getAttribute('POSITION'));
      for (const target of prim.listTargets()) accessors.add(target.getAttribute('POSITION'));
    }
  }
  for (const a of accessors) {
    if (a.getComponentType() !== SHORT || !a.getNormalized()) throw new Error('integerPositions: POSITION is not normalized int16');
    a.setNormalized(false);
  }
  const ibm = [...skins][0].getInverseBindMatrices();
  const m = ibm.getArray();
  // column-major: columns 0..2 carry x, y, z of the vertex
  for (let i = 0; i < m.length; i += 16) for (let c = 0; c < 12; c++) m[i + c] *= k;
  ibm.setArray(m);
}

/** Morph deltas touch only the face; store them sparse like the Blender export did. */
function sparseTargets(doc) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const target of prim.listTargets()) {
        for (const sem of target.listSemantics()) target.getAttribute(sem).setSparse(true);
      }
    }
  }
}

async function optimise(io, kind, src, dst) {
  const raw = readFileSync(src);
  // glTF-Transform replaces asset.generator on read; keep the exporter's name from the file
  const generator = JSON.parse(raw.subarray(20, 20 + raw.readUInt32LE(12)).toString('utf8')).asset.generator;
  const doc = await io.readBinary(new Uint8Array(raw));
  const stats = {};
  if (kind === 'characters') {
    stats.restChannelsRemoved = stripRestChannels(doc);
    stats.rotationOutputsQuantized = quantizeRotations(doc);
  }
  await doc.transform(
    quantize({ ...QUANT, quantizationVolume: kind === 'characters' ? 'scene' : 'mesh' }),
  );
  if (kind === 'characters') integerPositions(doc);
  sparseTargets(doc);
  await doc.transform(
    dedup({ keepUniqueNames: true }),
    prune({ keepLeaves: true, keepAttributes: true, keepIndices: true, keepSolidTextures: true, keepExtras: true }),
  );
  doc.getRoot().getAsset().generator = `${generator}, optimised by kantor-rpg tools/glb_optimize.mjs (glTF-Transform ${VERSION})`;
  const bytes = await io.writeBinary(doc);
  writeFileSync(dst, bytes);
  return { ...stats, bytes: bytes.byteLength };
}

async function main() {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setVertexLayout(VertexLayout.SEPARATE);
  const totals = {};
  for (const kind of KINDS) {
    const inDir = join(IN, kind);
    const outDir = join(OUT, kind);
    mkdirSync(outDir, { recursive: true });
    const files = readdirSync(inDir).filter((f) => f.endsWith('.glb')).sort();
    if (!files.length) throw new Error(`no GLB in ${relative(ROOT, inDir)}; run the Blender builder first`);
    totals[kind] = { files: files.length, before: 0, after: 0 };
    for (const f of files) {
      const src = join(inDir, f);
      const before = readFileSync(src).byteLength;
      const r = await optimise(io, kind, src, join(outDir, f));
      totals[kind].before += before;
      totals[kind].after += r.bytes;
      const extra = kind === 'characters' ? ` restChannelsRemoved=${r.restChannelsRemoved} rotationOutputs=${r.rotationOutputsQuantized}` : '';
      console.log(`OPT ${kind}/${f}: ${before} -> ${r.bytes} bytes (${((100 * r.bytes) / before).toFixed(1)}%)${extra}`);
    }
  }
  for (const [kind, t] of Object.entries(totals)) {
    console.log(`OPT_TOTAL ${kind}: files=${t.files} before=${t.before} after=${t.after}`);
  }
  console.log(`OPT_DONE kinds=${Object.keys(totals).join(',')} in=${relative(ROOT, IN)} out=${relative(ROOT, OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
