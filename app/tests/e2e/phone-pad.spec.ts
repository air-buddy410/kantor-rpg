import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// v2.6 (Budi 2026-11-19): a phone becomes Pemain 2 through the pad relay.
// Two pages in one browser stand in for the PC and the phone; the relay runs
// locally on its own port. In the relay test WebRTC is removed on the phone,
// so the fallback path is proven too.
const PORT = 18791;
const RELAY = `ws://127.0.0.1:${PORT}/pad-relay`;
let relay: ChildProcess;

test.beforeAll(async () => {
  const file = fileURLToPath(new URL('../../../server/pad-relay.mjs', import.meta.url));
  relay = spawn(process.execPath, [file], { env: { ...process.env, PAD_RELAY_PORT: String(PORT), PAD_RELAY_ORIGINS: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/pad-relay/health`)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('relay did not start');
});
test.afterAll(() => { relay?.kill(); });

for (const mode of ['langsung', 'relay'] as const) {
  test(`phone joins as a virtual gamepad (${mode})`, async ({ browser }, info) => {
    test.skip(info.project.name !== 'desktop', 'two pages, one viewport is enough');
    const pc = await (await browser.newContext()).newPage();
    await pc.goto(`/mg.html?game=arcade&relay=${encodeURIComponent(RELAY)}`);
    await expect(pc.locator('#arcade')).toBeVisible({ timeout: 20_000 });
    await pc.locator('#arcade-phone').click();
    const codeEl = pc.locator('.pp-code');
    await expect(codeEl).toHaveText(/^[A-Z2-9]{6}$/, { timeout: 10_000 });
    const code = (await codeEl.textContent())!;
    const phone = await (await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true })).newPage();
    if (mode === 'relay') await phone.addInitScript(() => { (window as unknown as { RTCPeerConnection?: unknown }).RTCPeerConnection = undefined; });
    await phone.goto(`/pad.html?relay=${encodeURIComponent(RELAY)}#${code}`);
    await expect(phone.locator('body')).toHaveAttribute('data-phase', /seat|joined/, { timeout: 15_000 });
    await expect(pc.locator('.pp-phones li')).toHaveCount(1, { timeout: 10_000 });
    if (mode === 'relay') await expect(pc.locator('.pp-phones li')).toContainText('relay', { timeout: 8_000 });
    else await expect(pc.locator('.pp-phones li')).toContainText('langsung', { timeout: 8_000 });
    // Cross on the phone shows up as button 0 of virtual gamepad 4 on the PC
    const box = (await phone.locator('[data-b="0"]').boundingBox())!;
    await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await phone.mouse.down();
    await expect.poll(() => pc.evaluate(() => navigator.getGamepads()[4]?.buttons[0]?.pressed ?? false), { timeout: 5_000 }).toBe(true);
    await phone.mouse.up();
    await expect.poll(() => pc.evaluate(() => navigator.getGamepads()[4]?.buttons[0]?.pressed ?? true), { timeout: 5_000 }).toBe(false);
    expect(await pc.evaluate(() => navigator.getGamepads()[4]?.id)).toContain('HP PerumNet');
    await phone.close();
    await pc.close();
  });
}
