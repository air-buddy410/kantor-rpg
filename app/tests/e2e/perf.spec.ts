import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVIDENCE } from './helpers';

// Fixed 60 s route (REQ-PERF-01). Runs in the cloud container with software
// WebGL (SwiftShader, no GPU): numbers describe this environment only.
test('fixed route benchmark records frame times', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop' || !process.env.KANTOR_PERF, 'set KANTOR_PERF=1 to run the 60 s benchmark');
  test.setTimeout(180_000);
  const seconds = Number(process.env.KANTOR_PERF_SECONDS ?? 60);
  const t0 = Date.now();
  await page.goto(`/?perf=route&seconds=${seconds}`);
  await page.waitForFunction(() => !!window.__kantor, null, { timeout: 30_000 });
  const loadMs = Date.now() - t0;
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return { domContentLoadedMs: n.domContentLoadedEventEnd, transferBytes: n.transferSize + res.reduce((a, r) => a + (r.transferSize || 0), 0), resources: res.length };
  });
  await page.waitForFunction(() => !!window.__perfResult, null, { timeout: (seconds + 60) * 1000, polling: 1000 });
  const result = await page.evaluate(() => window.__perfResult!);
  const out = { ...result, environment: 'Claude Code cloud container, headless Chromium 141, SwiftShader software WebGL, no GPU', loadMsUntilAppReady: loadMs, navigation: nav, measuredAt: new Date().toISOString() };
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, `perf-route-${info.project.name}.json`), JSON.stringify(out, null, 1));
  expect(result.frames as number).toBeGreaterThan(30);
  expect(result.distanceM as number).toBeGreaterThan(20);
});
