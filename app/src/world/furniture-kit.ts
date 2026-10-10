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
  let next = 0;
  // Leave network capacity for playable/NPC characters instead of launching 54 background requests.
  await Promise.all(Array.from({ length: Math.min(4, types.length) }, async () => {
    while (next < types.length) {
      const type = types[next++];
      try {
        const gltf = await loader.loadAsync(`${base}/${type}.glb`);
        const { parts, mount, triangles } = kitEntryFromScene(gltf.scene);
        kit.set(type, { parts, mount, triangles });
      } catch {
        failed.push(type);
      }
    }
  }));
  return { kit, failed };
}

/** Shipped GLBs use KHR_mesh_quantization (R2): positions/normals arrive as
 * (normalized) integers. Baking the node matrix in and slicing raw arrays both
 * need plain floats, so every non-float attribute is expanded first. */
function toFloat32(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const [name, attr] of Object.entries(geo.attributes)) {
    const a = attr as THREE.BufferAttribute;
    if (a.array instanceof Float32Array && !a.normalized) continue;
    const f = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) f[i * a.itemSize + k] = a.getComponent(i, k);
    geo.setAttribute(name, new THREE.BufferAttribute(f, a.itemSize));
  }
  return geo;
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
/** Turn a loaded furniture scene into batched parts (exported for tests). */
export function kitEntryFromScene(scene: THREE.Object3D): KitEntry {
  scene.updateMatrixWorld(true);
  const parts: Part[] = [];
  let mount = 0;
  let triangles = 0;
  scene.traverse((o) => {
    const x = o.userData as Record<string, unknown>;
    if (typeof x.kantor_mount_height_m === 'number') mount = x.kantor_mount_height_m;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const geo = toFloat32(mesh.geometry.clone());
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
  separateCoplanar(parts);
  return { parts, mount, triangles };
}

/** Offset candidates step by this; ~1 mm is resolved by 24-bit depth at the
 * 34 m max camera distance (~0.15 mm) with margin for phones. */
export const PART_OFFSET_M = 0.0015;
/** Faces closer than this (same facing, overlapping) count as fighting. */
export const PART_CLEARANCE_M = 0.0013;

interface Face { n: THREE.Vector3; d: number; c: THREE.Vector3; p0: THREE.Vector3; min: THREE.Vector3; max: THREE.Vector3 }

function faces(g: THREE.BufferGeometry): Face[] {
  const pos = g.attributes.position;
  const out: Face[] = [];
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let t = 0; t < pos.count; t += 3) {
    a.fromBufferAttribute(pos, t); b.fromBufferAttribute(pos, t + 1); c.fromBufferAttribute(pos, t + 2);
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    const len = n.length();
    if (len < 1e-8) continue;
    n.divideScalar(len);
    out.push({ n, d: n.dot(a), c: a.clone().add(b).add(c).divideScalar(3), p0: a.clone(), min: a.clone().min(b).min(c), max: a.clone().max(b).max(c) });
  }
  return out;
}

/** Any same-facing face pair closer than the clearance whose boxes overlap
 * by more than 2 mm in the plane (touching edges are not a fight). */
function fights(a: Face[], b: Face[]): boolean {
  // Normal buckets plus their 26 neighbours: a rounding edge must not hide a pair.
  const bins = new Map<string, Face[]>();
  const q = (f: Face) => [Math.round(f.n.x * 20), Math.round(f.n.y * 20), Math.round(f.n.z * 20)];
  for (const f of b) { const k = q(f).join(); (bins.get(k) ?? bins.set(k, []).get(k)!).push(f); }
  const m = 0.002;
  const tmp = new THREE.Vector3();
  for (const f of a) {
    const [x, y, z] = q(f);
    const near: Face[] = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) near.push(...(bins.get(`${x + i},${y + j},${z + k}`) ?? []));
    for (const o of near) {
      if (f.n.dot(o.n) < 0.9995 || Math.abs(f.d - o.d) >= 0.01) continue;
      // Local gap (centroid to the other plane): plane offsets of small faces
      // far from the origin carry mm-level error.
      const gap = Math.max(Math.abs(f.n.dot(tmp.subVectors(o.c, f.p0))), Math.abs(o.n.dot(tmp.subVectors(f.c, o.p0))));
      if (gap >= PART_CLEARANCE_M) continue;
      // overlap in the two axes with the least normal component
      const ax = (['x', 'y', 'z'] as const).filter((k) => Math.abs(f.n[k]) < 0.9);
      if (ax.every((k) => Math.min(f.max[k], o.max[k]) - Math.max(f.min[k], o.min[k]) > m)) return true;
    }
  }
  return false;
}

/** Mitered shell: every vertex moves so each face through it shifts by `off`
 * along its normal and shared corners stay shared (no cracks at box edges). */
function inflate(g: THREE.BufferGeometry, off: number): void {
  const pos = g.attributes.position;
  const key = (i: number) => `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`;
  const normals = new Map<string, THREE.Vector3[]>();
  const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let t = 0; t < pos.count; t += 3) {
    a.fromBufferAttribute(pos, t); b.fromBufferAttribute(pos, t + 1); c.fromBufferAttribute(pos, t + 2);
    const n = new THREE.Vector3().subVectors(b, a).cross(c.sub(a));
    if (n.lengthSq() < 1e-20) continue;
    n.normalize();
    for (let k = 0; k < 3; k++) {
      const list = normals.get(key(t + k)) ?? normals.set(key(t + k), []).get(key(t + k))!;
      if (!list.some((m) => m.dot(n) > 0.999)) list.push(n);
    }
  }
  const shift = new Map<string, THREE.Vector3>();
  for (const [k, list] of normals) {
    const m = list.reduce((s2, n) => s2.add(n), new THREE.Vector3()).normalize();
    const minDot = Math.min(...list.map((n) => m.dot(n)));
    shift.set(k, m.multiplyScalar(off / Math.max(minDot, 0.34)));
  }
  for (let i = 0; i < pos.count; i++) {
    const v = shift.get(key(i));
    if (v) pos.setXYZ(i, pos.getX(i) + v.x, pos.getY(i) + v.y, pos.getZ(i) + v.z);
  }
  pos.needsUpdate = true;
}

/** Blender families put several materials on the same plane (stair wall vs
 * treads, rack top vs frame, console screen vs body); merged per colour they
 * z-fight. Largest part first stays exact; every next part takes the
 * smallest outward offset (0, 1.5, 3 ... mm) that clears all parts placed
 * before it, so a detail always sits visibly in front of what it covers. */
function separateCoplanar(parts: Part[]): void {
  const area = (g: THREE.BufferGeometry) => {
    const p = g.attributes.position;
    const [a, b, c] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    let s = 0;
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
      s += b.sub(a).cross(c.sub(a)).length() / 2;
    }
    return s;
  };
  const order = parts.map((p, i) => ({ i, a: area(p.geo) })).sort((x, y) => y.a - x.a || x.i - y.i);
  const placed: { f: Face[]; box: THREE.Box3 }[] = [];
  for (const { i } of order) {
    const g = parts[i].geo;
    g.computeBoundingBox();
    // Only parts whose boxes touch can fight; most pairs are skipped here.
    const reach = g.boundingBox!.clone().expandByScalar(0.02);
    const near = placed.filter((p) => p.box.intersectsBox(reach));
    let used = 0;
    for (let step = 0; step <= 12; step++) {
      const trial = step === 0 ? g : g.clone();
      if (step) inflate(trial, step * PART_OFFSET_M);
      const f = faces(trial);
      if (step === 12 || !near.some((p) => fights(f, p.f))) {
        if (step) { g.setAttribute('position', trial.attributes.position); used = step; }
        g.computeBoundingBox();
        placed.push({ f, box: g.boundingBox!.clone() });
        break;
      }
    }
    parts[i].offsetSteps = used;
  }
}

export function kitParts(e: KitEntry): Part[] {
  return e.parts.map((p) => ({ ...p, geo: p.geo.clone() }));
}
