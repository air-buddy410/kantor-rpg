// 3/4 top-down follow camera. Yaw is user-controlled (drag, Q/Z); pitch and
// zoom are bounded so the floor cutaway stays readable.
import * as THREE from 'three';

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0; // radians; 0 = looking north (plan +Y)
  pitch = 1.0; // radians above horizon
  distance = 17;
  minDistance = 7;
  maxDistance = 32;
  private target = new THREE.Vector3();
  private drag: { id: number; x: number; y: number } | null = null;

  constructor(dom: HTMLElement, aspect: number) {
    this.camera = new THREE.PerspectiveCamera(38, aspect, 0.1, 200);
    dom.addEventListener('pointerdown', (e) => {
      // Touch on the left third belongs to the joystick area.
      if (e.pointerType === 'touch' && e.clientX < window.innerWidth * 0.4) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      this.yaw -= (e.clientX - this.drag.x) * 0.006;
      this.pitch = THREE.MathUtils.clamp(this.pitch + (e.clientY - this.drag.y) * 0.004, 0.55, 1.35);
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
    });
    const end = (e: PointerEvent) => { if (this.drag && e.pointerId === this.drag.id) this.drag = null; };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
    dom.addEventListener('wheel', (e) => { e.preventDefault(); this.zoom(e.deltaY > 0 ? 1.1 : 0.9); }, { passive: false });
  }

  zoom(f: number) { this.distance = THREE.MathUtils.clamp(this.distance * f, this.minDistance, this.maxDistance); }
  rotate(d: number) { this.yaw += d; }
  recenter(facingRad: number) { this.yaw = facingRad; this.pitch = 1.0; }

  /** Camera-space intent -> plan-space direction (x east, y north). */
  planDirection(ix: number, iy: number): [number, number] {
    const fx = Math.sin(this.yaw);
    const fy = Math.cos(this.yaw);
    return [ix * fy + iy * fx, -ix * fx + iy * fy];
  }

  update(focus: THREE.Vector3, dt: number, snap = false) {
    const k = snap ? 1 : 1 - Math.exp(-dt * 8);
    this.target.lerp(focus, k);
    // Portrait screens have a narrow horizontal FOV; pull back so a room still fits.
    const dist = this.distance * (this.camera.aspect < 1 ? 1 + 0.6 * (1 - this.camera.aspect) : 1);
    const horiz = Math.cos(this.pitch) * dist;
    // plan forward (sin yaw, cos yaw) -> three (sin, 0, -cos); camera sits behind.
    const off = new THREE.Vector3(-Math.sin(this.yaw) * horiz, Math.sin(this.pitch) * dist, Math.cos(this.yaw) * horiz);
    this.camera.position.copy(this.target).add(off);
    this.camera.lookAt(this.target.x, this.target.y + 0.8, this.target.z);
  }

  resize(aspect: number) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
}
