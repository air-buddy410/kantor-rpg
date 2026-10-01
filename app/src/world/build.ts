// Builds one THREE.Group per floor from world.json + derived walls. Static
// parts are merged per material so a floor costs a few dozen draw calls
// instead of one per furniture part.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildFixture, type Part } from './furniture';
import { CATEGORY_TINT, ENV, FINISH_COLOR } from './palette';
import type { DerivedWalls, Fixture, FloorId, World } from './types';

export const WALL_HEIGHT_INTERIOR = 1.25; // cutaway height so the 3/4 camera sees into rooms
export const WALL_HEIGHT_EXTERIOR = 1.55;

/** world plan (x, y, z-up) -> three (x, y-up, z) */
export function toThree(x: number, y: number, z = 0): THREE.Vector3 {
  return new THREE.Vector3(x, z, -y);
}

class Batcher {
  private buckets = new Map<string, { color: number; emissive: boolean; glass: boolean; occluder: boolean; geos: THREE.BufferGeometry[] }>();

  add(geo: THREE.BufferGeometry, color: number, matrix: THREE.Matrix4, opts: { emissive?: boolean; glass?: boolean; occluder?: boolean } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(matrix);
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    const key = `${color}|${opts.emissive ? 1 : 0}|${opts.glass ? 1 : 0}|${opts.occluder ? 1 : 0}`;
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = { color, emissive: !!opts.emissive, glass: !!opts.glass, occluder: !!opts.occluder, geos: [] }));
    b.geos.push(g);
    if (g !== geo) geo.dispose();
  }

  build(materials: MaterialCache, group: THREE.Group, castShadow: boolean) {
    for (const b of this.buckets.values()) {
      const merged = mergeGeometries(b.geos, false);
      b.geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, b.occluder ? materials.occluder(b.color) : materials.get(b.color, b.emissive, b.glass));
      mesh.castShadow = castShadow && !b.glass;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    this.buckets.clear();
  }
}

export class MaterialCache {
  private cache = new Map<string, THREE.Material>();
  constructor(private lowQuality: boolean) {}
  get(color: number, emissive = false, glass = false): THREE.Material {
    const key = `${color}|${emissive}|${glass}`;
    let m = this.cache.get(key);
    if (!m) {
      if (this.lowQuality) {
        m = new THREE.MeshLambertMaterial({ color, emissive: emissive ? color : 0x000000, emissiveIntensity: emissive ? 0.5 : 0, transparent: glass, opacity: glass ? 0.35 : 1 });
      } else {
        m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, emissive: emissive ? color : 0x000000, emissiveIntensity: emissive ? 0.45 : 0, transparent: glass, opacity: glass ? 0.35 : 1 });
      }
      this.cache.set(key, m);
    }
    return m;
  }
  /** Uniforms shared by every occluder material; the game updates them per frame. */
  readonly cutaway = { uPlayer: { value: new THREE.Vector3() }, uCamera: { value: new THREE.Vector3() }, uRadius: { value: 1.6 } };

  /** Wall material that discards fragments inside a capsule between camera
   * and avatar, so walls never hide the CEO (PRD 7 occlusion fade). */
  occluder(color: number): THREE.Material {
    const key = `occ|${color}`;
    let m = this.cache.get(key);
    if (!m) {
      const mat = this.lowQuality ? new THREE.MeshLambertMaterial({ color }) : new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 });
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, this.cutaway);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vCutWorld;')
          .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCutWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vCutWorld;\nuniform vec3 uPlayer;\nuniform vec3 uCamera;\nuniform float uRadius;')
          .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  vec3 seg = uPlayer - uCamera;
  float t = clamp(dot(vCutWorld - uCamera, seg) / dot(seg, seg), 0.0, 1.0);
  float d = length(vCutWorld - (uCamera + seg * t));
  if (t < 0.97 && d < uRadius * t) discard;`);
      };
      mat.customProgramCacheKey = () => `occ-${this.lowQuality}`;
      m = mat;
      this.cache.set(key, m);
    }
    return m;
  }

  dispose() { this.cache.forEach((m) => m.dispose()); this.cache.clear(); }
}

export interface FloorBuild { group: THREE.Group; fixtureGroup: THREE.Group; elevation: number; triangles: number }

function fixtureMatrix(fx: Fixture, elevation: number): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  m.compose(toThree(fx.pos[0], fx.pos[1], elevation), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (fx.rot * Math.PI) / 180), new THREE.Vector3(1, 1, 1));
  return m;
}

const textureLoader = new THREE.TextureLoader();
const artCache = new Map<string, THREE.MeshLambertMaterial>();

/** Front face of artwork-bearing fixtures, in the fixture's local frame (see furniture.ts panel()). */
function artworkFace(fx: Fixture): { w: number; h: number; y: number; z: number } | null {
  const [w, d, h] = fx.size;
  if (fx.type === 'poster') return { w: w * 0.88, h: h * 0.84, y: 1.2 + h * 0.08 + (h * 0.84) / 2, z: d / 2 + 0.02 };
  if (fx.type === 'gallery_panel') { const ph = h - 0.15; return { w: w * 0.88, h: ph * 0.84, y: 0.12 + ph * 0.08 + (ph * 0.84) / 2, z: (d * 0.4) / 2 + 0.02 }; }
  return null;
}

/** Generated original artwork (tools/make_signage.py) as textured planes; a
 * missing image removes the plane so the procedural composition shows. */
function addArtwork(fixtures: Fixture[], floor: FloorId, elevation: number, group: THREE.Group) {
  for (const fx of fixtures) {
    if (fx.floor !== floor || !fx.artwork) continue;
    const face = artworkFace(fx);
    if (!face) continue;
    let mat = artCache.get(fx.artwork);
    if (!mat) {
      mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      const m = mat;
      textureLoader.load(`assets/signage/${fx.artwork}.jpg`, (t) => { t.colorSpace = THREE.SRGBColorSpace; m.map = t; m.needsUpdate = true; }, undefined, () => {
        group.traverse((o) => { if ((o as THREE.Mesh).material === m) o.visible = false; });
      });
      artCache.set(fx.artwork, mat);
    }
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(face.w, face.h), mat);
    plane.position.set(0, face.y, face.z);
    const holder = new THREE.Group();
    holder.applyMatrix4(fixtureMatrix(fx, elevation));
    holder.add(plane);
    holder.name = `art-${fx.id}`;
    group.add(holder);
  }
}

export function buildFixturesInto(fixtures: Fixture[], floor: FloorId, elevation: number, materials: MaterialCache, group: THREE.Group, castShadow: boolean) {
  addArtwork(fixtures, floor, elevation, group);
  const batch = new Batcher();
  for (const fx of fixtures) {
    if (fx.floor !== floor) continue;
    let parts: Part[];
    if (fx.type === 'stair_u' && floor === 'L2') parts = stairVoid(fx);
    else parts = buildFixture(fx);
    const m = fixtureMatrix(fx, elevation);
    for (const p of parts) batch.add(p.geo, p.color, m, p);
  }
  batch.build(materials, group, castShadow);
}

function stairVoid(fx: Fixture): Part[] {
  // Upper floor shows the stair well: dark void, railings and the top landing.
  const [w, d] = fx.size;
  const parts: Part[] = [];
  const voidGeo = new THREE.BoxGeometry(w - 0.1, 0.02, d - 1.6);
  voidGeo.translate(0, 0.02, 0.8 - 0.05);
  parts.push({ geo: voidGeo, color: 0x3a3229 });
  const rail = (len: number, x: number, z: number, alongZ: boolean) => {
    const g = new THREE.BoxGeometry(alongZ ? 0.05 : len, 0.05, alongZ ? len : 0.05);
    g.translate(x, 1.0, z);
    parts.push({ geo: g, color: ENV.woodDark });
    const posts = Math.max(2, Math.round(len / 0.6));
    for (let k = 0; k <= posts; k++) {
      const t = -len / 2 + (k * len) / posts;
      const p = new THREE.BoxGeometry(0.04, 1.0, 0.04);
      p.translate(alongZ ? x : x + t, 0.5, alongZ ? z + t : z);
      parts.push({ geo: p, color: ENV.metal });
    }
  };
  rail(d - 1.6, -w / 2 + 0.05, 0.75, true);
  rail(w - 0.1, 0, -d / 2 + 1.55, false);
  return parts;
}

export function buildFloor(world: World, walls: DerivedWalls, floor: FloorId, materials: MaterialCache, castShadow: boolean, fixtures = world.fixtures): FloorBuild {
  const fl = world.floors.find((f) => f.id === floor)!;
  const elev = fl.elevation;
  const group = new THREE.Group();
  group.name = `floor-${floor}`;
  const batch = new Batcher();
  const id = new THREE.Matrix4();
  // Slab under the whole envelope, then one finish plate per room.
  const env = fl.envelope;
  const [W, D] = [Math.max(...env.map((p) => p[0])), Math.max(...env.map((p) => p[1]))];
  const slab = new THREE.BoxGeometry(W + 0.3, 0.3, D + 0.3);
  slab.translate(W / 2, elev - 0.15, -D / 2);
  batch.add(slab, ENV.slab, id);
  for (const room of world.rooms) {
    if (room.floor !== floor) continue;
    const shape = new THREE.Shape(room.polygon.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2); // plan (x, y) -> three (x, -y) on the XZ plane
    geo.translate(0, elev + 0.005, 0);
    const color = CATEGORY_TINT[room.category] ?? FINISH_COLOR[room.finish.floor] ?? 0xd8c8ab;
    batch.add(geo, color, id);
  }
  for (const wall of walls.floors[floor].walls) {
    const t = wall.thickness;
    const len = wall.to - wall.from + t;
    const hgt = wall.exterior ? WALL_HEIGHT_EXTERIOR : WALL_HEIGHT_INTERIOR;
    const mid = (wall.from + wall.to) / 2;
    const geo = new THREE.BoxGeometry(wall.axis === 'x' ? len : t, hgt, wall.axis === 'x' ? t : len);
    const [cx, cy] = wall.axis === 'x' ? [mid, wall.at] : [wall.at, mid];
    geo.translate(cx, elev + hgt / 2, -cy);
    batch.add(geo, wall.exterior ? ENV.wallExterior : ENV.wallInterior, id, { occluder: true });
    const cap = new THREE.BoxGeometry(wall.axis === 'x' ? len : t + 0.02, 0.05, wall.axis === 'x' ? t + 0.02 : len);
    cap.translate(cx, elev + hgt + 0.025, -cy);
    batch.add(cap, ENV.wallCap, id, { occluder: true });
  }
  for (const op of walls.floors[floor].openings) {
    // Threshold strip marks every doorway; restricted doors get a closed leaf.
    const len = op.to - op.from;
    const mid = (op.from + op.to) / 2;
    const [cx, cy] = op.axis === 'x' ? [mid, op.at] : [op.at, mid];
    const th = new THREE.BoxGeometry(op.axis === 'x' ? len : 0.32, 0.012, op.axis === 'x' ? 0.32 : len);
    th.translate(cx, elev + 0.012, -cy);
    batch.add(th, op.access === 'restricted' ? ENV.accent : ENV.woodDark, id);
    if (op.exit) {
      const sign = new THREE.BoxGeometry(op.axis === 'x' ? 0.5 : 0.06, 0.18, op.axis === 'x' ? 0.06 : 0.5);
      sign.translate(cx, elev + WALL_HEIGHT_EXTERIOR + 0.25, -cy);
      batch.add(sign, ENV.fabricGreen, id, { emissive: true });
    }
  }
  if (floor === 'L1') {
    const ground = new THREE.PlaneGeometry(W + 30, D + 30);
    ground.rotateX(-Math.PI / 2);
    ground.translate(W / 2, -0.31, -D / 2);
    batch.add(ground, ENV.ground, id);
  }
  batch.build(materials, group, castShadow);
  const fixtureGroup = new THREE.Group();
  fixtureGroup.name = `fixtures-${floor}`;
  buildFixturesInto(fixtures, floor, elev, materials, fixtureGroup, castShadow);
  group.add(fixtureGroup);
  let triangles = 0;
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      const g = mesh.geometry as THREE.BufferGeometry;
      triangles += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });
  return { group, fixtureGroup, elevation: elev, triangles };
}
