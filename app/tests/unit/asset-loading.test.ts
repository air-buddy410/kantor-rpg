import { afterEach, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadFurnitureKit } from '../../src/world/furniture-kit';

afterEach(() => vi.restoreAllMocks());

test('background furniture never floods the character downloads with more than four concurrent GLBs', async () => {
  const completions: Array<() => void> = [];
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(() => new Promise<GLTF>((resolve) => {
    completions.push(() => resolve({ scene: new THREE.Group(), animations: [] } as unknown as GLTF));
  }));
  const types = Array.from({ length: 12 }, (_, i) => `type-${i}`);
  const done = loadFurnitureKit(types);
  expect(completions).toHaveLength(4);
  while (completions.length) {
    const batch = completions.splice(0);
    batch.forEach((complete) => complete());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(completions.length).toBeLessThanOrEqual(4);
  }
  const result = await done;
  expect([...result.kit.keys()].sort()).toEqual(types.sort());
  expect(result.failed).toEqual([]);
});

test('one failed furniture GLB does not prevent the remaining queued types from loading', async () => {
  vi.spyOn(GLTFLoader.prototype, 'loadAsync').mockImplementation(async (url) => {
    if (url.endsWith('/bad.glb')) throw new Error('missing asset');
    return { scene: new THREE.Group(), animations: [] } as unknown as GLTF;
  });
  const result = await loadFurnitureKit(['a', 'b', 'bad', 'c', 'd', 'e']);
  expect(result.failed).toEqual(['bad']);
  expect([...result.kit.keys()].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
});
