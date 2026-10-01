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

interface AtlasSpec { size: number; cell: number; zones: Record<string, [number, number]> }

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
  /** Palette atlas contract from the GLB extras (kantor_atlas): zone -> [col, row] cell. */
  private atlas: AtlasSpec | null = null;
  private hair: string | null = null;
  private lod: 0 | 1 = 0;
  private lod1: THREE.Object3D | null = null;
  private face: THREE.Mesh | null = null;
  private nextBlink = 2 + Math.random() * 3;
  talking = false;

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
      if (x.kantor_atlas && typeof x.kantor_atlas === 'object') this.atlas = x.kantor_atlas as AtlasSpec;
      if (o.name === 'lod1') this.lod1 = o;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.morphTargetDictionary && 'blink' in mesh.morphTargetDictionary) this.face = mesh;
    });
    if (!this.atlas) {
      const sx = asset.scene.userData as Record<string, unknown>;
      if (sx.kantor_atlas && typeof sx.kantor_atlas === 'object') this.atlas = sx.kantor_atlas as AtlasSpec;
    }
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

  /** Distance LOD: LOD1 (one skinned mesh, <=5k tris, default hair baked in) replaces body + hair. */
  setLod(level: 0 | 1): void {
    if (!this.lod1 || level === this.lod) return;
    this.lod = level;
    this.refreshVisibility();
  }

  get lodLevel(): 0 | 1 { return this.lod; }

  private refreshVisibility(): void {
    if (!this.body) return;
    const far = this.lod === 1 && !!this.lod1;
    for (const o of this.body.children.length ? collect(this.body) : []) {
      if (o === this.lod1) o.visible = far;
      // LOD1 bakes body, default hair and the held prop into one mesh.
      else if (o.name === 'body' || o.name.startsWith('prop_')) o.visible = !far;
      else if (o.name.startsWith('hair_')) o.visible = !far && !!this.hair && (o.name === `hair_${this.hair}` || o.name.startsWith(`hair_${this.hair}.`) || o.name.startsWith(`hair_${this.hair}_`));
    }
  }

  /** Expression weight 0..1 on the face morph targets (blink, smile, talk, surprised, frown). */
  setExpression(name: string, weight: number): void {
    const f = this.face;
    const k = f?.morphTargetDictionary?.[name];
    if (f && k !== undefined && f.morphTargetInfluences) f.morphTargetInfluences[k] = weight;
  }

  /** Current morph weights (tests, debug). Empty for placeholders and pre-atlas GLBs. */
  expressions(): Record<string, number> {
    const f = this.face;
    if (!f?.morphTargetDictionary || !f.morphTargetInfluences) return {};
    return Object.fromEntries(Object.entries(f.morphTargetDictionary).map(([k, i]) => [k, f.morphTargetInfluences![i]]));
  }

  update(dt: number, moving: number, reducedMotion: boolean): void {
    this.t += dt;
    if (this.face) {
      // Blink every few seconds; talking flaps the mouth with a smile. Both
      // stop under reduced motion (a held neutral face is the calm default).
      if (!reducedMotion && this.t >= this.nextBlink) {
        const k = (this.t - this.nextBlink) / 0.14;
        this.setExpression('blink', k < 1 ? Math.sin(k * Math.PI) : 0);
        if (k >= 1) this.nextBlink = this.t + 2.5 + Math.random() * 3.5;
      }
      this.setExpression('talk', this.talking && !reducedMotion ? 0.35 + 0.35 * Math.sin(this.t * 14) : 0);
      this.setExpression('smile', this.talking ? 0.5 : 0);
    }
    if (this.mixer) {
      this.mixer.update(dt);
    } else if (this.body) {
      // Placeholder bob so locomotion still reads; disabled under reduced motion.
      this.body.position.y = reducedMotion ? 0 : Math.abs(Math.sin(this.t * 9)) * 0.05 * moving;
    }
  }

  /** Show only the named hair node and recolour palette zones (Avatar Studio).
   * Atlas characters (one material, kantor_atlas extras) get a per-avatar copy
   * of the palette texture with the outfit cells repainted, so recolouring
   * keeps one material and one draw call per mesh. Older multi-material GLBs
   * fall back to recolouring materials by name. */
  applyVariant(hair: string | null, palette: Record<string, string> | null): void {
    if (!this.body) return;
    if (hair) this.hair = hair;
    this.refreshVisibility();
    if (!palette) return;
    if (this.atlas && this.recolourAtlas(palette)) return;
    this.body.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
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
    });
  }

  private atlasSource: THREE.MeshStandardMaterial | null = null;
  private atlasMaterial: THREE.MeshStandardMaterial | null = null;

  private recolourAtlas(palette: Record<string, string>): boolean {
    const atlas = this.atlas!;
    if (!this.atlasSource) {
      this.body!.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (!this.atlasSource && m && !Array.isArray(m) && m.map && m.name.startsWith('kantor_atlas')) this.atlasSource = m;
      });
    }
    const src = this.atlasSource;
    const image = src?.map?.image as CanvasImageSource & { width: number; height: number } | undefined;
    if (!src || !image || typeof document === 'undefined') return false;
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(image, 0, 0);
    const px = image.width / atlas.size; // cells are in atlas pixels; the image may be scaled
    for (const [zone, colour] of Object.entries(palette)) {
      const cell = atlas.zones[zone];
      if (!cell || !/^#[0-9a-f]{6}$/i.test(colour)) continue;
      ctx.fillStyle = colour;
      ctx.fillRect(cell[0] * atlas.cell * px, cell[1] * atlas.cell * px, atlas.cell * px, atlas.cell * px);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false; // glTF texture convention, same as the source map
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    this.atlasMaterial?.map?.dispose();
    this.atlasMaterial?.dispose();
    const mat = src.clone();
    mat.map = tex;
    this.atlasMaterial = mat;
    this.body!.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && !Array.isArray(mesh.material) && (mesh.material === src || (mesh.material as THREE.Material).name.startsWith('kantor_atlas'))) mesh.material = mat;
    });
    return true;
  }
}

function collect(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => { if (o !== root) out.push(o); });
  return out;
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
