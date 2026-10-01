import { expect, test } from '@playwright/test';
import { boot } from './helpers';

// Data views must show loading, empty and error states (CLAUDE.md quality gate).
test.describe('document list states', () => {
  test('error state when the manifest fails', async ({ page }) => {
    await page.route('**/docs/manifest.json', (r) => r.fulfill({ status: 500, body: 'x' }));
    await boot(page);
    await page.locator('#btn-directory').click();
    await expect(page.locator('#directory-body')).toContainText('Daftar dokumen gagal dimuat: manifest HTTP 500');
  });

  test('empty state when no documents were generated', async ({ page }) => {
    await page.route('**/docs/manifest.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ docs: [] }) }));
    await boot(page);
    await page.locator('#btn-directory').click();
    await expect(page.locator('#directory-body')).toContainText('Belum ada dokumen yang dihasilkan');
  });

  test('loading state is announced before the list arrives', async ({ page }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    await page.route('**/docs/manifest.json', async (r) => { await gate; await r.continue(); });
    await boot(page);
    await page.locator('#btn-directory').click();
    await expect(page.locator('#directory-body')).toContainText('Memuat daftar dokumen');
    release();
    await expect(page.locator('.doc-list a').first()).toBeVisible();
  });

  test('blueprint card reports a missing PDF honestly', async ({ page }) => {
    await page.route('**/docs/manifest.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ docs: [] }) }));
    await boot(page);
    await page.evaluate(() => (window.__kantor!.useInteractable as (id: string) => void)('FX-L1-073'));
    await expect(page.locator('#dlg-info')).toContainText('belum dihasilkan');
  });
});
