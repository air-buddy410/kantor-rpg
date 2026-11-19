import { expect, test } from '@playwright/test';
import { boot, shot, state } from './helpers';

// PRD v2.0: facility mini games, Game Station, sound settings and reprimand.
const GAMES = ['balap-drone', 'tarung-kantor', 'lompat-lantai', 'sambung-kabel', 'arena-bom', 'lari-pagi', 'angkat-beban', 'peregangan', 'biliar', 'barista', 'server-down', 'susun-denah', 'desain-poster', 'kuis-perpustakaan', 'bola-meja', 'ular-kabel', 'teknisi-kilat', 'lomba-17an', 'hoki-meja'];

type MgState = { phase: string; game: string; frames: number } | null;

test.describe('v2.0 mini games', () => {
  test('every mini game page loads, starts and runs without page errors', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'one viewport is enough for the load smoke; layouts below');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    for (const id of GAMES) {
      await page.goto(`/mg.html?game=${id}&seed=7`);
      await expect(page.locator('#mg-card-title')).toBeVisible();
      await page.getByRole('button', { name: 'Mulai' }).click();
      await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __mg: { state: () => MgState } }).__mg.state()))?.frames ?? 0, { message: id }).toBeGreaterThan(30);
      const s = await page.evaluate(() => (window as unknown as { __mg: { state: () => MgState } }).__mg.state());
      expect(s?.phase, id).toBe('play');
    }
    expect(errors).toEqual([]);
  });

  test('mini game layout fits the viewport and touch buttons are 44 px', async ({ page }, info) => {
    await page.goto('/mg.html?game=arena-bom&seed=7');
    await page.getByRole('button', { name: 'Mulai' }).click();
    const box = await page.locator('.mg-canvas').boundingBox();
    const vp = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height + 1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    if (info.project.name === 'mobile') {
      const small = await page.$$eval('.mg-tb', (els) => els.map((e) => e.getBoundingClientRect()).filter((r) => r.width < 44 || r.height < 44).length);
      expect(small).toBe(0);
    }
    await shot(page, info, 'v2-arena-bom');
  });

  test('pause, resume and the result card with a local leaderboard', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'host logic, one viewport');
    await page.goto('/mg.html?game=peregangan&seed=7');
    await page.getByRole('button', { name: 'Mulai' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#mg-card-title')).toHaveText('Jeda');
    await page.getByRole('button', { name: 'Lanjut' }).click();
    // Lose on purpose: press the wrong move three times whenever input opens.
    for (let i = 0; i < 400; i++) {
      const s = await page.evaluate(() => (window as unknown as { __mg: { state: () => { phase: string; snap: { seq: string[]; phase: string; inputIdx: number } | null } } }).__mg.state());
      if (s.phase === 'result') break;
      if (s.snap?.phase === 'input') {
        const want = s.snap.seq[s.snap.inputIdx];
        await page.keyboard.press(want === 'up' ? 'ArrowDown' : 'ArrowUp');
      }
      await page.waitForTimeout(60);
    }
    await expect(page.locator('#mg-card-title')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Main lagi' })).toBeVisible();
  });
});

test.describe('v2.0 office integration', () => {
  test('using a gym treadmill opens Lari Pagi, holds the slot, and closing returns to the office', async ({ page }, info) => {
    const errors = await boot(page);
    await page.locator('#btn-directory').click();
    await page.getByRole('button', { name: 'Pergi Ruang olahraga' }).click();
    await expect.poll(async () => (await state(page)).room, { timeout: 10_000 }).toBe('L2-GYM');
    // Use a free treadmill through its slot (same path as pressing E there); an NPC may hold the other.
    const held0 = new Map(await page.evaluate(() => (window.__kantor!.reservations as () => [string, string][])()));
    const slotId = ['SL-L2-080-1', 'SL-L2-081-1'].find((x) => !held0.has(x))!;
    test.skip(!slotId, 'both treadmills busy in this seed');
    await page.evaluate((id) => (window.__kantor!.useInteractable as (x: string) => void)(`slot:${id}`), slotId);
    await expect(page.locator('#mg-host')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#mg-title')).toHaveText('Lari Pagi');
    expect(await page.evaluate(() => (window.__kantor!.miniGame as () => string | null)())).toBe('lari-pagi');
    const held = await page.evaluate(() => (window.__kantor!.reservations as () => [string, string][])());
    expect(held.some(([k, npc]) => k === slotId && npc === 'ACT-BUDI')).toBe(true);
    await shot(page, info, 'v2-lari-pagi-intro');
    await page.getByRole('button', { name: 'Keluar' }).first().click();
    await expect(page.locator('#mg-host')).toHaveCount(0);
    expect(await page.evaluate(() => (window.__kantor!.miniGame as () => string | null)())).toBeNull();
    const after = await page.evaluate(() => (window.__kantor!.reservations as () => [string, string][])());
    expect(after.some(([k, npc]) => k === slotId && npc === 'ACT-BUDI')).toBe(false);
    expect(errors).toEqual([]);
  });

  test('Game Station shows 10 playable cabinets (v2.4) and opens a game', async ({ page }, info) => {
    const errors = await boot(page);
    await page.evaluate(() => (window.__kantor!.useInteractable as (x: string) => void)('FX-L2-061'));
    await expect(page.locator('#arcade')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.arcade-slot')).toHaveCount(10);
    await expect(page.locator('.arcade-slot[aria-disabled="true"]')).toHaveCount(0);
    await shot(page, info, 'v2-game-station');
    await page.locator('.arcade-slot[data-game="sambung-kabel"]').click();
    await expect(page.locator('#mg-title')).toHaveText('Sambung Kabel');
    await page.getByRole('button', { name: 'Keluar' }).first().click();
    await expect(page.locator('#arcade')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#arcade')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('reprimand: idle persona reacts and hurries to its desk; a working agent is refused', async ({ page }, info) => {
    const errors = await boot(page);
    const res = await page.evaluate(() => (window.__kantor!.scold as (id: string, k: string) => Promise<string>)('ACT-KEVIN', 'bola'));
    expect(res).toBe('ok');
    await expect(page.locator('#toast')).toContainText('Kevin:');
    expect(await page.evaluate(() => (window.__kantor!.scolds as () => number)())).toBe(1);
    expect(await page.evaluate(() => (window.__kantor!.scold as (id: string, k: string) => Promise<string>)('ACT-KEVIN', 'palu'))).toBe('cooldown');
    // The persona card offers the three props (data-scold buttons) for an idle persona.
    await page.evaluate(() => (window.__kantor!.talkTo as (x: string) => void)('ACT-LEO'));
    await expect(page.locator('#dlg-info [data-scold]')).toHaveCount(3);
    await page.locator('#dlg-info [data-scold="palu"]').click();
    await expect(page.locator('#dlg-info')).not.toBeVisible();
    await expect(page.locator('#toast')).toContainText('Leo:');
    await page.evaluate(() => (window.__kantor!.setWorkStatus as (id: string, s: string) => void)('ACT-NOVA', 'working'));
    expect(await page.evaluate(() => (window.__kantor!.scold as (id: string, k: string) => Promise<string>)('ACT-NOVA', 'gulungan'))).toBe('working');
    await expect(page.locator('#toast')).toContainText('tidak bisa ditegur');
    await shot(page, info, 'v2-tegur');
    expect(errors).toEqual([]);
  });

  test('sound settings persist and V mutes from the office', async ({ page }) => {
    await boot(page);
    await page.locator('#stage').click({ position: { x: 10, y: 10 } }).catch(() => {});
    await page.keyboard.press('v');
    await expect.poll(async () => (await page.evaluate(() => (window.__kantor!.audio as () => { prefs: { muted: boolean } })())).prefs.muted).toBe(true);
    await expect(page.locator('#toast')).toContainText('Suara dimatikan');
    await page.reload();
    await page.waitForFunction(() => !!window.__kantor);
    expect((await page.evaluate(() => (window.__kantor!.audio as () => { prefs: { muted: boolean } })())).prefs.muted).toBe(true);
    await page.locator('#btn-settings').click();
    await expect(page.locator('input[name="audioMuted"]')).toBeChecked();
    for (const n of ['audioMaster', 'audioMusic', 'audioSfx']) await expect(page.locator(`input[name="${n}"]`)).toBeVisible();
    await page.locator('input[name="audioMusic"]').fill('20');
    await expect.poll(async () => (await page.evaluate(() => (window.__kantor!.audio as () => { prefs: { music: number } })())).prefs.music).toBeCloseTo(0.2);
  });
});
