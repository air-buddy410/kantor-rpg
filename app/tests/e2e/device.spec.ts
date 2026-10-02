import { expect, test } from '@playwright/test';

// Hooks for the physical validation runs (docs/DEVICE-VALIDATION.md). These
// tests prove the hooks work; they are not the device or screen-reader tests.
test.describe('device validation hooks (R2)', () => {
  test('?perf=route&report=1 shows the result with device info, copy and download', async ({ page, context }, info) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/?perf=route&seconds=6&report=1');
    await expect(page.locator('#perf-report')).toBeVisible({ timeout: 90_000 });
    const json = JSON.parse(await page.locator('#perf-report-json').innerText());
    expect(json).toHaveProperty('fpsAverage');
    expect(json.device).toHaveProperty('userAgent');
    expect(json.device).toHaveProperty('gpuRenderer');
    const vp = page.viewportSize()!;
    expect(json.device.viewport).toEqual([vp.width, vp.height]);
    await expect(page.locator('#perf-report-download')).toHaveAttribute('download', 'kantor-rpg-perf.json');
    await page.locator('#perf-report-copy').click();
    await expect(page.locator('#perf-report')).toContainText(/Disalin|Clipboard tidak tersedia/);
    await page.locator('#perf-report-close').click();
    await expect(page.locator('#perf-report')).toHaveCount(0);
  });

  test('?a11ylog=1 lists live-region announcements in order', async ({ page }) => {
    await page.goto('/?a11ylog=1');
    await page.waitForFunction(() => !!window.__kantor);
    await expect(page.locator('#a11y-log-panel')).toBeVisible();
    // Walking into the meeting room changes the polite live room name.
    expect(await page.evaluate(() => (window.__kantor!.walkTo as (x: number, y: number) => Promise<boolean>)(4, 6.5))).toBe(true);
    await expect.poll(async () => page.locator('#a11y-log li').count(), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect(page.locator('#a11y-log')).toContainText('room-name: Ruang rapat besar');
  });
});
