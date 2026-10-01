import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { boot, EVIDENCE } from './helpers';

// Automated WCAG 2.x A/AA scan of the DOM layers in both themes. The 3D
// canvas is aria-hidden; its content is covered by the directory.
const scenes = [
  { name: 'world', open: async () => {} },
  { name: 'directory', open: async (p: import('@playwright/test').Page) => p.locator('#btn-directory').click() },
  { name: 'help-dialog', open: async (p: import('@playwright/test').Page) => p.locator('#btn-help').click() },
  { name: 'settings-dialog', open: async (p: import('@playwright/test').Page) => p.locator('#btn-settings').click() },
];

for (const scheme of ['light', 'dark'] as const) {
  for (const sc of scenes) {
    test(`axe ${scheme} ${sc.name}`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await boot(page);
      await sc.open(page);
      await page.waitForTimeout(400);
      const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('#stage').exclude('#labels').analyze();
      mkdirSync(join(EVIDENCE, 'axe'), { recursive: true });
      writeFileSync(join(EVIDENCE, 'axe', `${info.project.name}-${scheme}-${sc.name}.json`), JSON.stringify({ violations: res.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target) })), passes: res.passes.length }, null, 1));
      expect(res.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }
}

test('axe fallback (no WebGL)', async ({ page }) => {
  await boot(page, '?nogl=1');
  const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(res.violations.map((v) => v.id)).toEqual([]);
});
