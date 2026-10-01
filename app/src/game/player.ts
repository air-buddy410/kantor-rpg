// CEO controller: camera-relative movement, grid collision with axis sliding
// (same navgrid the validator proves reachable), stuck recovery to the
// floor's safe waypoint.
import * as THREE from 'three';
import type { NavGrid } from '../world/navgrid';
import type { FloorId, Vec2 } from '../world/types';
import { Avatar } from './avatar';

// Chibi legs: native walk ~0.85 m/s; 1.6 m/s walk plays the clip at ~1.9x,
// which reads as brisk steps without visible sliding (timeScale follows speed).
export const WALK_SPEED = 1.6;
export const RUN_SPEED = 3.4;

export class Player {
  pos: Vec2;
  floor: FloorId;
  facing: number; // plan degrees
  speed = 0;
  readonly avatar: Avatar;
  stuckRecoveries = 0;

  constructor(pos: Vec2, floor: FloorId, facing: number) {
    this.pos = [pos[0], pos[1]];
    this.floor = floor;
    this.facing = facing;
    this.avatar = new Avatar('CEO', 0x1f4d3a);
    this.avatar.setFacing(facing);
  }

  /** Move by intent (plan direction, 0..1). Returns metres actually moved. */
  step(dt: number, dir: Vec2, run: boolean, nav: NavGrid): number {
    const mag = Math.hypot(dir[0], dir[1]);
    const target = mag > 0.05 ? (run ? RUN_SPEED : WALK_SPEED) * Math.min(1, mag) : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * 10);
    if (mag > 0.05) {
      const want = THREE.MathUtils.radToDeg(Math.atan2(dir[1], dir[0]));
      const diff = ((want - this.facing + 540) % 360) - 180;
      this.facing += diff * Math.min(1, dt * 14);
    }
    if (this.speed < 0.01 || mag < 0.05) {
      this.avatar.setFacing(this.facing);
      return 0;
    }
    const ux = dir[0] / mag;
    const uy = dir[1] / mag;
    const dist = this.speed * dt;
    // Sub-step so a fast frame cannot tunnel through a 0.15 m wall.
    const steps = Math.max(1, Math.ceil(dist / 0.05));
    let moved = 0;
    for (let s = 0; s < steps; s++) {
      const d = dist / steps;
      const nx = this.pos[0] + ux * d;
      const ny = this.pos[1] + uy * d;
      if (nav.walkableAt([nx, ny])) { this.pos = [nx, ny]; moved += d; continue; }
      if (nav.walkableAt([nx, this.pos[1]])) { this.pos = [nx, this.pos[1]]; moved += Math.abs(ux * d); continue; }
      if (nav.walkableAt([this.pos[0], ny])) { this.pos = [this.pos[0], ny]; moved += Math.abs(uy * d); continue; }
      break;
    }
    this.avatar.setFacing(this.facing);
    return moved;
  }

  /** If the current cell became blocked (layout change, floor switch), recover. */
  ensureWalkable(nav: NavGrid, safe: Vec2): boolean {
    if (nav.walkableAt(this.pos)) return false;
    const near = nav.nearestWalkable(this.pos, 1.5);
    this.pos = near ?? [safe[0], safe[1]];
    this.stuckRecoveries++;
    return true;
  }
}
