// Chat agen: tombol Suara dengan mikrofon palsu Chromium, gerbang persetujuan
// yang tidak lagi menahan pertanyaan biasa, dan perintah slash gaya Telegram.
// Backend privat asli jalan di proses tes dengan runner palsu (tanpa LLM).
// Uji opsional ujung-ke-ujung dengan mlx-whisper sungguhan:
//   KANTOR_STT_WAV=/path/ucapan.wav npx playwright test chat-voice-slash -g "whisper"
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { boot, shot } from './helpers';
import { createServer } from '../../../server/server.mjs';
import { whisperTranscriber } from '../../../server/media.mjs';
import { totp, hashPassword, base32Encode } from '../../../server/auth.mjs';

const SECRET: string = base32Encode(Buffer.from('kantor-rpg-voice-slash'));
const PROXY = 'e2e-proxy-voice-slash-0123456789';
const WAV = process.env.KANTOR_STT_WAV ?? '';
const realStt = !!WAV && fs.existsSync(WAV);
let server: { close: () => void; address: () => { port: number } };
let backend = '';
let tmp = '';
let clockOffset = 0;
const calls: { profile: string; message: string; hermesSession: string | null }[] = [];
let hold: Promise<void> | null = null;

test.use({
  // A fake capture device answers getUserMedia without a prompt; with KANTOR_STT_WAV it "speaks" that file.
  launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', ...(realStt ? [`--use-file-for-fake-audio-capture=${WAV}`] : [])] },
});

test.beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kantor-vs-'));
  const home = path.join(tmp, 'home');
  fs.mkdirSync(path.join(home, '.hermes', 'logs'), { recursive: true });
  fs.writeFileSync(path.join(home, '.hermes', '.env'), 'TELEGRAM_ALLOWED_USERS=777\n');
  const leo = path.join(home, '.hermes', 'profiles', 'leo');
  fs.mkdirSync(leo, { recursive: true });
  const ts = Date.now() / 1000;
  execFileSync('sqlite3', [path.join(leo, 'state.db'), `
    create table sessions(id text primary key, source text, session_key text, started_at real, ended_at real, model text);
    create table messages(id integer primary key autoincrement, session_id text, role text, content text, timestamp real, platform_message_id text, _compressed_summary int default 0);
    insert into sessions values('tg_leo','telegram','agent:leo:telegram:dm:777',${ts - 900},null,'model-uji');
    insert into messages(session_id,role,content,timestamp,platform_message_id) values ('tg_leo','user','Leo, poster sudah?',${ts - 600},'11'),('tg_leo','assistant','Sudah, cek folder poster.',${ts - 590},null);
  `]);
  const dataDir = path.join(tmp, 'data');
  fs.mkdirSync(dataDir, { mode: 0o700 });
  fs.writeFileSync(path.join(dataDir, 'owner.json'), JSON.stringify({ username: 'budi', passwordHash: hashPassword('sandi-e2e-panjang-1'), totpSecret: SECRET }), { mode: 0o600 });
  const runner = async (job: { profile: string; message: string; hermesSession: string | null }) => {
    calls.push(job);
    if (hold) await hold;
    await new Promise((r) => setTimeout(r, 300));
    return { ok: true, text: `Siap, ${job.profile}.\n\`\`\`json\n{"pilihan":[]}\n\`\`\``, session: job.hermesSession ?? 'hs_vs' };
  };
  ({ server } = createServer({
    dataDir, home, proxySecret: PROXY, allowedOrigin: `http://127.0.0.1:${process.env.KANTOR_PORT ?? '4173'}`, runner, cookieSecure: false, boardTtlMs: 0,
    now: () => Date.now() + clockOffset, pushFetch: async () => ({ ok: true, status: 201 }), telegram: { post: () => ({ ok: true }) },
    transcriber: realStt ? whisperTranscriber() : async () => 'halo dari mikrofon palsu',
  }));
  await new Promise<void>((r) => (server as unknown as { listen: (p: number, h: string, cb: () => void) => void }).listen(0, '127.0.0.1', r));
  backend = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function openChat(page: Page, profile: string) {
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    // The app aborts superseded polls (chat re-render, dialog close): the
    // browser side is gone then and fulfill throws "response disposed". That
    // is the app working as intended, not a test failure.
    try {
      const res = await route.fetch({ url: backend + url.pathname.replace(/^.*\/api\//, '/api/') + url.search, headers: { ...req.headers(), 'x-kantor-proxy': PROXY } });
      await route.fulfill({ response: res });
    } catch (e) {
      if (!/disposed|closed|aborted|Target page/i.test(String(e))) throw e;
    }
  });
  await boot(page);
  await page.keyboard.press('c');
  await page.getByLabel('Nama').fill('budi');
  await page.getByLabel('Sandi').fill('sandi-e2e-panjang-1');
  clockOffset += 31_000;
  await page.getByLabel('Kode 2FA (6 digit)').fill(totp(SECRET, Date.now() + clockOffset));
  await page.getByRole('button', { name: 'Masuk' }).click();
  const dlg = page.locator('#dlg-agent');
  await dlg.locator(`.agent-pick-btn[data-agent="${profile}"]`).click();
  await expect(dlg.locator('#agent-manual-toggle')).toBeVisible();
  if (await dlg.locator('#agent-manual').isHidden()) await dlg.locator('#agent-manual-toggle').click();
  await expect(dlg.locator('#agent-manual-text')).toBeVisible();
  return dlg;
}

test('Suara: label, durasi berjalan dan status tetap hidup walau chat dirender ulang, lalu transkrip muncul di chip', async ({ page }, info) => {
  // leo is Telegram-bound: the open chat polls and re-renders every few seconds while recording.
  const dlg = await openChat(page, 'leo');
  const mic = dlg.locator('#agent-mic');
  await expect(mic).toHaveText(/Suara/);
  await mic.click();
  await expect(dlg.locator('#agent-mic')).toHaveText(/Selesai rekam/);
  await expect(dlg.locator('#agent-mic')).toHaveAttribute('aria-pressed', 'true');
  await expect(dlg.locator('#agent-mic-status')).toContainText(/Merekam 0:0\d/);
  await page.waitForTimeout(realStt ? 4500 : 2600);
  // The duration kept counting (it is the proof the recorder runs), across re-renders.
  await expect(dlg.locator('#agent-mic-status')).toContainText(/Merekam 0:0[2-9]/);
  await shot(page, info, 'voice-recording');
  await dlg.locator('#agent-mic').click();
  await expect(dlg.locator('.staged-item')).toContainText('pesan-suara', { timeout: 15_000 });
  await expect(dlg.locator('#agent-mic')).toHaveText(/Suara/);
  await expect(dlg.locator('#agent-mic-status')).toHaveText('');
  const want = realStt ? /status server/i : /halo dari mikrofon palsu/;
  await expect(dlg.locator('.staged-item [data-transcript]')).toContainText(want, { timeout: realStt ? 300_000 : 20_000 });
  await shot(page, info, 'voice-transcript');
  const before = calls.length;
  await dlg.locator('#agent-send').click();
  await expect.poll(() => calls.length, { timeout: 20_000 }).toBeGreaterThan(before);
  expect(calls.at(-1)!.message).toMatch(/Transkrip otomatis: ".+"/);
  if (realStt) info.annotations.push({ type: 'transcript', description: /Transkrip otomatis: "([^"]*)"/.exec(calls.at(-1)!.message)![1] });
});

test('whisper: rekaman mikrofon palsu dari berkas suara jadi transkrip nyata (opsional, KANTOR_STT_WAV)', async ({ page }, info) => {
  test.skip(!realStt || info.project.name !== 'desktop', 'butuh KANTOR_STT_WAV; cukup sekali di desktop');
  test.setTimeout(400_000);
  const dlg = await openChat(page, 'infra');
  await dlg.locator('#agent-mic').click();
  await expect(dlg.locator('#agent-mic-status')).toContainText('Merekam');
  await page.waitForTimeout(4500);
  await dlg.locator('#agent-mic').click();
  await expect(dlg.locator('.staged-item [data-transcript]')).toContainText(/status server/i, { timeout: 300_000 });
  info.annotations.push({ type: 'transcript', description: (await dlg.locator('.staged-item [data-transcript]').textContent()) ?? '' });
});

test('Suara: izin mikrofon ditolak memberi pesan jelas yang terlihat di atas dialog', async ({ page }, info) => {
  const dlg = await openChat(page, 'infra');
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); });
  await dlg.locator('#agent-mic').click();
  const toast = page.locator('#toast');
  await expect(toast).toContainText('Izin mikrofon ditolak');
  // The modal dialog is in the top layer; the toast must be painted above it.
  // (Hit-testing cannot prove it: a modal makes everything outside it inert.)
  expect(await toast.evaluate((t) => t.matches(':popover-open'))).toBe(true);
  await page.locator('#toast').screenshot({ path: info.outputPath('toast-over-dialog.png') });
  await expect(dlg.locator('#agent-mic')).toHaveText(/Suara/);
  await expect(dlg.locator('#agent-mic')).toBeEnabled();
  await page.screenshot({ path: info.outputPath('voice-denied-full.png') });
  await shot(page, info, 'voice-denied');
  // No microphone at all.
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('none', 'NotFoundError')); });
  await dlg.locator('#agent-mic').click();
  await expect(toast).toContainText('Tidak ada mikrofon');
  // A prompt that never answers still gives feedback (status while waiting).
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => new Promise(() => {}); });
  await dlg.locator('#agent-mic').click();
  await expect(dlg.locator('#agent-mic-status')).toHaveText('Meminta izin mikrofon…');
  await expect(dlg.locator('#agent-mic')).toBeDisabled();
});

test('Suara: menutup chat saat merekam atau saat izin belum dijawab melepas mikrofon dan tidak mengunggah', async ({ page }) => {
  const dlg = await openChat(page, 'infra');
  await page.evaluate(() => {
    const w = window as unknown as { streams: MediaStream[] };
    w.streams = [];
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => { const st = await orig(c); w.streams.push(st); return st; };
  });
  let uploads = 0;
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/uploads')) uploads += 1; });
  await dlg.locator('#agent-mic').click();
  await expect(dlg.locator('#agent-mic-status')).toContainText('Merekam');
  await page.waitForTimeout(1200);
  await dlg.getByRole('button', { name: 'Tutup' }).click();
  await expect(dlg).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as unknown as { streams: MediaStream[] }).streams.every((st) => st.getTracks().every((x) => x.readyState === 'ended')))).toBe(true);
  // A permission that is granted only after the chat closed must not start recording.
  await page.keyboard.press('c');
  await dlg.locator('.agent-pick-btn[data-agent="infra"]').click();
  await expect(dlg.locator('#agent-manual-toggle')).toBeVisible();
  if (await dlg.locator('#agent-manual').isHidden()) await dlg.locator('#agent-manual-toggle').click();
  await expect(dlg.locator('#agent-mic')).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { streams: MediaStream[]; grant: () => void };
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => new Promise((ok) => { w.grant = () => void orig(c).then(ok); /* orig is the wrapper above: it records the stream */ });
  });
  await dlg.locator('#agent-mic').click();
  await expect(dlg.locator('#agent-mic-status')).toHaveText('Meminta izin mikrofon…');
  await dlg.getByRole('button', { name: 'Tutup' }).click();
  await page.evaluate(() => (window as unknown as { grant: () => void }).grant());
  await expect.poll(() => page.evaluate(() => { const l = (window as unknown as { streams: MediaStream[] }).streams; return l.length === 2 && l.every((st) => st.getTracks().every((x) => x.readyState === 'ended')); })).toBe(true);
  await page.waitForTimeout(1200);
  expect(uploads).toBe(0);
});

test('gerbang: "sudah di reset?" langsung ke agen; perintah hapus data tetap minta persetujuan', async ({ page }) => {
  const dlg = await openChat(page, 'enterprise');
  const ta = dlg.locator('#agent-manual-text');
  const n0 = calls.length;
  await ta.fill('sudah di reset?');
  await dlg.locator('#agent-send').click();
  await expect.poll(() => calls.length, { timeout: 15_000 }).toBe(n0 + 1);
  expect(calls.at(-1)!.message.startsWith('sudah di reset?')).toBe(true);
  await expect(dlg.getByText('Butuh persetujuanmu')).toHaveCount(0);
  await expect(dlg.locator('.turn.agent').last()).toContainText('Siap, enterprise', { timeout: 15_000 });
  if (await dlg.locator('#agent-manual').isHidden()) await dlg.locator('#agent-manual-toggle').click();
  await ta.fill('hapus data pelanggan lama di server');
  await dlg.locator('#agent-send').click();
  await expect(dlg.getByText('Butuh persetujuanmu')).toBeVisible();
  expect(calls.length).toBe(n0 + 1);
  await dlg.getByRole('button', { name: 'Tolak' }).click();
});

test('perintah slash: ketik / memunculkan menu, dipilih keyboard/klik, dijalankan server tanpa ke agen', async ({ page }, info) => {
  const dlg = await openChat(page, 'leo');
  const ta = dlg.locator('#agent-manual-text');
  const n0 = calls.length;
  await ta.fill('');
  await ta.pressSequentially('/');
  const menu = dlg.locator('#agent-slash');
  await expect(menu).toBeVisible();
  await expect(menu.locator('[role="option"]')).toHaveText([/\/new/, /\/stop/, /\/status/, /\/telegram/, /\/help/]);
  for (const b of await menu.locator('[role="option"]').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await shot(page, info, 'slash-menu');
  // Keyboard: filter, arrows, Enter.
  await ta.pressSequentially('st');
  await expect(menu.locator('[role="option"]')).toHaveText([/\/stop/, /\/status/]);
  await page.keyboard.press('ArrowDown');
  await expect(menu.locator('[aria-selected="true"]')).toHaveText(/\/status/);
  await page.keyboard.press('Enter');
  const note = dlg.locator('.command-note');
  await expect(note).toContainText('Sesi Hermes: tg_leo');
  await expect(note).toContainText('Model: model-uji');
  await expect(menu).toBeHidden();
  await expect(ta).toHaveValue('');
  // Esc closes the menu first, not the composer.
  await ta.pressSequentially('/');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(dlg.locator('#agent-manual')).toBeVisible();
  // Click /help.
  await ta.fill('');
  await ta.pressSequentially('/he');
  // Tab completes the name only; nothing runs until Enter or a click.
  await page.keyboard.press('Tab');
  await expect(ta).toHaveValue('/help');
  await expect(ta).toBeFocused();
  await expect(ta).toHaveAttribute('aria-activedescendant', 'slash-help');
  await expect(note).toContainText('Sesi Hermes');
  await menu.getByRole('option', { name: /\/help/ }).click();
  await expect(note).toContainText('Perintah yang bisa dipakai');
  // Unknown command typed in full and sent: help, not forwarded.
  await ta.fill('/compress');
  await dlg.locator('#agent-send').click();
  await expect(note).toContainText('/compress tidak dikenal');
  // /stop with a running task.
  let release!: () => void;
  hold = new Promise((r) => { release = r; });
  await ta.fill('buat 3 opsi poster');
  await dlg.locator('#agent-send').click();
  await expect.poll(() => calls.length, { timeout: 15_000 }).toBe(n0 + 1);
  // The runner starts before the send answers; typing /stop before that answer is
  // rendered lands in the old textarea, which the render then replaces (CI flake).
  await expect(dlg.locator('#agent-body .chat li', { hasText: 'buat 3 opsi poster' })).toBeVisible();
  if (await dlg.locator('#agent-manual').isHidden()) await dlg.locator('#agent-manual-toggle').click();
  await dlg.locator('#agent-manual-text').fill('/stop');
  await dlg.locator('#agent-send').click();
  await expect(dlg.locator('.command-note')).toContainText('1 tugas dihentikan');
  release(); hold = null;
  // /new on a Telegram-bound chat: RPG-only conversation, said plainly; /telegram goes back.
  await dlg.locator('#agent-manual-text').fill('/new');
  await dlg.locator('#agent-send').click();
  await expect(dlg.locator('.command-note')).toContainText('Sesi Telegram Leo tidak ikut diganti');
  await expect(dlg.locator('#agent-sync-note')).toContainText('khusus RPG yang kamu mulai dengan /new');
  await expect(dlg.getByText('Sama dengan chat Telegram')).toHaveCount(0);
  await shot(page, info, 'slash-new');
  await dlg.locator('#agent-manual-text').fill('/telegram');
  await dlg.locator('#agent-send').click();
  await expect(dlg.getByText('Sama dengan chat Telegram')).toBeVisible();
  await expect(dlg.locator('.turn.agent').filter({ hasText: 'cek folder poster' })).toHaveCount(1);
  expect(calls.length, 'tidak ada perintah yang sampai ke agen').toBe(n0 + 1);
});
