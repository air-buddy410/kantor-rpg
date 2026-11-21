import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
let relay: ChildProcess;
const port = 18792;
const url = `ws://127.0.0.1:${port}/pad-relay`;
test.beforeAll(async () => {
  relay = spawn(process.execPath, [fileURLToPath(new URL('../../../server/pad-relay.mjs', import.meta.url))], { env: { ...process.env, PAD_RELAY_PORT: String(port), PAD_RELAY_ORIGINS: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/pad-relay/health`)).ok) return; } catch { /* server starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('relay did not start');
});
test.afterAll(() => relay?.kill());
for (const mode of ['langsung', 'relay']) test(`3 phones: seats match lobby and controls (${mode})`, async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop');
  test.setTimeout(90_000);
  const contexts = [await browser.newContext({ locale: 'id-ID' })];
  try {
    const pc = await contexts[0].newPage();
    await pc.goto(`/mg.html?game=arcade&relay=${encodeURIComponent(url)}`);
    await pc.locator('#arcade-phone').click();
    await expect(pc.locator('.pp-code')).toHaveText(/^[A-Z2-9]{6}$/);
    const code = await pc.locator('.pp-code').textContent();
    const phones = [];
    for (let i = 0; i < 3; i++) {
      const ctx = await browser.newContext({ locale: 'id-ID', viewport: { width: 844, height: 390 }, hasTouch: true });
      contexts.push(ctx);
      if (mode === 'relay') await ctx.addInitScript(() => { Object.defineProperty(window, 'RTCPeerConnection', { value: undefined }); });
      const p = await ctx.newPage();
      await p.goto(`/pad.html?relay=${encodeURIComponent(url)}#${code}`);
      await expect(p.locator('.hp-status')).toHaveText('Tersambung');
      await expect(p.locator('.hp-hint')).toContainText('untuk ikut main');
      phones.push(p);
    }
    await expect(pc.locator('.pp-phones li').first()).toContainText('HP 1');
    await pc.locator('dialog.pp').getByRole('button', { name: 'Tutup' }).click();
    await pc.locator('[data-game="arena-bom"]').click();
    await expect(pc.locator('#mg-host .mg-card button.primary')).toBeVisible();
    await pc.waitForTimeout(500);
    const press = async (k: number, button: number) => {
      await phones[k].locator(`[data-b="${button}"]`).dispatchEvent('pointerdown', { pointerId: 1 });
      await pc.waitForTimeout(150);
      await phones[k].locator(`[data-b="${button}"]`).dispatchEvent('pointerup', { pointerId: 1 });
    };
    for (const [k, seat] of [[2, 2], [0, 3], [1, 4]]) {
      await press(k, 0);
      await expect(phones[k].locator('.hp-status')).toHaveText(`Pemain ${seat}`);
      await expect(pc.locator(`.mg-lobby li[data-p="${seat}"]`)).toContainText(`HP ${k + 1}`);
    }
    // Leaving a lobby compacts seats: every remaining phone must follow its new seat.
    await press(2, 1);
    await expect(phones[2].locator('.hp-status')).toHaveText('Tersambung');
    await expect(phones[0].locator('.hp-status')).toHaveText('Pemain 2');
    await expect(phones[1].locator('.hp-status')).toHaveText('Pemain 3');
    await press(2, 0);
    await expect(phones[2].locator('.hp-status')).toHaveText('Pemain 4');
    await pc.locator('#mg-host .mg-card button.primary').click();
    await pc.waitForTimeout(3000);
    const before = await pc.evaluate(() => (window as unknown as { __mg: { state(): { snap: { players: { x: number; y: number }[] } } } }).__mg.state().snap.players.map((p) => [p.x, p.y]));
    const d = (await phones[0].locator('.hp-dpad').boundingBox())!;
    await phones[0].mouse.move(d.x + d.width / 2, d.y + d.height * 0.92);
    await phones[0].mouse.down();
    await pc.waitForTimeout(900);
    await phones[0].mouse.up();
    const after = await pc.evaluate(() => (window as unknown as { __mg: { state(): { snap: { players: { x: number; y: number }[] } } } }).__mg.state().snap.players.map((p) => [p.x, p.y]));
    expect(after[1][1]).toBeGreaterThan(before[1][1]);
    expect(after.filter((_, i) => i !== 1)).toEqual(before.filter((_, i) => i !== 1));
    await pc.locator('#mg-host .mg-bar').getByRole('button', { name: 'Keluar', exact: true }).click();
    for (const p of phones) await expect(p.locator('.hp-status')).toHaveText('Tersambung');
  } finally { for (const ctx of contexts) await ctx.close(); }
});
