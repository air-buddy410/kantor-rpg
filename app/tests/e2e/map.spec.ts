import { expect, test } from '@playwright/test';
import { boot, EVIDENCE, expectTapTargets, shot } from './helpers';
import { mkdirSync } from 'node:fs';

type Person = { id: string; name: string; floor: string; pos: [number, number]; movingTo: string | null };
type Snap = { floor: string; pos: [number, number]; people: Person[] };
const snap = (page: import('@playwright/test').Page) => page.evaluate(() => (window.__kantor!.map as () => Snap)());

test.describe('minimap and floor map', () => {
  test('minimap shows the current floor and counts people on the other floor', async ({ page }, info) => {
    await boot(page);
    const mini = page.locator('#minimap');
    await expect(mini).toBeVisible();
    const s = await snap(page);
    expect(s.floor).toBe('L1');
    expect(s.people.length).toBe(8);
    await expect(mini.locator('.minimap-floor')).toHaveText('Lantai 1');
    // Wait until the sim has someone upstairs, then the badge must report them.
    await expect.poll(async () => (await snap(page)).people.filter((p) => p.floor === 'L2').length, { timeout: 60_000 }).toBeGreaterThan(0);
    const up = (await snap(page)).people.filter((p) => p.floor === 'L2').length;
    await expect(mini.locator('.minimap-away')).toHaveText(new RegExp(`^↑ L2: \\d+$`));
    await expect(mini).toHaveAttribute('aria-label', /orang di Lantai 2 \(di atas\)/);
    expect(up).toBeGreaterThan(0);
    // The minimap must not sit on HUD buttons, the joystick or the action button.
    const box = (await mini.boundingBox())!;
    for (const sel of ['.hud-actions .btn', '.joystick', '.touch-btn']) {
      for (const b of await page.locator(sel).all()) {
        if (!(await b.isVisible())) continue;
        const o = (await b.boundingBox())!;
        const overlap = box.x < o.x + o.width && box.x + box.width > o.x && box.y < o.y + o.height && box.y + box.height > o.y;
        expect(overlap, `minimap overlaps ${sel}`).toBe(false);
      }
    }
    mkdirSync(EVIDENCE, { recursive: true });
    await shot(page, info, 'minimap');
  });

  test('P opens the floor map; people are grouped by floor and Temui crosses floors', async ({ page }, info) => {
    test.setTimeout(240_000);
    await boot(page);
    await expect(page.locator('#minimap')).toBeVisible();
    await expect.poll(async () => (await snap(page)).people.filter((p) => p.floor === 'L2' && !p.movingTo).length, { timeout: 90_000 }).toBeGreaterThan(0);
    await page.keyboard.press('p');
    const dlg = page.locator('#dlg-map');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('button', { name: /Lantai 1 \(\d+\) · kamu/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(dlg.locator('.map-group').first().locator('h3')).toContainText('lantai kamu');
    const away = dlg.locator('.map-group').nth(1);
    await expect(away.locator('h3')).toContainText('Lantai 2');
    await expect(away).toContainText('Beda lantai');
    await expect(away.locator('.floor-tag').first()).toHaveText('L2, beda lantai');
    await expectTapTargets(page, '#dlg-map .map-person-actions .btn');
    await shot(page, info, 'map-dialog');

    // "Lihat" on someone upstairs switches the map to Lantai 2 and marks them.
    const s = await snap(page);
    const target = s.people.find((p) => p.floor === 'L2' && !p.movingTo)!;
    const row = dlg.locator(`[data-person="${target.id}"]`);
    await row.getByRole('button', { name: /^Tandai/ }).click();
    await expect(dlg.getByRole('button', { name: /^Lantai 2/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(dlg.locator(`[data-person="${target.id}"]`)).toHaveClass(/selected/);
    await shot(page, info, 'map-dialog-l2');

    // "Temui" moves the CEO to that floor next to the persona and opens their card.
    await dlg.locator(`[data-person="${target.id}"]`).getByRole('button', { name: /^Temui/ }).click();
    await expect(dlg).toBeHidden();
    await expect.poll(async () => (await snap(page)).floor, { timeout: 20_000 }).toBe('L2');
    await expect(page.locator('#minimap .minimap-floor')).toHaveText('Lantai 2');
    await expect(page.locator('dialog[open]')).toContainText(target.name);
  });

  test('Escape closes the map and focus returns to the minimap', async ({ page }) => {
    await boot(page);
    await page.locator('#minimap').click();
    await expect(page.locator('#dlg-map')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#dlg-map')).toBeHidden();
    await expect(page.locator('#minimap')).toBeFocused();
  });
});

test.describe('phone HUD folds', () => {
  test('menu and minimap fold away, stay folded after reload, and unfold again', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'the fold controls are for phone widths');
    await boot(page);
    const toggle = page.locator('#btn-hud-toggle');
    const fold = page.locator('#minimap-fold');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expectTapTargets(page, '.hud-actions .btn, #btn-hud-toggle, #minimap-fold, .touch-btn');
    // Eight menu buttons (v2.4 added Game) fit one row of icon buttons on a 390 px phone.
    const tops = await page.locator('.hud-actions .btn').evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))]);
    expect(tops).toHaveLength(1);
    await toggle.click();
    await fold.click();
    await expect(page.locator('#btn-chat')).toBeHidden();
    await expect(page.locator('#minimap')).toBeHidden();
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await shot(page, info, 'hud-folded');
    await page.reload();
    await expect(page.locator('#minimap-fold')).toHaveAttribute('aria-expanded', 'false', { timeout: 60_000 });
    await expect(page.locator('#btn-chat')).toBeHidden();
    await page.locator('#btn-hud-toggle').click();
    await page.locator('#minimap-fold').click();
    await expect(page.locator('#btn-chat')).toBeVisible();
    await expect(page.locator('#minimap')).toBeVisible();
    await page.locator('#btn-settings').click();
    await expect(page.locator('#dlg-settings')).toBeVisible();
  });
});
