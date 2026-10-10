#!/usr/bin/env node
// Flicker probe: drives the built app (vite preview) in headless Chromium with
// SwiftShader, walks/rotates the CEO with the real keyboard input, grabs every
// rendered frame in the page (preserveDrawingBuffer) and counts pixels that
// oscillate A -> B -> A across three consecutive frames. Smooth camera motion
// changes pixels monotonically; z-fighting, sort flips and LOD/cutaway
// flip-flops show up as oscillation.
//
//   node tools/flicker_probe.mjs --label before [--url http://127.0.0.1:4173] [--out docs/evidence/AUDIT-3D]
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'app', 'package.json'));
const { chromium } = require('@playwright/test');
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const URL_ = opt('--url', 'http://127.0.0.1:4173');
const LABEL = opt('--label', 'run');
const OUT = resolve(ROOT, opt('--out', 'docs/evidence/AUDIT-3D'), LABEL);
// Profiles: desktop, and the phone Budi filmed on (portrait 464x848 CSS px, dpr 3).
const PROFILES = {
  desktop: { viewport: { width: 1280, height: 720 }, dpr: 1, scale: 2, mobile: false },
  phone: { viewport: { width: 464, height: 848 }, dpr: 3, scale: 1, mobile: true },
};
const T = 28; // luminance step (0..255) that counts as a visible change

// Each scenario: optional walk to a start point, then keys held while frames are captured.
const SCENARIOS = [
  // hold = [key, bursts]; null = stand still
  { id: 'lobby-walk-west-east', start: [14, 1.6], hold: [['a', 8], ['d', 8]] },
  { id: 'lobby-window-still', start: [11, 1.2], hold: [[null, 6]] },
  { id: 'lobby-window-rotate', start: [11, 1.2], hold: [['q', 10]] },
  { id: 'lobby-walk-north', start: [16.5, 1.2], hold: [['w', 8], ['s', 8]] },
  { id: 'corridor-rotate', start: [14, 9.5], hold: [['z', 10]] },
  { id: 'meet-window-walk', start: [3, 1.2], hold: [['d', 8], ['a', 8]] },
  { id: 'l1-walk-zoomout', start: [22, 9.5], hold: [['-', 1], ['a', 10]] },
  // Spots from Budi's phone video: stair core (divider wall, glass, rail),
  // corridor door frames, server room red partition and desk shadows.
  { id: 'stair-core-walk', start: [13.5, 12], hold: [['s', 8], ['w', 8]] },
  { id: 'stair-core-rotate', start: [13.5, 9.5], hold: [['q', 10]] },
  { id: 'ncorr-doors-walk', start: [18, 17.5], hold: [['d', 10], ['a', 10]] },
  { id: 'server-walk', start: [27, 20], hold: [['a', 8], ['d', 8]] },
];

async function run(profile, quality) {
  const P = PROFILES[profile];
  const W = P.viewport.width, H = P.viewport.height, SCALE = P.scale;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: P.viewport, deviceScaleFactor: P.dpr, isMobile: P.mobile, hasTouch: P.mobile });
  await page.addInitScript(([q]) => {
    localStorage.setItem('kantor-rpg.settings.v1', JSON.stringify({ theme: 'light', quality: q, reducedMotion: false, visitor: false }));
    // Manual frame driver: while __step.manual is set, rAF callbacks run only
    // from __step.frame() and performance.now advances exactly 1/60 s per frame.
    const realNow = performance.now.bind(performance);
    const realRaf = window.requestAnimationFrame.bind(window);
    const st = { manual: false, t: 0, queue: [] };
    window.__step = st;
    performance.now = () => (st.manual ? st.t : realNow());
    window.requestAnimationFrame = (cb) => { if (!st.manual) return realRaf((ts) => (st.manual ? st.queue.push(cb) : cb(ts))); st.queue.push(cb); return 0; };
    st.start = () => { st.t = realNow(); st.manual = true; };
    st.frame = (ms = 1000 / 60) => { st.t += ms; const q = st.queue.splice(0); q.forEach((cb) => cb(st.t)); };
    st.stop = () => { st.manual = false; const q = st.queue.splice(0); q.forEach((cb) => realRaf(cb)); };
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      if (/webgl/.test(String(type))) attrs = { ...(attrs || {}), preserveDrawingBuffer: true };
      return orig.call(this, type, attrs);
    };
  }, [quality]);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${URL_}/?seed=20261001`);
  await page.waitForFunction(() => !!window.__kantor, null, { timeout: 60_000 });
  // furniture GLBs + characters
  await page.waitForFunction(() => { const s = window.__kantor.stats(); return s && (s.furnitureKit?.loaded ?? 1) > 0; }, null, { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const info = await page.evaluate(() => ({ renderer: window.__kantor.renderer, render: window.__kantor.render(), stats: window.__kantor.stats() }));
  const results = [];
  for (const sc of SCENARIOS.filter((x) => !process.env.PROBE_ONLY || process.env.PROBE_ONLY.split(',').includes(x.id))) {
    await page.evaluate(([x, y]) => window.__kantor.walkTo(x, y, 40000), sc.start);
    await page.waitForTimeout(1200); // camera lerp settles
    // Every captured image is exactly one 1/60 s game frame, so motion between
    // samples is as small as on a 60 Hz screen whatever SwiftShader's speed.
    await page.evaluate(() => window.__step.start());
    // The game's pending real rAF must land in the manual queue before stepping.
    await page.waitForFunction(() => window.__step.queue.length > 0, null, { polling: 20 });
    await page.evaluate(([w, h, s]) => {
      const c = document.createElement('canvas');
      c.width = Math.round(w / s); c.height = Math.round(h / s);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      window.__probe = { frames: [], keep: [], size: [c.width, c.height], grab: () => {
        ctx.drawImage(document.querySelector('canvas'), 0, 0, c.width, c.height);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        const lum = new Uint8Array(c.width * c.height);
        for (let i = 0; i < lum.length; i++) lum[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) >> 8;
        window.__probe.frames.push(lum);
        if (window.__probe.frames.length % 45 === 2) window.__probe.keep.push(c.toDataURL('image/jpeg', 0.7));
      } };
    }, [W, H, SCALE]);
    for (const [key, n] of sc.hold) {
      if (key) await page.keyboard.down(key);
      // Bursts: 12 normal 1/60 s frames move the scene along the route (not
      // captured), then 8 captured micro-frames of 1/4000 s. Inside a burst
      // real motion is sub-pixel, so any A->B->A change is a depth/sort/
      // visibility flip, not a thin edge sweeping past.
      await page.evaluate((bursts) => {
        for (let k = 0; k < bursts; k++) {
          for (let j = 0; j < 12; j++) window.__step.frame();
          window.__probe.frames.push(null);
          for (let j = 0; j < 8; j++) { window.__step.frame(1000 / 4000); window.__probe.grab(); }
        }
      }, n);
      if (key) await page.keyboard.up(key);
    }
    const r = await page.evaluate(([t]) => {
            const F = window.__probe.frames;
      const [w, h] = window.__probe.size;
      const n = w * h;
      const heat = new Uint16Array(n);
      // pop = large change between two micro-frames (sub-pixel motion): a
      // toggle that is not undone in the next frame (cutaway edge, visibility).
      const pop = new Uint16Array(n);
      let pops = 0, pairs = 0;
      for (let k = 1; k < F.length; k++) {
        const [a, b] = [F[k - 1], F[k]];
        if (!a || !b) continue;
        pairs++;
        for (let i = 0; i < n; i++) if (Math.abs(b[i] - a[i]) > t * 2) { pop[i]++; pops++; }
      }
      const per = [];
      let dup = 0;
      for (let k = 2; k < F.length; k++) {
        const [a, b, c] = [F[k - 2], F[k - 1], F[k]];
        if (!a || !b || !c) continue; // burst boundary
        let same = true;
        for (let i = 0; i < n; i += 97) if (a[i] !== b[i]) { same = false; break; }
        if (same) { dup++; continue; }
        let osc = 0;
        for (let i = 0; i < n; i++) {
          const d1 = b[i] - a[i], d2 = c[i] - b[i];
          if (Math.abs(d1) > t && Math.abs(d2) > t && Math.sign(d1) !== Math.sign(d2) && Math.abs(c[i] - a[i]) < t / 2) { osc++; heat[i]++; }
        }
        per.push(osc / n);
      }
      // heatmap: pixels that oscillated in >= 2 triplets (isolated hits are motion noise)
      const hc = document.createElement('canvas'); hc.width = w; hc.height = h;
      const hx = hc.getContext('2d');
      const img = hx.createImageData(w, h);
      const last = F[F.length - 1] ?? F.filter(Boolean).pop();
      let hot = 0;
      for (let i = 0; i < n; i++) {
        const v = last[i] >> 1;
        const on = heat[i] >= 2;
        const popOn = pop[i] >= 2;
        if (on) hot++;
        img.data[i * 4] = on ? 255 : v; img.data[i * 4 + 1] = on ? 0 : v; img.data[i * 4 + 2] = on ? 0 : popOn ? 255 : v; img.data[i * 4 + 3] = 255;
      }
      hx.putImageData(img, 0, 0);
      per.sort((x, y) => x - y);
      const mean = per.reduce((s, x) => s + x, 0) / Math.max(1, per.length);
      return { frames: F.filter(Boolean).length, duplicateFrames: dup, triplets: per.length, oscMeanFrac: mean, oscP95Frac: per[Math.floor(per.length * 0.95)] ?? 0, oscMaxFrac: per[per.length - 1] ?? 0, hotPixels: hot, hotFrac: hot / n, popMeanFrac: pops / Math.max(1, pairs) / n, heat: hc.toDataURL('image/png'), keep: window.__probe.keep.slice(0, 3) };
    }, [T]);
    await page.evaluate(() => window.__step.stop());
    const st = await page.evaluate(() => window.__kantor.state());
    const dir = join(OUT, `${profile}-${quality}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${sc.id}-heat.png`), Buffer.from(r.heat.split(',')[1], 'base64'));
    r.keep.forEach((d, i) => writeFileSync(join(dir, `${sc.id}-f${i}.jpg`), Buffer.from(d.split(',')[1], 'base64')));
    delete r.heat; delete r.keep;
    results.push({ scenario: sc.id, profile, quality, endPos: st.pos, room: st.room, ...r });
    console.log(`${LABEL} ${profile}-${quality} ${sc.id}: frames=${r.frames} oscMean=${(r.oscMeanFrac * 100).toFixed(3)}% p95=${(r.oscP95Frac * 100).toFixed(3)}% hot=${r.hotPixels} pop=${(r.popMeanFrac * 100).toFixed(3)}%`);
  }
  await browser.close();
  return { profile, quality, viewport: [W, H], dpr: P.dpr, analysisScale: 1 / SCALE, info, errors, results };
}

const all = [];
const save = () => { mkdirSync(OUT, { recursive: true }); writeFileSync(join(OUT, 'flicker-probe.json'), JSON.stringify({ label: LABEL, url: URL_, threshold: T,
  method: 'A->B->A luminance oscillation over 3 consecutive captured micro-frames (1/4000 s each, manual rAF + performance.now driver), bursts separated by 12 uncaptured 1/60 s frames; hot (red) = pixel oscillated in >= 2 triplets; pop (blue) = change > 2T between two micro-frames, >= 2 times', environment: 'headless Chromium, ANGLE SwiftShader (no GPU)', measuredAt: new Date().toISOString(), runs: all }, null, 1)); };
// Default runs: desktop at both quality tiers, phone at the tier it resolves to.
for (const pq of (process.env.PROBE_RUNS ?? 'desktop:high,desktop:low,phone:auto').split(',')) {
  const [pr, q] = pq.split(':');
  all.push(await run(pr, q));
  save(); // progress survives a timeout
}
console.log(`PROBE_DONE ${OUT}`);
