import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import world from '@design/world.json';
import walls from '@design/derived/walls.json';
import { buildFloor, MaterialCache, setFurnitureKit } from '../../src/world/build';
import { kitEntryFromScene, type FurnitureKit } from '../../src/world/furniture-kit';
import { DoorController } from '../../src/world/doors';
import { DoorMeshes } from '../../src/world/door-meshes';
import type { DerivedWalls, World } from '../../src/world/types';
import { scanCoplanar } from './coplanar-scan';

// Z-fighting gate: no two differently coloured surfaces of the built world may
// share a plane (< 1 mm apart, same facing) over a visible area. Runs on the
// world exactly as the game builds it, with the shipped furniture GLBs.
const W = world as unknown as World;
// Node has no DOM image loader; artwork planes keep their geometry without the texture.
vi.spyOn(THREE.TextureLoader.prototype, 'load').mockImplementation(() => new THREE.Texture());
type Fs = { readFileSync(p: string): Uint8Array; readdirSync(p: string): string[]; mkdirSync(p: string, o: object): void; writeFileSync(p: string, d: string): void };
const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as Fs;
const DIR = new URL('../../public/assets/furniture/', import.meta.url).pathname;
const ENV_ = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const GAP = Number(ENV_.KANTOR_GAP ?? 0.001);
const OUT = ENV_.KANTOR_AUDIT_OUT;

async function kit(): Promise<FurnitureKit> {
  const k: FurnitureKit = new Map();
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.glb'))) {
    const buf = fs.readFileSync(DIR + f);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const scene = await new Promise<THREE.Group>((res, rej) => new GLTFLoader().parse(ab, '', (g) => res(g.scene), rej));
    k.set(f.replace(/\.glb$/, ''), kitEntryFromScene(scene));
  }
  return k;
}

describe('no coplanar overlapping surfaces (z-fighting) in the built world', () => {
  for (const mode of ['procedural', 'glb'] as const) {
    for (const floor of ['L1', 'L2'] as const) {
      for (const doorsOpen of [false, true]) {
        it(`${floor} ${mode} furniture, doors ${doorsOpen ? 'open' : 'closed'}: no same-plane overlap between different materials`, async () => {
          setFurnitureKit(mode === 'glb' ? await kit() : null);
          const mats = new MaterialCache(false);
          const fb = buildFloor(W, walls as unknown as DerivedWalls, floor, mats, false);
          // Door leaves are instanced and posed at runtime: scan them closed and fully open.
          const ctl = new DoorController(W, walls as unknown as DerivedWalls);
          if (doorsOpen) for (const l of ctl.leaves(floor)) (ctl as unknown as { state: Map<string, number> }).state.set(l.id, 1);
          new DoorMeshes(W, ctl, mats, new Map([[floor, fb.group]]));
          const r = scanCoplanar(fb.group, GAP, 1e-4);
          setFurnitureKit(null);
          if (OUT) {
            fs.mkdirSync(OUT, { recursive: true });
            fs.writeFileSync(`${OUT}/coplanar-${floor}-${mode}${doorsOpen ? '-doors-open' : ''}.json`, JSON.stringify({ floor, mode, doorsOpen, gapM: GAP, minAreaM2: 1e-4, triangles: r.triangles, meshes: r.meshes.length, hits: r.hits.length, list: r.hits.slice(0, 300) }, null, 1));
          }
          // Downward faces are never seen: the camera pitch keeps it above every floor.
          // Same colour on both sides of a pair renders identically whichever wins.
          const colour = (n: string) => n.split('#')[1].split('/')[0].split('[')[0];
          const seen = r.hits.filter((h) => h.normal[1] > -0.5 && colour(h.a) !== colour(h.b));
          expect(seen.map((h) => `${h.a} vs ${h.b} @${h.at.join(',')} ${h.areaM2} m2`)).toEqual([]);
        });
      }
    }
  }

  // Every shipped GLB on its own (all materials, all nodes): catches same-plane
  // faces inside an asset before the batcher or a future loader sees them.
  // Characters are skipped: one atlas material per persona, skinned at runtime.
  for (const kind of ['furniture', 'building'] as const) {
    it(`${kind} GLBs: report same-plane faces between materials`, async () => {
      const dir = new URL(`../../public/assets/${kind}/`, import.meta.url).pathname;
      const rows: { file: string; hits: number; seenAreaM2: number; top: string[] }[] = [];
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.glb'))) {
        const buf = fs.readFileSync(dir + f);
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
        const gltf = await new Promise<{ scene: THREE.Group }>((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
        // Split multi-material meshes so each material is its own scan object.
        const root = new THREE.Group();
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          const g = m.geometry.clone();
          for (const [k, a] of Object.entries(g.attributes)) if ((a as THREE.BufferAttribute).normalized || !((a as THREE.BufferAttribute).array instanceof Float32Array)) {
            const src = a as THREE.BufferAttribute; const out = new Float32Array(src.count * src.itemSize);
            for (let i = 0; i < src.count; i++) for (let c = 0; c < src.itemSize; c++) out[i * src.itemSize + c] = src.getComponent(i, c);
            g.setAttribute(k, new THREE.BufferAttribute(out, src.itemSize));
          }
          g.applyMatrix4(m.matrixWorld);
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          const groups = g.groups.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : g.attributes.position.count, materialIndex: 0 }];
          for (const gr of groups) {
            const sub = g.clone(); sub.clearGroups();
            if (sub.index) sub.setIndex(Array.from(sub.index.array as ArrayLike<number>).slice(gr.start, gr.start + gr.count));
            const mesh = new THREE.Mesh(sub, mats[gr.materialIndex ?? 0]);
            mesh.name = `${o.name}:${(mats[gr.materialIndex ?? 0] as THREE.Material).name}`;
            root.add(mesh);
          }
        });
        const r = scanCoplanar(root, GAP, 1e-4);
        const seen = r.hits.filter((h) => h.normal[1] > -0.5);
        rows.push({ file: f, hits: seen.length, seenAreaM2: +seen.reduce((s2, h) => s2 + h.areaM2, 0).toFixed(4), top: seen.slice(0, 5).map((h) => `${h.a} vs ${h.b} n=${h.normal.join(',')} ${h.areaM2} m2`) });
      }
      if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(`${OUT}/coplanar-assets-${kind}.json`, JSON.stringify({ kind, gapM: GAP, rows }, null, 1)); }
      expect(rows.length).toBeGreaterThan(0);
    });
  }
});
