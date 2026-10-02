import { expect, test } from '@playwright/test';
import { boot, expectTapTargets, shot, state, walkTo } from './helpers';

test.describe('world vertical slice', () => {
  test('boots in lobby with simulation badge and no page errors', async ({ page }, info) => {
    const errors = await boot(page);
    await expect(page.locator('#room-name')).toHaveText('Lobby & resepsi');
    await expect(page.locator('#sim-badge')).toContainText('SIMULASI');
    await expect(page.locator('#directory-panel')).toBeHidden();
    await page.waitForTimeout(1500);
    await shot(page, info, 'spawn');
    expect(errors).toEqual([]);
  });

  test('keyboard walking moves the CEO and the reception desk collider stops it', async ({ page }, info) => {
    await boot(page);
    const s0 = await state(page);
    await page.locator('#stage canvas').click({ position: { x: 300, y: 600 } });
    // Hold until the CEO stops advancing: frame rate in CI is low (software
    // WebGL), and the game clamps dt, so wall-clock time is not distance.
    // Personas are solid (hardening): a stop next to one is a persona block,
    // not the desk, so keep holding until the CEO is stopped with nobody close.
    const personaNear = (p: number[]) => page.evaluate((q) => (window.__kantor!.npcs as () => { floor: string; pos: number[] }[])()
      .some((n) => n.floor === 'L1' && Math.hypot(n.pos[0] - q[0], n.pos[1] - q[1]) < 0.8), p);
    await page.keyboard.down('w');
    let last = s0.pos[1];
    for (let k = 0; k < 60; k++) {
      await page.waitForTimeout(500);
      const st = await state(page);
      const y = st.pos[1];
      if (y > s0.pos[1] + 1 && Math.abs(y - last) < 0.01 && !(await personaNear(st.pos))) break;
      last = y;
    }
    await page.keyboard.up('w');
    const s1 = await state(page);
    expect(s1.pos[1]).toBeGreaterThan(s0.pos[1] + 1.5);
    // Desk front edge at y=4.55; with radius 0.25 on a 0.1 m grid the CEO must
    // stop at least 0.1 m short of the edge (grid contract tolerance one cell).
    expect(s1.pos[1]).toBeLessThan(4.45);
    expect(s1.room).toBe('L1-LOBBY');
  });

  test('stair interaction changes floor only at the marked point', async ({ page }, info) => {
    await boot(page);
    // Pressing E at spawn does nothing to the floor.
    await page.keyboard.press('e');
    expect((await state(page)).floor).toBe('L1');
    expect(await walkTo(page, 14.8, 11.3)).toBe(true);
    await expect(page.locator('#prompt')).toContainText('tangga');
    await page.keyboard.press('e');
    await expect.poll(async () => (await state(page)).floor, { timeout: 5000 }).toBe('L2');
    await expect(page.locator('#floor-chip')).toHaveText('L2');
    await page.waitForTimeout(800);
    await shot(page, info, 'l2-arrival');
    // L2 recreation rooms are reachable: walk into the game room.
    expect(await walkTo(page, 26, 14.0)).toBe(true);
    await expect(page.locator('#room-name')).toHaveText('Ruang game');
    await shot(page, info, 'l2-game');
    // and back down by the lift
    expect(await walkTo(page, 18.875, 13.65)).toBe(true);
    await page.keyboard.press('e');
    await expect.poll(async () => (await state(page)).floor, { timeout: 5000 }).toBe('L1');
  });

  test('visitor mode locks the server room (UI toggle, path and directory)', async ({ page }) => {
    await boot(page);
    expect(await page.evaluate(() => (window.__kantor!.walkTo as (x: number, y: number) => Promise<boolean>)(22.5, 17.5))).toBe(true);
    await page.locator('#btn-settings').click();
    await page.getByLabel('Mode visitor (ruang terbatas terkunci)').check();
    await page.getByRole('button', { name: 'Selesai' }).click();
    expect((await state(page)).visitor).toBe(true);
    expect(await walkTo(page, 27, 21)).toBe(false);
    await page.locator('#btn-directory').click();
    const server = page.locator('.dir-item', { hasText: 'Ruang server' });
    await expect(server).toContainText('terkunci');
    await expect(server.getByRole('button')).toHaveAttribute('aria-disabled', 'true');
  });

  test('dialogs trap focus, block locomotion and return focus on Escape', async ({ page }, info) => {
    await boot(page);
    const help = page.locator('#btn-help');
    await help.click();
    await expect(page.locator('#dlg-help')).toBeVisible();
    const before = await state(page);
    await page.keyboard.down('w');
    await page.waitForTimeout(800);
    await page.keyboard.up('w');
    expect((await state(page)).pos).toEqual(before.pos);
    await page.keyboard.press('Escape');
    await expect(page.locator('#dlg-help')).toBeHidden();
    await expect(help).toBeFocused();
    if (info.project.name === 'desktop') {
      await page.keyboard.press('m');
      await expect(page.locator('#directory-panel')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#directory-panel')).toBeHidden();
    }
  });

  test('directory "Pergi" moves the CEO to a room and opens persona cards', async ({ page }, info) => {
    await boot(page);
    await page.locator('#btn-directory').click();
    await page.getByRole('button', { name: 'Pergi Ruang biliar' }).click();
    await expect.poll(async () => (await state(page)).room, { timeout: 5000 }).toBe('L2-BILLIARD');
    await page.locator('#btn-directory').click();
    await page.getByRole('button', { name: 'Profil Nova' }).click();
    await expect(page.locator('#dlg-info')).toContainText('Spesifikasi ICT');
    await expect(page.locator('#dlg-info')).toContainText('Representasi virtual original');
    await shot(page, info, 'persona-card');
    await page.keyboard.press('Escape');
  });

  test('tap targets are at least 44 px and layout differs per device class', async ({ page }, info) => {
    await boot(page);
    await expectTapTargets(page, 'button, a[href]');
    const touchVisible = await page.locator('#joystick').isVisible();
    if (info.project.name === 'desktop') expect(touchVisible).toBe(false);
    else expect(touchVisible).toBe(true);
    await page.locator('#btn-directory').click();
    const box = (await page.locator('#directory-panel').boundingBox())!;
    const vw = page.viewportSize()!.width;
    if (info.project.name === 'mobile') expect(box.width).toBeGreaterThanOrEqual(vw - 1); // bottom sheet
    if (info.project.name === 'tablet') expect(box.x).toBeLessThan(vw / 2); // left side sheet
    if (info.project.name === 'desktop') expect(box.x).toBeGreaterThan(vw / 2); // right panel
    await expectTapTargets(page, '#directory-panel button, #directory-panel a[href]');
    await shot(page, info, 'directory');
  });

  test('touch joystick walks the CEO', async ({ page }, info) => {
    test.skip(info.project.name === 'desktop', 'touch only');
    await boot(page);
    const s0 = await state(page);
    const j = (await page.locator('#joystick').boundingBox())!;
    const cx = j.x + j.width / 2;
    const cy = j.y + j.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, cy - 50, { steps: 4 });
    // Hold until the CEO has covered distance; software WebGL frame rate varies.
    await expect.poll(async () => {
      const s = await state(page);
      return Math.hypot(s.pos[0] - s0.pos[0], s.pos[1] - s0.pos[1]);
    }, { timeout: 15_000 }).toBeGreaterThan(0.8);
    await page.mouse.up();
    await shot(page, info, 'joystick');
  });

  test('dark theme renders with computed token colours', async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await boot(page);
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.hud-place')!).backgroundColor);
    expect(bg).toBe('rgb(27, 42, 34)');
    await page.waitForTimeout(800);
    await shot(page, info, 'dark');
  });

  test('reduced motion makes floor changes instant (no fade)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page);
    expect(await walkTo(page, 14.8, 11.3)).toBe(true);
    await page.keyboard.press('e');
    // instant: same frame, no fade overlay ever applied
    expect((await state(page)).floor).toBe('L2');
    await expect(page.locator('#fade')).not.toHaveClass(/on/);
  });

  test('only same-origin requests are made (no external endpoints)', async ({ page }) => {
    const hosts = new Set<string>();
    // blob:/data: URLs are in-page (GLTFLoader hands embedded textures to the
    // image decoder that way); only network schemes count as endpoints.
    page.on('request', (r) => { const u = new URL(r.url()); if (u.protocol !== 'blob:' && u.protocol !== 'data:') hosts.add(u.host); });
    // Under the CSP of docs/PREVIEW-HANDOFF.md (scripts/serve-csp.mjs) a blocked load shows up here.
    const csp: string[] = [];
    page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text()); });
    await boot(page);
    await page.locator('#btn-directory').click();
    await page.waitForTimeout(1500);
    expect([...hosts]).toEqual([new URL(page.url()).host]);
    expect(csp).toEqual([]);
  });
});

test.describe('fallback without WebGL', () => {
  test('directory, room cards and documents work with keyboard only', async ({ page }, info) => {
    const errors = await boot(page, '?nogl=1');
    await expect(page.locator('#fallback')).toBeVisible();
    await expect(page.locator('#fallback-reason')).toContainText('nogl');
    const info1 = page.getByRole('button', { name: 'Info Ruang server' });
    await info1.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#dlg-info')).toContainText('L1-SERVER');
    await page.keyboard.press('Escape');
    await expect(info1).toBeFocused();
    await expect(page.locator('.doc-list a').first()).toBeVisible();
    await shot(page, info, 'fallback');
    expect(errors).toEqual([]);
  });
});
