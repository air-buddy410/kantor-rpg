// Character wrapper: GLB from the Blender pipeline when present, otherwise an
// honest labelled placeholder (REQ-CHAR-01 failure path). Facing uses plan
// degrees (0 = east, 90 = north); glTF characters face +Z.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const cache = new Map<string, Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] } | null>>();

export function loadCharacter(url: string): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] } | null> {
  let p = cache.get(url);
  if (!p) {
    p = new GLTFLoader().loadAsync(url).then((g) => ({ scene: g.scene, animations: g.animations })).catch((err) => {
      console.warn(`character asset missing or invalid: ${url}`, err);
      return null;
    });
    cache.set(url, p);
  }
  return p;
}

export class Avatar {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current = '';
  private body: THREE.Object3D | null = null;
  private t = 0;
  isPlaceholder = true;
  clipNames: string[] = [];
  /** Native locomotion speeds baked by the Blender pipeline (rig extras). */
  walkNative = 0.85;
  runNative = 2.4;
  defaultHair: string | null = null;

  constructor(readonly label: string, color = 0x1f4d3a) {
    this.root.name = `avatar-${label}`;
    this.body = placeholder(color);
    this.root.add(this.body);
  }

  async load(url: string): Promise<boolean> {
    const asset = await loadCharacter(url);
    if (!asset) return false;
    const model = cloneSkinned(asset.scene) as THREE.Group;
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; }
    });
    if (this.body) this.root.remove(this.body);
    this.body = model;
    model.traverse((o) => {
      const x = o.userData as Record<string, unknown>;
      if (typeof x.kantor_walk_native_speed_mps === 'number') this.walkNative = x.kantor_walk_native_speed_mps;
      if (typeof x.kantor_run_native_speed_mps === 'number') this.runNative = x.kantor_run_native_speed_mps;
      if (typeof x.kantor_default_hair === 'string') this.defaultHair = x.kantor_default_hair.replace(/^hair_/, '');
    });
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    this.actions.clear();
    for (const clip of asset.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.clipNames = [...this.actions.keys()];
    this.isPlaceholder = false;
    // Variant GLBs ship every hair style; exactly one may be visible.
    if (this.defaultHair) this.applyVariant(this.defaultHair, null);
    const prev = this.current;
    this.current = '';
    this.play(prev || 'idle');
    return true;
  }

  get model(): THREE.Object3D | null { return this.body; }

  has(name: string): boolean { return this.actions.has(name); }

  play(name: string, fade = 0.2): void {
    if (name === this.current) return;
    const next = this.actions.get(name) ?? this.actions.get('idle');
    const prev = this.actions.get(this.current);
    this.current = name;
    if (!next) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (prev && prev !== next) prev.fadeOut(fade);
  }

  setFacing(deg: number): void { this.root.rotation.y = THREE.MathUtils.degToRad(deg) + Math.PI / 2; }

  /** Match stride to ground speed so feet do not slide (m/s). */
  setGroundSpeed(speed: number): void {
    const walk = this.actions.get('walk');
    const run = this.actions.get('run');
    if (walk) walk.timeScale = THREE.MathUtils.clamp(speed / this.walkNative, 0.5, 2.6);
    if (run) run.timeScale = THREE.MathUtils.clamp(speed / this.runNative, 0.6, 2.0);
  }

  update(dt: number, moving: number, reducedMotion: boolean): void {
    this.t += dt;
    if (this.mixer) {
      this.mixer.update(dt);
    } else if (this.body) {
      // Placeholder bob so locomotion still reads; disabled under reduced motion.
      this.body.position.y = reducedMotion ? 0 : Math.abs(Math.sin(this.t * 9)) * 0.05 * moving;
    }
  }

  /** Show only the named hair node and recolour palette materials (Avatar Studio). */
  applyVariant(hair: string | null, palette: Record<string, string> | null): void {
    if (!this.body) return;
    this.body.traverse((o) => {
      if (hair && o.name.startsWith('hair_')) o.visible = o.name === `hair_${hair}` || o.name.startsWith(`hair_${hair}.`) || o.name.startsWith(`hair_${hair}_`);
      const mesh = o as THREE.Mesh;
      if (palette && mesh.isMesh) {
        const swap = (m: THREE.Material): THREE.Material => {
          const key = m.userData.paletteKey ?? m.name.replace(/\.\d+$/, '');
          const std = m as THREE.MeshStandardMaterial;
          if (!palette[key] || !std.color) return m;
          const c = std.clone();
          c.userData.paletteKey = key;
          c.color.set(palette[key]);
          return c;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
      }
    });
  }
}

function placeholder(color: number): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'placeholder';
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xe9c9a5, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.5, 6, 12), mat);
  body.position.y = 0.48;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 14), skin);
  head.position.y = 1.08;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), mat);
  nose.position.set(0, 1.08, 0.24); // marks facing (+Z)
  g.add(body, head, nose);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return g;
}
