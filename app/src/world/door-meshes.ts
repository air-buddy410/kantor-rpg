// Door leaf meshes: one InstancedMesh per floor and leaf colour, so all
// leaves of a floor cost at most two draw calls whatever their state.
import * as THREE from 'three';
import { toThree, WALL_HEIGHT_EXTERIOR, WALL_HEIGHT_INTERIOR, type MaterialCache } from './build';
import type { DoorController } from './doors';
import { ENV } from './palette';
import type { DoorLeaf, FloorId, World } from './types';

const LEAF_T = 0.04;

export class DoorMeshes {
  private meshes: { floor: FloorId; mesh: THREE.InstancedMesh; leaves: DoorLeaf[]; heights: number[] }[] = [];
  private last = new Map<string, number>();

  constructor(world: World, private doors: DoorController, materials: MaterialCache, groups: Map<FloorId, THREE.Group>) {
    const footprint = world.building.footprint;
    for (const f of world.floors) {
      const all = doors.leaves(f.id);
      for (const restricted of [false, true]) {
        const leaves = all.filter((l) => l.restricted === restricted);
        if (!leaves.length) continue;
        // Unit box spanning +x from the hinge; scaled per instance to the leaf
        // length and to the cutaway height of its wall (exterior or interior).
        const geo = new THREE.BoxGeometry(1, 1, LEAF_T);
        geo.translate(0.5, 0.5, 0);
        const mesh = new THREE.InstancedMesh(geo, materials.get(restricted ? ENV.accent : ENV.woodDark), leaves.length);
        mesh.name = `door-leaves-${f.id}${restricted ? '-restricted' : ''}`;
        mesh.frustumCulled = false;
        mesh.castShadow = false;
        const heights = leaves.map((l) => {
          const onEnvelope = l.hinge[0] <= 0.2 || l.hinge[1] <= 0.2 || l.hinge[0] >= footprint[0] - 0.2 || l.hinge[1] >= footprint[1] - 0.2;
          return (onEnvelope ? WALL_HEIGHT_EXTERIOR : WALL_HEIGHT_INTERIOR) - 0.05;
        });
        this.meshes.push({ floor: f.id, mesh, leaves, heights });
        groups.get(f.id)?.add(mesh);
      }
    }
    this.sync(world, true);
  }

  /** Re-pose leaves whose openness changed since the last frame. */
  sync(world: World, force = false): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const { floor, mesh, leaves, heights } of this.meshes) {
      const elev = world.floors.find((x) => x.id === floor)!.elevation;
      let dirty = force;
      leaves.forEach((leaf, k) => {
        const o = this.doors.openness(leaf.id);
        if (!force && this.last.get(leaf.id) === o) return;
        this.last.set(leaf.id, o);
        dirty = true;
        q.setFromAxisAngle(up, THREE.MathUtils.degToRad(this.doors.angle(leaf)));
        m.compose(toThree(leaf.hinge[0], leaf.hinge[1], elev + 0.02), q, new THREE.Vector3(leaf.length, heights[k], 1));
        mesh.setMatrixAt(k, m);
      });
      if (dirty) mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
