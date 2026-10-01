import { expect, test, type Page } from '@playwright/test';
import { boot, shot, state, walkTo } from './helpers';

interface Npc { id: string; floor: string; pos: [number, number]; phase: string; activity: string; slot: string | null; workStatus: string }
const npcs = (page: Page) => page.evaluate(() => (window.__kantor!.npcs as () => Npc[])());

test.describe('persona NPCs (M2)', () => {
  test('six simulated personas spawn, move over time and never claim a work status', async ({ page }, info) => {
    const errors = await boot(page);
    const a = await npcs(page);
    expect(a).toHaveLength(6);
    expect(a.every((n) => n.workStatus === 'unknown')).toBe(true);
    await expect.poll(async () => page.evaluate(() => (window.__kantor!.simTime as () => number)()), { timeout: 60_000 }).toBeGreaterThan(8);
    const b = await npcs(page);
    expect(b.some((n, i) => n.pos[0] !== a[i].pos[0] || n.pos[1] !== a[i].pos[1] || n.activity !== a[i].activity)).toBe(true);
    await expect(page.locator('.npc-label').first()).toBeAttached();
    await shot(page, info, 'npcs');
    expect(errors).toEqual([]);
  });

  test('directory "Temui" opens the persona dialog, pauses the NPC and restores focus on Escape', async ({ page }, info) => {
    await boot(page);
    await page.locator('#btn-directory').click();
    await page.getByRole('button', { name: 'Temui Nova' }).click();
    const dlg = page.locator('#dlg-info');
    await expect(dlg).toBeVisible({ timeout: 10_000 });
    await expect(dlg).toContainText('Nova');
    await expect(dlg).toContainText('SIMULASI');
    await expect(dlg).toContainText('tidak diketahui');
    expect((await npcs(page)).find((n) => n.id === 'ACT-NOVA')!.phase).toBe('paused');
    // Talking drives the face morph targets from the Blender GLB (smile + mouth).
    type Face = { expressions: Record<string, number>; lod: number } | null;
    const face = () => page.evaluate(() => (window.__kantor!.npcFace as (id: string) => Face)('ACT-NOVA'));
    await expect.poll(async () => Object.keys((await face())?.expressions ?? {}).sort().join(','), { timeout: 15_000 }).toBe('blink,frown,smile,surprised,talk');
    await expect.poll(async () => (await face())!.expressions.smile).toBeGreaterThan(0.4);
    const first = await dlg.locator('.quote').innerText();
    await dlg.getByRole('button', { name: 'Topik lain' }).click();
    await expect(dlg.locator('.quote')).not.toHaveText(first);
    const before = await state(page);
    await page.keyboard.down('w');
    await page.waitForTimeout(700);
    await page.keyboard.up('w');
    expect((await state(page)).pos).toEqual(before.pos);
    await shot(page, info, 'npc-dialog');
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(page.locator('#btn-directory')).toBeFocused();
    // The dialog 'close' event is dispatched in a later task; poll for the resume.
    await expect.poll(async () => (await npcs(page)).find((n) => n.id === 'ACT-NOVA')!.phase).not.toBe('paused');
  });

  test('walking up to a seated NPC and pressing E greets it', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'keyboard greeting on desktop; touch covered by directory path');
    await boot(page);
    const target = (await npcs(page)).find((n) => n.phase === 'perform' && n.floor === 'L1' && n.activity === 'desk')!;
    expect(target).toBeTruthy();
    expect(await walkTo(page, target.pos[0], target.pos[1] - 0.9)).toBe(true);
    await expect(page.locator('#prompt')).toContainText('Sapa');
    await page.keyboard.press('e');
    await expect(page.locator('#dlg-info')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('blueprint table and virtual activities give real feedback', async ({ page }) => {
    await boot(page);
    expect(await walkTo(page, 23.0, 12.2)).toBe(true);
    await expect(page.locator('#prompt')).toContainText(/denah|Sapa/);
    await page.evaluate(() => (window.__kantor!.useInteractable as (id: string) => void)('FX-L1-073'));
    await expect(page.locator('#dlg-info')).toContainText('KONSEP');
    await expect(page.locator('#dlg-info a[href="docs/A-101.pdf"]')).toBeVisible();
    await page.keyboard.press('Escape');
    // The coffee bar now runs on its activity slots (shared with NPCs): either
    // the CEO gets a free slot (labelled virtual) or a busy-by-name message.
    await page.evaluate(() => (window.__kantor!.useInteractable as (id: string) => void)('FX-L2-014'));
    await expect.poll(async () => `${await page.locator('#activity-text').textContent()} ${await page.locator('#toast').textContent()}`).toMatch(/aktivitas virtual|Sedang dipakai/);
  });
});
