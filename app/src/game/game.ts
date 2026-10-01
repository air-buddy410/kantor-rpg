// Game orchestrator: renderer, floors, CEO, interactions and HUD wiring.
import * as THREE from 'three';
import { buildFixturesInto, buildFloor, MaterialCache, toThree, type FloorBuild } from '../world/build';
import { withFixtures } from '../world/slots';
import { NavGrid } from '../world/navgrid';
import type { AccessMode, ActivitySlot, DerivedWalls, Fixture, FloorId, Room, Vec2, VerticalLink, World } from '../world/types';
import { $, anyDialogOpen, el, openDialog, toast } from '../ui/dom';
import { renderDirectory } from '../ui/directory';
import type { Settings } from '../ui/settings';
import { CameraRig } from './camera';
import { Input } from './input';
import { Player } from './player';
import { ACTIVITY_LABEL, NpcLayer } from './npcs';
import dialogueJson from '@design/dialogue.json';

const DIALOGUE = dialogueJson as { personas: Record<string, string[]> };

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
  npcs!: NpcLayer;
  studioOpen = false;
  onAvatarLoaded: (() => void) | null = null;
  studioFocus: THREE.Vector3 | null = null;
  /** world.json fixtures before any local layout was applied */
  readonly baseFixtures: Fixture[];
  private npcInteractables = new Map<string, Interactable>();
  private talkingTo: string | null = null;
  private lineIndex = new Map<string, number>();
  roomId: string | null = null;
  floorSwitches = 0;

  constructor(private stage: HTMLElement, public world: World, readonly walls: DerivedWalls, public settings: Settings) {
    this.baseFixtures = world.fixtures;
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
    const seed = Number(new URLSearchParams(location.search).get('seed') ?? 20261001);
    this.npcs = new NpcLayer(world, { L1: this.floors.get('L1')!.nav.staff, L2: this.floors.get('L2')!.nav.staff }, seed, $('labels'));
    this.scene.add(this.npcs.group);
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
  /** Swap the active fixture layout (Studio preview or publish): rebuild
   * furniture meshes, nav grids, reachability, interactables and NPC plans. */
  applyFixtures(fixtures: Fixture[]) {
    this.endActivity(false);
    this.world = withFixtures(this.world, fixtures);
    for (const f of this.world.floors) {
      const fr = this.floors.get(f.id)!;
      const old = fr.build.fixtureGroup;
      fr.build.group.remove(old);
      old.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      const g = new THREE.Group();
      g.name = `fixtures-${f.id}`;
      buildFixturesInto(fixtures, f.id, f.elevation, this.materials, g, !this.lowQuality);
      fr.build.group.add(g);
      fr.build.fixtureGroup = g;
      fr.nav = { staff: new NavGrid(this.world, this.walls, f.id, fixtures, 'staff'), visitor: new NavGrid(this.world, this.walls, f.id, fixtures, 'visitor') };
    }
    this.computeReach();
    this.collectInteractables();
    this.npcInteractables.clear();
    this.npcs.sim.updateLayout(this.world, { L1: this.floors.get('L1')!.nav.staff, L2: this.floors.get('L2')!.nav.staff });
    this.renderDirectory();
  }

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
    for (const slot of this.world.activitySlots) {
      list.push({ id: `slot:${slot.id}`, kind: 'fixture', floor: slot.floor, pos: slot.pos, radius: 0.85, label: slotVerb(slot), run: () => this.startActivity(slot) });
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
      else if (k === 'escape' && this.activity) this.endActivity(true);
    };
    $('touch-interact').addEventListener('click', () => this.interact());
    $('activity-end').addEventListener('click', () => this.endActivity(true));
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
      meet: (id) => this.meet(id),
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
    // Activities without a backend run on the fixture's own slots so NPCs see
    // the reservation; feedback is labelled virtual.
    const slots = this.world.activitySlots.filter((sl) => sl.fixture === fx.id);
    const free = slots.find((sl) => !this.slotTakenBy(sl.id));
    if (free) this.startActivity(free);
    else if (slots.length) toast(`Sedang dipakai ${this.slotTakenBy(slots[0].id)}. Coba lagi nanti.`);
    else toast(`${this.fixtureLabel(fx, inter)}: aktivitas virtual, tidak mengubah status kerja.`);
  }

  private activityUntil = 0;
  activity: { slot: ActivitySlot; startedAt: number; shots: number; pots: number; seed: number } | null = null;

  /** Name of the NPC holding a slot reservation, or null when free. */
  private slotTakenBy(slotId: string): string | null {
    const r = this.npcs.sim.reservations.get(slotId);
    if (!r || r.npc === PLAYER_ID || r.expires <= this.npcs.sim.time) return null;
    return this.npcs.sim.npcs.find((n) => n.id === r.npc)?.name ?? 'persona lain';
  }

  startActivity(slot: ActivitySlot) {
    if (this.activity?.slot.id === slot.id) { this.activityAction(); return; }
    if (this.activity) this.endActivity(false);
    const taker = this.slotTakenBy(slot.id);
    if (taker) { toast(`Sedang dipakai ${taker}.`); return; }
    const fr = this.floors.get(slot.floor)!;
    const spot = fr.nav[this.mode].nearestWalkable(slot.pos, 0.9, fr.reach[this.mode]);
    if (!spot) { toast('Tempat ini tidak dapat dicapai.'); return; }
    this.player.pos = spot;
    this.player.facing = slot.facing;
    this.npcs.sim.reservations.set(slot.id, { npc: PLAYER_ID, expires: Number.POSITIVE_INFINITY });
    this.activity = { slot, startedAt: performance.now(), shots: 0, pots: 0, seed: hashString(slot.id) };
    $('activity').hidden = false;
    this.renderActivity();
  }

  /** E while busy: billiards and games have a small action, others finish. */
  private activityAction() {
    const a = this.activity;
    if (!a) return;
    if (a.slot.activity === 'billiards') {
      a.shots++;
      // Deterministic pseudo-random outcome per slot and shot; labelled simulation.
      const roll = ((a.seed ^ (a.shots * 2654435761)) >>> 0) % 100;
      if (roll < 38) a.pots++;
      toast(roll < 38 ? `Masuk! ${a.pots} dari ${a.shots} pukulan (simulasi)` : `Meleset. ${a.pots} dari ${a.shots} pukulan (simulasi)`);
      this.renderActivity();
    } else if (a.slot.activity === 'game') {
      a.shots++;
      toast(`Level ${a.shots + 1} (permainan virtual, tanpa skor tersimpan)`);
      this.renderActivity();
    } else this.endActivity(true);
  }

  endActivity(announce: boolean) {
    const a = this.activity;
    if (!a) return;
    const r = this.npcs.sim.reservations.get(a.slot.id);
    if (r?.npc === PLAYER_ID) this.npcs.sim.reservations.delete(a.slot.id);
    this.activity = null;
    $('activity').hidden = true;
    if (announce) toast('Aktivitas selesai.');
  }

  private renderActivity() {
    const a = this.activity;
    if (!a) return;
    const secs = Math.floor((performance.now() - a.startedAt) / 1000);
    const extra = a.slot.activity === 'billiards' ? ` · ${a.pots}/${a.shots} masuk` : a.slot.activity === 'game' ? ` · level ${a.shots + 1}` : '';
    $('activity-text').textContent = `${slotVerb(a.slot)} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}${extra} (aktivitas virtual)`;
  }

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
    if (anyDialogOpen() || this.transitioning || this.studioOpen) return;
    if (this.activity) { this.activityAction(); return; }
    if (this.focusTarget) this.focusTarget.run();
    else toast('Tidak ada yang bisa dipakai di dekat sini.');
  }

  private nearestInteractable(): Interactable | null {
    // CEO interaction with a person outranks furniture and links (PRD 8 priority).
    const npc = this.npcs.nearest(this.player.floor, this.player.pos, 1.6);
    if (npc) {
      let it = this.npcInteractables.get(npc.id);
      if (!it) {
        it = { id: npc.id, kind: 'fixture', floor: npc.floor, pos: npc.pos, radius: 1.6, label: `Sapa ${npc.name}`, run: () => this.talkTo(npc.id) };
        this.npcInteractables.set(npc.id, it);
      }
      it.pos = npc.pos;
      it.floor = npc.floor;
      return it;
    }
    let best: Interactable | null = null;
    let bd = Infinity;
    for (const it of this.interactables) {
      if (it.floor !== this.player.floor) continue;
      const d = Math.hypot(it.pos[0] - this.player.pos[0], it.pos[1] - this.player.pos[1]);
      if (d <= it.radius && d < bd) { bd = d; best = it; }
    }
    return best;
  }

  /** Open the persona dialog; the NPC pauses (reservation kept) until it closes. */
  talkTo(id: string) {
    const npc = this.npcs.sim.pauseForPlayer(id);
    if (!npc) { toast('Persona tidak ditemukan.'); return; }
    this.talkingTo = id;
    this.npcs.faceTowards(id, this.player.pos);
    this.player.facing = (Math.atan2(npc.pos[1] - this.player.pos[1], npc.pos[0] - this.player.pos[0]) * 180) / Math.PI;
    this.player.avatar.setFacing(this.player.facing);
    const lines = DIALOGUE.personas[id] ?? ['Halo.'];
    const quote = el('p', { class: 'quote', 'aria-live': 'polite' });
    const next = () => {
      const k = this.lineIndex.get(id) ?? 0;
      quote.textContent = lines[k % lines.length];
      this.lineIndex.set(id, k + 1);
    };
    next();
    const more = el('button', { type: 'button', class: 'btn' }, 'Topik lain');
    more.addEventListener('click', next);
    const room = this.world.rooms.find((r) => r.floor === npc.floor && insidePoly(npc.pos, r.polygon));
    const body = [
      el('p', { class: 'sim-note' }, 'SIMULASI: persona virtual, dialog fiksi statis.'),
      quote,
      dlRows([
        ['Peran', npc.role],
        ['Aktivitas tampilan', `${ACTIVITY_LABEL[npc.activity] ?? npc.activity} (simulasi)`],
        ['Status kerja', `tidak diketahui: ${npc.workStatusSource}`],
        ['Lokasi', room ? room.name : '-'],
        ['Jam simulasi', this.npcs.sim.clockLabel()],
      ]),
      more,
    ];
    $('dlg-info-title').textContent = npc.name;
    $('dlg-info-body').replaceChildren(...body);
    const dlg = $('dlg-info') as HTMLDialogElement;
    dlg.addEventListener('close', () => {
      if (this.talkingTo) this.npcs.sim.resume(this.talkingTo);
      this.talkingTo = null;
    }, { once: true });
    openDialog(dlg);
  }

  /** Accessible path: move next to an NPC and open the dialog without 3D navigation. */
  meet(id: string) {
    const npc = this.npcs.sim.npcs.find((n) => n.id === id);
    if (!npc) { toast('Persona tidak ditemukan.'); return; }
    const fr = this.floors.get(npc.floor)!;
    const spot = fr.nav[this.mode].nearestWalkable(npc.pos, 2.0, fr.reach[this.mode]);
    if (!spot) { toast(`${npc.name} sedang di area yang tidak dapat dicapai pada mode ini.`); return; }
    this.toggleDirectory(false);
    this.transition(() => {
      this.player.floor = npc.floor;
      this.player.pos = spot;
      this.applyFloorVisibility();
      this.talkTo(id);
    });
  }

  start() {
    this.player.avatar.load('assets/characters/ch-ceo.glb').then((ok) => {
      if (!ok) toast('Model karakter belum tersedia: memakai placeholder berlabel.', 4000);
      else this.onAvatarLoaded?.();
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
    if (!this.transitioning && !this.studioOpen) {
      if (this.autopilot) { dir = this.autopilot.dir; run = this.autopilot.run; }
      else {
        const m = this.input.move();
        dir = this.rig.planDirection(m.x, m.y);
        run = m.run;
        if (this.input.held('q')) this.rig.rotate(-dt * 1.6);
        if (this.input.held('z')) this.rig.rotate(dt * 1.6);
      }
    }
    if (this.activity && Math.hypot(dir[0], dir[1]) > 0.1) this.endActivity(false);
    const moved = this.activity ? 0 : this.player.step(dt, dir, run, nav);
    const speed = moved / Math.max(dt, 1e-4);
    if (this.activity) {
      this.player.avatar.play(slotClip(this.activity.slot));
      this.player.avatar.setFacing(this.activity.slot.facing);
      if (Math.floor(performance.now() / 500) !== Math.floor((performance.now() - dt * 1000) / 500)) this.renderActivity();
    } else if (performance.now() > this.activityUntil || speed > 0.2) {
      this.player.avatar.play(speed > 2.4 ? 'run' : speed > 0.2 ? 'walk' : 'idle');
    }
    this.player.avatar.setGroundSpeed(speed);
    this.player.avatar.update(dt, Math.min(1, speed / 2), this.settings.reducedMotion);
    const pv = this.playerVec();
    this.player.avatar.root.position.copy(pv);
    if (this.activity?.slot.pose === 'sit') {
      const el = this.world.floors.find((f) => f.id === this.activity!.slot.floor)!.elevation;
      this.player.avatar.root.position.copy(toThree(this.activity.slot.pos[0], this.activity.slot.pos[1], el));
    }
    this.rig.update(this.studioOpen && this.studioFocus ? this.studioFocus : pv, dt);
    this.materials.cutaway.uPlayer.value.set(pv.x, pv.y + 0.9, pv.z);
    this.materials.cutaway.uCamera.value.copy(this.rig.camera.position);
    this.sun.position.set(pv.x - 14, pv.y + 22, pv.z + 10);
    this.sun.target.position.copy(pv);
    this.npcs.update(dt, this.player.floor, this.rig.camera, this.stage.clientWidth, this.stage.clientHeight, this.settings.reducedMotion);
    $('sim-clock').textContent = this.npcs.sim.clockLabel();
    this.updateFocus(dt);
    this.updateRoom();
    this.updateLabels();
    this.onFrame?.(dt);
    this.renderer.render(this.scene, this.rig.camera);
  }

  private updateFocus(dt: number) {
    const prompt = $('prompt');
    if (this.studioOpen) { prompt.hidden = true; this.marker.visible = false; this.focusTarget = null; return; }
    if (this.activity) {
      const act = this.activity.slot.activity;
      const key = matchMedia('(pointer: coarse)').matches ? 'Aksi' : 'E';
      prompt.textContent = `${key}: ${act === 'billiards' ? 'Pukul bola' : act === 'game' ? 'Main ronde berikut' : 'Selesai'}`;
      prompt.hidden = false;
      this.focusTarget = null;
      this.marker.visible = false;
      return;
    }
    const it = this.nearestInteractable();
    if (it !== this.focusTarget || prompt.hidden === !!it) {
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

const PLAYER_ID = 'ACT-BUDI';

const VERB: Record<string, string> = {
  desk: 'Pakai workstation', coffee: 'Bikin kopi', chat: 'Diskusi', read: 'Membaca', stretch: 'Peregangan',
  game: 'Main game', billiards: 'Main biliar', exercise: 'Olahraga', rest: 'Istirahat',
};

export function slotVerb(slot: ActivitySlot): string {
  if (slot.pose === 'sit' && (slot.activity === 'chat' || slot.activity === 'rest' || slot.activity === 'read')) return 'Duduk';
  return VERB[slot.activity] ?? 'Pakai';
}

export function slotClip(slot: ActivitySlot): string {
  const sit = slot.pose === 'sit';
  switch (slot.activity) {
    case 'desk': return sit ? 'type' : 'read';
    case 'chat': return sit ? 'sit' : 'talk';
    case 'read': return sit ? 'sit' : 'read';
    case 'rest': return 'sit';
    case 'game': return sit ? 'game' : 'talk';
    default: return slot.activity;
  }
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
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

function dlRows(rows: [string, string][]): HTMLElement { return dl(rows); }

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
