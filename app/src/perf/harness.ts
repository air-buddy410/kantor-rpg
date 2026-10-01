// Fixed-route benchmark (REQ-PERF-01). Activated with ?perf=route. The CEO is
// driven by autopilot along navgrid paths through both floors for a fixed
// duration; frame times are recorded and summarised on window.__perfResult.
// Results describe this client only; nothing here claims a device-wide FPS.
import type { Game } from '../game/game';
import type { Vec2 } from '../world/types';

interface Leg { floor: 'L1' | 'L2'; to: Vec2; link?: string }

const ROUTE: Leg[] = [
  { floor: 'L1', to: [10, 9.25] },
  { floor: 'L1', to: [4, 4.5] },
  { floor: 'L1', to: [10, 9.25] },
  { floor: 'L1', to: [14.8, 11.3], link: 'VL-STAIR-A@L1' },
  { floor: 'L2', to: [10.5, 17.5] },
  { floor: 'L2', to: [24, 12.5] },
  { floor: 'L2', to: [16.2, 11.3], link: 'VL-STAIR-A@L2' },
  { floor: 'L1', to: [22.5, 17.5] },
  { floor: 'L1', to: [14, 3] },
];

export function runPerfRoute(game: Game, seconds = 60): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const frames: number[] = [];
    let leg = 0;
    let path: Vec2[] | null = null;
    let idx = 0;
    const t0 = performance.now();
    let distance = 0;
    let last: Vec2 = [...game.player.pos] as Vec2;
    game.onFrame = () => {
      frames.push(game.lastRawMs);
      distance += Math.hypot(game.player.pos[0] - last[0], game.player.pos[1] - last[1]);
      last = [...game.player.pos] as Vec2;
      const elapsed = (performance.now() - t0) / 1000;
      if (elapsed >= seconds) {
        game.autopilot = null;
        game.onFrame = null;
        resolve(summarise(frames, game, elapsed, distance));
        return;
      }
      const L = ROUTE[leg % ROUTE.length];
      if (game.player.floor !== L.floor) { game.autopilot = null; return; }
      if (!path) { path = game.nav.findPath(game.player.pos, L.to); idx = 0; if (!path) { leg++; return; } }
      const target = path[Math.min(idx, path.length - 1)];
      const dx = target[0] - game.player.pos[0];
      const dy = target[1] - game.player.pos[1];
      const d = Math.hypot(dx, dy);
      if (d < 0.25) {
        idx++;
        if (idx >= path.length) {
          path = null;
          game.autopilot = null;
          if (L.link) (window as unknown as { __kantor: { useInteractable: (id: string) => void } }).__kantor.useInteractable(L.link);
          leg++;
        }
        return;
      }
      game.autopilot = { dir: [dx / d, dy / d], run: false };
    };
  });
}

function summarise(frames: number[], game: Game, elapsed: number, distance: number) {
  const sorted = [...frames].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return {
    label: 'fixed route benchmark; client-specific measurement',
    seconds: Number(elapsed.toFixed(1)),
    frames: frames.length,
    fpsAverage: Number((frames.length / elapsed).toFixed(1)),
    frameMsMedian: Number(q(0.5).toFixed(2)),
    frameMsP95: Number(q(0.95).toFixed(2)),
    frameMsMax: Number(sorted[sorted.length - 1].toFixed(2)),
    framesOver33ms: frames.filter((f) => f > 33.4).length,
    dropRate: Number((frames.filter((f) => f > 33.4).length / frames.length).toFixed(3)),
    distanceM: Number(distance.toFixed(1)),
    floorSwitches: game.floorSwitches,
    renderer: game.rendererName,
    lowQuality: game.lowQuality,
    pixelRatio: game.renderer.getPixelRatio(),
    viewport: [innerWidth, innerHeight],
    jsHeapMB: mem ? Number((mem.usedJSHeapSize / 1048576).toFixed(1)) : null,
    stats: game.stats(),
    userAgent: navigator.userAgent,
  };
}
