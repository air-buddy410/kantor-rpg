import './styles.css';
import worldJson from '@design/world.json';
import wallsJson from '@design/derived/walls.json';
import { Game } from './game/game';
import { runPerfRoute } from './perf/harness';
import { renderDirectory } from './ui/directory';
import { $, openDialog, toast } from './ui/dom';
import { applyTheme, loadSettings, saveSettings, type Settings } from './ui/settings';
import type { DerivedWalls, World } from './world/types';
import { showPersonaCard, showRoomCard } from './game/game';

const world = worldJson as unknown as World;
const walls = wallsJson as unknown as DerivedWalls;
const params = new URLSearchParams(location.search);
const settings = loadSettings();
applyTheme(settings);

declare global {
  interface Window { __kantor?: Record<string, unknown>; __perfResult?: Record<string, unknown> }
}

function webglAvailable(): string | null {
  if (params.get('nogl') === '1') return 'WebGL dimatikan lewat parameter ?nogl=1 (uji fallback).';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return gl ? null : 'Browser ini tidak menyediakan WebGL.';
  } catch {
    return 'Pembuatan konteks WebGL gagal.';
  }
}

function enterFallback(reason: string) {
  const app = $('app');
  app.dataset.mode = 'fallback';
  $('stage').replaceChildren();
  $('touch').hidden = true;
  $('fallback').hidden = false;
  $('fallback-reason').textContent = reason;
  $('room-name').textContent = 'Mode direktori';
  const panel = $('directory-panel');
  panel.hidden = false;
  $('fallback').append(panel);
  renderDirectory(world, {
    mode3d: false,
    canGo: (r) => ({ ok: !(settings.visitor && r.access === 'restricted') }),
    go: () => {},
    showRoom: (r) => showRoomCard(world, r, !(settings.visitor && r.access === 'restricted')),
    showPersona: (id) => showPersonaCard(world, id),
  });
  window.__kantor = { mode: 'fallback', reason };
}

function wireSettings(game: Game | null, s: Settings) {
  const dlg = $('dlg-settings') as HTMLDialogElement;
  const form = dlg.querySelector('form')!;
  $('btn-settings').addEventListener('click', (e) => {
    (form.elements.namedItem('theme') as RadioNodeList).value = s.theme;
    (form.elements.namedItem('quality') as RadioNodeList).value = s.quality;
    (form.elements.namedItem('reducedMotion') as HTMLInputElement).checked = s.reducedMotion;
    (form.elements.namedItem('visitor') as HTMLInputElement).checked = s.visitor;
    $('settings-renderer').textContent = game ? `Renderer: ${game.rendererName}. Kualitas aktif: ${game.lowQuality ? 'ringan' : 'tinggi'}. Perubahan kualitas berlaku setelah muat ulang.` : 'Mode direktori: renderer 3D tidak aktif.';
    openDialog(dlg, e.currentTarget as HTMLElement);
  });
  form.addEventListener('change', () => {
    s.theme = (form.elements.namedItem('theme') as RadioNodeList).value as Settings['theme'];
    s.quality = (form.elements.namedItem('quality') as RadioNodeList).value as Settings['quality'];
    s.reducedMotion = (form.elements.namedItem('reducedMotion') as HTMLInputElement).checked;
    const visitor = (form.elements.namedItem('visitor') as HTMLInputElement).checked;
    applyTheme(s);
    if (game && visitor !== s.visitor) game.setVisitor(visitor);
    s.visitor = visitor;
    saveSettings(s);
  });
}

function wireCommon() {
  $('btn-help').addEventListener('click', (e) => openDialog($('dlg-help') as HTMLDialogElement, e.currentTarget as HTMLElement));
  $('directory-close').addEventListener('click', () => {
    $('directory-panel').hidden = true;
    $('btn-directory').setAttribute('aria-expanded', 'false');
    $('btn-directory').focus();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('directory-panel').hidden && !document.querySelector('dialog[open]') && $('app').dataset.mode !== 'fallback') {
      $('directory-panel').hidden = true;
      $('btn-directory').setAttribute('aria-expanded', 'false');
      $('btn-directory').focus();
    }
  });
}

function boot() {
  wireCommon();
  const reason = webglAvailable();
  if (reason) {
    enterFallback(reason);
    wireSettings(null, settings);
    $('btn-directory').addEventListener('click', () => $('directory-panel').focus());
    return;
  }
  let game: Game;
  try {
    game = new Game($('stage'), world, walls, settings);
  } catch (err) {
    enterFallback(`Renderer 3D gagal dibuat: ${(err as Error).message}`);
    wireSettings(null, settings);
    return;
  }
  $('app').dataset.mode = 'world';
  wireSettings(game, settings);
  $('btn-directory').addEventListener('click', () => game.toggleDirectory());
  window.addEventListener('kantor:fallback', (e) => enterFallback((e as CustomEvent<string>).detail));
  game.start();
  window.__kantor = {
    mode: 'world',
    state: () => ({ floor: game.player.floor, pos: game.player.pos, facing: game.player.facing, room: game.roomId, visitor: game.settings.visitor, avatarPlaceholder: game.player.avatar.isPlaceholder, clips: game.player.avatar.clipNames, recoveries: game.player.stuckRecoveries, floorSwitches: game.floorSwitches }),
    stats: () => game.stats(),
    npcs: () => game.npcs.sim.npcs.map((n) => ({ id: n.id, floor: n.floor, pos: n.pos, phase: n.phase, activity: n.activity, slot: n.slot, workStatus: n.workStatus })),
    simTime: () => game.npcs.sim.time,
    renderer: game.rendererName,
    // Test/benchmark helper: drives the CEO with the normal movement code along
    // a navgrid path (no teleport). Resolves false when no path exists.
    walkTo: (x: number, y: number, timeoutMs = 90000) => new Promise<boolean>((resolve) => {
      const path = game.nav.findPath(game.player.pos, [x, y]);
      if (!path) { resolve(false); return; }
      let i = 0;
      const t0 = performance.now();
      game.onFrame = () => {
        const tgt = path[Math.min(i, path.length - 1)];
        const dx = tgt[0] - game.player.pos[0];
        const dy = tgt[1] - game.player.pos[1];
        const d = Math.hypot(dx, dy);
        if (d < 0.2) i++;
        if (i >= path.length || performance.now() - t0 > timeoutMs) {
          game.autopilot = null;
          game.onFrame = null;
          resolve(i >= path.length);
          return;
        }
        game.autopilot = d < 0.2 ? null : { dir: [dx / d, dy / d], run: true };
      };
    }),
    useInteractable: (id: string) => {
      const it = (game as unknown as { interactables: { id: string; run: () => void }[] }).interactables.find((x) => x.id === id);
      it?.run();
    },
  };
  if (params.get('perf') === 'route') {
    const secs = Number(params.get('seconds') ?? 60);
    toast(`Benchmark rute tetap ${secs} s berjalan`, 3000);
    runPerfRoute(game, secs).then((r) => { window.__perfResult = r; toast('Benchmark selesai'); });
  }
}

boot();
