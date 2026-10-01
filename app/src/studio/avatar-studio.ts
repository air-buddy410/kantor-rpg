// Avatar Studio (REQ-AVATAR-01). Options come from design/characters.json
// avatarVariants and are filtered by what the loaded GLB actually contains,
// so no choice is offered without an asset. Preferences persist per browser;
// anything stored that no longer exists falls back to the default.
import * as THREE from 'three';
import charactersJson from '@design/characters.json';
import { Avatar } from '../game/avatar';
import { $, el, openDialog, toast } from '../ui/dom';

interface Palette { label: string; [material: string]: string }
interface VariantSpec { defaultHair: string; hairStyles: string[]; defaultPalette: string; palettes: Record<string, Palette> }
export interface AvatarChoice { hair: string; palette: string }

const SPEC = (charactersJson as unknown as { avatarVariants: Record<string, VariantSpec>; hairStyles?: Record<string, { label?: string }> }).avatarVariants['CH-CEO'];
const HAIR_LABEL: Record<string, string> = { short_tuft: 'Pendek berjambul', swept: 'Disisir ke samping', spiky_soft: 'Jabrik lembut' };
const KEY = 'kantor-rpg.avatar.v1';
const PREVIEW_CLIPS = ['idle', 'walk', 'wave', 'talk', 'sit', 'type'];

export const DEFAULT_CHOICE: AvatarChoice = { hair: SPEC.defaultHair, palette: SPEC.defaultPalette };

export function paletteColors(name: string): Record<string, string> {
  const p = SPEC.palettes[name] ?? SPEC.palettes[SPEC.defaultPalette];
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) if (k !== 'label') out[k] = v;
  return out;
}

/** Stored choice, validated against the spec and the hair nodes actually present. */
export function loadChoice(available: string[] = SPEC.hairStyles): AvatarChoice {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<AvatarChoice> | null;
    if (raw && typeof raw.hair === 'string' && typeof raw.palette === 'string' && available.includes(raw.hair) && SPEC.palettes[raw.palette]) {
      return { hair: raw.hair, palette: raw.palette };
    }
  } catch { /* storage blocked or corrupt: default below */ }
  return { ...DEFAULT_CHOICE };
}

export function saveChoice(c: AvatarChoice): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(c)); return true; } catch { return false; }
}

export function clearChoice(): void {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}

/** Hair styles present as nodes in a loaded model. */
export function availableHair(model: THREE.Object3D | null): string[] {
  if (!model) return [];
  const found = new Set<string>();
  model.traverse((o) => { const m = /^hair_([a-z_]+?)(?:[._]\d+)?$/.exec(o.name); if (m) found.add(m[1]); });
  return SPEC.hairStyles.filter((h) => found.has(h));
}

export class AvatarStudio {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  private preview = new Avatar('preview');
  private raf = 0;
  private timer = new THREE.Timer();
  private choice: AvatarChoice = { ...DEFAULT_CHOICE };
  private clip = 'idle';
  private hairs: string[] = [];

  constructor(private apply: (c: AvatarChoice) => void, private playerModel: () => THREE.Object3D | null) {
    this.scene.background = new THREE.Color(0xefe3cc);
    this.scene.add(new THREE.HemisphereLight(0xfff4e0, 0x6d6450, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 4, 3);
    this.scene.add(sun, this.preview.root);
    this.camera.position.set(0, 1.0, 4.2);
    this.camera.lookAt(0, 0.8, 0);
  }

  async open(opener?: HTMLElement) {
    const dlg = $('dlg-avatar') as HTMLDialogElement;
    this.hairs = availableHair(this.playerModel());
    this.choice = loadChoice(this.hairs.length ? this.hairs : SPEC.hairStyles);
    this.renderForm();
    openDialog(dlg, opener);
    dlg.addEventListener('close', () => this.stopPreview(), { once: true });
    const host = $('avatar-preview');
    try {
      if (!this.renderer) {
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.domElement.setAttribute('aria-hidden', 'true');
      }
      host.replaceChildren(this.renderer.domElement);
      const size = Math.min(260, host.clientWidth || 260);
      this.renderer.setSize(size, Math.round(size * 1.2));
      this.camera.aspect = 1 / 1.2;
      this.camera.updateProjectionMatrix();
      $('avatar-preview-state').textContent = 'Memuat model...';
      const ok = this.preview.isPlaceholder ? await this.preview.load('assets/characters/ch-ceo.glb') : true;
      $('avatar-preview-state').textContent = ok ? '' : 'Model karakter tidak tersedia; pratinjau memakai placeholder.';
      this.update();
      this.startPreview();
    } catch {
      host.replaceChildren(el('p', { class: 'muted small' }, 'Pratinjau 3D tidak tersedia di browser ini; pilihan tetap bisa disimpan.'));
    }
  }

  private renderForm() {
    const form = $('avatar-form');
    form.replaceChildren();
    const hairs = this.hairs.length ? this.hairs : [];
    const fsHair = el('fieldset', {});
    fsHair.append(el('legend', {}, 'Rambut'));
    if (!hairs.length) fsHair.append(el('p', { class: 'muted small' }, 'Varian rambut tidak ditemukan di model; memakai default.'));
    for (const h of hairs) {
      const id = `hair-${h}`;
      const input = el('input', { type: 'radio', name: 'hair', value: h, id });
      input.checked = h === this.choice.hair;
      input.addEventListener('change', () => { this.choice.hair = h; this.update(); });
      const label = el('label', { for: id });
      label.append(input, document.createTextNode(` ${HAIR_LABEL[h] ?? h}`));
      fsHair.append(label);
    }
    const fsPal = el('fieldset', {});
    fsPal.append(el('legend', {}, 'Pakaian'));
    for (const [name, p] of Object.entries(SPEC.palettes)) {
      const id = `pal-${name}`;
      const input = el('input', { type: 'radio', name: 'palette', value: name, id });
      input.checked = name === this.choice.palette;
      input.addEventListener('change', () => { this.choice.palette = name; this.update(); });
      const swatch = el('span', { class: 'swatch', 'aria-hidden': 'true' });
      swatch.style.background = `linear-gradient(90deg, ${p.outfit_main} 0 50%, ${p.outfit_bottom} 50% 100%)`;
      const label = el('label', { for: id });
      label.append(input, swatch, document.createTextNode(` ${p.label}`));
      fsPal.append(label);
    }
    const fsAnim = el('fieldset', {});
    fsAnim.append(el('legend', {}, 'Pratinjau animasi'));
    const sel = el('select', { 'aria-label': 'Animasi pratinjau', id: 'avatar-clip' });
    for (const c of PREVIEW_CLIPS) sel.append(el('option', { value: c }, c));
    sel.value = this.clip;
    sel.addEventListener('change', () => { this.clip = sel.value; this.preview.play(this.clip); });
    fsAnim.append(sel);
    form.append(fsHair, fsPal, fsAnim);
  }

  private update() {
    this.preview.applyVariant(this.choice.hair, paletteColors(this.choice.palette));
    this.preview.play(this.clip);
  }

  private startPreview() {
    cancelAnimationFrame(this.raf);
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.timer.update();
      const dt = Math.min(0.1, this.timer.getDelta());
      const reduced = document.documentElement.getAttribute('data-reduced-motion') === 'true';
      if (!reduced) this.preview.root.rotation.y += dt * 0.5;
      this.preview.update(dt, 0, reduced);
      this.renderer?.render(this.scene, this.camera);
    };
    loop();
  }

  private stopPreview() { cancelAnimationFrame(this.raf); }

  save() {
    const ok = saveChoice(this.choice);
    this.apply(this.choice);
    toast(ok ? 'Avatar disimpan di browser ini.' : 'Avatar dipakai sekarang, tetapi penyimpanan browser tidak tersedia.');
    ($('dlg-avatar') as HTMLDialogElement).close();
  }

  reset() {
    clearChoice();
    this.choice = { ...DEFAULT_CHOICE };
    this.apply(this.choice);
    this.renderForm();
    this.update();
    toast('Avatar kembali ke default.');
  }
}
