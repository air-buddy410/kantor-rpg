// Game orchestrator: renderer, floors, CEO, interactions and HUD wiring.
import * as THREE from 'three';
import { buildFloor, MaterialCache, toThree, type FloorBuild } from '../world/build';
import { NavGrid } from '../world/navgrid';
import type { AccessMode, DerivedWalls, Fixture, FloorId, Room, Vec2, VerticalLink, World } from '../world/types';
import { $, anyDialogOpen, el, openDialog, toast } from '../ui/dom';
import { renderDirectory } from '../ui/directory';
import type { Settings } from '../ui/settings';
import { CameraRig } from './camera';
import { Input } from './input';
import { Player } from './player';

export interface Interactable {
  id: string;
  kind: 'link' | 'fixture';
  floor: FloorId;
  pos: Vec2;
  radius: number;
  label: string;
  run: () => void;
}

interface FloorRuntime { build: FloorBuild; nav: Record<AccessMode, NavGrid>; reach: Record<AccessMode, Uint8Array> }

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly input: Input;
  readonly player: Player;
  readonly floors = new Map<FloorId, FloorRuntime>();
  private materials: MaterialCache;
  private sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  private hemi = new THREE.HemisphereLight(0xfff4e0, 0x6d6450, 1.4);
  private timer = new THREE.Timer();
  private interactables: Interactable[] = [];
  private focusTarget: Interactable | null = null;
  private labels = new Map<string, HTMLElement>();
  private marker: THREE.Mesh;
  private transitioning = false;
  private running = true;
  private rafId = 0;
  readonly rendererName: string;
  readonly lowQuality: boolean;
  frameTimes: number[] = [];
  lastRawMs = 0;
  onFrame: ((dt: number) => void) | null = null;
  autopilot: { dir: Vec2; run: boolean } | null = null;
  roomId: string | null = null;
  floorSwitches = 0;

  constructor(private stage: HTMLElement, readonly world: World, readonly walls: DerivedWalls, public settings: Settings) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.rendererName = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    const software = /swiftshader|llvmpipe|software/i.test(this.rendererName);
    this.lowQuality = settings.quality === 'low' || (settings.quality === 'auto' && software);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.lowQuality ? 1 : 1.75));
    this.renderer.setSize(stage.clientWidth, stage.clientHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = !this.lowQuality;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    stage.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.materials = new MaterialCache(this.lowQuality);
    this.rig = new CameraRig(this.renderer.domElement, stage.clientWidth / Math.max(1, stage.clientHeight));
    this.input = new Input($('joystick'), $('joystick-knob'));
    const spawn = world.waypoints.find((w) => w.id === world.floors[0].spawn)!;
    this.player = new Player(spawn.pos, spawn.floor, spawn.facing ?? 90);
    this.rig.recenter(THREE.MathUtils.degToRad(90 - (spawn.facing ?? 90)));
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 40), new THREE.MeshBasicMaterial({ color: 0xc0643f, transparent: true, opacity: 0.9, depthWrite: false }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.visible = false;
    this.setupScene();
    this.buildFloors();
    this.scene.add(this.player.avatar.root, this.marker);
    this.collectInteractables();
    this.wireUi();
    this.applyFloorVisibility();
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.stop();
      window.dispatchEvent(new CustomEvent('kantor:fallback', { detail: 'Konteks WebGL hilang (context lost). Mode direktori aktif.' }));
    });
    window.addEventListener('resize', () => this.resize());
  }

  private setupScene() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    this.scene.background = new THREE.Color(dark ? 0x26352d : 0xe8ddc7);
    this.scene.fog = new THREE.Fog(this.scene.background as THREE.Color, 40, 90);
    this.hemi.intensity = dark ? 0.9 : 1.4;
    this.scene.add(this.hemi);
    this.sun.position.set(-14, 22, 10);
    this.sun.castShadow = !this.lowQuality;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera as THREE.OrthographicCamera;
    c.left = -20; c.right = 20; c.top = 20; c.bottom = -20; c.near = 1; c.far = 80;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun, this.sun.target);
  }

  private buildFloors() {
    for (const f of this.world.floors) {
      const build = buildFloor(this.world, this.walls, f.id, this.materials, !this.lowQuality);
      this.scene.add(build.group);
      const nav = { staff: new NavGrid(this.world, this.walls, f.id, this.world.fixtures, 'staff'), visitor: new NavGrid(this.world, this.walls, f.id, this.world.fixtures, 'visitor') };
      this.floors.set(f.id, { build, nav, reach: { staff: new Uint8Array(0), visitor: new Uint8Array(0) } });
    }
    this.computeReach();
  }

  /** Flood from the spawn across floors through vertical links, per access mode. */
  private computeReach() {
    for (const mode of ['staff', 'visitor'] as AccessMode[]) {
      const l1 = this.floors.get('L1')!;
      const spawn = this.world.waypoints.find((w) => w.id === this.world.floors[0].spawn)!;
      l1.reach[mode] = l1.nav[mode].flood([l1.nav[mode].cellOf(spawn.pos)]);
      const seeds: [number, number][] = [];
      const l2 = this.floors.get('L2')!;
      for (const vl of this.world.verticalLinks) {
        if (vl.playable === false) continue;
        const e1 = vl.ends.find((e) => e.floor === 'L1')!;
        const e2 = vl.ends.find((e) => e.floor === 'L2')!;
        if (l1.nav[mode].nearestWalkable(e1.point, 1, l1.reach[mode])) seeds.push(l2.nav[mode].cellOf(e2.arrive ?? e2.point));
      }
      l2.reach[mode] = l2.nav[mode].flood(seeds);
    }
  }

  get mode(): AccessMode { return this.settings.visitor ? 'visitor' : 'staff'; }
  get nav(): NavGrid { return this.floors.get(this.player.floor)!.nav[this.mode]; }

  private collectInteractables() {
    const list: Interactable[] = [];
    for (const vl of this.world.verticalLinks) {
      if (vl.playable === false) continue;
      for (const end of vl.ends) {
        const other = vl.ends.find((e) => e !== end)!;
        const verb = vl.type === 'lift' ? 'Naik lift' : 'Pakai tangga';
        list.push({
          id: `${vl.id}@${end.floor}`, kind: 'link', floor: end.floor, pos: end.point, radius: 1.1,
          label: `${verb} ke ${this.world.floors.find((f) => f.id === other.floor)!.name}`,
          run: () => this.useLink(vl, other.floor),
        });
      }
    }
    for (const fx of this.world.fixtures) {
      const inter = this.world.catalog[fx.type]?.interaction;
      if (!inter) continue;
      list.push({ id: fx.id, kind: 'fixture', floor: fx.floor, pos: fx.pos, radius: Math.max(fx.size[0], fx.size[1]) / 2 + 0.9, label: this.fixtureLabel(fx, inter), run: () => this.useFixture(fx, inter) });
    }
    this.interactables = list;
  }

  private fixtureLabel(fx: Fixture, inter: string): string {
    switch (inter) {
      case 'blueprint': return 'Baca denah dan ICT';
      case 'directory': return 'Buka direktori';
      case 'artwork': return 'Lihat karya';
      case 'coffee': return 'Bikin kopi (aktivitas virtual)';
      case 'billiards': return 'Main biliar (aktivitas virtual)';
      case 'game': return 'Main game (aktivitas virtual)';
      case 'exercise': return 'Olahraga (aktivitas virtual)';
      default: return this.world.catalog[fx.type].label;
    }
  }

  private wireUi() {
    this.input.onInteract = () => this.interact();
    this.input.onKey = (k) => {
      if (k === 'r') this.rig.recenter(THREE.MathUtils.degToRad(90 - this.player.facing));
      else if (k === 'q') this.rig.rotate(-0.35);
      else if (k === 'z') this.rig.rotate(0.35);
      else if (k === '+' || k === '=') this.rig.zoom(0.85);
      else if (k === '-') this.rig.zoom(1.18);
      else if (k === 'm') this.toggleDirectory();
      else if (k === 'h') openDialog($('dlg-help') as HTMLDialogElement);
    };
    $('touch-interact').addEventListener('click', () => this.interact());
    $('touch-run').addEventListener('click', (e) => {
      this.input.runToggle = !this.input.runToggle;
      (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(this.input.runToggle));
    });
    this.renderDirectory();
  }

  renderDirectory() {
    renderDirectory(this.world, {
      mode3d: true,
      canGo: (room) => (this.roomTarget(room) ? { ok: true } : { ok: false, reason: room.access === 'restricted' ? 'Akses terbatas (mode visitor)' : 'Tidak terjangkau' }),
      go: (room) => this.goToRoom(room),
      showRoom: (room) => showRoomCard(this.world, room, this.roomTarget(room) !== null),
      showPersona: (id) => showPersonaCard(this.world, id),
    });
  }

  toggleDirectory(force?: boolean) {
    const panel = $('directory-panel');
    const open = force ?? panel.hidden;
    panel.hidden = !open;
    $('btn-directory').setAttribute('aria-expanded', String(open));
    if (open) panel.focus();
    else $('btn-directory').focus();
  }

  /** Walkable reachable cell inside the room closest to its centroid. */
  roomTarget(room: Room): Vec2 | null {
    const fr = this.floors.get(room.floor)!;
    const nav = fr.nav[this.mode];
    const reach = fr.reach[this.mode];
    const xs = room.polygon.map((p) => p[0]);
    const ys = room.polygon.map((p) => p[1]);
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    const [ia, ja] = nav.cellOf([Math.min(...xs), Math.min(...ys)]);
    const [ib, jb] = nav.cellOf([Math.max(...xs), Math.max(...ys)]);
    let best: Vec2 | null = null;
    let bd = Infinity;
    for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) {
      if (!nav.walkable(i, j) || !reach[j * nav.w + i]) continue;
      const c = nav.center(i, j);
      if (!insidePoly(c, room.polygon)) continue;
      const d = Math.hypot(c[0] - cx, c[1] - cy);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  goToRoom(room: Room) {
    const t = this.roomTarget(room);
    if (!t) { toast(`${room.name} tidak dapat dicapai pada mode ini.`); return; }
    this.toggleDirectory(false);
    this.transition(() => {
      this.player.floor = room.floor;
      this.player.pos = t;
      this.applyFloorVisibility();
      toast(`Pindah ke ${room.name}`);
    });
  }

  private useLink(vl: VerticalLink, to: FloorId) {
    const end = vl.ends.find((e) => e.floor === to)!;
    this.transition(() => {
      this.player.floor = to;
      this.player.pos = [...(end.arrive ?? end.point)] as Vec2;
      if (end.facing !== undefined) this.player.facing = end.facing;
      this.floorSwitches++;
      this.applyFloorVisibility();
      toast(`${this.world.floors.find((f) => f.id === to)!.name}`);
    }, (vl.travelSeconds ?? 2) * 120);
  }

  private useFixture(fx: Fixture, inter: string) {
    if (inter === 'directory') { this.toggleDirectory(true); return; }
    if (inter === 'blueprint') { showBlueprintCard(this.world); return; }
    if (inter === 'artwork') { showArtworkCard(fx); return; }
    // Activities without a backend are labelled virtual and give real feedback.
    const anim: Record<string, string> = { coffee: 'coffee', billiards: 'billiards', game: 'game', exercise: 'exercise' };
    const name = anim[inter];
    if (name && this.player.avatar.has(name)) {
      this.player.avatar.play(name);
      this.activityUntil = performance.now() + 3500;
    }
    toast(`${this.fixtureLabel(fx, inter)}: dimulai. Aktivitas virtual, tidak mengubah status kerja.`);
  }

  private activityUntil = 0;

  private transition(fn: () => void, holdMs = 220) {
    if (this.transitioning) return;
    const fade = $('fade');
    if (this.settings.reducedMotion) { fn(); this.rig.update(this.playerVec(), 0, true); return; }
    this.transitioning = true;
    fade.classList.add('on');
    window.setTimeout(() => {
      fn();
      this.rig.update(this.playerVec(), 0, true);
      fade.classList.remove('on');
      this.transitioning = false;
    }, 260 + holdMs);
  }

  applyFloorVisibility() {
    for (const [id, fr] of this.floors) fr.build.group.visible = id === this.player.floor;
    $('floor-chip').textContent = this.player.floor;
    this.rebuildLabels();
  }

  private rebuildLabels() {
    const host = $('labels');
    host.replaceChildren();
    this.labels.clear();
    for (const r of this.world.rooms) {
      if (r.floor !== this.player.floor || r.category === 'shaft' || r.category === 'circulation') continue;
      const locked = this.settings.visitor && r.access === 'restricted';
      const tag = el('div', { class: `room-label${locked ? ' locked' : ''}` }, locked ? `${r.name} (terkunci)` : r.name);
      host.append(tag);
      this.labels.set(r.id, tag);
    }
  }

  setVisitor(on: boolean) {
    this.settings.visitor = on;
    const fr = this.floors.get(this.player.floor)!;
    if (!fr.reach[this.mode][this.nav.cellOf(this.player.pos)[1] * this.nav.w + this.nav.cellOf(this.player.pos)[0]]) {
      // Switching to visitor inside a restricted room: walk the CEO out to safety.
      const safe = this.world.waypoints.find((w) => w.id === this.world.floors.find((f) => f.id === this.player.floor)!.safePoint)!;
      this.player.pos = [...safe.pos] as Vec2;
      toast('Mode visitor: ruang terbatas dikunci, avatar dipindah ke titik aman.');
    }
    this.rebuildLabels();
    this.renderDirectory();
  }

  private playerVec(): THREE.Vector3 {
    const el = this.world.floors.find((f) => f.id === this.player.floor)!.elevation;
    return toThree(this.player.pos[0], this.player.pos[1], el);
  }

  private interact() {
    if (anyDialogOpen() || this.transitioning) return;
    if (this.focusTarget) this.focusTarget.run();
    else toast('Tidak ada yang bisa dipakai di dekat sini.');
  }

  private nearestInteractable(): Interactable | null {
    let best: Interactable | null = null;
    let bd = Infinity;
    for (const it of this.interactables) {
      if (it.floor !== this.player.floor) continue;
      const d = Math.hypot(it.pos[0] - this.player.pos[0], it.pos[1] - this.player.pos[1]);
      if (d <= it.radius && d < bd) { bd = d; best = it; }
    }
    return best;
  }

  start() {
    this.player.avatar.load('assets/characters/ch-ceo.glb').then((ok) => {
      if (!ok) toast('Model karakter belum tersedia: memakai placeholder berlabel.', 4000);
    });
    this.rig.update(this.playerVec(), 0, true);
    const loop = () => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(loop);
      this.frame();
    };
    loop();
  }

  stop() { this.running = false; cancelAnimationFrame(this.rafId); }

  private frame() {
    this.timer.update();
    const raw = this.timer.getDelta();
    // Simulation clamps dt so a stall cannot tunnel the avatar; metrics keep the raw value.
    const dt = Math.min(0.1, raw);
    this.lastRawMs = raw * 1000;
    this.frameTimes.push(this.lastRawMs);
    if (this.frameTimes.length > 4000) this.frameTimes.splice(0, 1000);
    const nav = this.nav;
    const safe = this.world.waypoints.find((w) => w.id === this.world.floors.find((f) => f.id === this.player.floor)!.safePoint)!;
    if (this.player.ensureWalkable(nav, safe.pos)) toast('Posisi tidak valid, kembali ke titik aman.');
    let dir: Vec2 = [0, 0];
    let run = false;
    if (!this.transitioning) {
      if (this.autopilot) { dir = this.autopilot.dir; run = this.autopilot.run; }
      else {
        const m = this.input.move();
        dir = this.rig.planDirection(m.x, m.y);
        run = m.run;
        if (this.input.held('q')) this.rig.rotate(-dt * 1.6);
        if (this.input.held('z')) this.rig.rotate(dt * 1.6);
      }
    }
    const moved = this.player.step(dt, dir, run, nav);
    const speed = moved / Math.max(dt, 1e-4);
    if (performance.now() > this.activityUntil || speed > 0.2) {
      this.player.avatar.play(speed > 2.6 ? 'run' : speed > 0.2 ? 'walk' : 'idle');
    }
    this.player.avatar.update(dt, Math.min(1, speed / 2), this.settings.reducedMotion);
    const pv = this.playerVec();
    this.player.avatar.root.position.copy(pv);
    this.rig.update(pv, dt);
    this.materials.cutaway.uPlayer.value.set(pv.x, pv.y + 0.9, pv.z);
    this.materials.cutaway.uCamera.value.copy(this.rig.camera.position);
    this.sun.position.set(pv.x - 14, pv.y + 22, pv.z + 10);
    this.sun.target.position.copy(pv);
    this.updateFocus(dt);
    this.updateRoom();
    this.updateLabels();
    this.onFrame?.(dt);
    this.renderer.render(this.scene, this.rig.camera);
  }

  private updateFocus(dt: number) {
    const it = this.nearestInteractable();
    const prompt = $('prompt');
    if (it !== this.focusTarget) {
      this.focusTarget = it;
      if (it) {
        prompt.textContent = `${matchMedia('(pointer: coarse)').matches ? 'Aksi' : 'E'}: ${it.label}`;
        prompt.hidden = false;
      } else prompt.hidden = true;
    }
    if (it) {
      const elev = this.world.floors.find((f) => f.id === it.floor)!.elevation;
      this.marker.visible = true;
      this.marker.position.copy(toThree(it.pos[0], it.pos[1], elev + 0.03));
      const s = this.settings.reducedMotion ? 1 : 1 + 0.08 * Math.sin(performance.now() / 260);
      this.marker.scale.setScalar(s);
    } else this.marker.visible = false;
    void dt;
  }

  private updateRoom() {
    let id: string | null = null;
    for (const r of this.world.rooms) if (r.floor === this.player.floor && insidePoly(this.player.pos, r.polygon)) { id = r.id; break; }
    if (id !== this.roomId) {
      this.roomId = id;
      const r = this.world.rooms.find((x) => x.id === id);
      $('room-name').textContent = r ? r.name : 'Di luar ruang';
    }
  }

  private updateLabels() {
    const cam = this.rig.camera;
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    const elev = this.world.floors.find((f) => f.id === this.player.floor)!.elevation;
    for (const r of this.world.rooms) {
      const tag = this.labels.get(r.id);
      if (!tag) continue;
      const xs = r.polygon.map((p) => p[0]);
      const ys = r.polygon.map((p) => p[1]);
      const v = toThree((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, elev + 1.6).project(cam);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      tag.style.opacity = visible ? '1' : '0';
      if (visible) tag.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
      tag.style.left = '0';
      tag.style.top = '0';
    }
  }

  resize() {
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    this.renderer.setSize(w, h);
    this.rig.resize(w / Math.max(1, h));
  }

  stats() {
    const info = this.renderer.info;
    return {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      floorTriangles: Object.fromEntries([...this.floors].map(([k, v]) => [k, Math.round(v.build.triangles)])),
    };
  }
}

export function insidePoly(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function infoDialog(title: string, nodes: (Node | string)[]) {
  $('dlg-info-title').textContent = title;
  $('dlg-info-body').replaceChildren(...nodes);
  openDialog($('dlg-info') as HTMLDialogElement);
}

function dl(rows: [string, string][]): HTMLElement {
  const d = el('dl', { class: 'info-grid' });
  for (const [k, v] of rows) d.append(el('dt', {}, k), el('dd', {}, v));
  return d;
}

export function showRoomCard(world: World, room: Room, reachable: boolean) {
  const area = polyArea(room.polygon);
  const seats = world.activitySlots.filter((s) => s.room === room.id && s.pose === 'sit').length;
  infoDialog(room.name, [
    dl([
      ['ID', room.id], ['Lantai', world.floors.find((f) => f.id === room.floor)!.name], ['Fungsi', room.function],
      ['Luas (as dinding)', `${area.toFixed(2)} m2 (proposal)`], ['Kursi dari fixture', String(seats)],
      ['Akses', room.access === 'restricted' ? 'terbatas' : room.access], ['Lantai finish', room.finish.floor],
      ['Status', reachable ? 'dapat dicapai pada mode ini' : 'tidak dapat dicapai pada mode ini'],
    ]),
    el('p', { class: 'muted small' }, 'Ukuran adalah proposal konsep (AS-DIM-01, AS-DIM-02), bukan luas yang disahkan.'),
  ]);
}

export function showPersonaCard(world: World, id: string) {
  const a = world.actors.find((x) => x.id === id)!;
  const home = world.rooms.find((r) => r.id === a.homeRoom);
  infoDialog(a.displayName, [
    dl([['Peran', a.role], ['Ruang utama', home ? home.name : '-'], ['Jenis', a.kind === 'player' ? 'avatar pemain (CEO)' : 'persona NPC']]),
    el('p', {}, 'Representasi virtual original. Bukan likeness orang nyata dan bukan bukti pekerjaan sedang berjalan.'),
    el('p', { class: 'muted small' }, 'Status kerja nyata (workStatus) tidak tersedia: integrasi private dinonaktifkan sampai ada izin.'),
  ]);
}

function showBlueprintCard(world: World) {
  const link = el('a', { href: 'docs/A-101.pdf', target: '_blank', rel: 'noopener' }, 'Buka A-101 Denah Lantai 1 (PDF)');
  const status = el('p', { class: 'muted small', role: 'status' }, 'Memeriksa ketersediaan PDF...');
  fetch('docs/manifest.json').then((r) => r.json()).then((m: { docs: { href: string }[] }) => {
    const ok = m.docs.some((d) => d.href === 'docs/A-101.pdf');
    status.textContent = ok ? 'PDF tersedia pada build ini.' : 'PDF A-101 belum dihasilkan pada build ini.';
    if (!ok) link.remove();
  }).catch(() => { status.textContent = 'Daftar dokumen gagal dimuat.'; });
  infoDialog('Meja denah: blueprint dan ICT', [
    el('p', {}, `Dataset ${world.revision.id}: ${world.rooms.length} ruang, ${world.doors.length} pintu, ${world.fixtures.length} fixture, ${world.ict.outlets.length} outlet ICT.`),
    el('p', {}, 'Semua gambar berstatus KONSEP, bukan untuk konstruksi. DWG native BLOCKED karena AutoCAD tidak tersedia; DXF dan PDF dihasilkan dari dataset yang sama.'),
    link, status,
  ]);
}

function showArtworkCard(fx: Fixture) {
  infoDialog('Karya di dinding', [
    el('p', {}, `Karya ${fx.artwork ?? fx.id}: komposisi geometris original buatan generator proyek (bukan aset pihak ketiga).`),
    el('p', { class: 'muted small' }, 'Pamflet dan signage final menyusul di M3 (brief Kevin).'),
  ]);
}

function polyArea(poly: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
}
