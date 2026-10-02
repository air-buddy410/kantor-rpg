// Office Studio UI. The 3D view switches to a top-down grid over one floor;
// fixtures are selected by click or from a keyboard-accessible list and
// edited through Editor, which validates every operation before commit.
import * as THREE from 'three';
import type { Game } from '../game/game';
import { toThree } from '../world/build';
import type { Fixture, FloorId, Vec2 } from '../world/types';
import { $, el, toast } from '../ui/dom';
import { Editor, GRID, LOCKED_FAMILIES, snap } from './editor';
import { LayoutError, makeLayout, MAX_IMPORT_BYTES, parseLayout, serializeLayout, store } from './layout';
import { corners, pointInPoly } from './validate';
import type { Issue } from './validate';

export class StudioUI {
  editor: Editor | null = null;
  floor: FloorId = 'L1';
  selected: string | null = null;
  private grid: THREE.LineSegments | null = null;
  private highlight: THREE.LineSegments;
  private ghost: THREE.LineSegments;
  // One instanced mesh for all outlet markers: a single draw call in Studio.
  private outletMarks: THREE.InstancedMesh;
  private drag: { id: number; start: Vec2; moved: boolean } | null = null;
  private panel: HTMLElement;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);
  private savedCamera = { yaw: 0, pitch: 1, distance: 17 };

  constructor(private game: Game) {
    this.panel = $('studio-panel');
    const mat = new THREE.LineBasicMaterial({ color: 0xc0643f, depthTest: false });
    this.highlight = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), mat);
    this.highlight.renderOrder = 10;
    this.highlight.visible = false;
    this.ghost = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0x1f4d3a, depthTest: false }));
    this.ghost.renderOrder = 11;
    this.ghost.visible = false;
    this.outletMarks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.12, 0.22), new THREE.MeshBasicMaterial({ color: 0x2f6f9f, depthTest: false }), 256);
    this.outletMarks.renderOrder = 9;
    this.outletMarks.visible = false;
    this.outletMarks.frustumCulled = false;
    game.scene.add(this.highlight, this.ghost, this.outletMarks);
    const canvas = game.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
  }

  get isOpen(): boolean { return !!this.editor; }

  open() {
    if (this.editor) return;
    const pub = store.loadPublished(this.game.world);
    const draft = store.loadDraft(this.game.world);
    const start = draft?.fixtures ?? this.game.world.fixtures;
    this.editor = new Editor(this.game.world, this.game.walls, start);
    if (draft) this.game.applyFixtures(draft.fixtures);
    this.floor = this.game.player.floor;
    this.game.studioOpen = true;
    this.savedCamera = { yaw: this.game.rig.yaw, pitch: this.game.rig.pitch, distance: this.game.rig.distance };
    this.game.rig.enabled = false;
    this.panel.hidden = false;
    this.render();
    this.showFloor(this.floor);
    window.addEventListener('keydown', this.keyHandler, true);
    this.status(draft ? 'Draft lokal dimuat.' : pub.error ? `Layout publish lokal tidak valid (${pub.error}); memakai dataset.` : 'Studio dibuka. Pilih fixture dari daftar atau klik di denah.');
    (this.panel.querySelector('select') as HTMLElement | null)?.focus();
  }

  close() {
    if (!this.editor) return;
    if (this.editor.dirty) store.saveDraft(makeLayout(this.game.world, this.editor.fixtures, 'draft otomatis'));
    const pub = store.loadPublished(this.game.world).doc;
    this.game.applyFixtures(pub?.fixtures ?? this.game.baseFixtures);
    this.editor = null;
    this.selected = null;
    this.highlight.visible = false;
    this.ghost.visible = false;
    this.outletMarks.visible = false;
    if (this.grid) { this.game.scene.remove(this.grid); this.grid.geometry.dispose(); this.grid = null; }
    this.game.studioOpen = false;
    this.game.rig.enabled = true;
    Object.assign(this.game.rig, this.savedCamera);
    this.panel.hidden = true;
    window.removeEventListener('keydown', this.keyHandler, true);
    $('btn-studio').focus();
    toast('Studio ditutup. Perubahan yang belum dipublish tersimpan sebagai draft.');
  }

  private showFloor(floor: FloorId) {
    this.floor = floor;
    if (this.game.player.floor !== floor) {
      const safe = this.game.world.waypoints.find((w) => w.id === this.game.world.floors.find((f) => f.id === floor)!.safePoint)!;
      this.game.player.floor = floor;
      this.game.player.pos = [...safe.pos] as Vec2;
      this.game.applyFloorVisibility();
    }
    if (this.grid) { this.game.scene.remove(this.grid); this.grid.geometry.dispose(); }
    this.grid = makeGrid(this.game.world.floors.find((f) => f.id === floor)!.elevation);
    this.game.scene.add(this.grid);
    this.game.studioFocus = toThree(16, 12, this.game.world.floors.find((f) => f.id === floor)!.elevation);
    this.game.rig.yaw = 0;
    this.game.rig.pitch = 1.42;
    this.game.rig.distance = 31;
    this.render();
  }

  private status(msg: string, issues: Issue[] = []) {
    const s = $('studio-status');
    s.replaceChildren(el('p', {}, msg));
    if (issues.length) {
      const ul = el('ul', { class: 'issues' });
      for (const i of issues.slice(0, 8)) ul.append(el('li', {}, i.message));
      if (issues.length > 8) ul.append(el('li', {}, `+${issues.length - 8} lainnya`));
      s.append(ul);
    }
  }

  private commit(result: { ok: boolean; issues: Issue[]; id?: string }, okMsg: string) {
    if (!this.editor) return;
    if (!result.ok) {
      this.status('Ditolak: perubahan tidak disimpan.', result.issues);
      this.render();
      return;
    }
    if (result.id) this.selected = result.id;
    this.game.applyFixtures(this.editor.fixtures);
    this.status(okMsg);
    this.render();
  }

  private selectedFixture(): Fixture | undefined {
    return this.editor?.fixtures.find((f) => f.id === this.selected);
  }

  nudge(dx: number, dy: number) {
    const fx = this.selectedFixture();
    if (!fx || !this.editor) return;
    this.commit(this.editor.apply({ kind: 'move', id: fx.id, pos: [fx.pos[0] + dx, fx.pos[1] + dy] }), `${fx.id} dipindah.`);
  }

  rotate() {
    const fx = this.selectedFixture();
    if (!fx || !this.editor) return;
    this.commit(this.editor.apply({ kind: 'rotate', id: fx.id, delta: 90 }), `${fx.id} diputar 90 derajat.`);
  }

  remove() {
    const fx = this.selectedFixture();
    if (!fx || !this.editor) return;
    const r = this.editor.apply({ kind: 'delete', id: fx.id });
    if (r.ok) this.selected = null;
    this.commit(r, `${fx.id} dihapus.`);
  }

  /** Place a new fixture near the view centre, searching outward for a valid spot. */
  add(type: string) {
    if (!this.editor) return;
    const centre = this.selectedFixture()?.pos ?? [16, 12];
    let last: Issue[] = [];
    for (let ring = 0; ring <= 12; ring++) {
      for (let k = 0; k < Math.max(1, ring * 8); k++) {
        const a = (k / Math.max(1, ring * 8)) * Math.PI * 2;
        const p: Vec2 = [snap(centre[0] + Math.cos(a) * ring * GRID * 2), snap(centre[1] + Math.sin(a) * ring * GRID * 2)];
        const r = this.editor.apply({ kind: 'add', type, floor: this.floor, pos: p });
        if (r.ok) { this.commit(r, `${r.id} ditambahkan.`); return; }
        last = r.issues;
      }
    }
    this.status('Tidak ada tempat valid di sekitar titik ini.', last);
  }

  undo() { if (this.editor?.undo()) { this.game.applyFixtures(this.editor.fixtures); this.status('Undo.'); this.render(); } }
  redo() { if (this.editor?.redo()) { this.game.applyFixtures(this.editor.fixtures); this.status('Redo.'); this.render(); } }

  validate() {
    if (!this.editor) return;
    const issues = this.editor.validateAll();
    this.status(issues.length ? `${issues.length} masalah ditemukan.` : 'Valid: tidak ada overlap, pintu bebas, semua ruang dan slot terjangkau.', issues);
  }

  saveDraft() {
    if (!this.editor) return;
    this.status(store.saveDraft(makeLayout(this.game.world, this.editor.fixtures, 'draft')) ? 'Draft tersimpan di browser ini.' : 'Penyimpanan browser tidak tersedia; gunakan Export JSON.');
  }

  exportJson() {
    if (!this.editor) return;
    const blob = new Blob([serializeLayout(makeLayout(this.game.world, this.editor.fixtures, 'export Office Studio'))], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `kantor-rpg-layout-${this.game.world.revision.id}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    this.status('Layout diekspor sebagai JSON.');
  }

  async importJson(file: File) {
    if (!this.editor) return;
    if (file.size > MAX_IMPORT_BYTES) { this.status(`Import ditolak: file lebih dari ${MAX_IMPORT_BYTES / 1024} KB. Layout sekarang tidak berubah.`); return; }
    try {
      const doc = parseLayout(await file.text(), this.game.world);
      const ed = new Editor(this.game.world, this.game.walls, doc.fixtures);
      const issues = ed.validateAll();
      if (issues.length) { this.status('Import ditolak: layout tidak valid. Layout sekarang tidak berubah.', issues); return; }
      this.editor = ed;
      this.editor.dirty = true;
      this.selected = null;
      this.game.applyFixtures(ed.fixtures);
      this.status(`Layout diimpor (${doc.fixtures.length} fixture). Belum dipublish.`);
      this.render();
    } catch (e) {
      this.status(`Import ditolak: ${e instanceof LayoutError ? e.message : 'file tidak terbaca'}. Layout sekarang tidak berubah.`);
    }
  }

  publish() {
    if (!this.editor) return;
    const issues = this.editor.validateAll();
    if (issues.length) { this.status('Publish ditolak: perbaiki masalah dulu.', issues); return; }
    const ok = store.publish(makeLayout(this.game.world, this.editor.fixtures, 'publish lokal'));
    store.clearDraft();
    this.editor.dirty = false;
    this.status(ok ? 'Dipublish lokal di browser ini (bukan repo, bukan server).' : 'Penyimpanan browser tidak tersedia: publish lokal gagal.');
    this.render();
  }

  rollback() {
    if (!this.editor) return;
    const doc = store.rollback(this.game.world);
    const fixtures = doc?.fixtures ?? this.game.baseFixtures;
    this.editor = new Editor(this.game.world, this.game.walls, fixtures);
    this.selected = null;
    this.game.applyFixtures(fixtures);
    this.status(doc ? 'Kembali ke publish sebelumnya.' : 'Kembali ke dataset asli (world.json).');
    this.render();
  }

  private onKey(e: KeyboardEvent) {
    if (!this.editor || document.querySelector('dialog[open]')) return;
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    let handled = true;
    if (ctrl && k === 'z' && !e.shiftKey) this.undo();
    else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) this.redo();
    else if (k === 'arrowleft') this.nudge(-GRID, 0);
    else if (k === 'arrowright') this.nudge(GRID, 0);
    else if (k === 'arrowup') this.nudge(0, GRID);
    else if (k === 'arrowdown') this.nudge(0, -GRID);
    else if (k === 'r') this.rotate();
    else if (k === 'delete' || k === 'backspace') this.remove();
    else if (k === 'escape') { if (this.selected) { this.selected = null; this.render(); } else this.close(); }
    else handled = ['w', 'a', 's', 'd', 'e', 'm', 'q', 'z', 'shift'].includes(k); // swallow game keys while editing
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }

  private planPoint(e: PointerEvent): Vec2 | null {
    const rect = this.game.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.game.rig.camera);
    const elev = this.game.world.floors.find((f) => f.id === this.floor)!.elevation;
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -elev), hit)) return null;
    return [hit.x, -hit.z];
  }

  private onPointerDown(e: PointerEvent) {
    if (!this.editor) return;
    const p = this.planPoint(e);
    if (!p) return;
    const hit = [...this.editor.fixtures].reverse().find((f) => f.floor === this.floor && pointInPoly(p, corners(f)));
    this.selected = hit?.id ?? null;
    if (hit) {
      this.drag = { id: e.pointerId, start: p, moved: false };
      this.game.renderer.domElement.setPointerCapture(e.pointerId);
    }
    this.render();
  }

  private onPointerMove(e: PointerEvent) {
    if (!this.editor || !this.drag || e.pointerId !== this.drag.id) return;
    const p = this.planPoint(e);
    const fx = this.selectedFixture();
    if (!p || !fx) return;
    const dx = p[0] - this.drag.start[0];
    const dy = p[1] - this.drag.start[1];
    if (Math.hypot(dx, dy) > GRID / 2) this.drag.moved = true;
    if (this.drag.moved) this.placeBox(this.ghost, { ...fx, pos: [snap(fx.pos[0] + dx), snap(fx.pos[1] + dy)] });
  }

  private onPointerUp(e: PointerEvent) {
    if (!this.editor || !this.drag || e.pointerId !== this.drag.id) return;
    const p = this.planPoint(e);
    const fx = this.selectedFixture();
    const { moved, start } = this.drag;
    this.drag = null;
    this.ghost.visible = false;
    if (!p || !fx || !moved) return;
    const target: Vec2 = [fx.pos[0] + p[0] - start[0], fx.pos[1] + p[1] - start[1]];
    this.commit(this.editor.apply({ kind: 'move', id: fx.id, pos: target }), `${fx.id} dipindah.`);
  }

  private placeBox(box: THREE.LineSegments, fx: Pick<Fixture, 'pos' | 'rot' | 'size' | 'floor'>) {
    const elev = this.game.world.floors.find((f) => f.id === fx.floor)!.elevation;
    box.position.copy(toThree(fx.pos[0], fx.pos[1], elev + fx.size[2] / 2));
    box.rotation.set(0, (fx.rot * Math.PI) / 180, 0);
    box.scale.set(fx.size[0], Math.max(0.05, fx.size[2]), fx.size[1]);
    box.visible = true;
  }

  /** Outlet markers for the shown floor, at the derived (furniture-following) positions. */
  private placeOutlets() {
    if (!this.editor) return;
    const elev = this.game.world.floors.find((f) => f.id === this.floor)!.elevation;
    const m = new THREE.Matrix4();
    let n = 0;
    for (const o of this.editor.outlets()) {
      if (o.floor !== this.floor || n >= this.outletMarks.count) continue;
      m.makeTranslation(toThree(o.pos[0], o.pos[1], elev + 0.08));
      this.outletMarks.setMatrixAt(n++, m);
    }
    this.outletMarks.count = n;
    this.outletMarks.instanceMatrix.needsUpdate = true;
    this.outletMarks.visible = true;
  }

  render() {
    const body = $('studio-body');
    if (!this.editor) return;
    const ed = this.editor;
    const fx = this.selectedFixture();
    this.outletMarks.count = 256;
    this.placeOutlets();
    if (fx) this.placeBox(this.highlight, fx);
    else this.highlight.visible = false;
    body.replaceChildren();
    const floors = el('div', { class: 'seg', role: 'group', 'aria-label': 'Lantai' });
    for (const f of this.game.world.floors) {
      const b = el('button', { type: 'button', class: 'btn', 'aria-pressed': String(f.id === this.floor) }, f.id);
      b.addEventListener('click', () => this.showFloor(f.id));
      floors.append(b);
    }
    const pick = el('select', { id: 'studio-pick', 'aria-label': 'Pilih fixture' });
    pick.append(el('option', { value: '' }, 'Pilih fixture...'));
    for (const room of this.game.world.rooms.filter((r) => r.floor === this.floor)) {
      const items = ed.fixtures.filter((f) => f.room === room.id);
      if (!items.length) continue;
      const g = el('optgroup', { label: room.name });
      for (const f of items) {
        const o = el('option', { value: f.id }, `${f.id} · ${this.game.world.catalog[f.type].label}${ed.editable(f) ? '' : ' (terkunci)'}`);
        if (f.id === this.selected) o.selected = true;
        g.append(o);
      }
      pick.append(g);
    }
    pick.addEventListener('change', () => { this.selected = pick.value || null; this.render(); (document.getElementById('studio-pick') as HTMLElement)?.focus(); });
    const info = el('p', { class: 'muted small', id: 'studio-selected' });
    const lock = fx ? ed.lockedReason(fx) : null;
    info.textContent = fx ? `${fx.id} di ${this.game.world.rooms.find((r) => r.id === fx.room)?.name}; posisi ${fx.pos[0].toFixed(2)}, ${fx.pos[1].toFixed(2)} m; rotasi ${fx.rot} derajat.${lock ? ` Terkunci: ${lock}` : ''}` : 'Belum ada fixture terpilih.';
    const ict = ed.outletDerivation();
    const own = fx ? ict.outlets.find((o) => o.serves === fx.id) : undefined;
    const outletInfo = el('p', { class: 'muted small', id: 'studio-outlet' },
      own ? `Outlet ICT ${own.id} (${own.ports} port, ${own.domain}) ikut di ${own.pos[0].toFixed(2)}, ${own.pos[1].toFixed(2)} m.` : fx ? 'Fixture ini tidak punya outlet ICT.' : '');
    const ictSummary = el('p', { class: 'muted small', id: 'studio-ict' },
      `ICT: ${ict.outlets.length} outlet; ${ict.moved.length} ikut pindah, ${ict.removed.length} dihapus, ${ict.added.length} baru. Port map dihitung ulang dari export dengan tools/ict_derive.py --layout.`);
    const canEdit = !!fx && !lock && ed.editable(fx);
    const tools = el('div', { class: 'tool-grid' });
    const btn = (label: string, aria: string, fn: () => void, enabled: boolean) => {
      const b = el('button', { type: 'button', class: 'btn', 'aria-label': aria }, label);
      if (!enabled) b.disabled = true;
      b.addEventListener('click', fn);
      tools.append(b);
      return b;
    };
    btn('Barat', 'Geser ke barat 0,25 m', () => this.nudge(-GRID, 0), canEdit);
    btn('Utara', 'Geser ke utara 0,25 m', () => this.nudge(0, GRID), canEdit);
    btn('Selatan', 'Geser ke selatan 0,25 m', () => this.nudge(0, -GRID), canEdit);
    btn('Timur', 'Geser ke timur 0,25 m', () => this.nudge(GRID, 0), canEdit);
    btn('Putar', 'Putar 90 derajat', () => this.rotate(), canEdit);
    btn('Hapus', 'Hapus fixture terpilih', () => this.remove(), canEdit);
    btn('Undo', 'Undo', () => this.undo(), ed.canUndo());
    btn('Redo', 'Redo', () => this.redo(), ed.canRedo());
    const addRow = el('div', { class: 'add-row' });
    const typeSel = el('select', { 'aria-label': 'Tipe fixture baru' });
    for (const [type, c] of Object.entries(this.game.world.catalog)) {
      if (LOCKED_FAMILIES.has(c.family) || type === 'rack_42u') continue;
      typeSel.append(el('option', { value: type }, c.label));
    }
    const addBtn = el('button', { type: 'button', class: 'btn' }, 'Tambah');
    addBtn.addEventListener('click', () => this.add(typeSel.value));
    addRow.append(typeSel, addBtn);
    const files = el('div', { class: 'tool-grid' });
    const fbtn = (label: string, fn: () => void, primary = false) => {
      const b = el('button', { type: 'button', class: primary ? 'btn primary' : 'btn' }, label);
      b.addEventListener('click', fn);
      files.append(b);
    };
    fbtn('Validasi', () => this.validate());
    fbtn('Simpan draft', () => this.saveDraft());
    fbtn('Export JSON', () => this.exportJson());
    const imp = el('input', { type: 'file', accept: 'application/json,.json', id: 'studio-import', class: 'visually-hidden' });
    imp.addEventListener('change', () => { const f = imp.files?.[0]; if (f) void this.importJson(f); imp.value = ''; });
    const impLabel = el('label', { for: 'studio-import', class: 'btn', role: 'button', tabindex: '0' }, 'Import JSON');
    impLabel.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); imp.click(); } });
    files.append(impLabel, imp);
    fbtn('Publish lokal', () => this.publish(), true);
    fbtn(`Rollback (${store.historyCount()})`, () => this.rollback());
    const exit = el('button', { type: 'button', class: 'btn', id: 'studio-exit' }, 'Keluar Studio');
    exit.addEventListener('click', () => this.close());
    body.append(floors, pick, info, outletInfo, tools, addRow, files, el('p', { class: 'muted small' }, `Grid ${GRID} m. Panah geser, R putar, Delete hapus, Ctrl+Z/Ctrl+Y, Esc batal pilih. Publish hanya di browser ini; dataset repo tidak berubah.`), ictSummary, exit);
  }
}

function makeGrid(elev: number): THREE.LineSegments {
  const pts: number[] = [];
  const cols: number[] = [];
  const c1 = new THREE.Color(0x1f4d3a);
  const c2 = new THREE.Color(0x8a9a8f);
  for (let x = 0; x <= 32 + 1e-9; x += 0.5) {
    const c = Number.isInteger(x) ? c1 : c2;
    pts.push(x, elev + 0.02, 0, x, elev + 0.02, -24);
    cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  for (let y = 0; y <= 24 + 1e-9; y += 0.5) {
    const c = Number.isInteger(y) ? c1 : c2;
    pts.push(0, elev + 0.02, -y, 32, elev + 0.02, -y);
    cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false });
  const lines = new THREE.LineSegments(g, m);
  lines.renderOrder = 5;
  return lines;
}
