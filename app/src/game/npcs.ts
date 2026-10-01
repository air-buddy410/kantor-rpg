// Renders IdleSim NPCs with their Blender GLBs and maps activity -> clip.
// The sim runs on a fixed 0.1 s step; rendering interpolates positions.
import * as THREE from 'three';
import { IdleSim, type NpcState } from '../sim/idle';
import type { NavGrid } from '../world/navgrid';
import { toThree } from '../world/build';
import type { FloorId, World } from '../world/types';
import { Avatar } from './avatar';

export const ACTIVITY_LABEL: Record<string, string> = {
  desk: 'di meja kerja', coffee: 'bikin kopi', chat: 'ngobrol', read: 'membaca', stretch: 'peregangan', game: 'main game',
  billiards: 'main biliar', exercise: 'olahraga', rest: 'istirahat', walk: 'berjalan', idle: 'santai', talk: 'bicara dengan CEO',
};

const STEP = 0.1;

interface View { avatar: Avatar; prev: THREE.Vector3; next: THREE.Vector3; label: HTMLElement; floor: FloorId }

export class NpcLayer {
  readonly sim: IdleSim;
  readonly group = new THREE.Group();
  private views = new Map<string, View>();
  private acc = 0;

  constructor(private world: World, nav: Record<FloorId, NavGrid>, seed: number, labelHost: HTMLElement) {
    this.sim = new IdleSim(world, nav, { seed, startHour: 8.75, minutesPerSecond: 1 });
    this.group.name = 'npcs';
    // Own layer: room labels are rebuilt on floor change and must not wipe these.
    const host = document.createElement('div');
    host.className = 'labels npc-labels';
    host.setAttribute('aria-hidden', 'true');
    labelHost.after(host);
    for (const npc of this.sim.npcs) {
      const actor = world.actors.find((a) => a.id === npc.id)!;
      const avatar = new Avatar(npc.name, 0x6f8fa6);
      void avatar.load(`assets/characters/${actor.avatarAsset.toLowerCase()}.glb`);
      const p = this.worldPos(npc);
      avatar.root.position.copy(p);
      const label = document.createElement('div');
      label.className = 'npc-label';
      label.setAttribute('aria-hidden', 'true');
      host.append(label);
      this.views.set(npc.id, { avatar, prev: p.clone(), next: p.clone(), label, floor: npc.floor });
      this.group.add(avatar.root);
    }
  }

  private worldPos(npc: NpcState): THREE.Vector3 {
    const elev = this.world.floors.find((f) => f.id === npc.floor)!.elevation;
    let [x, y] = npc.pos;
    if (npc.phase === 'perform' && npc.slot) {
      // Seated activities sit on the chair itself, not on the approach cell.
      const slot = this.world.activitySlots.find((s) => s.id === npc.slot)!;
      if (slot.pose === 'sit') [x, y] = slot.pos;
    }
    return toThree(x, y, elev);
  }

  clipFor(npc: NpcState): string {
    if (npc.phase === 'travel' || npc.phase === 'recover') return 'walk';
    if (npc.phase === 'paused') return 'talk';
    if (npc.phase !== 'perform') return 'idle';
    const slot = npc.slot ? this.world.activitySlots.find((s) => s.id === npc.slot) : undefined;
    const sit = slot?.pose === 'sit';
    switch (npc.activity) {
      case 'desk': return 'type';
      case 'coffee': return 'coffee';
      case 'chat': return sit ? 'sit' : 'talk';
      case 'read': return sit ? 'sit' : 'read';
      case 'rest': return 'sit';
      case 'game': return sit ? 'game' : 'talk';
      default: return npc.activity;
    }
  }

  update(dt: number, playerFloor: FloorId, camera: THREE.Camera, w: number, h: number, reducedMotion: boolean): void {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 5) {
      for (const v of this.views.values()) v.prev.copy(v.next);
      this.sim.step(STEP);
      for (const npc of this.sim.npcs) {
        const v = this.views.get(npc.id)!;
        const p = this.worldPos(npc);
        // Floor change or sit snap: no interpolation across the jump.
        if (v.floor !== npc.floor || p.distanceTo(v.next) > 1.5) v.prev.copy(p);
        v.next.copy(p);
        v.floor = npc.floor;
      }
      this.acc -= STEP;
      steps++;
    }
    if (steps === 5) this.acc = 0; // drop backlog after a long stall instead of fast-forwarding
    const t = this.acc / STEP;
    for (const npc of this.sim.npcs) {
      const v = this.views.get(npc.id)!;
      const visible = npc.floor === playerFloor;
      v.avatar.root.visible = visible;
      v.avatar.root.position.lerpVectors(v.prev, v.next, t);
      v.avatar.setFacing(npc.facing);
      v.avatar.play(this.clipFor(npc));
      v.avatar.update(dt, npc.phase === 'travel' ? 1 : 0, reducedMotion);
      if (!visible) { v.label.style.opacity = '0'; continue; }
      const s = v.avatar.root.position.clone().add(new THREE.Vector3(0, 1.9, 0)).project(camera);
      const on = s.z < 1 && Math.abs(s.x) < 1.05 && Math.abs(s.y) < 1.05;
      v.label.style.opacity = on ? '1' : '0';
      if (on) {
        v.label.textContent = `${npc.name} · ${ACTIVITY_LABEL[npc.activity] ?? npc.activity}`;
        v.label.style.transform = `translate(-50%, -100%) translate(${((s.x + 1) / 2) * w}px, ${((1 - s.y) / 2) * h}px)`;
      }
    }
  }

  nearest(floor: FloorId, pos: [number, number], radius: number): NpcState | null {
    let best: NpcState | null = null;
    let bd = radius;
    for (const npc of this.sim.npcs) {
      if (npc.floor !== floor) continue;
      const d = Math.hypot(npc.pos[0] - pos[0], npc.pos[1] - pos[1]);
      if (d <= bd) { bd = d; best = npc; }
    }
    return best;
  }

  faceTowards(id: string, pos: [number, number]): void {
    const npc = this.sim.npcs.find((n) => n.id === id);
    if (npc) npc.facing = (Math.atan2(pos[1] - npc.pos[1], pos[0] - npc.pos[0]) * 180) / Math.PI;
  }
}
