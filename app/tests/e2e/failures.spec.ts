import { expect, test } from '@playwright/test';
import { boot, state, walkTo } from './helpers';

// PRD 12 failure paths that had no test before R2 (Must audit).
test.describe('failure paths (PRD 12)', () => {
  test('AC-ACCESS/AC-PERF: losing the WebGL context mid-session falls back to the keyboard directory', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      const c = document.querySelector('#stage canvas') as HTMLCanvasElement;
      const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext;
      gl.getExtension('WEBGL_lose_context')!.loseContext();
    });
    await expect(page.locator('#app')).toHaveAttribute('data-mode', 'fallback');
    await expect(page.locator('#fallback-reason')).toContainText('context lost');
    await expect(page.locator('#btn-studio')).toBeHidden();
    await page.locator('#btn-directory').click();
    await expect(page.getByRole('button', { name: 'Info' }).first()).toBeVisible();
    // Closing the directory must not strand the user: Direktori brings it back.
    await page.locator('#directory-close').click();
    await expect(page.locator('#directory-panel')).toBeHidden();
    await page.locator('#btn-directory').click();
    await expect(page.locator('#directory-panel')).toBeVisible();
    await expect(page.locator('#directory-panel')).toBeFocused();
  });

  test('AC-INTERACT: pressing the action with nothing in reach says so instead of doing nothing', async ({ page }, info) => {
    await boot(page);
    expect(await walkTo(page, 2, 9.25)).toBe(true); // west end of the L1 corridor, nothing interactive
    if (info.project.name === 'desktop') {
      await page.locator('#stage canvas').click({ position: { x: 300, y: 600 } });
      await page.keyboard.press('e');
    } else await page.locator('#touch-interact').tap();
    await expect(page.locator('#toast')).toContainText('Tidak ada yang bisa dipakai di dekat sini');
  });

  test('AC-CHAR: a missing character GLB gives an honest labelled placeholder, not a crash', async ({ page }) => {
    await page.route('**/assets/characters/ch-ceo.glb', (r) => r.abort());
    await boot(page);
    await expect.poll(async () => (await state(page)).avatarPlaceholder, { timeout: 20_000 }).toBe(true);
    await expect(page.locator('#toast')).toContainText('placeholder');
  });
});
