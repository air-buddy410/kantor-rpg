// Runtime loader for the Blender furniture families (app/public/assets/furniture).
// Each GLB is flattened into colour-keyed parts so the static batcher can merge
// them exactly like the procedural kit; a type whose GLB fails to load keeps
// the procedural geometry (honest fallback, no missing furniture).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Part } from './furniture';

export interface KitEntry { parts: Part[]; mount: number; triangles: number }
export type FurnitureKit = Map<string, KitEntry>;

export async function loadFurnitureKit(types: string[], base = 'assets/furniture'): Promise<{ kit: FurnitureKit; failed: string[] }> {
  const loader = new GLTFLoader();
  const kit: FurnitureKit = new Map();
  const failed: string[] = [];
  await Promise.all(types.map(async (type) => {
    try {
      const gltf = await loader.loadAsync(`${base}/${type}.glb`);
      gltf.scene.updateMatrixWorld(true);
      const parts: Part[] = [];
      let mount = 0;
      let triangles = 0;
      gltf.scene.traverse((o) => {
        const x = o.userData as Record<string, unknown>;
        if (typeof x.kantor_mount_height_m === 'number') mount = x.kantor_mount_height_m;
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const geo = mesh.geometry.clone();
        geo.applyMatrix4(mesh.matrixWorld);
        // Split multi-material meshes by group so each colour batches separately.
        const groups = geo.groups.length ? geo.groups : [{ start: 0, count: geo.index ? geo.index.count : geo.attributes.position.count, materialIndex: 0 }];
        for (const g of groups) {
          const m = mats[g.materialIndex ?? 0] as THREE.MeshStandardMaterial;
          const sub = subGeometry(geo, g.start, g.count);
          triangles += (sub.index ? sub.index.count : sub.attributes.position.count) / 3;
          const emissive = !!m.emissive && m.emissive.getHex() !== 0;
          parts.push({ geo: sub, color: m.color.getHex(THREE.SRGBColorSpace), emissive, glass: m.transparent && m.opacity < 0.9 });
        }
      });
      kit.set(type, { parts, mount, triangles });
    } catch {
      failed.push(type);
    }
  }));
  return { kit, failed };
}

function subGeometry(geo: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal'] as const) {
    const a = src.attributes[name] as THREE.BufferAttribute | undefined;
    if (!a) continue;
    out.setAttribute(name, new THREE.BufferAttribute((a.array as Float32Array).slice(start * a.itemSize, (start + count) * a.itemSize), a.itemSize));
  }
  if (!out.attributes.normal) out.computeVertexNormals();
  return out;
}

/** Fresh copies of a kit entry's parts (the batcher consumes and transforms them). */
export function kitParts(e: KitEntry): Part[] {
  return e.parts.map((p) => ({ ...p, geo: p.geo.clone() }));
}
