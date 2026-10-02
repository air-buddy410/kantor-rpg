import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { boot, EVIDENCE } from './helpers';

// First download and JS chunking (R2). Targets are labelled project targets,
// measured from Resource Timing in this container (no CDN, no compression
// guarantees): decodedBodySize is the uncompressed size, transferSize what
// actually crossed the wire from vite preview.
type Res = { name: string; transfer: number; decoded: number; type: string };
const resources = (page: import('@playwright/test').Page) => page.evaluate(() => (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
  .map((r) => ({ name: r.name, transfer: r.transferSize, decoded: r.decodedBodySize, type: r.initiatorType })));

test('first download and JS chunks stay inside the R2 targets; Studio code loads on demand', async ({ page }, info) => {
  await boot(page);
  await page.waitForTimeout(4000); // furniture GLBs and NPC characters finish loading
  const res: Res[] = await resources(page);
  const js = res.filter((r) => r.name.endsWith('.js'));
  const nav = await page.evaluate(() => (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).transferSize);
  const total = nav + res.reduce((a, r) => a + r.transfer, 0);
  const entry = js.find((r) => /\/assets\/index-[^/]+\.js$/.test(r.name));
  const report = { totalTransferBytes: total, js: js.map((r) => ({ file: r.name.split('/').pop(), decoded: r.decoded, transfer: r.transfer })),
    glbBytes: res.filter((r) => r.name.endsWith('.glb')).reduce((a, r) => a + r.transfer, 0), measuredAt: new Date().toISOString() };
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, 'bundle-desktop.json'), JSON.stringify(report, null, 1));
  // Target: first load <= 6 MB (was 9.73 MB at b109cde).
  expect(total).toBeLessThanOrEqual(6_000_000);
  // Target: the app's own entry chunk <= 250 kB decoded; three.js lives in its own cacheable chunk.
  expect(entry, 'entry chunk').toBeTruthy();
  expect(entry!.decoded).toBeLessThanOrEqual(250_000);
  expect(js.some((r) => /three/i.test(r.name.split('/').pop()!))).toBe(true);
  // Office Studio code is not downloaded until the Studio is opened.
  expect(js.some((r) => /studio/i.test(r.name.split('/').pop()!))).toBe(false);
  await page.locator('#btn-studio').click();
  await expect(page.locator('#studio-panel')).toBeVisible();
  const after: Res[] = await resources(page);
  expect(after.some((r) => r.name.endsWith('.js') && /studio/i.test(r.name.split('/').pop()!))).toBe(true);
});
