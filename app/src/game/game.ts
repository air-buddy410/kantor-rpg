// Game orchestrator: renderer, floors, CEO, interactions and HUD wiring.
import { t } from '../i18n';
import * as THREE from 'three';
import { labelClear, type LabelBlocker } from './label-visibility';
import { buildFixturesInto, buildFloor, MaterialCache, setFurnitureKit, toThree, type FloorBuild } from '../world/build';
import { loadFurnitureKit } from '../world/furniture-kit';
import { withFixtures } from '../world/slots';
import { NavGrid } from '../world/navgrid';
import type { AccessMode, ActivitySlot, DerivedWalls, Fixture, FloorId, Room, Vec2, VerticalLink, World } from '../world/types';
import { $, anyDialogOpen, el, openDialog, toast } from '../ui/dom';
import { currentDevice, currentPadKind } from '../input/mode';
import { facePart, glyph } from '../input/glyphs';
import { PAD_PROFILES } from '../input/pad-profiles';
import { renderDirectory } from '../ui/directory';
import type { Settings } from '../ui/settings';
import { CameraRig } from './camera';
import { Input } from './input';
import { Player } from './player';
import { ACTIVITY_LABEL, NpcLayer, WORK_LABEL } from './npcs';
import { SCOLD_RUSH_SECONDS, type WorkStatus } from '../sim/idle';
import { DoorController } from '../world/doors';
import { DoorMeshes } from '../world/door-meshes';
import dialogueJson from '@design/dialogue.json';
import { facilityGame, FACILITY_TITLE } from '../minigames/facility';
import { sound } from '../audio';
import { trackForRoom } from '../audio/rooms';

const DIALOGUE = dialogueJson as { personas: Record<string, string[]> };

export type BoardTab = 'handoffs' | 'tasks' | 'log';
/** In-world boards (PRD 18.1): coordination room, work areas on both floors, IMPL screen. */
export const BOARD_FIXTURES: Record<string, BoardTab> = {
  'FX-L1-050': 'handoffs', 'FX-L1-023': 'tasks', 'FX-L2-034': 'tasks', 'FX-L1-065': 'log',
};
const BOARD_LABEL: Record<BoardTab, string> = { handoffs: 'Papan Handoff', tasks: 'Daftar Pekerjaan', log: 'Log Aktivitas' };
/** Persona -> Hermes profile that receives commands (server roster is the authority). */
export const ACTOR_PROFILE: Record<string, string> = {
  'ACT-MAX': 'default', 'ACT-ECHO': 'echo', 'ACT-LEO': 'leo', 'ACT-NOVA': 'enterprise', 'ACT-HUGO': 'sipil',
  'ACT-BRUNO': 'infra', 'ACT-KEVIN': 'sales', 'ACT-REX': 'labs',
};

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
  /** What the prompt shows now (device + label), so it is rebuilt only when that changes. */
  private promptSig = '';
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
  private ghostHintAt = 0;
  npcs!: NpcLayer;
  doors!: DoorController;
  private doorMeshes!: DoorMeshes;
  studioOpen = false;
  onAvatarLoaded: (() => void) | null = null;
  onBoard: ((tab: BoardTab) => void) | null = null;
  onAgent: ((profile: string) => void) | null = null;
  onAgentPicker: (() => void) | null = null;
  onMap: (() => void) | null = null;
  onGames: (() => void) | null = null;
  /** True while the owner is logged in and real presence drives the NPCs. */
  livePresence = false;

  /**
   * Real agent status (owner only). Working/waiting agents go to their desk
   * and type; everything else falls back to the idle simulation.
   */
  applyPresence(list: { actorId: string | null; status: string; source: string; summary: string }[] | null) {
    this.livePresence = list !== null;
    const map: Record<string, WorkStatus> = { working: 'working', waiting: 'waiting', idle: 'done', unknown: 'unknown' };
    for (const npc of this.npcs.sim.npcs) {
      const p = list?.find((a) => a.actorId === npc.id);
      if (!p) this.npcs.sim.setWork(npc.id, 'unknown', list ? t('tidak ada profil Hermes') : t('tidak ada adapter (demo offline)'));
      else this.npcs.sim.setWork(npc.id, map[p.status] ?? 'unknown', p.source, p.summary);
    }
    const badge = $('sim-badge');
    badge.textContent = list ? t('Status kerja: nyata') : t('SIMULASI: data demo');
    badge.title = list ? t('Agen yang sedang bekerja duduk dan mengetik di mejanya (Kanban, perintah RPG, agent.log). Aktivitas santai tetap simulasi.') : t('Semua aktivitas dan status adalah fixture demo, bukan data kerja nyata');
    badge.classList.toggle('live', !!list);
  }
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
      window.dispatchEvent(new CustomEvent('kantor:fallback', { detail: t('Konteks WebGL hilang (context lost). Mode direktori aktif.') }));
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
    this.sun.shadow.normalBias = 0.03; // stops shadow acne shimmering on walls/floors as the camera moves
    this.scene.add(this.sun, this.sun.target);
  }

  private sunAxes: THREE.Vector3[] | null = null;
  /** Sun follows the CEO in whole shadow-map texels: a sub-texel shift
   * re-rasterises every shadow edge each frame, which shimmered on thin walls,
   * door leaves and under desks while walking. */
  private followSun(pv: THREE.Vector3) {
    const off = new THREE.Vector3(-14, 22, 10);
    if (!this.sunAxes) {
      const z = off.clone().normalize();
      const x = new THREE.Vector3(0, 1, 0).cross(z).normalize();
      this.sunAxes = [x, z.clone().cross(x), z];
    }
    const c = this.sun.shadow.camera as THREE.OrthographicCamera;
    const texel = (c.right - c.left) / this.sun.shadow.mapSize.x;
    const [x, y, z] = this.sunAxes;
    const snap = (v: number) => Math.round(v / texel) * texel;
    const t = x.clone().multiplyScalar(snap(pv.dot(x))).addScaledVector(y, snap(pv.dot(y))).addScaledVector(z, pv.dot(z));
    this.sun.target.position.copy(t);
    this.sun.position.copy(t).add(off);
  }

  private buildFloors() {
    for (const f of this.world.floors) {
      const build = buildFloor(this.world, this.walls, f.id, this.materials, !this.lowQuality);
      this.scene.add(build.group);
      const nav = { staff: new NavGrid(this.world, this.walls, f.id, this.world.fixtures, 'staff'), visitor: new NavGrid(this.world, this.walls, f.id, this.world.fixtures, 'visitor') };
      this.floors.set(f.id, { build, nav, reach: { staff: new Uint8Array(0), visitor: new Uint8Array(0) } });
    }
    this.doors = new DoorController(this.world, this.walls);
    this.doorMeshes = new DoorMeshes(this.world, this.doors, this.materials, new Map([...this.floors].map(([k, v]) => [k, v.build.group])));
    this.computeReach();
  }

  /** Flood from the spawn across floors through vertical links, per access mode. */
  furnitureKit: { loaded: number; failed: string[] } = { loaded: 0, failed: [] };

  /** Rebuild only the furniture meshes (e.g. when the GLB kit arrives). */
  refreshFixtureMeshes() {
    for (const f of this.world.floors) {
      const fr = this.floors.get(f.id)!;
      const old = fr.build.fixtureGroup;
      fr.build.group.remove(old);
      old.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      const g = new THREE.Group();
      g.name = `fixtures-${f.id}`;
      buildFixturesInto(this.world.fixtures, f.id, f.elevation, this.materials, g, !this.lowQuality);
      fr.build.group.add(g);
      fr.build.fixtureGroup = g;
    }
  }

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
        const verb = vl.type === 'lift' ? t('Naik lift') : t('Pakai tangga');
        list.push({
          id: `${vl.id}@${end.floor}`, kind: 'link', floor: end.floor, pos: end.point, radius: 1.1,
          label: t('{verb} ke {floor}', { verb, floor: this.world.floors.find((f) => f.id === other.floor)!.name }),
          run: () => this.useLink(vl, other.floor),
        });
      }
    }
    for (const slot of this.world.activitySlots) {
      const sfx = this.world.fixtures.find((f) => f.id === slot.fixture);
      const sg = sfx ? facilityGame(sfx.type, sfx.room) : null;
      const label = sg ? t('Main {game}', { game: t(FACILITY_TITLE[sg] ?? sg) }) : slotVerb(slot);
      list.push({ id: `slot:${slot.id}`, kind: 'fixture', floor: slot.floor, pos: slot.pos, radius: 0.85, label, run: () => this.startActivity(slot) });
    }
    for (const fx of this.world.fixtures) {
      const board = BOARD_FIXTURES[fx.id];
      if (board) {
        list.push({ id: fx.id, kind: 'fixture', floor: fx.floor, pos: fx.pos, radius: Math.max(fx.size[0], fx.size[1]) / 2 + 0.9, label: t('Buka {board}', { board: t(BOARD_LABEL[board]) }), run: () => this.onBoard?.(board) });
        continue;
      }
      const inter = this.world.catalog[fx.type]?.interaction ?? (facilityGame(fx.type, fx.room) ? 'minigame' : undefined);
      if (!inter) continue;
      list.push({ id: fx.id, kind: 'fixture', floor: fx.floor, pos: fx.pos, radius: Math.max(fx.size[0], fx.size[1]) / 2 + 0.9, label: this.fixtureLabel(fx, inter), run: () => this.useFixture(fx, inter) });
    }
    this.interactables = list;
  }

  private fixtureLabel(fx: Fixture, inter: string): string {
    const game = facilityGame(fx.type, fx.room);
    if (game) return t('Main {game}', { game: t(FACILITY_TITLE[game] ?? game) });
    switch (inter) {
      case 'blueprint': return t('Baca denah dan ICT');
      case 'directory': return t('Buka direktori');
      case 'artwork': return t('Lihat karya');
      case 'coffee': return t('Bikin kopi (aktivitas virtual)');
      case 'billiards': return t('Main biliar (aktivitas virtual)');
      case 'game': return t('Main game (aktivitas virtual)');
      case 'exercise': return t('Olahraga (aktivitas virtual)');
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
      else if (k === 'b') this.onBoard?.('handoffs');
      else if (k === 'p') this.onMap?.();
      else if (k === 'g') this.onGames?.();
      else if (k === 'c') this.onAgentPicker?.();
      else if (k === 'v') sound.with((en) => toast(en.toggleMute() ? t('Suara dimatikan (V untuk menyalakan).') : t('Suara dinyalakan.'), 1400));
      else if (k === 'escape' && this.activity) this.endActivity(true);
    };
    $('touch-interact').addEventListener('click', () => this.interact());
    $('activity-end').addEventListener('click', () => this.endActivity(true));
    $('touch-run').addEventListener('click', () => this.toggleRun());
    this.renderDirectory();
  }

  renderDirectory() {
    renderDirectory(this.world, {
      mode3d: true,
      canGo: (room) => (this.roomTarget(room) ? { ok: true } : { ok: false, reason: room.access === 'restricted' ? t('Akses terbatas (mode visitor)') : t('Tidak terjangkau') }),
      go: (room) => this.goToRoom(room),
      showRoom: (room) => showRoomCard(this.world, room, this.roomTarget(room) !== null),
      showPersona: (id) => showPersonaCard(this.world, id),
      meet: (id) => this.meet(id),
      command: (profile) => this.onAgent?.(profile),
      profiles: ACTOR_PROFILE,
      boards: (tab) => this.onBoard?.(tab),
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
    const target = this.roomTarget(room);
    if (!target) { toast(t('{room} tidak dapat dicapai pada mode ini.', { room: room.name })); return; }
    this.toggleDirectory(false);
    this.transition(() => {
      this.player.floor = room.floor;
      this.player.pos = target;
      this.applyFloorVisibility();
      toast(t('Pindah ke {room}', { room: room.name }));
    });
  }

  private useLink(vl: VerticalLink, to: FloorId) {
    const end = vl.ends.find((e) => e.floor === to)!;
    this.transition(() => {
      this.player.floor = to;
      this.player.pos = [...(end.arrive ?? end.point)] as Vec2;
      if (end.facing !== undefined) this.player.facing = end.facing;
      this.floorSwitches++;
      sound.sfx(vl.type === 'lift' || vl.type === 'elevator' ? 'lift' : 'step');
      this.applyFloorVisibility();
      toast(`${this.world.floors.find((f) => f.id === to)!.name}`);
    }, (vl.travelSeconds ?? 2) * 120);
  }

  private useFixture(fx: Fixture, inter: string) {
    if (inter === 'directory') { this.toggleDirectory(true); return; }
    const game = facilityGame(fx.type, fx.room);
    if (game) { this.openFacilityGame(fx, game); return; }
    if (inter === 'blueprint') { showBlueprintCard(this.world); return; }
    if (inter === 'artwork') { showArtworkCard(fx); return; }
    // Activities without a backend run on the fixture's own slots so NPCs see
    // the reservation; feedback is labelled virtual.
    const slots = this.world.activitySlots.filter((sl) => sl.fixture === fx.id);
    const free = slots.find((sl) => !this.slotTakenBy(sl.id));
    if (free) this.startActivity(free);
    else if (slots.length) toast(t('Sedang dipakai {name}. Coba lagi nanti.', { name: this.slotTakenBy(slots[0].id) ?? '' }));
    else toast(t('{label}: aktivitas virtual, tidak mengubah status kerja.', { label: this.fixtureLabel(fx, inter) }));
  }

  /** Mini game currently open from a facility (PRD v2.0 REQ-MG). */
  miniGame: string | null = null;

  /**
   * Daftar game (Budi 2026-11-19): walk to the fixture that hosts the game and
   * open it there, so the room's seats are taken like on a walk-up. Game
   * Station games open straight on a cabinet, not via the launcher.
   */
  playAt(fixture: Fixture, game: string): boolean {
    if (this.miniGame || this.transitioning) return false;
    const room = this.world.rooms.find((r) => r.id === fixture.room);
    if (room && this.settings.visitor && room.access === 'restricted') { toast(t('Akses terbatas (mode visitor)')); return false; }
    const fr = this.floors.get(fixture.floor);
    const spot = fr?.nav[this.mode].nearestWalkable(fixture.pos, 1.6, fr.reach[this.mode]);
    if (!spot) { toast(t('{room} tidak dapat dicapai pada mode ini.', { room: room?.name ?? fixture.room })); return false; }
    this.toggleDirectory(false);
    this.transition(() => {
      this.player.floor = fixture.floor;
      this.player.pos = spot;
      this.applyFloorVisibility();
      // the 3D loop pauses under the game: name the new room now (HUD, state)
      this.updateRoom();
      // From the list the game always opens: a seat in use (Hugo at his
      // drafting table) only means the CEO plays standing beside it.
      const slots = this.facilitySlots(fixture, game);
      this.openFacilityGame(fixture, game, slots.find((sl) => !this.slotTakenBy(sl.id)), true);
    });
    return true;
  }

  /**
   * Walk-up use of a facility: hold a free slot (NPCs see it taken), then open
   * the game. The arcade cabinet and TV open the Game Station launcher.
   */
  openFacilityGame(fx: Fixture, game: string, slot?: ActivitySlot, evenIfBusy = false) {
    if (this.miniGame) return;
    const slots = slot ? [slot] : this.facilitySlots(fx, game);
    // Take the free seat nearest the CEO, not the first one in the list (at
    // the chess table that teleported Budi across the table).
    const me = this.player.pos;
    const free = slots.filter((sl) => !this.slotTakenBy(sl.id) && sl.floor === this.player.floor)
      .sort((a, b) => Math.hypot(a.pos[0] - me[0], a.pos[1] - me[1]) - Math.hypot(b.pos[0] - me[0], b.pos[1] - me[1]))[0]
      ?? slots.find((sl) => !this.slotTakenBy(sl.id));
    if (slots.length && !free && !evenIfBusy) { toast(t('Sedang dipakai {name}. Coba lagi nanti.', { name: this.slotTakenBy(slots[0].id) ?? '' })); return; }
    if (this.activity) this.endActivity(false);
    if (free) {
      const fr = this.floors.get(free.floor)!;
      const spot = fr.nav[this.mode].nearestWalkable(free.pos, 0.9, fr.reach[this.mode]);
      if (spot) { this.player.pos = spot; this.player.facing = free.facing; }
      this.npcs.sim.reservations.set(free.id, { npc: PLAYER_ID, expires: Number.POSITIVE_INFINITY });
    }
    this.miniGame = game;
    // Give focus back to what opened the game (Aksi button, HUD) on close;
    // without this it fell to <body> and a screen reader lost its place.
    const back = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const done = () => {
      this.miniGame = null;
      if (free && this.npcs.sim.reservations.get(free.id)?.npc === PLAYER_ID) this.npcs.sim.reservations.delete(free.id);
      this.input.clear();
      sound.music(this.areaTrack());
      if (back?.isConnected) back.focus({ preventScroll: true });
    };
    toast(t('Membuka {game}...', { game: t(FACILITY_TITLE[game] ?? game) }), 1200);
    const common = { reducedMotion: this.settings.reducedMotion, padProfile: () => this.settings.padProfile, aimSpeed: () => this.settings.aimSpeed, playerName: this.playerName };
    if (game === 'arcade') {
      void import('../minigames/arcade').then((m) => m.openArcade({ ...common, onClose: done })).catch(() => { done(); toast(t('Permainan gagal dimuat.')); });
    } else {
      void import('../minigames/host').then((m) => m.openMiniGame(game, { ...common, onClose: done })).catch(() => { done(); toast(t('Permainan gagal dimuat.')); });
    }
  }

  /**
   * Slots for a facility: its own, or for a table without seats of its own
   * (chess board) the seats around it that open the same game.
   */
  private facilitySlots(fx: Fixture, game: string): ActivitySlot[] {
    const own = this.world.activitySlots.filter((sl) => sl.fixture === fx.id);
    if (own.length) return own;
    const near = new Set(this.world.fixtures
      .filter((f) => f.floor === fx.floor && f.id !== fx.id && facilityGame(f.type, f.room) === game && Math.hypot(f.pos[0] - fx.pos[0], f.pos[1] - fx.pos[1]) < 1.6)
      .map((f) => f.id));
    return this.world.activitySlots.filter((sl) => near.has(sl.fixture));
  }

  /** Display name used on the local leaderboards. */
  playerName = 'Budi';

  private areaTrack(): string {
    return trackForRoom(this.roomId, this.player.floor);
  }

  private activityUntil = 0;
  activity: { slot: ActivitySlot; startedAt: number; shots: number; pots: number; seed: number } | null = null;

  /** Name of the NPC holding a slot reservation, or null when free. */
  private slotTakenBy(slotId: string): string | null {
    const r = this.npcs.sim.reservations.get(slotId);
    if (!r || r.npc === PLAYER_ID || r.expires <= this.npcs.sim.time) return null;
    return this.npcs.sim.npcs.find((n) => n.id === r.npc)?.name ?? t('persona lain');
  }

  startActivity(slot: ActivitySlot) {
    const sfx = this.world.fixtures.find((f) => f.id === slot.fixture);
    const sgame = sfx ? facilityGame(sfx.type, sfx.room) : null;
    if (sfx && sgame) { this.openFacilityGame(sfx, sgame, slot); return; }
    if (this.activity?.slot.id === slot.id) { this.activityAction(); return; }
    if (this.activity) this.endActivity(false);
    const taker = this.slotTakenBy(slot.id);
    if (taker) { toast(t('Sedang dipakai {name}.', { name: taker })); return; }
    const fr = this.floors.get(slot.floor)!;
    const spot = fr.nav[this.mode].nearestWalkable(slot.pos, 0.9, fr.reach[this.mode]);
    if (!spot) { toast(t('Tempat ini tidak dapat dicapai.')); return; }
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
      toast(roll < 38 ? t('Masuk! {pots} dari {shots} pukulan (simulasi)', { pots: a.pots, shots: a.shots }) : t('Meleset. {pots} dari {shots} pukulan (simulasi)', { pots: a.pots, shots: a.shots }));
      this.renderActivity();
    } else if (a.slot.activity === 'game') {
      a.shots++;
      toast(t('Level {n} (permainan virtual, tanpa skor tersimpan)', { n: a.shots + 1 }));
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
    if (announce) toast(t('Aktivitas selesai.'));
  }

  private renderActivity() {
    const a = this.activity;
    if (!a) return;
    const secs = Math.floor((performance.now() - a.startedAt) / 1000);
    const extra = a.slot.activity === 'billiards' ? ` · ${t('{pots}/{shots} masuk', { pots: a.pots, shots: a.shots })}` : a.slot.activity === 'game' ? ` · ${t('level {n}', { n: a.shots + 1 })}` : '';
    $('activity-text').textContent = `${slotVerb(a.slot)} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}${extra} ${t('(aktivitas virtual)')}`;
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
      const tag = el('div', { class: `room-label${locked ? ' locked' : ''}` }, locked ? t('{room} (terkunci)', { room: r.name }) : r.name);
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
      toast(t('Mode visitor: ruang terbatas dikunci, avatar dipindah ke titik aman.'));
    }
    this.rebuildLabels();
    this.renderDirectory();
  }

  private playerVec(): THREE.Vector3 {
    const el = this.world.floors.find((f) => f.id === this.player.floor)!.elevation;
    return toThree(this.player.pos[0], this.player.pos[1], el);
  }

  toggleRun() {
    this.input.runToggle = !this.input.runToggle;
    $('touch-run').setAttribute('aria-pressed', String(this.input.runToggle));
    toast(this.input.runToggle ? t('Lari: nyala') : t('Lari: mati'), 1200);
  }

  /** Gamepad A: same as E. */
  interactNow() { this.interact(); }

  private interact() {
    if (anyDialogOpen() || this.transitioning || this.studioOpen) return;
    if (this.activity) { this.activityAction(); return; }
    if (this.focusTarget) this.focusTarget.run();
    else toast(t('Tidak ada yang bisa dipakai di dekat sini.'));
  }

  private nearestInteractable(): Interactable | null {
    // CEO interaction with a person outranks furniture and links (PRD 8 priority).
    const npc = this.npcs.nearest(this.player.floor, this.player.pos, 1.6);
    if (npc) {
      let it = this.npcInteractables.get(npc.id);
      if (!it) {
        it = { id: npc.id, kind: 'fixture', floor: npc.floor, pos: npc.pos, radius: 1.6, label: t('Sapa {name}', { name: npc.name }), run: () => this.talkTo(npc.id) };
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
    if (!npc) { toast(t('Persona tidak ditemukan.')); return; }
    this.talkingTo = id;
    this.npcs.faceTowards(id, this.player.pos);
    this.player.facing = (Math.atan2(npc.pos[1] - this.player.pos[1], npc.pos[0] - this.player.pos[0]) * 180) / Math.PI;
    this.player.avatar.setFacing(this.player.facing);
    const lines = DIALOGUE.personas[id] ?? [t('Halo.')];
    const quote = el('p', { class: 'quote', 'aria-live': 'polite' });
    const next = () => {
      const k = this.lineIndex.get(id) ?? 0;
      quote.textContent = t(lines[k % lines.length]);
      this.lineIndex.set(id, k + 1);
    };
    next();
    const more = el('button', { type: 'button', class: 'btn' }, t('Topik lain'));
    more.addEventListener('click', next);
    const profile = ACTOR_PROFILE[id];
    const command = el('button', { type: 'button', class: 'btn primary', 'data-command': profile ?? '' }, t('Bicara & beri tugas'));
    command.addEventListener('click', () => {
      ($('dlg-info') as HTMLDialogElement).close();
      if (profile) this.onAgent?.(profile);
    });
    const room = this.world.rooms.find((r) => r.floor === npc.floor && insidePoly(npc.pos, r.polygon));
    const busy = npc.workStatus === 'working' || npc.workStatus === 'waiting';
    const work = !this.livePresence || npc.workStatus === 'unknown' ? t('tidak diketahui: {source}', { source: npc.workStatusSource })
      : busy ? `${t(WORK_LABEL[npc.workStatus])}${npc.workSummary ? `: ${npc.workSummary}` : ''} (${npc.workStatusSource})`
      : `${t('tidak ada tugas berjalan ({source})', { source: npc.workStatusSource })}${npc.workSummary ? `, ${npc.workSummary}` : ''}`;
    const body = [
      el('p', { class: 'sim-note' }, this.livePresence ? t('Status kerja dari Hermes. Dialog dan aktivitas santai tetap fiksi.') : t('SIMULASI: persona virtual, dialog fiksi statis.')),
      quote,
      dlRows([
        [t('Peran'), npc.role],
        [t('Aktivitas tampilan'), `${ACTIVITY_LABEL[npc.activity] ? t(ACTIVITY_LABEL[npc.activity]) : npc.activity}${busy && this.livePresence ? '' : ` ${t('(simulasi)')}`}`],
        [t('Status kerja'), work],
        [t('Lokasi'), room ? room.name : '-'],
        [t('Jam simulasi'), this.npcs.sim.clockLabel()],
      ]),
      el('div', { class: 'row' }),
    ];
    (body[body.length - 1] as HTMLElement).append(more, ...(profile && this.onAgent ? [command] : []));
    body.push(this.scoldRow(id, busy));
    $('dlg-info-title').textContent = npc.name;
    $('dlg-info-body').replaceChildren(...body);
    const dlg = $('dlg-info') as HTMLDialogElement;
    dlg.addEventListener('close', () => {
      if (this.talkingTo) this.npcs.sim.resume(this.talkingTo);
      this.talkingTo = null;
    }, { once: true });
    openDialog(dlg);
  }

  /** Reprimands done this visit (tests, HUD). */
  scolds = 0;

  /** Tegur buttons for the persona card (REQ-TEGUR-01, -04). */
  private scoldRow(id: string, busy: boolean): HTMLElement {
    const box = el('fieldset', { class: 'scold' });
    box.append(el('legend', {}, t('Tegur (visual saja)')));
    if (busy) {
      box.append(el('p', { class: 'sim-note' }, t('Sedang bekerja: agennya tidak bisa ditegur.')));
      return box;
    }
    const row = el('div', { class: 'row' });
    const props: [string, string][] = [['gulungan', t('Tepuk gulungan kertas')], ['palu', t('Ketuk palu mainan')], ['bola', t('Lempar bola kertas')]];
    for (const [kind, label] of props) {
      const b = el('button', { type: 'button', class: 'btn', 'data-scold': kind }, label);
      b.addEventListener('click', () => { ($('dlg-info') as HTMLDialogElement).close(); void this.scold(id, kind); });
      row.append(b);
    }
    box.append(row, el('p', { class: 'sim-note' }, t('Tidak mengirim apa pun ke agen atau Telegram.')));
    return box;
  }

  /** Running reprimand effects (one per persona at most, 10 s cooldown). */
  private scoldFx: import('./scold').ScoldFx[] = [];

  /**
   * Slapstick reprimand (REQ-TEGUR): the CEO turns to the persona and steps
   * closer if it is far, the prop pops into the CEO's hand, winds up and
   * swings (or the paper ball is thrown), then the impact frame and the
   * persona's reaction: squash, hop, orbiting stars, a line in a speech bubble
   * and a run back to the desk for 20 s. Pure animation (REQ-TEGUR-05).
   */
  async scold(id: string, kind: string): Promise<string> {
    const npc = this.npcs.sim.npcs.find((n) => n.id === id);
    if (!npc) return 'missing';
    // Resume first so the persona is free to walk away after the hit.
    if (npc.phase === 'paused') this.npcs.sim.resume(id);
    // The persona card closing must not resume the persona mid wind-up.
    if (this.talkingTo === id) this.talkingTo = null;
    const res = this.npcs.sim.scold(id);
    if (res === 'working') { toast(t('{name} sedang bekerja: agennya tidak bisa ditegur.', { name: npc.name })); return res; }
    if (res === 'cooldown') { toast(t('Tunggu sebentar sebelum menegur {name} lagi.', { name: npc.name })); return res; }
    if (res !== 'ok') return res;
    this.scolds++;
    // Hold the persona in place (desk route kept) until the hit lands.
    this.npcs.sim.pauseForPlayer(id);
    const m = await import('./scold');
    const rm = this.settings.reducedMotion;
    const prop = m.SCOLD_PROPS.find((p) => p.id === kind) ?? m.SCOLD_PROPS[0];
    const lines = m.SCOLD_LINES[id] ?? [m.SCOLD_FALLBACK];
    const line = t(lines[this.scolds % lines.length]);
    let landed = false;
    const land = () => {
      if (landed) return;
      landed = true;
      this.spatial(prop.sfx, npc.floor, npc.pos, 1.2);
      this.npcs.react(id, rm, line);
      toast(`${npc.name}: "${line}"`, 2600);
      // Rub the head for a beat, then run to the desk for the full 20 s.
      window.setTimeout(() => {
        if (npc.phase !== 'paused' || this.talkingTo === id) return;
        this.npcs.sim.resume(id);
        npc.scoldedUntil = this.npcs.sim.time + SCOLD_RUSH_SECONDS;
        npc.until = Math.max(npc.until, npc.scoldedUntil);
      }, rm ? 600 : 1100);
    };
    const near = npc.floor === this.player.floor && Math.hypot(npc.pos[0] - this.player.pos[0], npc.pos[1] - this.player.pos[1]) < 14;
    if (!near) { land(); return res; } // persona out of sight: reaction only
    for (const f of this.scoldFx) if (!f.finished) f.dispose();
    const faceNpc = () => {
      this.player.facing = (Math.atan2(npc.pos[1] - this.player.pos[1], npc.pos[0] - this.player.pos[0]) * 180) / Math.PI;
      this.player.avatar.setFacing(this.player.facing);
    };
    faceNpc();
    if (this.activity) this.endActivity(false);
    this.npcs.faceTowards(id, this.player.pos);
    const nav = this.nav;
    const STAND = prop.id === 'bola' ? 3.2 : 1.15;
    const fx = new m.ScoldFx({
      scene: this.scene, kind: prop.id, reducedMotion: rm,
      ceo: { root: this.player.avatar.root, model: this.player.avatar.model },
      head: () => this.npcs.headOf(id) ?? toThree(npc.pos[0], npc.pos[1], 1.75),
      floorY: this.world.floors.find((f) => f.id === npc.floor)!.elevation,
      camera: this.rig.camera,
      shake: rm ? null : this.renderer.domElement,
      // Step closer when the persona is out of reach; walls stop the CEO.
      approach: (dt) => {
        faceNpc();
        const dx = npc.pos[0] - this.player.pos[0];
        const dy = npc.pos[1] - this.player.pos[1];
        const d = Math.hypot(dx, dy);
        if (d <= STAND + 0.05) { this.player.avatar.play('idle', 0.12); return true; }
        const stepLen = Math.min(d - STAND, 4 * dt);
        const next: Vec2 = [this.player.pos[0] + (dx / d) * stepLen, this.player.pos[1] + (dy / d) * stepLen];
        if (!nav.walkableAt(next)) { this.player.avatar.play('idle', 0.12); return true; }
        this.player.pos = next;
        this.player.avatar.locomotion(4, dt, 0, rm);
        this.activityUntil = performance.now() + 2500;
        return false;
      },
      onSwing: () => sound.sfx('whoosh'),
      onImpact: land,
    });
    this.scoldFx.push(fx);
    // Keep the frame loop's locomotion from overriding the swing pose.
    this.activityUntil = performance.now() + 2500;
    return res;
  }

  /** Advance reprimand effects after the CEO's clip posed the skeleton. */
  private updateScold(dt: number) {
    if (!this.scoldFx.length) return;
    this.scoldFx = this.scoldFx.filter((f) => f.update(dt));
  }

  /** True during an impact hit-stop: the CEO and personas hold for ~80 ms. */
  private get scoldFrozen(): boolean { return this.scoldFx.some((f) => f.frozen); }

  /** Live reprimand effects (tests). */
  scoldFxCount(): number { return this.scoldFx.length; }

  /** Plan-view state for the minimap and floor map: the CEO and every persona. */
  mapSnapshot() {
    return {
      floor: this.player.floor, pos: [this.player.pos[0], this.player.pos[1]] as Vec2, facing: this.player.facing, visitor: this.settings.visitor,
      people: this.npcs.sim.npcs.map((n) => {
        const busy = n.workStatus === 'working' || n.workStatus === 'waiting';
        return {
          id: n.id, name: n.name, role: n.role, floor: n.floor, pos: [n.pos[0], n.pos[1]] as Vec2, busy,
          doing: busy ? t(WORK_LABEL[n.workStatus]) : (ACTIVITY_LABEL[n.activity] ? t(ACTIVITY_LABEL[n.activity]) : n.activity),
          movingTo: n.via?.to ?? null,
        };
      }),
    };
  }

  /** Accessible path: move next to an NPC and open the dialog without 3D navigation. */
  meet(id: string) {
    const npc = this.npcs.sim.npcs.find((n) => n.id === id);
    if (!npc) { toast(t('Persona tidak ditemukan.')); return; }
    const fr = this.floors.get(npc.floor)!;
    const spot = fr.nav[this.mode].nearestWalkable(npc.pos, 2.0, fr.reach[this.mode]);
    if (!spot) { toast(t('{name} sedang di area yang tidak dapat dicapai pada mode ini.', { name: npc.name })); return; }
    this.toggleDirectory(false);
    this.transition(() => {
      this.player.floor = npc.floor;
      this.player.pos = spot;
      this.applyFloorVisibility();
      this.talkTo(id);
    });
  }

  start() {
    // First paint uses the procedural kit; Blender furniture swaps in when loaded.
    loadFurnitureKit(Object.keys(this.world.catalog)).then(({ kit, failed }) => {
      setFurnitureKit(kit);
      this.furnitureKit = { loaded: kit.size, failed };
      this.refreshFixtureMeshes();
      if (failed.length) console.warn(`furniture GLB missing, procedural fallback for: ${failed.join(', ')}`);
    });
    this.player.avatar.load('assets/characters/ch-ceo.glb').then((ok) => {
      if (!ok) toast(t('Model karakter belum tersedia: memakai placeholder berlabel.'), 4000);
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
    // The mini game layer covers the office; skip the 3D frame (the host runs its own loop).
    if (this.miniGame && document.documentElement.hasAttribute('data-minigame')) return;
    this.lastRawMs = raw * 1000;
    this.frameTimes.push(this.lastRawMs);
    if (this.frameTimes.length > 4000) this.frameTimes.splice(0, 1000);
    const nav = this.nav;
    const safe = this.world.waypoints.find((w) => w.id === this.world.floors.find((f) => f.id === this.player.floor)!.safePoint)!;
    if (this.player.ensureWalkable(nav, safe.pos)) toast(t('Posisi tidak valid, kembali ke titik aman.'));
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
    const others = this.npcs.sim.npcs.filter((n) => n.floor === this.player.floor).map((n) => n.pos);
    const wasGhost = this.player.ghost;
    const moved = this.activity ? 0 : this.player.step(dt, dir, run, nav, others);
    // One short hint when the CEO starts walking through a persona.
    if (this.player.ghost && !wasGhost && performance.now() > this.ghostHintAt) {
      this.ghostHintAt = performance.now() + 8000;
      toast(this.player.ghostBy === 'run' ? t('Lari: menembus NPC.') : t('Terhalang NPC 2 detik: menembus.'), 1400);
    }
    const speed = moved / Math.max(dt, 1e-4);
    this.footsteps(moved, speed);
    if (this.activity) {
      this.player.avatar.play(slotClip(this.activity.slot));
      this.player.avatar.setFacing(this.activity.slot.facing);
      if (Math.floor(performance.now() / 500) !== Math.floor((performance.now() - dt * 1000) / 500)) this.renderActivity();
      this.player.avatar.settle();
    } else if (performance.now() > this.activityUntil || speed > 0.2) {
      this.player.avatar.locomotion(speed, dt, this.player.turnRate, this.settings.reducedMotion);
    }
    this.player.avatar.setGroundSpeed(speed);
    const frozen = this.scoldFrozen;
    this.player.avatar.update(frozen ? 0 : dt, Math.min(1, speed / 2), this.settings.reducedMotion);
    const pv = this.playerVec();
    this.player.avatar.root.position.copy(pv);
    this.player.avatar.lookAt(this.activity ? null : this.lookTarget(), dt, this.settings.reducedMotion);
    this.updateScold(dt);
    if (this.activity?.slot.pose === 'sit') {
      const el = this.world.floors.find((f) => f.id === this.activity!.slot.floor)!.elevation;
      this.player.avatar.root.position.copy(toThree(this.activity.slot.pos[0], this.activity.slot.pos[1], el));
    }
    this.rig.update(this.studioOpen && this.studioFocus ? this.studioFocus : pv, dt);
    this.followSun(pv);
    // Seated CEO (activity) is not in the way; standing or walking CEO is.
    this.npcs.sim.setPlayer(this.activity ? null : this.player.floor, this.player.pos);
    const labelBlockers = [...document.querySelectorAll('.hud-top, .joystick, .touch-btn, #prompt, .activity-chip, .minimap, #pad-legend')]
      .map(el => el.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
    this.npcs.update(frozen ? 0 : dt, this.player.floor, this.rig.camera, this.stage.clientWidth, this.stage.clientHeight, this.settings.reducedMotion, this.player.pos, labelBlockers);
    const agents = [{ floor: this.player.floor, pos: this.player.pos }, ...this.npcs.sim.npcs.map((n) => ({ floor: n.floor, pos: n.pos }))];
    this.doors.update(dt, agents, this.settings.visitor, this.settings.reducedMotion);
    for (const d of this.doors.justOpened) this.spatial('door', d.floor, d.centre);
    this.doorMeshes.sync(this.world);
    $('sim-clock').textContent = this.npcs.sim.clockLabel();
    this.updateFocus(dt);
    this.updateRoom();
    this.updateLabels(labelBlockers);
    this.onFrame?.(dt);
    this.renderer.render(this.scene, this.rig.camera);
  }

  /** "E: Sapa" on a keyboard, "Aksi: Sapa" on touch, the Cross glyph and "Sapa" on a DualSense. */
  private setPrompt(prompt: HTMLElement, label: string) {
    const d = currentDevice();
    const prof = PAD_PROFILES[this.settings.padProfile] ?? PAD_PROFILES.standar;
    const sig = `${d}|${currentPadKind()}|${prof.swapFace}|${label}`;
    if (sig === this.promptSig) return;
    this.promptSig = sig;
    if (d === 'pad') prompt.replaceChildren(glyph(facePart('a', prof.swapFace), currentPadKind()), ` ${label}`);
    else prompt.textContent = `${d === 'touch' ? t('Aksi') : 'E'}: ${label}`;
  }

  private updateFocus(dt: number) {
    const prompt = $('prompt');
    if (this.studioOpen) { prompt.hidden = true; this.marker.visible = false; this.focusTarget = null; return; }
    if (this.activity) {
      const act = this.activity.slot.activity;
      this.setPrompt(prompt, act === 'billiards' ? t('Pukul bola') : act === 'game' ? t('Main ronde berikut') : t('Selesai'));
      prompt.hidden = false;
      this.focusTarget = null;
      this.marker.visible = false;
      return;
    }
    const it = this.nearestInteractable();
    if (it !== this.focusTarget || prompt.hidden === !!it) {
      this.focusTarget = it;
      if (it) prompt.hidden = false;
      else prompt.hidden = true;
    }
    if (it) this.setPrompt(prompt, it.label);
    if (it) {
      const elev = this.world.floors.find((f) => f.id === it.floor)!.elevation;
      this.marker.visible = true;
      this.marker.position.copy(toThree(it.pos[0], it.pos[1], elev + 0.03));
      const s = this.settings.reducedMotion ? 1 : 1 + 0.08 * Math.sin(performance.now() / 260);
      this.marker.scale.setScalar(s);
    } else this.marker.visible = false;
    void dt;
  }

  /**
   * Positional one-shot: louder when near the CEO, silent beyond 14 m or on
   * another floor, panned by the angle relative to the camera.
   */
  spatial(name: string, floor: FloorId, pos: Vec2, base = 1) {
    if (floor !== this.player.floor) return;
    const dx = pos[0] - this.player.pos[0];
    const dy = pos[1] - this.player.pos[1];
    const d = Math.hypot(dx, dy);
    if (d > 14) return;
    const gain = base / (1 + d * d * 0.06);
    const right = this.rig.planDirection(1, 0);
    const pan = d > 0.3 ? (dx * right[0] + dy * right[1]) / d : 0;
    sound.sfx(name, { gain, pan: pan * 0.8 });
  }

  /** Nearest persona within 3 m on this floor, for the CEO's head turn. */
  private lookTarget(): THREE.Vector3 | null {
    let best: Vec2 | null = null;
    let bd = 3;
    for (const n of this.npcs.sim.npcs) {
      if (n.floor !== this.player.floor) continue;
      const d = Math.hypot(n.pos[0] - this.player.pos[0], n.pos[1] - this.player.pos[1]);
      if (d < bd) { bd = d; best = n.pos; }
    }
    if (!best) return null;
    const elev = this.world.floors.find((f) => f.id === this.player.floor)!.elevation;
    return toThree(best[0], best[1], elev + 1.4);
  }

  private stride = 0;
  /** One step sound per stride: ~0.75 m walking, ~1.1 m running. */
  private footsteps(moved: number, speed: number) {
    if (moved <= 0) { this.stride = 0; return; }
    this.stride += moved;
    const len = speed > 2.4 ? 1.1 : 0.75;
    if (this.stride >= len) {
      this.stride -= len;
      sound.sfx('step', { gain: speed > 2.4 ? 0.7 : 0.45, rate: 0.9 + Math.random() * 0.2 });
    }
  }

  private updateRoom() {
    let id: string | null = null;
    for (const r of this.world.rooms) if (r.floor === this.player.floor && insidePoly(this.player.pos, r.polygon)) { id = r.id; break; }
    if (id !== this.roomId) {
      this.roomId = id;
      if (!this.miniGame) sound.music(this.areaTrack());
      const r = this.world.rooms.find((x) => x.id === id);
      $('room-name').textContent = r ? r.name : t('Di luar ruang');
    }
  }

  private updateLabels(labelBlockers: LabelBlocker[]) {
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
      const screenY = ((1 - v.y) / 2) * h;
      const screenX = ((v.x + 1) / 2) * w;
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1
        && labelClear(screenX - tag.offsetWidth / 2, screenY - tag.offsetHeight / 2,
          tag.offsetWidth, tag.offsetHeight, labelBlockers);
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
      floorTriangles: Object.fromEntries([...this.floors].map(([k, v]) => {
        let t = 0;
        v.build.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { const g = m.geometry as THREE.BufferGeometry; t += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
        return [k, Math.round(t)];
      })),
      furnitureKit: this.furnitureKit,
      npcLod: this.npcs.lodCounts(),
    };
  }
}

const PLAYER_ID = 'ACT-BUDI';

const VERB: Record<string, string> = {
  desk: 'Pakai workstation', coffee: 'Bikin kopi', chat: 'Diskusi', read: 'Membaca', stretch: 'Peregangan',
  game: 'Main game', billiards: 'Main biliar', exercise: 'Olahraga', rest: 'Istirahat',
};

export function slotVerb(slot: ActivitySlot): string {
  if (slot.pose === 'sit' && (slot.activity === 'chat' || slot.activity === 'rest' || slot.activity === 'read')) return t('Duduk');
  return VERB[slot.activity] ? t(VERB[slot.activity]) : t('Pakai');
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
      ['ID', room.id], [t('Lantai'), world.floors.find((f) => f.id === room.floor)!.name], [t('Fungsi'), room.function],
      [t('Luas (as dinding)'), t('{area} m2 (proposal)', { area: area.toFixed(2) })], [t('Kursi dari fixture'), String(seats)],
      [t('Akses'), room.access === 'restricted' ? t('terbatas') : room.access], [t('Lantai finish'), t(room.finish.floor)],
      [t('Status'), reachable ? t('dapat dicapai pada mode ini') : t('tidak dapat dicapai pada mode ini')],
    ]),
    el('p', { class: 'muted small' }, t('Ukuran adalah proposal konsep (AS-DIM-01, AS-DIM-02), bukan luas yang disahkan.')),
  ]);
}

export function showPersonaCard(world: World, id: string) {
  const a = world.actors.find((x) => x.id === id)!;
  const home = world.rooms.find((r) => r.id === a.homeRoom);
  infoDialog(a.displayName, [
    dl([[t('Peran'), a.role], [t('Ruang utama'), home ? home.name : '-'], [t('Jenis'), a.kind === 'player' ? t('avatar pemain (CEO)') : t('persona NPC')]]),
    el('p', {}, t('Representasi virtual original. Bukan likeness orang nyata dan bukan bukti pekerjaan sedang berjalan.')),
    el('p', { class: 'muted small' }, t('Status kerja nyata (workStatus) tidak tersedia: integrasi private dinonaktifkan sampai ada izin.')),
  ]);
}

function showBlueprintCard(world: World) {
  const link = el('a', { href: 'docs/A-101.pdf', target: '_blank', rel: 'noopener' }, t('Buka A-101 Denah Lantai 1 (PDF)'));
  const status = el('p', { class: 'muted small', role: 'status' }, t('Memeriksa ketersediaan PDF...'));
  fetch('docs/manifest.json').then((r) => r.json()).then((m: { docs: { href: string }[] }) => {
    const ok = m.docs.some((d) => d.href === 'docs/A-101.pdf');
    status.textContent = ok ? t('PDF tersedia pada build ini.') : t('PDF A-101 belum dihasilkan pada build ini.');
    if (!ok) link.remove();
  }).catch(() => { status.textContent = t('Daftar dokumen gagal dimuat.'); });
  infoDialog(t('Meja denah: blueprint dan ICT'), [
    el('p', {}, t('Dataset {id}: {rooms} ruang, {doors} pintu, {fixtures} fixture, {outlets} outlet ICT.', { id: world.revision.id, rooms: world.rooms.length, doors: world.doors.length, fixtures: world.fixtures.length, outlets: world.ict.outlets.length })),
    el('p', {}, t('Semua gambar berstatus KONSEP, bukan untuk konstruksi. DWG native BLOCKED karena AutoCAD tidak tersedia; DXF dan PDF dihasilkan dari dataset yang sama.')),
    link, status,
  ]);
}

function showArtworkCard(fx: Fixture) {
  infoDialog(t('Karya di dinding'), [
    el('p', {}, t('Karya {id}: komposisi geometris original buatan generator proyek (bukan aset pihak ketiga).', { id: fx.artwork ?? fx.id })),
    el('p', { class: 'muted small' }, t('Pamflet dan signage final menyusul di M3 (brief Kevin).')),
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
