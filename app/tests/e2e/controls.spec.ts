import { expect, test, type Page } from '@playwright/test';
import { boot, state } from './helpers';

// Controls that tools/control_audit.py found without any test (R2). Each test
// drives the control the way a user would and checks its observable effect.
type Cam = { yaw: number; pitch: number; distance: number };
const cam = (page: Page) => page.evaluate(() => (window.__kantor!.camera as () => Cam)());
const render = (page: Page) => page.evaluate(() => (window.__kantor!.render as () => { lowQuality: boolean; shadows: boolean; theme: string | null })());
const motion = (page: Page) => page.evaluate(() => (window.__kantor!.motion as () => { speed: number; runToggle: boolean })());

test.describe('controls without earlier coverage (R2 control audit)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
  });

  test('skip link jumps to the directory; the close button hides it and returns focus', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Lewati ke direktori' })).toBeFocused();
    await page.keyboard.press('Enter');
    await page.locator('#btn-directory').click();
    await expect(page.locator('#directory-panel')).toBeVisible();
    await page.locator('#directory-close').click();
    await expect(page.locator('#directory-panel')).toBeHidden();
    await expect(page.locator('#btn-directory')).toBeFocused();
  });

  test('theme radios switch and persist; quality radio is stored and applied after reload', async ({ page }) => {
    await boot(page);
    const pick = async (label: string) => {
      await page.locator('#btn-settings').click();
      await page.getByLabel(label, { exact: false }).check();
      await page.getByRole('button', { name: 'Selesai' }).click();
    };
    await pick('Gelap');
    expect((await render(page)).theme).toBe('dark');
    await pick('Terang');
    expect((await render(page)).theme).toBe('light');
    await pick('Ikuti sistem');
    expect((await render(page)).theme).toBeNull();
    await pick('Ringan (tanpa bayangan)');
    await page.reload();
    await page.waitForFunction(() => !!window.__kantor);
    expect(await render(page)).toMatchObject({ lowQuality: true, shadows: false });
    await pick('Tinggi');
    await page.reload();
    await page.waitForFunction(() => !!window.__kantor);
    expect(await render(page)).toMatchObject({ lowQuality: false, shadows: true });
    await pick('Otomatis');
    await page.locator('#btn-settings').click();
    await expect(page.getByLabel('Otomatis')).toBeChecked();
    await page.getByRole('button', { name: 'Selesai' }).click();
  });

  test('keyboard: H opens help, R/Q/Z/+/- move the camera, Shift runs', async ({ page }, info) => {
    await boot(page);
    await page.locator('#stage canvas').click({ position: { x: 300, y: 600 } });
    await page.keyboard.press('h');
    await expect(page.locator('#dlg-help')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#dlg-help')).toBeHidden();
    const c0 = await cam(page);
    await page.keyboard.press('q');
    expect((await cam(page)).yaw).toBeLessThan(c0.yaw);
    await page.keyboard.press('z');
    await page.keyboard.press('z');
    expect((await cam(page)).yaw).toBeGreaterThan(c0.yaw);
    await page.keyboard.press('+');
    expect((await cam(page)).distance).toBeLessThan(c0.distance);
    await page.keyboard.press('-');
    await page.keyboard.press('-');
    expect((await cam(page)).distance).toBeGreaterThan(c0.distance);
    await page.keyboard.press('r');
    expect((await cam(page)).pitch).toBeCloseTo(1.0, 5);
    await page.keyboard.down('Shift');
    await page.keyboard.down('w');
    await expect.poll(async () => (await motion(page)).speed, { timeout: 10_000 }).toBeGreaterThan(2.0);
    await page.keyboard.up('w');
    await page.keyboard.up('Shift');
  });

  test('touch: Lari toggles running', async ({ page }, info) => {
    test.skip(info.project.name === 'desktop', 'touch controls only exist on touch layouts');
    await boot(page);
    await page.locator('#touch-run').tap();
    await expect(page.locator('#touch-run')).toHaveAttribute('aria-pressed', 'true');
    expect((await motion(page)).runToggle).toBe(true);
    await page.locator('#touch-run').tap();
    expect((await motion(page)).runToggle).toBe(false);
  });

  test('Studio: floor switch, nudge north/east, rotate (button and R), arrows, Delete, Ctrl+Z/Ctrl+Y, Simpan draft', async ({ page }) => {
    type Fx = { id: string; pos: [number, number]; rot: number };
    const fx = async (id: string) => (await page.evaluate(() => (window.__kantor!.fixtures as () => Fx[])())).find((f) => f.id === id);
    await boot(page);
    await page.locator('#btn-studio').click();
    await expect(page.locator('#studio-panel')).toBeVisible();
    await page.getByRole('button', { name: 'L2', exact: true }).click();
    await expect.poll(async () => (await state(page)).floor).toBe('L2');
    await page.getByRole('button', { name: 'L1', exact: true }).click();
    await page.selectOption('#studio-pick', 'FX-L1-007');
    const a = (await fx('FX-L1-007'))!;
    await page.getByRole('button', { name: 'Geser ke utara 0,25 m' }).click();
    await page.getByRole('button', { name: 'Geser ke timur 0,25 m' }).click();
    const b = (await fx('FX-L1-007'))!;
    expect(b.pos[1]).toBeGreaterThan(a.pos[1]);
    expect(b.pos[0]).toBeGreaterThan(a.pos[0]);
    await page.getByRole('button', { name: 'Putar 90 derajat' }).click();
    expect((await fx('FX-L1-007'))!.rot).toBe((a.rot + 90) % 360);
    // Keyboard on the plan: the select must not hold focus for the shortcuts.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('r');
    expect((await fx('FX-L1-007'))!.rot).toBe((a.rot + 180) % 360);
    // ArrowDown moves back south onto the row it came from (known free).
    await page.keyboard.press('ArrowDown');
    expect((await fx('FX-L1-007'))!.pos[1]).toBeCloseTo(b.pos[1] - 0.25, 5);
    await page.keyboard.press('Control+z');
    expect((await fx('FX-L1-007'))!.pos[1]).toBeCloseTo(b.pos[1], 5);
    await page.keyboard.press('Control+y');
    expect((await fx('FX-L1-007'))!.pos[1]).toBeCloseTo(b.pos[1] - 0.25, 5);
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#studio-status')).toContainText(/dipindah|Ditolak/);
    await page.keyboard.press('Delete');
    expect(await fx('FX-L1-007')).toBeUndefined();
    await page.keyboard.press('Control+z');
    expect(await fx('FX-L1-007')).toBeDefined();
    await page.getByRole('button', { name: 'Simpan draft' }).click();
    await page.locator('#studio-exit').click();
    await page.locator('#btn-studio').click();
    await expect(page.locator('#studio-status')).toContainText('Draft lokal dimuat');
  });
});
