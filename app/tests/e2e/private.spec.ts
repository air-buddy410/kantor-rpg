// M4/M5 di browser: papan demo untuk pengunjung, login owner sandi + 2FA,
// papan nyata, percakapan agen dengan 3 pilihan + Ketik manual, approval,
// dan keyboard/mobile. Backend privat yang asli dijalankan di proses tes
// dengan runner palsu (tanpa LLM) dan sumber Kanban/log buatan.
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { boot, shot } from './helpers';
import { createServer } from '../../../server/server.mjs';
import { totp, hashPassword, base32Encode } from '../../../server/auth.mjs';

const SECRET: string = base32Encode(Buffer.from('kantor-rpg-e2e-secret'));
const PROXY = 'e2e-proxy-secret-0123456789abcdef';
let server: { close: () => void; address: () => { port: number } };
let backend = '';
const calls: { profile: string; message: string }[] = [];
let tmp = '';
let tgTs = 0; // Telegram fixture clock (s); unread tests set read marks relative to it
// The server clock advances one TOTP step per login so every login has a
// fresh code (the server rejects a reused one) without waiting 30 s.
let clockOffset = 0;

test.beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kantor-e2e-'));
  const home = path.join(tmp, 'home');
  fs.mkdirSync(path.join(home, '.hermes', 'logs'), { recursive: true });
  fs.mkdirSync(path.join(home, 'Hermes', '_Bersama'), { recursive: true });
  const n = Math.floor(Date.now() / 1000);
  execFileSync('sqlite3', [path.join(home, '.hermes', 'kanban.db'), `
    create table tasks(id text primary key,title text,body text,assignee text,status text,created_by text,created_at int,started_at int,completed_at int);
    create table task_events(id integer primary key autoincrement,task_id text,kind text,created_at int);
    insert into tasks values('t_h1','HANDOFF proyek-e2e: Volume ruang Villa E2E','x','enterprise','todo','sipil',${n - 30 * 3600},null,null);
    insert into tasks values('t_r','Render poster E2E','x','leo','running','sales',${n - 600},${n - 300},null);
    insert into tasks values('t_b','Audit backup E2E','x','infra','blocked','default',${n - 900},null,null);
    insert into task_events(task_id,kind,created_at) values('t_b','blocked',${n - 120});
  `]);
  // Kevin (sales) has a Telegram DM with Budi: his RPG chat is that chat (ADR-017).
  const tgDir = path.join(home, '.hermes', 'profiles', 'sales');
  fs.mkdirSync(tgDir, { recursive: true });
  fs.writeFileSync(path.join(home, '.hermes', '.env'), 'TELEGRAM_ALLOWED_USERS=777\n');
  const ts = Date.now() / 1000;
  tgTs = ts;
  execFileSync('sqlite3', [path.join(tgDir, 'state.db'), `
    create table sessions(id text primary key, source text, session_key text, started_at real, ended_at real);
    create table messages(id integer primary key autoincrement, session_id text, role text, content text, timestamp real, platform_message_id text, _compressed_summary int default 0);
    insert into sessions values('tg_kevin','telegram','agent:sales:telegram:dm:777',${ts - 4000},null);
    insert into messages(session_id,role,content,timestamp,platform_message_id) values
${Array.from({ length: 15 }, (_, i) => `      ('tg_kevin','user','Catatan lama ${i + 1}',${ts - 3600 + i * 60},'${4000 + i}'),\n      ('tg_kevin','assistant','Balasan lama ${i + 1}',${ts - 3590 + i * 60},null),`).join('\n')}
      ('tg_kevin','user','Kevin, follow up Villa E2E besok pagi ya',${ts - 600},'5001'),
      ('tg_kevin','assistant','Siap, aku jadwalkan follow up jam 09.00.',${ts - 590},null);
  `]);
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir, { mode: 0o700 });
  fs.writeFileSync(path.join(dataDir, 'owner.json'), JSON.stringify({ username: 'budi', passwordHash: hashPassword('sandi-e2e-panjang-1'), totpSecret: SECRET }), { mode: 0o600 });
  const runner = async (job: { profile: string; message: string }) => {
    calls.push(job);
    await new Promise((r) => setTimeout(r, 400));
    if (job.message.startsWith('Tinjau')) return { ok: true, text: 'Sudah aku tinjau. Tidak ada keputusan lagi.\n```json\n{"pilihan":[]}\n```', session: 'hs' };
    return { ok: true, text: `Siap, ${job.profile} menerima.\n\`\`\`json\n{"pilihan":[{"label":"Cek progres","pesan":"Cek progres tugas ini"},{"label":"Tinjau hasil","pesan":"Tinjau hasil yang ada"},{"label":"Deploy ke produksi","pesan":"Deploy ke produksi sekarang"}]}\n\`\`\``, session: 'hs' };
  };
  ({ server } = createServer({ dataDir, home, proxySecret: PROXY, allowedOrigin: `http://127.0.0.1:${process.env.KANTOR_PORT ?? '4173'}`, runner, cookieSecure: false, boardTtlMs: 0, now: () => Date.now() + clockOffset, transcriber: async () => 'tolong cek denah lantai satu', pushFetch: async () => ({ ok: true, status: 201 }) }));
  await new Promise<void>((r) => (server as unknown as { listen: (p: number, h: string, cb: () => void) => void }).listen(0, '127.0.0.1', r));
  backend = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

/** Same-origin /api/ forwarded to the test backend with the nginx proxy header. */
async function wireApi(page: Page) {
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const res = await route.fetch({ url: backend + url.pathname.replace(/^.*\/api\//, '/api/') + url.search, headers: { ...req.headers(), 'x-kantor-proxy': PROXY } });
    await route.fulfill({ response: res });
  });
}

async function login(page: Page) {
  await page.getByLabel('Nama').fill('budi');
  await page.getByLabel('Sandi').fill('sandi-e2e-panjang-1');
  clockOffset += 31_000;
  await page.getByLabel('Kode 2FA (6 digit)').fill(totp(SECRET, Date.now() + clockOffset));
  await page.getByRole('button', { name: 'Masuk' }).click();
}

test('pengunjung: papan Demo dan tidak bisa memerintah agen (REQ-BOARD-04, AC-CMD-04)', async ({ page }, info) => {
  const errors = await boot(page);
  await page.getByRole('button', { name: /Papan kerja/ }).click();
  const dlg = page.locator('#dlg-boards');
  await expect(dlg.getByText('Demo', { exact: true })).toBeVisible();
  await expect(dlg.getByText(/Contoh: volume ruang/)).toBeVisible();
  await expect(dlg.getByText(/Backend privat tidak terjangkau/)).toBeVisible();
  await shot(page, info, 'boards-demo');
  await dlg.getByRole('button', { name: 'Tutup' }).click();
  await page.evaluate(() => (window.__kantor!.openAgent as (p: string) => void)('enterprise'));
  await expect(page.locator('#dlg-agent')).toContainText('hanya untuk owner yang login');
  await expect(page.locator('#agent-send')).toHaveCount(0);
  expect(calls.length).toBe(0);
  expect(errors.filter((e) => !/404|Failed to load resource/.test(e))).toEqual([]);
  const html = await (await page.request.get('/')).text();
  expect(html).not.toMatch(/Villa E2E|Render poster E2E/);
});

test('owner: login 2FA, papan nyata, filter lane, log (REQ-BOARD-01..03)', async ({ page }, info) => {
  await wireApi(page);
  await boot(page);
  await page.keyboard.press('b');
  const dlg = page.locator('#dlg-boards');
  await expect(dlg.getByText('Demo', { exact: true })).toBeVisible();
  await login(page);
  await expect(dlg.getByText('Data nyata')).toBeVisible();
  await expect(dlg.getByText('Hugo → Nova')).toBeVisible();
  await expect(dlg.getByText('Perlu perhatian', { exact: true })).toBeVisible();
  await shot(page, info, 'boards-handoff');
  await dlg.getByRole('tab', { name: 'Daftar Pekerjaan' }).click();
  await expect(dlg.locator('tbody tr').first()).toContainText('Audit backup E2E');
  await dlg.getByLabel('Bot').selectOption('Leo');
  await expect(dlg.locator('#task-count')).toHaveText('1 dari 3 tugas.');
  await expect(dlg.locator('tbody tr')).toHaveCount(1);
  await dlg.getByRole('tab', { name: 'Daftar Pekerjaan' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(dlg.getByRole('tab', { name: 'Log Aktivitas' })).toHaveAttribute('aria-selected', 'true');
  await expect(dlg.locator('.log li').first()).toContainText('Tugas diblokir');
  await dlg.locator('.log-link').first().click();
  await expect(dlg.getByRole('tab', { name: 'Daftar Pekerjaan' })).toHaveAttribute('aria-selected', 'true');
  await expect(dlg.locator('tr.focus-row')).toContainText('Audit backup E2E');
  // Leo's lane is PRIBADI in the roster; the handoff/ENT and infra rows drop out.
  await dlg.getByLabel('Badan').selectOption('PRIBADI');
  await expect(dlg.locator('tbody tr')).toHaveCount(1);
  await expect(dlg.locator('tbody tr')).toContainText('Render poster E2E');
  await dlg.getByLabel('Badan').selectOption('');
  await dlg.getByRole('tab', { name: 'Log Aktivitas' }).click();
  await shot(page, info, 'boards-log');
  // Backend goes away: the last snapshot stays, labelled stale (REQ-BOARD-05).
  await page.unroute('**/api/**');
  await page.route('**/api/**', (r) => r.abort());
  await dlg.getByRole('tab', { name: 'Papan Handoff' }).click();
  await page.evaluate(() => (window.__kantor!.openBoards as (t: string) => void)('handoffs'));
  await expect(dlg.getByText(/^Basi: pembaruan gagal/)).toBeVisible();
  await expect(dlg.getByText('Hugo → Nova')).toBeVisible();
  await page.unroute('**/api/**');
  await wireApi(page);
  await dlg.locator('#btn-logout').click();
  await expect(dlg.getByText('Demo', { exact: true })).toBeVisible();
  await expect(dlg.getByText('Volume ruang Villa E2E')).toHaveCount(0);
});

test('owner: beri tugas ke Nova, 3 pilihan + manual, approval, tanpa kirim ganda (AC-CMD-01..03, AC-CHOICE-01, AC-MANUAL-01)', async ({ page }, info) => {
  await wireApi(page);
  await boot(page);
  await page.getByRole('button', { name: /Direktori/ }).click();
  await page.getByRole('button', { name: 'Beri tugas ke Nova' }).click();
  const dlg = page.locator('#dlg-agent');
  await login(page);
  await expect(dlg).toContainText('Profil');
  await expect(dlg).toContainText('enterprise');
  const ta = dlg.locator('#agent-manual-text');
  await ta.fill('Hitung outlet Villa E2E');
  const n0 = calls.length;
  await dlg.locator('#agent-send').dblclick();
  await expect(dlg.locator('.task-status').first()).toBeVisible();
  await expect(dlg.getByRole('button', { name: /^1\. Cek progres/ })).toBeVisible({ timeout: 15_000 });
  expect(calls.length).toBe(n0 + 1);
  expect(calls.at(-1)!.profile).toBe('enterprise');
  expect(calls.at(-1)!.message.startsWith('Hitung outlet Villa E2E')).toBe(true);
  await expect(dlg.getByRole('button', { name: /^2\. Tinjau hasil/ })).toBeVisible();
  await expect(dlg.getByRole('button', { name: /^3\. Deploy ke produksi \(perlu persetujuan\)/ })).toBeVisible();
  await expect(dlg.getByRole('button', { name: '4. Ketik manual' })).toBeVisible();
  for (const b of await dlg.locator('.btn.choice').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await shot(page, info, 'agent-choices');
  // Escape inside manual input closes it without sending.
  await dlg.getByRole('button', { name: '4. Ketik manual' }).click();
  await expect(ta).toBeFocused();
  await ta.fill('jangan terkirim');
  await page.keyboard.press('Escape');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('#agent-manual')).toBeHidden();
  expect(calls.length).toBe(n0 + 1);
  // Risky option waits for a separate approval.
  await dlg.getByRole('button', { name: /^3\. Deploy ke produksi/ }).click();
  await expect(dlg.getByText('Butuh persetujuanmu')).toBeVisible();
  await page.waitForTimeout(600);
  expect(calls.length).toBe(n0 + 1);
  await shot(page, info, 'agent-approval');
  await dlg.getByRole('button', { name: 'Tolak' }).click();
  await expect(dlg.getByText('Butuh persetujuanmu')).toHaveCount(0);
  expect(calls.length).toBe(n0 + 1);
  // Option 2 goes through; the old choices expire after the new reply.
  await dlg.getByRole('button', { name: /^2\. Tinjau hasil/ }).click();
  await expect(dlg.getByText('Sudah aku tinjau')).toBeVisible({ timeout: 15_000 });
  expect(calls.at(-1)!.message.startsWith('Tinjau hasil yang ada')).toBe(true);
  await expect(dlg.getByRole('button', { name: /^1\. Cek progres/ })).toHaveCount(0);
  await expect(dlg.locator('#agent-manual')).toBeVisible();
  await shot(page, info, 'agent-reply');
  // Fresh conversation; a risky manual message: cancel one, approve another.
  await dlg.getByRole('button', { name: 'Mulai percakapan baru' }).click();
  await expect(dlg.getByText(/Belum ada pesan/)).toBeVisible();
  await ta.fill('Restart VM di proxmox2 sekarang');
  await dlg.locator('#agent-send').click();
  await expect(dlg.getByText('Butuh persetujuanmu')).toBeVisible();
  await dlg.getByRole('button', { name: 'Batalkan' }).click();
  await expect(dlg.getByText('Butuh persetujuanmu')).toHaveCount(0);
  const n1 = calls.length;
  if (await dlg.locator('#agent-manual').isHidden()) await dlg.getByRole('button', { name: 'Ketik pesan' }).click();
  await ta.fill('Hapus snapshot lama VM 105');
  await dlg.locator('#agent-send').click();
  await dlg.getByRole('button', { name: 'Setujui untuk tugas ini' }).click();
  await expect(dlg.getByText(/Siap, enterprise menerima/).last()).toBeVisible({ timeout: 15_000 });
  expect(calls.length).toBe(n1 + 1);
  expect(calls.at(-1)!.message).toContain('Persetujuan Budi dari panel RPG');
});

test('NPC di dunia: Sapa lalu Bicara & beri tugas membuka profil yang benar', async ({ page }) => {
  await wireApi(page);
  await boot(page);
  await page.getByRole('button', { name: /Direktori/ }).click();
  await page.getByRole('button', { name: 'Temui Leo' }).click();
  const info = page.locator('#dlg-info');
  await expect(info.getByRole('button', { name: 'Bicara & beri tugas' })).toBeVisible({ timeout: 20_000 });
  await info.getByRole('button', { name: 'Bicara & beri tugas' }).click();
  await expect(page.locator('#dlg-agent')).toBeVisible();
  await login(page);
  await expect(page.locator('#dlg-agent')).toContainText('leo');
  await expect(page.locator('#agent-title')).toContainText('Leo');
});

test('shortcut C: chat agen tanpa mendatangi NPC; status nyata membuat Leo bekerja di mejanya', async ({ page }, info) => {
  await wireApi(page);
  await boot(page);
  await expect(page.locator('#sim-badge')).toHaveText('SIMULASI: data demo');
  await page.keyboard.press('c');
  const dlg = page.locator('#dlg-agent');
  await expect(dlg).toContainText('hanya untuk owner yang login');
  await login(page);
  await expect(page.locator('#agent-title')).toHaveText('Chat agen');
  const leo = dlg.locator('[data-agent="leo"]');
  await expect(leo).toContainText('Bekerja'); // Kanban: Render poster E2E, running
  await expect(dlg.locator('[data-agent="echo"]')).toContainText('Siap');
  await shot(page, info, 'agent-picker');
  await dlg.locator('[data-agent="enterprise"]').click();
  await expect(page.locator('#agent-title')).toContainText('Nova');
  await page.keyboard.press('Escape');
  await expect(page.locator('#sim-badge')).toHaveText('Status kerja: nyata');
  // Leo walks to his own desk and keeps typing; the label says he is working.
  await expect.poll(async () => page.evaluate(() => (window.__kantor!.npcs as () => { id: string; phase: string; activity: string; slot: string | null; workStatus: string }[])().find((n) => n.id === 'ACT-LEO')),
    { timeout: 60_000 }).toMatchObject({ workStatus: 'working', phase: 'perform', activity: 'desk', slot: 'SL-L1-099-1' });
  await expect(page.locator('.npc-label.busy', { hasText: 'Leo · bekerja' })).toHaveCount(1);
  const echo = await page.evaluate(() => (window.__kantor!.npcs as () => { id: string; workStatus: string }[])().find((n) => n.id === 'ACT-ECHO'));
  expect(echo?.workStatus).toBe('done');
});

test('sync Telegram: chat Kevin di RPG menampilkan obrolan Telegram yang sama (ADR-017)', async ({ page }, info) => {
  await wireApi(page);
  await boot(page);
  await page.keyboard.press('b');
  await login(page);
  await expect(page.locator('#dlg-boards').getByText('Data nyata')).toBeVisible();
  await page.locator('#dlg-boards').getByRole('button', { name: 'Tutup' }).click();
  await page.keyboard.press('c');
  await page.locator('.agent-pick-btn[data-agent="sales"]').click();
  const dlg = page.locator('#dlg-agent');
  await expect(dlg.locator('#agent-sync-note')).toContainText('percakapan Telegram-mu dengan Kevin');
  await expect(dlg.getByText('Sama dengan chat Telegram')).toBeVisible();
  await expect(dlg.locator('.turn.owner').filter({ hasText: 'follow up Villa E2E besok pagi' })).toHaveCount(1);
  await expect(dlg.locator('.turn.owner .who').first()).toContainText('Telegram');
  await expect(dlg.locator('.turn.agent').last()).toContainText('jam 09.00');
  // Telegram feel: day separator, double tick on answered messages, "last active" line, reply quote.
  await expect(dlg.locator('.day-divider').first()).toBeVisible();
  await expect(dlg.locator('.turn.owner').filter({ hasText: 'follow up Villa E2E besok pagi' }).locator('[data-receipt="read"]')).toHaveText('✓✓');
  await expect(dlg.locator('#agent-status')).toContainText(/aktif|mengetik/);
  await dlg.locator('.turn.agent').last().getByRole('button', { name: /Balas pesan/ }).click();
  await expect(dlg.locator('#agent-manual-text')).toHaveValue(/^↩ Membalas Kevin: ".*jam 09\.00/);
  await shot(page, info, 'agent-telegram-sync');
});

test('chat seperti aplikasi pesan: badge belum dibaca, dibuka dari pesan belum dibaca, lalu terbaca', async ({ page }, info) => {
  await wireApi(page);
  await boot(page);
  // Kevin's chat was last read between "Balasan lama 15" and his 09.00 reply.
  const mark = Math.round((tgTs - 595) * 1000);
  await page.evaluate((at) => localStorage.setItem('kantor-rpg:read:sales', String(at)), mark);
  await page.keyboard.press('b');
  await login(page);
  await expect(page.locator('#dlg-boards').getByText('Data nyata')).toBeVisible();
  await page.locator('#dlg-boards').getByRole('button', { name: 'Tutup' }).click();
  await expect(page.locator('#btn-chat .unread-badge')).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('c');
  await expect(page.locator('.agent-pick-btn[data-agent="sales"] .unread-badge')).toHaveText('1');
  await page.locator('.agent-pick-btn[data-agent="sales"]').click();
  const dlg = page.locator('#dlg-agent');
  const divider = dlg.locator('.unread-divider');
  await expect(divider).toHaveText('Belum dibaca');
  await expect(dlg.locator('.unread-divider + li')).toContainText('jam 09.00');
  // The log is scrolled so the unread part is in view, not the top of the history.
  await expect.poll(async () => dlg.locator('.chat').evaluate((log: HTMLElement) => {
    const d = log.querySelector<HTMLElement>('.unread-divider')!;
    const top = d.offsetTop - log.offsetTop;
    return log.scrollTop > 0 && top >= log.scrollTop - 1 && top <= log.scrollTop + log.clientHeight;
  })).toBe(true);
  await expect.poll(() => page.evaluate(() => Number(localStorage.getItem('kantor-rpg:read:sales')))).toBeGreaterThan(mark);
  await shot(page, info, 'agent-unread');
  await dlg.getByRole('button', { name: 'Tutup' }).click();
  await page.keyboard.press('c');
  await expect(page.locator('.agent-pick-btn[data-agent="sales"]')).toBeVisible();
  await expect(page.locator('.agent-pick-btn[data-agent="sales"] .unread-badge')).toHaveCount(0);
});

test('chat tahap 2-3: kirim foto, pesan suara jadi teks, cari pesan, setelan notifikasi', async ({ page, context }, info) => {
  await context.grantPermissions(['microphone']).catch(() => {});
  await wireApi(page);
  await boot(page);
  await page.keyboard.press('b');
  await login(page);
  await expect(page.locator('#dlg-boards').getByText('Data nyata')).toBeVisible();
  await page.locator('#dlg-boards').getByRole('button', { name: 'Tutup' }).click();
  await page.keyboard.press('c');
  const dlg = page.locator('#dlg-agent');
  await expect(dlg.locator('.notify-settings summary')).toHaveText(/Notifikasi/);
  await dlg.locator('.notify-settings summary').click();
  await expect(dlg.locator('#push-help')).not.toBeEmpty();
  await dlg.locator('.agent-pick-btn[data-agent="infra"]').click();
  await expect(page.locator('#agent-title')).toContainText('Bruno');
  if (await dlg.locator('#agent-manual').isHidden()) await dlg.locator('#agent-manual-toggle').click();
  // Foto: unggah, chip muncul, kirim tanpa teks; agen menerima path lokal.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await dlg.locator('#agent-file').setInputFiles({ name: 'denah.png', mimeType: 'image/png', buffer: png });
  await expect(dlg.locator('.staged-item')).toContainText('denah.png');
  const before = calls.length;
  await dlg.locator('#agent-manual-text').fill('Ini denahnya');
  await dlg.locator('#agent-send').click();
  await expect.poll(() => calls.length).toBeGreaterThan(before);
  expect(calls.at(-1)!.message).toMatch(/\[Image attached at: \/.+\.png\]/);
  await expect(dlg.locator('.turn.owner .att-image img').last()).toBeVisible();
  await expect.poll(async () => dlg.locator('.turn.owner .att-image img').last().evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1);
  await expect(dlg.locator('.turn.agent').last()).toContainText('infra menerima', { timeout: 15_000 });
  // Pesan suara: berkas audio masuk lewat pemilih berkas (perekam nyata butuh mikrofon fisik).
  if (await dlg.locator('#agent-manual').isHidden()) await dlg.locator('#agent-manual-toggle').click();
  await dlg.locator('#agent-file').setInputFiles({ name: 'suara.webm', mimeType: 'audio/webm', buffer: Buffer.from('1a45dfa3', 'hex') });
  await expect(dlg.locator('.staged-item')).toContainText('pesan-suara');
  const b2 = calls.length;
  await dlg.locator('#agent-send').click();
  await expect.poll(() => calls.length).toBeGreaterThan(b2);
  expect(calls.at(-1)!.message).toContain('Transkrip otomatis: "tolong cek denah lantai satu"');
  await expect(dlg.locator('.turn.owner .att-voice audio').last()).toBeAttached();
  await expect(dlg.locator('.turn.owner .att-voice .transcript').last()).toContainText('tolong cek denah');
  // Cari pesan.
  await dlg.locator('.chat-search summary').click();
  await dlg.locator('#agent-search').fill('denahnya');
  await dlg.locator('.chat-search').getByRole('button', { name: 'Cari' }).click();
  await expect(dlg.locator('.search-results mark').first()).toHaveText(/denahnya/i);
  await shot(page, info, 'agent-media-search');
});

test('PWA: manifest, ikon dan service worker tersedia', async ({ page }) => {
  await boot(page);
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const m = await (await page.request.get(new URL(href!, page.url()).href)).json();
  expect(m.display).toBe('standalone');
  for (const i of m.icons) expect((await page.request.get(new URL(i.src, page.url()).href)).status()).toBe(200);
  const sw = await page.request.get(new URL('sw.js', page.url()).href);
  expect(sw.status()).toBe(200);
  expect(await sw.text()).toContain('showNotification');
});
