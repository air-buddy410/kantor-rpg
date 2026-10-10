// Z-fighting detector: finds same-facing triangle pairs from different meshes
// (= different material/colour, since the batcher merges per material) that lie
// on the same plane within `gap` metres and overlap by more than `minArea` m².
// Opposite-facing pairs are skipped: front-side materials cull one of them.
import * as THREE from 'three';

export interface CoplanarHit { a: string; b: string; normal: [number, number, number]; planeD: number; gapM: number; areaM2: number; at: [number, number, number] }

interface Tri { mesh: number; p: THREE.Vector3[]; n: THREE.Vector3; d: number; min: THREE.Vector3; max: THREE.Vector3; twoSided: boolean }

function triangles(root: THREE.Object3D, names: string[]): Tri[] {
  root.updateMatrixWorld(true);
  const out: Tri[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !o.visible) return;
    const mat = mesh.material as THREE.Material & { color?: THREE.Color; transparent: boolean };
    const baseId = names.length;
    names.push(`${o.name || o.parent?.name || 'mesh'}#${mat.color?.getHexString() ?? '?'}${mat.transparent ? '/glass' : ''}${mat.side !== THREE.FrontSide ? '/2side' : ''}`);
    const g = mesh.geometry;
    const pos = g.attributes.position;
    const idx = g.index;
    const n = idx ? idx.count : pos.count;
    const twoSided = mat.side !== THREE.FrontSide;
    // Instanced meshes (door leaves): every instance is a separate object.
    const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh) : null;
    const mats = inst ? Array.from({ length: inst.count }, (_, k) => { const m = new THREE.Matrix4(); inst.getMatrixAt(k, m); return m.premultiply(mesh.matrixWorld); }) : [mesh.matrixWorld];
    mats.forEach((mw, k) => {
      const id = k === 0 ? baseId : names.push(`${names[baseId]}[${k}]`) - 1;
      for (let i = 0; i < n; i += 3) {
        const p = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i + j) : i + j).applyMatrix4(mw));
        const nrm = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0]));
        const len = nrm.length();
        if (len < 1e-9) continue; // degenerate
        nrm.divideScalar(len);
        out.push({ mesh: id, p, n: nrm, d: nrm.dot(p[0]), min: p[0].clone().min(p[1]).min(p[2]), max: p[0].clone().max(p[1]).max(p[2]), twoSided });
      }
    });
  });
  return out;
}

/** Area of the intersection of two coplanar triangles (2D clip on the dominant plane). */
function overlapArea(a: Tri, b: Tri): number {
  const ax = Math.abs(a.n.x), ay = Math.abs(a.n.y), az = Math.abs(a.n.z);
  const [u, v] = ax >= ay && ax >= az ? ['y', 'z'] : ay >= az ? ['x', 'z'] : ['x', 'y'];
  const scale = 1 / Math.max(ax, ay, az); // projected area -> true area
  const P = (t: Tri) => t.p.map((q) => [q[u as 'x'], q[v as 'x']] as [number, number]);
  const ccw = (poly: [number, number][]) => {
    const s = (poly[1][0] - poly[0][0]) * (poly[2][1] - poly[0][1]) - (poly[1][1] - poly[0][1]) * (poly[2][0] - poly[0][0]);
    return s < 0 ? poly.reverse() : poly;
  };
  let poly = ccw(P(a));
  const clip = ccw(P(b));
  for (let i = 0; i < 3 && poly.length; i++) {
    const [c0, c1] = [clip[i], clip[(i + 1) % 3]];
    const inside = (q: [number, number]) => (c1[0] - c0[0]) * (q[1] - c0[1]) - (c1[1] - c0[1]) * (q[0] - c0[0]) >= -1e-12;
    const next: [number, number][] = [];
    for (let k = 0; k < poly.length; k++) {
      const s = poly[k], e = poly[(k + 1) % poly.length];
      const si = inside(s), ei = inside(e);
      if (si) next.push(s);
      if (si !== ei) {
        const dx = e[0] - s[0], dy = e[1] - s[1];
        const den = (c1[0] - c0[0]) * dy - (c1[1] - c0[1]) * dx;
        const t = den === 0 ? 0 : ((c1[1] - c0[1]) * (s[0] - c0[0]) - (c1[0] - c0[0]) * (s[1] - c0[1])) / den;
        next.push([s[0] + t * dx, s[1] + t * dy]);
      }
    }
    poly = next;
  }
  let area = 0;
  for (let k = 0; k < poly.length; k++) { const [p, q] = [poly[k], poly[(k + 1) % poly.length]]; area += p[0] * q[1] - q[0] * p[1]; }
  return (Math.abs(area) / 2) * scale;
}

export function scanCoplanar(root: THREE.Object3D, gap = 0.001, minArea = 1e-4): { triangles: number; meshes: string[]; hits: CoplanarHit[] } {
  const names: string[] = [];
  const tris = triangles(root, names);
  // Bucket by quantised normal and plane offset; neighbouring offset bins are checked too.
  const bins = new Map<string, Tri[]>();
  // Canonical orientation so opposite-facing faces share a bucket; they only
  // count when one side is double-sided (front-side materials cull one of them).
  const flip = (t: Tri) => t.n.x < -1e-6 || (Math.abs(t.n.x) <= 1e-6 && (t.n.y < -1e-6 || (Math.abs(t.n.y) <= 1e-6 && t.n.z < 0)));
  const nq = (t: Tri) => { const s2 = flip(t) ? -1 : 1; return [Math.round(s2 * t.n.x * 20), Math.round(s2 * t.n.y * 20), Math.round(s2 * t.n.z * 20)]; };
  const nk = (t: Tri) => nq(t).join();
  // Plane offsets of tiny triangles far from the origin carry mm-level error
  // (normal error x lever arm), so buckets are coarse and the real gap is
  // measured locally below (centroid of one face to the other's plane).
  const cell = Math.max(gap, 0.01);
  const bin = (t: Tri) => Math.floor((flip(t) ? -t.d : t.d) / cell);
  for (const t of tris) {
    const k = `${nk(t)}|${bin(t)}`;
    (bins.get(k) ?? bins.set(k, []).get(k)!).push(t);
  }
  const seen = new Map<string, CoplanarHit>();
  for (const t of tris) {
    // Neighbouring normal and offset buckets too: rounding edges must not hide a pair.
    const [x, y, z] = nq(t);
    const lists: Tri[][] = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) for (const off of [-1, 0, 1]) {
      const l = bins.get(`${x + i},${y + j},${z + k}|${bin(t) + off}`);
      if (l) lists.push(l);
    }
    for (const list of lists) {
      for (const o of list) {
        if (o.mesh <= t.mesh) continue; // each unordered pair once, other meshes only
        const dot = t.n.dot(o.n);
        if (dot < 0.9999 && !(dot < -0.9999 && (t.twoSided || o.twoSided))) continue;
        const oc = o.p[0].clone().add(o.p[1]).add(o.p[2]).divideScalar(3);
        const tc = t.p[0].clone().add(t.p[1]).add(t.p[2]).divideScalar(3);
        const g = Math.max(Math.abs(t.n.dot(oc.sub(t.p[0]))), Math.abs(o.n.dot(tc.sub(o.p[0]))));
        if (g >= gap) continue;
        if (t.max.x < o.min.x - 1e-4 || o.max.x < t.min.x - 1e-4 || t.max.y < o.min.y - 1e-4 || o.max.y < t.min.y - 1e-4 || t.max.z < o.min.z - 1e-4 || o.max.z < t.min.z - 1e-4) continue;
        const area = overlapArea(t, o);
        if (area < 1e-7) continue;
        const [a, b] = [names[t.mesh], names[o.mesh]].sort();
        const key = `${a}|${b}|${nk(t)}|${t.d.toFixed(3)}`;
        const prev = seen.get(key);
        if (prev) { prev.areaM2 += area; continue; }
        const c = t.p[0].clone().add(t.p[1]).add(t.p[2]).divideScalar(3);
        seen.set(key, { a, b, normal: [t.n.x, t.n.y, t.n.z].map((x) => +x.toFixed(3)) as [number, number, number], planeD: +t.d.toFixed(4), gapM: +g.toFixed(5), areaM2: area, at: [c.x, c.y, c.z].map((x) => +x.toFixed(2)) as [number, number, number] });
      }
    }
  }
  const hits = [...seen.values()].filter((h) => h.areaM2 >= minArea).map((h) => ({ ...h, areaM2: +h.areaM2.toFixed(5) }));
  hits.sort((x, y) => y.areaM2 - x.areaM2);
  return { triangles: tris.length, meshes: names, hits };
}
