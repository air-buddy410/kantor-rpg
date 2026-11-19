import { expect, test } from '@playwright/test';
import { boot, shot, state } from './helpers';

// v2.4 (Budi 2026-11-19): every game in one HUD list, Multiplayer and Single
// player, with its room; Play walks the CEO there and opens the game.
type MgState = { phase: string; game: string } | null;
const mg = (page: import('@playwright/test').Page) => page.evaluate(() => (window.__kantor!.miniGameState as () => Promise<MgState>)());

test.describe('Daftar game', () => {
  test('G opens the list: multiplayer and single player tabs, rooms, no duplicates', async ({ page }, info) => {
    const errors = await boot(page);
    await page.keyboard.press('g');
    const dlg = page.locator('#dlg-games');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('#games-tab-multi')).toHaveAttribute('aria-selected', 'true');
    const multi = await dlg.locator('#games-multi .game-row').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.game));
    await dlg.locator('#games-tab-single').click();
    const single = await dlg.locator('#games-single .game-row').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.game));
    expect(multi).toEqual(expect.arrayContaining(['biliar', 'arena-bom', 'catur', 'tarung-kantor', 'bola-meja', 'hoki-meja']));
    expect(single).toEqual(expect.arrayContaining(['server-down', 'lari-pagi', 'barista']));
    expect(new Set([...multi, ...single]).size).toBe(multi.length + single.length);
    expect(multi.length + single.length).toBe(20);
    await expect(dlg.locator('.game-row[data-game="server-down"] .game-room')).toContainText('Lantai 1');
    await dlg.locator('#games-tab-multi').click();
    await expect(dlg.locator('.game-row[data-game="biliar"] .game-room')).toContainText('Ruang biliar');
    await shot(page, info, 'v24-game-list');
    expect(errors).toEqual([]);
  });

  test('Play on an L1 game from L2 moves the CEO to its room and opens it; closing returns to the office', async ({ page }) => {
    await boot(page);
    await page.locator('#btn-games').click();
    await page.locator('#games-tab-single').click();
    await page.locator('.game-row[data-game="susun-denah"] .btn.primary').click();
    await expect.poll(async () => (await mg(page))?.game, { timeout: 15_000 }).toBe('susun-denah');
    expect((await state(page)).room).toBe('L1-HUGO');
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await mg(page))?.phase ?? 'closed', { timeout: 10_000 }).toBe('closed');
    await page.keyboard.press('g');
    await page.locator('.game-row[data-game="biliar"] .btn.primary').click();
    await expect.poll(async () => (await mg(page))?.game, { timeout: 15_000 }).toBe('biliar');
    const s = await state(page);
    expect(s.floor).toBe('L2');
    expect(s.room).toBe('L2-BILLIARD');
  });

  test('Game Station: 10 cabinets, multiplayer group first, player chips', async ({ page }) => {
    await page.goto('/mg.html?game=arcade');
    const station = page.locator('#arcade');
    await expect(station).toBeVisible({ timeout: 20_000 });
    await expect(station.locator('.arcade-slot')).toHaveCount(10);
    await expect(station.locator('.arcade-group').first()).toHaveText('Multiplayer');
    await expect(station.locator('.arcade-slot[data-game="bola-meja"] .chip')).toContainText('4 pemain');
    await expect(station.locator('#arcade-phone')).toBeVisible();
  });

  test('Pengaturan: stick aim speed slider is saved and read by the games', async ({ page }) => {
    await boot(page);
    await page.locator('#btn-settings').click();
    const slider = page.locator('#dlg-settings input[name="aimSpeed"]');
    await expect(slider).toHaveValue('100');
    await slider.fill('50');
    await expect(page.locator('#dlg-settings output[name="aimSpeedOut"]')).toHaveText('50%');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('kantor-rpg.settings.v1') ?? '{}').aimSpeed);
    expect(saved).toBe(50);
  });
});
