import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import world from '@design/world.json';
import { kitEntryFromScene } from '../../src/world/furniture-kit';
import type { World } from '../../src/world/types';

const W = world as unknown as World;
// Node built-ins via a computed specifier: the app tsconfig has no Node types.
type Fs = { readFileSync(p: string): Uint8Array; readdirSync(p: string): string[] };
const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as Fs;
const DIR = new URL('../../public/assets/furniture/', import.meta.url).pathname;

function parse(buf: Uint8Array): Promise<THREE.Group> {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return new Promise((res, rej) => new GLTFLoader().parse(ab, '', (g) => res(g.scene), rej));
}

describe('furniture kit reads the shipped (quantized) GLBs at their real size (R2)', () => {
  const files = fs.readdirSync(DIR).filter((f: string) => f.endsWith('.glb'));
  it('covers every catalog family that ships a GLB', () => expect(files.length).toBeGreaterThanOrEqual(50));
  for (const f of files) {
    const type = f.replace(/\.glb$/, '');
    const cat = W.catalog[type];
    if (!cat) continue;
    it(`${type}: baked parts fit the catalog footprint within 5 cm`, async () => {
      const entry = kitEntryFromScene(await parse(fs.readFileSync(DIR + f)));
      const box = new THREE.Box3();
      for (const p of entry.parts) { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox!); }
      const size = box.getSize(new THREE.Vector3());
      // glTF is Y-up: x = catalog width, z = catalog depth, y = height (+ mount lift handled separately).
      expect(size.x, `${type} width`).toBeLessThanOrEqual(cat.size[0] + 0.05);
      expect(size.z, `${type} depth`).toBeLessThanOrEqual(cat.size[1] + 0.05);
      expect(size.y, `${type} height`).toBeLessThanOrEqual(cat.size[2] + 0.05);
      expect(Math.max(size.x, size.y, size.z), `${type} not collapsed`).toBeGreaterThan(0.05);
    });
  }
});
