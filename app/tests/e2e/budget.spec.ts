import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVIDENCE } from './helpers';

// Render budget gate (PRD 6: visible scene <= 250k triangles and <= 150 draw
// calls, target labelled for mobile). Peak values over a fixed 25 s route
// through both floors, read from renderer.info every frame. Draw calls and
// triangles do not depend on GPU speed, so the container measures them
// faithfully; FPS from this run is NOT a device result (ADR-011).
test('peak draw calls and triangles stay inside the mobile budget on the fixed route', async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.goto('/?perf=route&seconds=25');
  await page.waitForFunction(() => !!window.__kantor, null, { timeout: 60_000 });
  await page.waitForFunction(() => !!window.__perfResult, null, { timeout: 180_000, polling: 1000 });
  const r = await page.evaluate(() => window.__perfResult!) as { peak: { drawCalls: number; triangles: number; at: number[]; floor: string }; stats: { npcLod: { lod0: number; lod1: number } } };
  mkdirSync(EVIDENCE, { recursive: true });
  writeFileSync(join(EVIDENCE, `budget-${info.project.name}.json`), JSON.stringify({ ...r, measuredAt: new Date().toISOString(), note: 'peak over fixed 25 s route; SwiftShader container, FPS not a device result' }, null, 1));
  expect(r.peak.drawCalls).toBeLessThanOrEqual(150);
  expect(r.peak.triangles).toBeLessThanOrEqual(250_000);
});
