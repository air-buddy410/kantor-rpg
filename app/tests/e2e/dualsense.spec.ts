import { expect, test, type Page } from '@playwright/test';
import { boot, shot } from './helpers';

// v2.3 (Budi 2026-11-19): with a DualSense connected the HUD switches to the
// PlayStation button layout, every mini game shows a tutorial and a legend in
// that layout, and billiards takes analog aim and an R2 shot.
const DUALSENSE = () => {
  const pad = {
    id: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
  };
  (window as unknown as { __pad: typeof pad }).__pad = pad;
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] });
};
type PadW = { __pad: { axes: number[]; buttons: { pressed: boolean; value: number }[] } };
const frames = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
const set = (page: Page, i: number, v: number) => page.evaluate(([b, x]) => { const k = (window as unknown as PadW).__pad.buttons[b]; k.value = x; k.pressed = x > 0.5; }, [i, v] as const);
const axes = (page: Page, a: number[]) => page.evaluate((v) => { (window as unknown as PadW).__pad.axes = v; }, a);
async function press(page: Page, i: number) { await set(page, i, 1); await frames(page); await page.waitForTimeout(60); await set(page, i, 0); await frames(page); }
type Mg = { phase: string; snap: Record<string, unknown> | null } | null;
const mg = (page: Page) => page.evaluate(() => (window as unknown as { __mg: { state: () => Mg } }).__mg.state());

test.describe('DualSense layout', () => {
  test.beforeEach(async ({ page }) => { await page.addInitScript(DUALSENSE); });

  test('office HUD switches to PlayStation glyphs with the pad, and back with the keyboard', async ({ page }, info) => {
    const errors = await boot(page);
    await page.evaluate(() => window.dispatchEvent(new Event('gamepadconnected')));
    await expect(page.locator('html')).toHaveAttribute('data-device', 'pad');
    await expect(page.locator('html')).toHaveAttribute('data-pad', 'ps');
    const strip = page.locator('#pad-legend');
    await expect(strip).toBeVisible();
    await expect(strip.locator('.glyph.g-cross')).toHaveAttribute('aria-label', 'Silang');
    await expect(strip).toContainText('Interaksi');
    await expect(strip.locator('.glyph.g-options')).toHaveText('Options');
    await expect(page.locator('#help-pad .glyph.g-r1')).toHaveCount(1);
    await expect(page.locator('#touch')).toBeHidden();
    await shot(page, info, 'dualsense-hud');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('html')).toHaveAttribute('data-device', 'keyboard');
    await expect(strip).toBeHidden();
    // the next pad press takes it back
    await press(page, 3);
    await expect(page.locator('html')).toHaveAttribute('data-device', 'pad');
    expect(errors).toEqual([]);
  });

  test('reversed profile moves Interaksi to Circle in the HUD legend', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('kantor-rpg.settings.v1', JSON.stringify({ padProfile: 'terbalik' })));
    await boot(page);
    await page.evaluate(() => window.dispatchEvent(new Event('gamepadconnected')));
    const li = page.locator('#pad-legend li', { hasText: 'Interaksi' });
    await expect(li.locator('.glyph')).toHaveAttribute('aria-label', 'Lingkaran');
  });

  test('every mini game shows tutorial steps and a legend in DualSense glyphs', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'content check, one viewport');
    const ids = ['balap-drone', 'tarung-kantor', 'lompat-lantai', 'sambung-kabel', 'arena-bom', 'lari-pagi', 'angkat-beban', 'peregangan', 'biliar', 'barista', 'server-down', 'susun-denah', 'desain-poster', 'kuis-perpustakaan', 'catur', 'bola-meja', 'ular-kabel', 'teknisi-kilat', 'lomba-17an', 'hoki-meja'];
    for (const id of ids) {
      await page.goto(`/mg.html?game=${id}&seed=7`);
      await expect(page.locator('#mg-host .mg-card .mg-steps li').first(), id).toBeVisible({ timeout: 20_000 });
      expect(await page.locator('.mg-steps li').count(), id).toBeGreaterThanOrEqual(2);
      await expect(page.locator('.mg-tut-tab[data-dev="pad"]'), id).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.mg-legend .glyph').first(), id).toBeVisible();
      // no raw {placeholder} left in any step
      expect(await page.locator('.mg-steps').innerText(), id).not.toMatch(/\{\w+\}/);
    }
  });

  test('billiards: stick aims, R2 pull and release shoots', async ({ page }, info) => {
    await page.goto('/mg.html?game=biliar&seed=7');
    await expect(page.locator('#mg-host .mg-card button.primary')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.mg-steps')).toContainText('R2');
    await page.locator('#mg-host .mg-card button.primary').click();
    await expect.poll(async () => (await mg(page))?.phase).toBe('play');
    const a0 = (await mg(page))!.snap!.aim as number;
    await axes(page, [0, 0, 0.9, 0]);
    await page.waitForTimeout(500);
    await axes(page, [0, 0, 0, 0]);
    const a1 = (await mg(page))!.snap!.aim as number;
    expect(Math.abs(a1 - a0)).toBeGreaterThan(0.05);
    expect(Math.abs(a1 - a0)).toBeLessThan(0.6);
    await shot(page, info, 'dualsense-biliar');
    await set(page, 7, 0.6);
    await expect.poll(async () => (await mg(page))!.snap!.trigger).toBe(true);
    await set(page, 7, 0);
    await expect.poll(async () => (await mg(page))!.snap!.phase).toBe('roll');
  });
});
