import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { boot, shot } from './helpers';

type Fx = { id: string; pos: [number, number]; rot: number };
// Moves snap to the absolute 0.25 m grid (GRID in src/studio/editor.ts).
const snapped = (v: number) => Math.round(v / 0.25) * 0.25;
const fixture = async (page: Page, id: string) => (await page.evaluate(() => (window.__kantor!.fixtures as () => Fx[])())).find((f) => f.id === id);

async function openStudio(page: Page) {
  await page.locator('#btn-studio').click();
  await expect(page.locator('#studio-panel')).toBeVisible();
}

test.describe('Office Studio (REQ-STUDIO-01)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
  });

  test('move, reject overlap, undo/redo, exit without publish reverts', async ({ page }, info) => {
    await boot(page);
    await openStudio(page);
    await page.selectOption('#studio-pick', 'FX-L1-007');
    const before = (await fixture(page, 'FX-L1-007'))!;
    await page.getByRole('button', { name: 'Geser ke barat 0,25 m' }).click();
    await expect(page.locator('#studio-status')).toContainText('dipindah');
    expect((await fixture(page, 'FX-L1-007'))!.pos[0]).toBeCloseTo(snapped(before.pos[0] - 0.25), 5);
    await page.getByRole('button', { name: 'Undo' }).click();
    expect((await fixture(page, 'FX-L1-007'))!.pos).toEqual(before.pos);
    await page.getByRole('button', { name: 'Redo' }).click();
    expect((await fixture(page, 'FX-L1-007'))!.pos[0]).toBeCloseTo(snapped(before.pos[0] - 0.25), 5);
    // The reception chair cannot be pushed into the reception desk.
    await page.selectOption('#studio-pick', 'FX-L1-002');
    const chair = (await fixture(page, 'FX-L1-002'))!;
    await page.getByRole('button', { name: 'Geser ke selatan 0,25 m' }).click();
    await expect(page.locator('#studio-status')).toContainText('Ditolak');
    await expect(page.locator('#studio-status')).toContainText('bertabrakan');
    expect((await fixture(page, 'FX-L1-002'))!.pos).toEqual(chair.pos);
    await shot(page, info, 'studio');
    await page.locator('#studio-exit').click();
    await expect(page.locator('#studio-panel')).toBeHidden();
    expect((await fixture(page, 'FX-L1-007'))!.pos).toEqual(before.pos);
  });

  test('structural fixtures are locked with a reason', async ({ page }) => {
    await boot(page);
    await openStudio(page);
    await page.selectOption('#studio-pick', 'FX-L1-067');
    await expect(page.locator('#studio-selected')).toContainText('Terkunci');
    await expect(page.getByRole('button', { name: 'Hapus fixture terpilih' })).toBeDisabled();
  });

  test('publish persists across reload, rollback returns to the dataset', async ({ page }) => {
    await boot(page);
    await openStudio(page);
    await page.selectOption('#studio-pick', 'FX-L1-007');
    const base = (await fixture(page, 'FX-L1-007'))!;
    await page.getByRole('button', { name: 'Geser ke barat 0,25 m' }).click();
    await page.getByRole('button', { name: 'Publish lokal' }).click();
    await expect(page.locator('#studio-status')).toContainText('Dipublish lokal');
    await page.reload();
    await page.waitForFunction(() => !!window.__kantor);
    expect((await fixture(page, 'FX-L1-007'))!.pos[0]).toBeCloseTo(snapped(base.pos[0] - 0.25), 5);
    await openStudio(page);
    await page.getByRole('button', { name: /Rollback/ }).click();
    await expect(page.locator('#studio-status')).toContainText('dataset asli');
    await page.locator('#studio-exit').click();
    expect((await fixture(page, 'FX-L1-007'))!.pos).toEqual(base.pos);
  });

  test('export round-trips; a broken or invalid import is rejected and changes nothing', async ({ page }, info) => {
    await boot(page);
    await openStudio(page);
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export JSON' }).click();
    const file = await dl;
    const path = join(info.outputDir, 'layout.json');
    await file.saveAs(path);
    const doc = JSON.parse(readFileSync(path, 'utf-8'));
    expect(doc.format).toBe('kantor-rpg-layout');
    const count = await page.evaluate(() => (window.__kantor!.studioFixtures as () => number)());
    expect(doc.fixtures).toHaveLength(count);
    const broken = join(info.outputDir, 'broken.json');
    writeFileSync(broken, '{"format": "kantor-rpg-layout", ');
    await page.locator('#studio-import').setInputFiles(broken);
    await expect(page.locator('#studio-status')).toContainText('Import ditolak');
    const overlapping = join(info.outputDir, 'overlap.json');
    const bad = structuredClone(doc);
    const chair = bad.fixtures.find((f: Fx) => f.id === 'FX-L1-002');
    chair.pos = [14, 5.0];
    writeFileSync(overlapping, JSON.stringify(bad));
    await page.locator('#studio-import').setInputFiles(overlapping);
    await expect(page.locator('#studio-status')).toContainText('tidak valid');
    expect(await page.evaluate(() => (window.__kantor!.studioFixtures as () => number)())).toBe(count);
    await page.locator('#studio-import').setInputFiles(path);
    await expect(page.locator('#studio-status')).toContainText('Layout diimpor');
  });

  test('adding a fixture places it on a valid free spot', async ({ page }) => {
    await boot(page);
    await openStudio(page);
    await page.selectOption('#studio-pick', 'FX-L1-007');
    const n0 = await page.evaluate(() => (window.__kantor!.studioFixtures as () => number)());
    await page.getByLabel('Tipe fixture baru').selectOption('plant_small');
    await page.getByRole('button', { name: 'Tambah' }).click();
    await expect(page.locator('#studio-status')).toContainText('ditambahkan');
    expect(await page.evaluate(() => (window.__kantor!.studioFixtures as () => number)())).toBe(n0 + 1);
    await page.getByRole('button', { name: 'Validasi' }).click();
    await expect(page.locator('#studio-status')).toContainText('Valid');
  });
});

test.describe('Avatar Studio (REQ-AVATAR-01)', () => {
  test('preview, save persists across reload, reset returns to default', async ({ page }, info) => {
    await page.goto('/');
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
    await boot(page);
    await expect.poll(async () => (await page.evaluate(() => (window.__kantor!.avatar as () => { hair: string })())).hair, { timeout: 20_000 }).toBe('hair_short_tuft');
    await page.locator('#btn-avatar').click();
    await page.getByLabel('Disisir ke samping').check();
    await page.getByLabel('Terakota').check();
    await page.getByLabel('Animasi pratinjau').selectOption('wave');
    await page.waitForTimeout(800);
    await shot(page, info, 'avatar-studio');
    await page.getByRole('button', { name: 'Simpan' }).click();
    await expect(page.locator('#dlg-avatar')).toBeHidden();
    expect((await page.evaluate(() => (window.__kantor!.avatar as () => { hair: string })())).hair).toBe('hair_swept');
    await page.reload();
    await page.waitForFunction(() => !!window.__kantor);
    await expect.poll(async () => (await page.evaluate(() => (window.__kantor!.avatar as () => { hair: string })())).hair, { timeout: 20_000 }).toBe('hair_swept');
    await page.locator('#btn-avatar').click();
    await page.getByRole('button', { name: 'Reset ke default' }).click();
    await page.getByRole('button', { name: 'Batal' }).click();
    expect((await page.evaluate(() => (window.__kantor!.avatar as () => { hair: string })())).hair).toBe('hair_short_tuft');
  });

  test('a stored choice without an asset falls back to the default', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('kantor-rpg.avatar.v1', JSON.stringify({ hair: 'mohawk', palette: 'neon' })));
    await page.reload();
    await page.waitForFunction(() => !!window.__kantor);
    await expect.poll(async () => (await page.evaluate(() => (window.__kantor!.avatar as () => { hair: string })())).hair, { timeout: 20_000 }).toBe('hair_short_tuft');
  });

  test('studios are hidden (not dead) without WebGL', async ({ page }) => {
    await boot(page, '?nogl=1');
    await expect(page.locator('#btn-studio')).toBeHidden();
    await expect(page.locator('#btn-avatar')).toBeHidden();
  });
});
