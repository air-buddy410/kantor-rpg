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

// Budi 2026-11-19 (iPhone screenshot): the pad overflowed upright and could be zoomed.
// Upright it is turned 90° and fits; landscape fits; pinch does not zoom; the
// left stick follows the thumb and reads in the pad's own frame when turned.
for (const [name, vp] of [['upright', { width: 390, height: 664 }], ['landscape', { width: 750, height: 342 }]] as const) {
  test(`phone pad fits the screen and does not zoom (${name})`, async ({ browser }, info) => {
    test.skip(info.project.name !== 'desktop', 'own phone viewports');
    const pc = await (await browser.newContext()).newPage();
    await pc.goto(`/mg.html?game=arcade&relay=${encodeURIComponent(RELAY)}`);
    await pc.locator('#arcade-phone').click();
    const code = (await pc.locator('.pp-code').textContent({ timeout: 10_000 }))!;
    const ctx = await browser.newContext({ viewport: vp, hasTouch: true, isMobile: true });
    const phone = await ctx.newPage();
    await phone.goto(`/pad.html?relay=${encodeURIComponent(RELAY)}#${code}`);
    await expect(phone.locator('body')).toHaveAttribute('data-phase', /seat|joined/, { timeout: 15_000 });
    await expect(phone.locator('body')).toHaveAttribute('data-rot', name === 'upright' ? '90' : '0');
    // every control on screen, at least 44 px, none on top of another
    const bad = await phone.evaluate(() => {
      const W = innerWidth, H = innerHeight, out: string[] = [];
      const els = [...document.querySelectorAll<HTMLElement>('.hp-btn, .hp-arm, .hp-stick, .hp-trig')];
      for (const el of els) {
        const b = el.getBoundingClientRect();
        if (b.left < -1 || b.top < -1 || b.right > W + 1 || b.bottom > H + 1) out.push(`out ${el.getAttribute('aria-label')}`);
        if (Math.min(b.width, b.height) < 43.5) out.push(`small ${el.getAttribute('aria-label')}`);
      }
      const big = [...document.querySelectorAll<HTMLElement>('.hp-btn, .hp-dpad, .hp-stick, .hp-trig')].filter((e) => !e.closest('.hp-face')).concat([...document.querySelectorAll<HTMLElement>('.hp-face')]);
      for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++) {
        const A = big[i].getBoundingClientRect(), C = big[j].getBoundingClientRect();
        if (Math.min(A.right, C.right) - Math.max(A.left, C.left) > 2 && Math.min(A.bottom, C.bottom) - Math.max(A.top, C.top) > 2) out.push(`overlap ${big[i].className} / ${big[j].className}`);
      }
      return out;
    });
    expect(bad).toEqual([]);
    // pinch out on the pad: the page stays at scale 1
    const cdp = await ctx.newCDPSession(phone);
    await cdp.send('Input.synthesizePinchGesture', { x: vp.width / 2, y: vp.height / 2, scaleFactor: 2.5, relativeSpeed: 800, gestureSourceType: 'touch' });
    expect(await phone.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);
    // left stick: touch inside its zone, drag toward the pad's right; the PC reads +x
    const zone = (await phone.locator('.hp-left').boundingBox())!;
    const x0 = zone.x + zone.width / 2, y0 = zone.y + zone.height / 2;
    const [dx, dy] = name === 'upright' ? [0, 60] : [60, 0]; // turned 90° clockwise: pad right is screen down
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dx, y: y0 + dy }] });
    await expect.poll(() => pc.evaluate(() => navigator.getGamepads()[4]?.axes[0] ?? 0), { timeout: 5_000 }).toBeGreaterThan(0.6);
    expect(Math.abs(await pc.evaluate(() => navigator.getGamepads()[4]?.axes[1] ?? 0))).toBeLessThan(0.3);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => pc.evaluate(() => navigator.getGamepads()[4]?.axes[0] ?? 1), { timeout: 5_000 }).toBe(0);
    await phone.close(); await pc.close();
  });
}

