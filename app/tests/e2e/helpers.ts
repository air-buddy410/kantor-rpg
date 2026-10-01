import { expect, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const EVIDENCE = join(REPO, 'docs', 'evidence', process.env.KANTOR_MILESTONE ?? 'M1');

export interface KState { floor: string; pos: [number, number]; facing: number; room: string | null; visitor: boolean; avatarPlaceholder: boolean; clips: string[]; recoveries: number; floorSwitches: number }

export async function boot(page: Page, query = ''): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(`/${query}`);
  await page.waitForFunction(() => !!window.__kantor, null, { timeout: 30_000 });
  return errors;
}

export async function state(page: Page): Promise<KState> {
  return page.evaluate(() => (window.__kantor!.state as () => KState)());
}

export async function walkTo(page: Page, x: number, y: number): Promise<boolean> {
  return page.evaluate(([px, py]) => (window.__kantor!.walkTo as (a: number, b: number) => Promise<boolean>)(px, py), [x, y]);
}

export async function shot(page: Page, info: TestInfo, name: string) {
  const dir = join(EVIDENCE, 'screenshots');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${info.project.name}-${name}.jpg`), type: 'jpeg', quality: 72 });
}

export async function expectTapTargets(page: Page, selector: string, min = 44) {
  const small = await page.$$eval(selector, (els, m) => els
    .filter((e) => (e as HTMLElement).offsetParent !== null)
    .map((e) => ({ id: e.id || e.textContent?.trim().slice(0, 20), r: e.getBoundingClientRect() }))
    .filter((x) => x.r.width < m || x.r.height < m)
    .map((x) => `${x.id} ${Math.round(x.r.width)}x${Math.round(x.r.height)}`), min);
  expect(small, `tap targets under ${min}px`).toEqual([]);
}
