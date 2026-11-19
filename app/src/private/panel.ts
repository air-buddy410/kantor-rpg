// Panel privat (PRD 17 M5 + 18 M4): login owner, tiga papan kerja, dan
// percakapan dengan agen Hermes nyata (3 pilihan + Ketik manual).
// Tanpa login atau tanpa backend, papan memakai data demo berlabel `Demo`
// dan tombol kirim tidak ada: halaman publik tidak bisa memerintah agen.
import { $, el, openDialog, toast } from '../ui/dom';
import { DEMO_BOARDS } from './demo';
import { disablePush, enablePush, mutedBots, PUSH_HELP, pushState, setMutedBots, type PushState } from './push';
import { clock, dayLabel, ping, quoteFor, RECEIPT, sameDay, setTitleCount, statusLine, unlockAudio } from './chat-ui';
import { t, t as tr, locale } from '../i18n';
import { api, ApiError, type Boards, type Conversation, type Me, type Agent, type Presence, type HandoffItem, type TaskItem, type LogItem, type Turn, type Attachment, type CommandResult } from './api';

type Tab = 'handoffs' | 'tasks' | 'log';
const STATUS_LABEL: Record<string, string> = {
  queued: 'Antre', working: 'Dikerjakan', waiting_owner: 'Menunggu keputusanmu', blocked: 'Menunggu persetujuan', completed: 'Selesai',
  failed: 'Gagal', cancelled: 'Dibatalkan', unknown: 'Tidak diketahui',
};
const TASK_STATUS: Record<string, string> = { todo: 'Antre', ready: 'Antre', triage: 'Antre', scheduled: 'Terjadwal', running: 'Sedang jalan', claimed: 'Diambil', blocked: 'Diblokir', done: 'Selesai' };

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleString(locale(), { timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });

// Read position per agent, kept in this browser only (no server state, no content).
const READ_KEY = 'kantor-rpg:read:';
export function readMark(profile: string): number | null {
  try { const v = localStorage.getItem(READ_KEY + profile); return v ? Number(v) || null : null; } catch { return null; }
}
function setReadMark(profile: string, at: number) {
  try { localStorage.setItem(READ_KEY + profile, String(at)); } catch { /* private mode: unread state just isn't kept */ }
}
const fmtSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);
const fmtAge = (h: number) => (h < 1 ? t('{n} mnt', { n: Math.max(1, Math.round(h * 60)) }) : h < 48 ? t('{n} jam', { n: Math.round(h) }) : t('{n} hari', { n: Math.round(h / 24) }));
// Same list the server runs (server/commands.mjs); the server stays the authority.
const SLASH: { name: string; help: string }[] = [
  { name: 'new', help: 'Mulai percakapan baru' },
  { name: 'stop', help: 'Hentikan tugas yang sedang berjalan' },
  { name: 'status', help: 'Sesi, model, dan tugas berjalan' },
  { name: 'telegram', help: 'Kembali ke chat Telegram bot ini' },
  { name: 'help', help: 'Daftar perintah' },
];
type MicState = 'idle' | 'asking' | 'recording' | 'uploading';
const fmtDur = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** Plain-language reason for a failed getUserMedia, by DOMException name. */
export function micError(name: string | undefined, secure = true): string {
  if (!secure) return t('Mikrofon hanya bisa dipakai di halaman HTTPS. Buka situs ini lewat alamat https.');
  switch (name) {
    case 'NotAllowedError': case 'PermissionDeniedError': return t('Izin mikrofon ditolak. Klik ikon gembok di bilah alamat, izinkan Mikrofon untuk situs ini, lalu coba lagi.');
    case 'NotFoundError': case 'DevicesNotFoundError': case 'OverconstrainedError': return t('Tidak ada mikrofon yang terdeteksi. Sambungkan mikrofon atau periksa Pengaturan Sistem → Suara → Input.');
    case 'NotReadableError': case 'TrackStartError': case 'AbortError': return t('Mikrofon sedang dipakai aplikasi lain atau diblokir macOS. Tutup aplikasi itu, atau izinkan browser di Pengaturan Sistem → Privasi → Mikrofon.');
    case 'SecurityError': return t('Browser memblokir mikrofon di halaman ini (kebijakan keamanan).');
    case 'Timeout': return t('Browser belum menjawab permintaan izin mikrofon. Cek apakah ada jendela izin yang tertutup, lalu coba lagi.');
    default: return t('Mikrofon tidak bisa dibuka ({err}).', { err: name ?? t('galat') });
  }
}

const newIdem = () => `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export class PrivatePanel {
  me: Me | null = null;
  backend: 'ok' | 'none' = 'none';
  boards: Boards | null = null;
  agents: Agent[] = [];
  conv: Conversation | null = null;
  private tab: Tab = 'handoffs';
  private filters = { lane: '', badan: '', status: '' };
  private pollTimer = 0;
  private boardTimer = 0;
  private pendingIdem: string | null = null;
  /** What the pending key was made for: a different message (e.g. /stop after a failed send) gets its own key. */
  private pendingFor = '';
  private sending = false;
  private shownAgentTurn: string | null = null;
  private focusTask: string | null = null;
  private stale: string | null = null;

  private presenceTimer = 0;
  /** Receives real agent status while logged in; null = back to simulation. */
  onPresence: ((agents: Presence[] | null) => void) | null = null;
  onUnreadChange: (() => void) | null = null;
  private readMarkAtOpen: number | null = null;
  private presenceList: Presence[] = [];
  /** Uploaded but not yet sent with a message (this chat only). */
  private staged: Attachment[] = [];
  private recorder: (MediaRecorder & { discard?: boolean }) | null = null;
  private micState: MicState = 'idle';
  /** Bumped when the chat closes or switches: a late mic grant or upload from before is dropped. */
  private micGen = 0;
  private micCloseHooked = false;
  private recStarted = 0;
  private recTimer = 0;
  /** Result of the last slash command, shown as a local system note until the next send. */
  private commandNote: { text: string; at: number } | null = null;
  private slashIndex = 0;
  private searchTerm = '';
  /** The search box stays open across re-renders (agent replies, polling) once opened. */
  private searchOpen = false;

  /**
   * Agent replies Budi has not seen yet. The first time a profile shows up in
   * this browser its history counts as read (baseline), so a new device does
   * not start with every bot flagged; only later replies count.
   */
  unreadFor(profile: string): number {
    const times = this.presenceList.find((p) => p.profile === profile)?.replies ?? [];
    const mark = readMark(profile);
    if (mark === null) { if (times.length) setReadMark(profile, times[times.length - 1]); return 0; }
    return times.filter((t) => t > mark).length;
  }

  unreadTotal(): number { return this.presenceList.reduce((n, p) => n + this.unreadFor(p.profile), 0); }

  constructor(private onOpenChange?: (open: boolean) => void) {}

  /** Polls /api/presence every 10 s while logged in; stops and resets on logout. */
  async startPresence(): Promise<void> {
    window.clearTimeout(this.presenceTimer);
    if (!this.me) await this.refreshMe();
    if (!this.authenticated) { this.onPresence?.(null); return; }
    try {
      const agents = (await api.presence()).agents;
      const before = this.presenceList.length ? this.unreadTotal() : null;
      this.presenceList = agents;
      this.onPresence?.(agents);
      this.onUnreadChange?.();
      const after = this.unreadTotal();
      setTitleCount(after);
      if (before !== null && after > before) ping();
      this.refreshHeader();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { this.me = null; this.onPresence?.(null); return; }
    }
    this.presenceTimer = window.setTimeout(() => void this.startPresence(), document.hidden ? 30_000 : 10_000);
  }

  private loggedIn() { this.me = null; void this.startPresence(); void import('./push').then((m) => m.swRegistration()); }
  private loggedOut() { window.clearTimeout(this.presenceTimer); this.onPresence?.(null); }

  /** Shortcut (C / HUD): pick any agent and chat, no walking to the NPC. */
  async openPicker(opener?: HTMLElement | null) {
    this.cancelMic(); // back to the agent list: a running recording belongs to the chat being left
    await this.refreshMe();
    const dlg = $('dlg-agent') as HTMLDialogElement;
    // However the dialog was opened (login, picker, NPC), closing it releases the microphone.
    if (!this.micCloseHooked) { this.micCloseHooked = true; dlg.addEventListener('close', () => this.cancelMic()); }
    $('agent-title').textContent = t('Chat agen');
    const body = $('agent-body');
    body.replaceChildren();
    if (!this.authenticated) {
      body.append(el('p', {}, t('Chat dengan agen nyata hanya untuk owner yang login.')));
      body.append(this.loginForm(() => void this.openPicker(opener)));
      if (!dlg.open) openDialog(dlg, opener);
      return;
    }
    let presence: Presence[] = [];
    try {
      this.agents = (await api.agents()).agents;
      presence = (await api.presence()).agents;
      this.presenceList = presence;
    } catch (e) {
      body.append(el('p', { class: 'warn', role: 'alert' }, t('Daftar agen tidak dapat dibuka: {msg}', { msg: (e as Error).message })));
      if (!dlg.open) openDialog(dlg, opener);
      return;
    }
    const list = el('ul', { class: 'agent-pick', 'aria-label': t('Pilih agen') });
    for (const a of this.agents) {
      const p = presence.find((x) => x.profile === a.profile);
      const state = t(p?.typing ? 'mengetik…' : p?.status === 'working' ? 'Bekerja' : p?.status === 'waiting' ? 'Menunggu kamu' : p?.status === 'unknown' ? 'Tidak diketahui' : 'Siap');
      const btn = el('button', { type: 'button', class: 'btn agent-pick-btn', 'data-agent': a.profile });
      btn.append(el('span', { class: 'agent-pick-name' }, a.name), el('span', { class: 'muted small' }, p?.typing ? t('sedang mengetik…') : statusLine(false, p?.lastSeen) || a.lane),
        el('span', { class: `tag ${p?.status === 'working' ? 'live' : p?.status === 'waiting' ? 'warn' : 'demo'}` }, state));
      const unread = this.unreadFor(a.profile);
      if (unread) btn.append(el('span', { class: 'unread-badge', 'aria-label': t('{n} pesan belum dibaca', { n: unread }) }, unread > 9 ? '9+' : String(unread)));
      if (p?.summary) btn.title = p.summary;
      btn.addEventListener('click', () => void this.openAgent(a.profile, opener));
      const li = el('li'); li.append(btn); list.append(li);
    }
    body.append(el('p', { class: 'muted small' }, t('Pilih agen untuk chat atau memberi tugas. Tombol C membuka daftar ini dari mana saja.')), list);
    // Settings fill in afterwards: a slow push service must not hold up the agent list.
    const slot = el('div', { id: 'notify-slot' });
    body.append(slot);
    void this.notifySettings().then((n) => slot.replaceChildren(n));
    if (!dlg.open) {
      openDialog(dlg, opener);
      this.onOpenChange?.(true);
      dlg.addEventListener('close', () => { window.clearTimeout(this.pollTimer); this.onOpenChange?.(false); }, { once: true });
    }
    (list.querySelector('button') as HTMLButtonElement | null)?.focus();
  }

  get authenticated() { return !!this.me?.authenticated; }

  async refreshMe(): Promise<void> {
    try { this.me = await api.me(); this.backend = 'ok'; } catch (e) {
      // A dropped connection does not log the owner out; the next call decides.
      if (this.me?.authenticated && !(e instanceof ApiError && e.status >= 400)) return;
      this.me = null; this.backend = 'none';
    }
  }

  /** Opens the board dialog on a given tab (used by the in-world boards). */
  async openBoards(tab: Tab = this.tab, opener?: HTMLElement | null) {
    this.tab = tab;
    await this.refreshMe();
    await this.loadBoards();
    this.renderBoards();
    const dlg = $('dlg-boards') as HTMLDialogElement;
    window.clearInterval(this.boardTimer);
    this.boardTimer = window.setInterval(() => { if (dlg.open) void this.loadBoards().then(() => this.renderBoards(true)); else window.clearInterval(this.boardTimer); }, 10_000);
    openDialog(dlg, opener);
  }

  private async loadBoards() {
    if (!this.authenticated) { this.boards = DEMO_BOARDS(Date.now()); return; }
    try { this.boards = await api.boards(); this.stale = null; } catch (e) {
      if (e instanceof ApiError && e.status === 401) { this.me = null; this.boards = DEMO_BOARDS(Date.now()); return; }
      const msg = (e as Error).message;
      // Keep the last good snapshot but say it is stale (REQ-BOARD-05).
      if (this.boards?.mode === 'private' && this.boards.handoffs.ok) { this.stale = msg; return; }
      const fail = { ok: false, source: 'backend', error: msg, items: [] as never[] };
      this.boards = { observedAt: new Date().toISOString(), mode: 'private', handoffs: fail, tasks: fail, log: fail };
    }
  }

  private renderBoards(keepFocus = false) {
    const b = this.boards!;
    const demo = b.mode === 'demo';
    const body = $('boards-body');
    const active = keepFocus ? document.activeElement?.id : null;
    // The 10 s auto refresh must not rebuild the login form: that would wipe
    // what the owner is typing. Keep the same node (values, listeners) instead.
    const keptLogin = keepFocus ? body.querySelector<HTMLElement>(':scope > section.login') : null;
    const caret = active && document.activeElement instanceof HTMLInputElement ? document.activeElement.selectionStart : null;
    body.replaceChildren();
    const head = el('div', { class: 'board-head' });
    head.append(el('span', { class: demo ? 'tag demo' : 'tag live' }, demo ? t('Demo') : t('Data nyata')));
    head.append(el('span', { class: 'muted small' }, demo
      ? t('Data simulasi. Login owner untuk melihat papan tim yang sebenarnya.')
      : t('Diamati {time} WITA. Baca-saja; ubah tugas tetap lewat bot.', { time: fmtTime(Date.parse(b.observedAt)) })));
    if (!demo) {
      const out = el('button', { type: 'button', class: 'btn link', id: 'btn-logout' }, t('Keluar'));
      out.addEventListener('click', async () => { try { await api.logout(); } catch { /* session already gone */ } this.me = null; this.loggedOut(); toast(t('Sudah keluar.')); void this.openBoards(this.tab); });
      head.append(out);
    }
    body.append(head);
    if (this.stale && !demo) body.append(el('p', { class: 'warn', role: 'status' }, t('Basi: pembaruan gagal ({err}). Data di bawah dari {time} WITA.', { err: this.stale, time: fmtTime(Date.parse(b.observedAt)) })));
    const tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': t('Papan kerja') });
    const names: [Tab, string][] = [['handoffs', 'Papan Handoff'], ['tasks', 'Daftar Pekerjaan'], ['log', 'Log Aktivitas']];
    for (const [id, label] of names) {
      const tabBtn = el('button', { type: 'button', role: 'tab', class: 'tab', id: `tab-${id}`, 'aria-selected': String(this.tab === id), 'aria-controls': 'board-panel' }, t(label));
      tabBtn.addEventListener('click', () => { this.tab = id; this.renderBoards(); $(`tab-${id}`).focus(); });
      tabBtn.addEventListener('keydown', (e) => {
        const i = names.findIndex(([n]) => n === this.tab);
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          this.tab = names[(i + (e.key === 'ArrowRight' ? 1 : names.length - 1)) % names.length][0];
          this.renderBoards(); $(`tab-${this.tab}`).focus();
        }
      });
      tabs.append(tabBtn);
    }
    body.append(tabs);
    const panel = el('div', { role: 'tabpanel', id: 'board-panel', 'aria-labelledby': `tab-${this.tab}`, class: 'board-panel' });
    body.append(panel);
    const board = b[this.tab];
    if (!board.ok) {
      panel.append(el('p', { class: 'warn', role: 'status' }, t('Tidak diketahui: sumber {source} tidak terbaca ({err}). Terakhir diamati {time}.', { source: board.source, err: board.error ?? t('galat'), time: fmtTime(Date.parse(b.observedAt)) })));
    } else if (this.tab === 'handoffs') this.renderHandoffs(panel, board.items as HandoffItem[], demo);
    else if (this.tab === 'tasks') this.renderTasks(panel, board.items as TaskItem[], demo);
    else this.renderLog(panel, board.items as LogItem[], demo);
    if (!this.authenticated) body.append(keptLogin ?? this.loginForm(() => void this.openBoards(this.tab)));
    const back = active ? document.getElementById(active) : null;
    if (back) {
      back.focus({ preventScroll: true });
      if (back instanceof HTMLInputElement && caret !== null && back.type !== 'password') back.setSelectionRange(caret, caret);
    }
  }

  private renderHandoffs(panel: HTMLElement, items: HandoffItem[], demo = false) {
    // Demo text is ours and gets translated; real board text is user content and is shown as is.
    const dt = (s: string) => (demo ? t(s) : s);
    const attention = items.filter((h) => h.attention).length;
    panel.append(el('p', { class: 'muted small' }, t('{n} handoff, {attention} perlu perhatian (diblokir atau >24 jam belum diterima).', { n: items.length, attention })));
    const order = ['Diblokir', 'Dikirim', 'Diterima', 'Dikerjakan', 'Selesai', 'Dibatalkan', 'Belum tercatat'];
    const list = el('ul', { class: 'cards' });
    for (const h of [...items].sort((a, b) => Number(b.attention) - Number(a.attention) || order.indexOf(a.status) - order.indexOf(b.status) || b.createdAt - a.createdAt)) {
      const li = el('li', { class: `card${h.attention ? ' attention' : ''}` });
      const top = el('div', { class: 'card-top' });
      top.append(el('strong', {}, `${h.from} → ${h.to}`), el('span', { class: `tag st-${h.status.toLowerCase().replace(/\s/g, '-')}` }, t(h.status)));
      if (h.attention) top.append(el('span', { class: 'tag warn' }, t('Perlu perhatian')));
      li.append(top, el('p', {}, dt(h.summary)));
      if (h.chain && h.chain.length > 2) {
        const ch = el('p', { class: 'chain', 'aria-label': t('Rantai kerja: {chain}', { chain: h.chain.join(t(', lalu ')) }) });
        h.chain.forEach((n, i) => {
          if (i) ch.append(el('span', { 'aria-hidden': 'true' }, ' → '));
          ch.append(el('span', { class: i === h.chainActive ? 'step active' : 'step' }, n));
        });
        li.append(ch);
      }
      if (h.diminta) li.append(el('p', { class: 'muted small' }, t('Yang diminta: {text}', { text: dt(h.diminta) })));
      li.append(el('p', { class: 'meta' }, `${dt(h.project)} · ${t(h.badan)} · ${t('umur {age}', { age: fmtAge(h.ageHours) })}${h.hasFile ? '' : ` · ${t('berkas belum tercatat')}`}`));
      list.append(li);
    }
    if (!items.length) panel.append(el('p', {}, t('Tidak ada handoff dalam 7 hari terakhir.')));
    panel.append(list);
  }

  private renderTasks(panel: HTMLElement, items: TaskItem[], demo = false) {
    const dt = (s: string) => (demo ? t(s) : s);
    const lanes = [...new Set(items.map((t) => t.owner))].sort();
    const statuses = [...new Set(items.map((t) => t.status))];
    const badans = [...new Set(items.map((t) => t.badan ?? 'Belum tercatat'))].sort();
    const bar = el('div', { class: 'filters' });
    const sel = (key: 'lane' | 'status' | 'badan', label: string, values: string[], text: (v: string) => string) => {
      const id = `filter-${key}`;
      const s = el('select', { id });
      s.append(el('option', { value: '' }, t('Semua')));
      for (const v of values) { const o = el('option', { value: v }, text(v)); if (this.filters[key] === v) o.selected = true; s.append(o); }
      s.addEventListener('change', () => { this.filters[key] = s.value; this.renderBoards(); $(id).focus(); });
      const l = el('label', { for: id }, t(label));
      bar.append(l, s);
    };
    sel('lane', 'Bot', lanes, (v) => v);
    sel('badan', 'Badan', badans, (v) => t(v));
    sel('status', 'Status', statuses, (v) => (TASK_STATUS[v] ? t(TASK_STATUS[v]) : v));
    panel.append(bar);
    const shown = items.filter((t) => (!this.filters.lane || t.owner === this.filters.lane) && (!this.filters.status || t.status === this.filters.status) && (!this.filters.badan || (t.badan ?? 'Belum tercatat') === this.filters.badan));
    panel.append(el('p', { class: 'muted small', role: 'status', id: 'task-count' }, t('{shown} dari {total} tugas.', { shown: shown.length, total: items.length })));
    const table = el('table', { class: 'board-table' });
    const thead = el('thead'); const hr = el('tr');
    for (const h of ['Tugas', 'Bot', 'Peminta', 'Status', 'Umur']) hr.append(el('th', { scope: 'col' }, t(h)));
    thead.append(hr); table.append(thead);
    const tb = el('tbody');
    for (const task of shown) {
      const tr = el('tr', { 'data-task': task.id, id: `row-${task.id}`, class: this.focusTask === task.id ? 'focus-row' : '' });
      tr.append(el('td', {}, dt(task.title)), el('td', {}, task.owner), el('td', {}, task.requester), el('td', {}, TASK_STATUS[task.status] ? t(TASK_STATUS[task.status]) : task.status), el('td', {}, fmtAge(task.ageHours)));
      tb.append(tr);
    }
    table.append(tb);
    panel.append(el('div', { class: 'table-wrap' }));
    (panel.lastChild as HTMLElement).append(table);
  }

  private renderLog(panel: HTMLElement, items: LogItem[], demo = false) {
    // Verbs and the fixed objects ('gagal', 'Tugas pribadi') are a closed server vocabulary; task titles are user content.
    const obj = (s: string) => (demo || s === 'gagal' || s === 'Tugas pribadi' ? t(s) : s);
    panel.append(el('p', { class: 'muted small' }, t('{n} peristiwa dalam 24 jam terakhir (maks. 50 tugas + 110 aksi alat). Isi perintah dan obrolan tidak ditampilkan.', { n: items.length })));
    const ol = el('ol', { class: 'log' });
    for (const r of items) {
      const li = el('li', { class: r.kind === 'task' ? 'log-task' : 'log-tool' });
      li.append(el('time', { datetime: new Date(r.at).toISOString() }, fmtTime(r.at)), el('strong', {}, r.bot));
      const text = `${t(r.verb)}${r.object ? `: ${obj(r.object)}` : ''}`;
      if (r.taskId) {
        const go = el('button', { type: 'button', class: 'btn link log-link' }, text);
        go.addEventListener('click', () => {
          this.tab = 'tasks'; this.filters = { lane: '', badan: '', status: '' }; this.focusTask = r.taskId;
          this.renderBoards();
          const row = document.getElementById(`row-${r.taskId}`);
          row?.scrollIntoView?.({ block: 'center' });
          $('tab-tasks').focus();
        });
        li.append(go);
      } else li.append(el('span', {}, text));
      ol.append(li);
    }
    panel.append(ol);
  }

  private loginForm(after: () => void): HTMLElement {
    const wrap = el('section', { class: 'login', 'aria-labelledby': 'login-title' });
    wrap.append(el('h3', { id: 'login-title' }, t('Login owner')));
    if (this.backend === 'none') {
      wrap.append(el('p', { class: 'muted small' }, t('Backend privat tidak terjangkau dari halaman ini. Papan dan perintah agen hanya tersedia di employee-rpg.air-buddy.site.')));
      return wrap;
    }
    if (!this.me?.configured) {
      wrap.append(el('p', { class: 'muted small' }, t('Akun owner belum dibuat. Buka tautan setup sekali pakai yang dikirim Max ke Telegram.')));
      return wrap;
    }
    const form = el('form', { class: 'settings', autocomplete: 'on' });
    const field = (id: string, label: string, attrs: Record<string, string>) => {
      form.append(el('label', { for: id }, t(label)));
      form.append(el('input', { id, ...attrs }));
    };
    field('login-user', 'Nama', { name: 'username', autocomplete: 'username', required: '' });
    field('login-pass', 'Sandi', { name: 'password', type: 'password', autocomplete: 'current-password', required: '' });
    field('login-code', 'Kode 2FA (6 digit)', { name: 'code', inputmode: 'numeric', pattern: '[0-9]{6}', autocomplete: 'one-time-code', required: '' });
    const err = el('p', { class: 'warn', role: 'alert' });
    err.hidden = true;
    const btn = el('button', { type: 'submit', class: 'btn primary' }, t('Masuk'));
    form.append(err, btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      const fd = new FormData(form);
      try {
        await api.login(String(fd.get('username')), String(fd.get('password')), String(fd.get('code')));
        this.loggedIn();
        await this.refreshMe();
        toast(t('Login owner berhasil.'));
        after();
      } catch (x) { err.textContent = (x as Error).message; err.hidden = false; btn.disabled = false; }
    });
    wrap.append(form);
    return wrap;
  }

  // ---- percakapan agen -------------------------------------------------

  async openAgent(profile: string, opener?: HTMLElement | null) {
    await this.refreshMe();
    const dlg = $('dlg-agent') as HTMLDialogElement;
    if (!this.micCloseHooked) { this.micCloseHooked = true; dlg.addEventListener('close', () => this.cancelMic()); }
    $('agent-title').textContent = t('Bicara & beri tugas');
    const body = $('agent-body');
    body.replaceChildren();
    if (!this.authenticated) {
      body.append(el('p', {}, t('Memberi tugas ke agen nyata hanya untuk owner yang login. Pengunjung tidak dapat mengirim apa pun ke agen.')));
      body.append(this.loginForm(() => void this.openAgent(profile, opener)));
      if (!dlg.open) openDialog(dlg, opener);
      return;
    }
    try {
      this.agents = (await api.agents()).agents;
      const next = await api.conversation(profile);
      if (next.id !== this.conv?.id) { this.cancelMic(); this.staged = []; this.searchTerm = ''; this.commandNote = null; }
      this.conv = next;
    } catch (e) {
      body.append(el('p', { class: 'warn', role: 'alert' }, t('Agen tidak dapat dibuka: {msg}', { msg: (e as Error).message })));
      if (!dlg.open) openDialog(dlg, opener);
      return;
    }
    this.renderConversation(false, true);
    if (!dlg.open) {
      openDialog(dlg, opener);
      this.onOpenChange?.(true);
      // Closing the chat must release the microphone; the clip is dropped, not sent.
      dlg.addEventListener('close', () => { window.clearTimeout(this.pollTimer); this.onOpenChange?.(false); }, { once: true });
    }
    this.schedulePoll();
  }

  private schedulePoll() {
    window.clearTimeout(this.pollTimer);
    const busy = this.conv?.tasks.some((t) => !t.terminal || t.status === 'blocked');
    // A Telegram-bound chat keeps refreshing while open: Budi may type in Telegram.
    const live = this.conv?.channel === 'telegram';
    if (!busy && !live) return;
    this.pollTimer = window.setTimeout(async () => {
      if (!($('dlg-agent') as HTMLDialogElement).open || !this.conv) return;
      try {
        const asked = this.conv.id;
        const next = await api.conversationById(asked);
        // /new or /telegram switched chats while this request was in flight: drop the stale answer.
        if (this.conv?.id !== asked) return;
        const sig = (c: Conversation) => JSON.stringify([c.turns.map((t) => [t.id, t.pending, !!t.options]), c.tasks.map((t) => t.status), c.cursor]);
        const changed = sig(next) !== sig(this.conv) || next.typing !== this.conv.typing;
        const lastAgent = (c: Conversation) => [...c.turns].reverse().find((t) => t.role === 'agent')?.id;
        if (lastAgent(next) && lastAgent(next) !== lastAgent(this.conv)) ping();
        this.conv = next;
        if (changed) this.renderConversation(true);
      } catch { /* keep last view; next tick retries */ }
      this.schedulePoll();
    }, busy || this.conv?.typing ? 2000 : 5000);
  }

  private renderConversation(keepInput = false, opening = false) {
    const c = this.conv!;
    const prevLog = document.querySelector<HTMLElement>('#agent-body .chat');
    const prevScroll = prevLog ? { top: prevLog.scrollTop, atBottom: prevLog.scrollHeight - prevLog.scrollTop - prevLog.clientHeight < 40 } : null;
    const draft = keepInput ? ($('agent-manual-text') as HTMLTextAreaElement | null)?.value : undefined;
    const lastAgentId = [...c.turns].reverse().find((t) => t.role === 'agent')?.id ?? null;
    // A new agent turn with choices starts with the choices, not the manual box.
    const manualOpen = keepInput && lastAgentId === this.shownAgentTurn && !!document.getElementById('agent-manual-text') && !$('agent-manual').hidden;
    this.shownAgentTurn = lastAgentId;
    const hadFocus = document.activeElement?.id;
    $('agent-title').textContent = `${c.agent} · ${t('bicara & beri tugas')}`;
    const body = $('agent-body');
    body.replaceChildren();
    body.append(el('p', { class: `chat-status${c.typing ? ' typing' : ''}`, id: 'agent-status', role: 'status', 'aria-live': 'polite' }, statusLine(c.typing, c.lastSeen)));
    const info = el('dl', { class: 'info-grid' });
    const mode = t(c.channel === 'telegram' ? 'Sama dengan chat Telegram' : c.channel === 'telegram-unavailable' ? 'Telegram tidak terbaca' : 'Khusus RPG');
    for (const [k, v] of [['Profil', c.profile], ['Lane', c.lane ?? '-'], ['Percakapan', mode]]) info.append(el('dt', {}, t(k)), el('dd', {}, v));
    body.append(info);
    if (c.channel === 'telegram') body.append(el('p', { class: 'muted small', id: 'agent-sync-note' }, t('Ini percakapan Telegram-mu dengan {agent}. Pesan dari sini masuk ke sesi yang sama, dan balasannya juga dikirim bot ke Telegram. Jangan ketik sandi, OTP, atau token.', { agent: c.agent ?? '' })));
    else if (c.detached) body.append(el('p', { class: 'muted small', id: 'agent-sync-note' }, t('Percakapan khusus RPG yang kamu mulai dengan /new. Sesi Telegram {agent} tidak berubah; ketik /telegram untuk kembali ke sana.', { agent: c.agent ?? '' })));
    else if (c.channel === 'telegram-unavailable') body.append(el('p', { class: 'warn', role: 'status' }, t('Riwayat Telegram bot ini tidak bisa dibaca sekarang. Pesan yang kamu kirim tetap masuk ke sesi Telegram-nya bila sesinya ada.')));
    else body.append(el('p', { class: 'muted small' }, t('Bot ini belum punya chat Telegram denganmu, jadi percakapan ini khusus RPG. Jangan ketik sandi, OTP, atau token di sini.')));
    body.append(this.searchBox());
    const log = el('ol', { class: 'chat', 'aria-live': 'polite', 'aria-label': t('Percakapan dengan {agent}', { agent: c.agent ?? '' }) });
    // Unread = agent/system messages newer than what Budi last saw (per profile, this browser).
    if (opening) this.readMarkAtOpen = readMark(c.profile);
    const mark = this.readMarkAtOpen;
    let divider: HTMLElement | null = null;
    let prevAt: number | null = null;
    for (const t of c.turns) {
      if (prevAt === null || !sameDay(prevAt, t.at)) log.append(el('li', { class: 'day-divider', role: 'separator' }, dayLabel(t.at)));
      prevAt = t.at;
      if (!divider && mark !== null && t.role !== 'owner' && t.at > mark) {
        divider = el('li', { class: 'unread-divider', role: 'separator' }, tr('Belum dibaca'));
        log.append(divider);
      }
      log.append(this.turnView(t));
    }
    if (c.typing) {
      const bubble = el('li', { class: 'turn agent typing-bubble', 'aria-label': t('{agent} sedang mengetik', { agent: c.agent ?? '' }) });
      bubble.append(el('span', { class: 'dots', 'aria-hidden': 'true' }, '•••'));
      log.append(bubble);
    }
    if (!c.turns.length) log.append(el('li', { class: 'muted' }, t('Belum ada pesan. Tulis tugas pertama untuk {agent}.', { agent: c.agent ?? '' })));
    if (this.commandNote) {
      const note = el('li', { class: 'turn system command-note', 'data-turn': 'command-note' });
      note.append(el('span', { class: 'who' }, t('Sistem')));
      const p = el('div', { class: 'text' }); p.textContent = this.commandNote.text; note.append(p);
      note.append(el('span', { class: 'meta' }, clock(this.commandNote.at)));
      log.append(note);
    }
    body.append(log);
    for (const t of c.tasks.filter((x) => !x.terminal || x.status === 'blocked' || x.status === 'waiting_owner')) {
      const last = [...c.events].reverse().find((e) => e.task_id === t.id);
      const row = el('div', { class: 'task-status', role: 'status', 'data-task': t.id, 'data-status': t.status });
      row.append(el('span', { class: `tag st-${t.status}` }, STATUS_LABEL[t.status] ? tr(STATUS_LABEL[t.status]) : t.status), el('span', { class: 'muted small' }, `${last?.note ?? ''} ${tr('Sumber {source}, {time}.', { source: t.source, time: fmtTime(t.observed_at) })}`));
      const appr = c.approvals.find((a) => a.task_id === t.id && a.status === 'pending');
      if (appr && t.status === 'blocked') row.append(this.approvalView(appr.id, t.id, appr.action, appr.impact, appr.rollback, appr.expires_at));
      if (t.status === 'queued' || t.status === 'working' || t.status === 'blocked') {
        const stop = el('button', { type: 'button', class: 'btn' }, tr(t.status === 'working' ? 'Hentikan' : 'Batalkan'));
        stop.addEventListener('click', async () => {
          try { await api.cancel(t.id); this.conv = await api.conversationById(c.id); this.renderConversation(); } catch (e) { toast((e as Error).message, 4000); }
        });
        row.append(stop);
      }
      body.append(row);
    }
    for (const t of c.tasks.filter((x) => x.status === 'failed' || x.status === 'unknown').slice(-1)) {
      if (c.tasks.at(-1)?.id === t.id) body.append(el('p', { class: 'warn', role: 'alert' }, tr('{status}: {err}. Tidak dicoba ulang otomatis.', { status: tr(STATUS_LABEL[t.status]), err: t.error ?? tr('tanpa keterangan') })));
    }
    const lastAgent = [...c.turns].reverse().find((t) => t.role === 'agent');
    const choices = el('div', { class: 'choices', role: 'group', 'aria-label': tr('Pilihan balasan') });
    if (lastAgent?.options) {
      lastAgent.options.forEach((o, i) => {
        const b = el('button', { type: 'button', class: `btn choice${i === 0 ? ' recommended' : ''}`, 'data-option': o.id }, `${i + 1}. ${o.label}${o.requiresApproval ? ` (${tr('perlu persetujuan')})` : ''}`);
        b.title = o.message;
        b.addEventListener('click', () => void this.send({ decision: { turnId: lastAgent.id, optionId: o.id } }, b));
        choices.append(b);
      });
    }
    const manualBtn = el('button', { type: 'button', class: 'btn choice', id: 'agent-manual-toggle', 'aria-expanded': 'false', 'aria-controls': 'agent-manual' }, lastAgent?.options ? `4. ${tr('Ketik manual')}` : tr('Ketik pesan'));
    choices.append(manualBtn);
    body.append(choices);
    const manual = el('form', { id: 'agent-manual', class: 'manual' });
    manual.hidden = !(manualOpen || !lastAgent?.options);
    const ta = el('textarea', { id: 'agent-manual-text', rows: '3', maxlength: '4000', 'aria-label': tr('Pesan untuk {agent}', { agent: c.agent ?? '' }), 'aria-describedby': 'agent-slash-hint', placeholder: tr('Tulis pesan, atau ketik / untuk perintah') });
    if (draft) ta.value = draft;
    const slash = el('div', { class: 'slash-menu', id: 'agent-slash', role: 'listbox', 'aria-label': tr('Perintah') });
    ta.setAttribute('aria-controls', 'agent-slash');
    ta.setAttribute('aria-autocomplete', 'list');
    const slashHint = el('span', { class: 'visually-hidden', id: 'agent-slash-hint', 'aria-live': 'polite' });
    const slashMatches = () => {
      const m = /^\/([a-z]*)$/i.exec(ta.value.trim());
      return m ? SLASH.filter((x) => x.name.startsWith(m[1].toLowerCase())) : [];
    };
    const drawSlash = () => {
      const list = slashMatches();
      slash.replaceChildren();
      slash.hidden = !list.length;
      ta.setAttribute('aria-expanded', String(!!list.length));
      if (!list.length) { slashHint.textContent = ''; ta.removeAttribute('aria-activedescendant'); return; }
      this.slashIndex = Math.min(this.slashIndex, list.length - 1);
      list.forEach((x, i) => {
        const b = el('button', { type: 'button', role: 'option', class: `slash-item${i === this.slashIndex ? ' active' : ''}`, id: `slash-${x.name}`, 'aria-selected': String(i === this.slashIndex), 'data-command': x.name });
        b.append(el('strong', {}, `/${x.name}`), el('span', { class: 'muted small' }, tr(x.help)));
        b.addEventListener('click', () => void this.runSlash(x.name, sendBtn));
        slash.append(b);
      });
      const cur = list[this.slashIndex];
      ta.setAttribute('aria-activedescendant', `slash-${cur.name}`);
      slashHint.textContent = `${tr('{n} perintah. Panah atas/bawah untuk memilih, Enter untuk menjalankan.', { n: list.length })} /${cur.name}: ${tr(cur.help)}`;
    };
    ta.addEventListener('input', () => { this.slashIndex = 0; drawSlash(); });
    ta.addEventListener('keydown', (e) => {
      const list = slash.hidden ? [] : slashMatches();
      if (list.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        this.slashIndex = (this.slashIndex + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length;
        drawSlash();
        return;
      }
      // Tab only completes the name (Telegram does the same); Enter runs it.
      if (list.length && e.key === 'Tab' && !e.shiftKey && ta.value.trim() !== `/${list[this.slashIndex].name}`) {
        e.preventDefault();
        ta.value = `/${list[this.slashIndex].name}`;
        drawSlash();
        return;
      }
      if (list.length && e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.runSlash(list[this.slashIndex].name, sendBtn);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        if (list.length) { slash.hidden = true; return; } // first Esc closes only the menu
        manual.hidden = true; manualBtn.setAttribute('aria-expanded', 'false'); manualBtn.focus();
      }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); manual.requestSubmit(); }
    });
    const sendBtn = el('button', { type: 'submit', class: 'btn primary', id: 'agent-send' }, tr('Kirim'));
    const chips = el('ul', { class: 'staged', id: 'agent-staged', 'aria-label': tr('Lampiran siap dikirim') });
    this.renderStaged(chips);
    const file = el('input', { type: 'file', id: 'agent-file', multiple: '', class: 'visually-hidden', accept: 'image/*,application/pdf,.docx,.xlsx,.txt,.csv,.zip,audio/*' });
    file.addEventListener('change', () => { void this.attachFiles([...(file.files ?? [])], chips); file.value = ''; });
    const attach = el('button', { type: 'button', class: 'btn', id: 'agent-attach', 'aria-label': tr('Lampirkan foto atau berkas') }, `📎 ${tr('Lampiran')}`);
    attach.addEventListener('click', () => file.click());
    const mic = el('button', { type: 'button', class: 'btn', id: 'agent-mic' });
    const micStatus = el('span', { class: 'mic-status small', id: 'agent-mic-status', role: 'status', 'aria-live': 'polite' });
    mic.addEventListener('click', () => void this.toggleRecord(chips));
    ta.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) { e.preventDefault(); void this.attachFiles(files, chips); }
    });
    manual.addEventListener('dragover', (e) => { e.preventDefault(); manual.classList.add('drop'); });
    manual.addEventListener('dragleave', () => manual.classList.remove('drop'));
    manual.addEventListener('drop', (e) => { e.preventDefault(); manual.classList.remove('drop'); void this.attachFiles([...(e.dataTransfer?.files ?? [])], chips); });
    const tools = el('div', { class: 'row composer-tools' });
    tools.append(attach, mic, micStatus, file);
    manual.append(chips, ta, slash, slashHint, tools, el('div', { class: 'row' }));
    (manual.lastChild as HTMLElement).append(el('span', { class: 'muted small' }, tr('Ctrl/⌘+Enter untuk kirim. Esc menutup tanpa mengirim. Foto bisa ditempel atau diseret ke sini.')), sendBtn);
    manual.addEventListener('submit', (e) => { e.preventDefault(); void this.send({ text: ta.value }, sendBtn); });
    drawSlash();
    manualBtn.setAttribute('aria-expanded', String(!manual.hidden));
    manualBtn.addEventListener('click', () => { manual.hidden = !manual.hidden; manualBtn.setAttribute('aria-expanded', String(!manual.hidden)); if (!manual.hidden) ta.focus(); });
    body.append(manual);
    // Same as typing /new, so the button and the command never disagree.
    const fresh = el('button', { type: 'button', class: 'btn link', id: 'agent-new' }, tr('Mulai percakapan baru'));
    fresh.addEventListener('click', () => void this.runSlash('new', fresh));
    body.append(fresh);
    log.addEventListener('scroll', () => { if (log.scrollHeight - log.scrollTop - log.clientHeight < 40) this.markRead(); }, { passive: true });
    // Open at the first unread message, else at the latest one; on refresh keep
    // the reader's place unless they were already at the bottom.
    requestAnimationFrame(() => {
      const smooth = !opening && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (opening && divider) log.scrollTop = Math.max(0, divider.offsetTop - log.offsetTop - 8);
      else if (opening || !prevScroll || prevScroll.atBottom) log.scrollTo({ top: log.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
      else log.scrollTop = prevScroll.top;
      if (log.scrollHeight - log.scrollTop - log.clientHeight < 40) this.markRead();
    });
    if (hadFocus && document.getElementById(hadFocus)) document.getElementById(hadFocus)!.focus({ preventScroll: true });
    this.paintMic();
  }

  /** Everything up to the newest agent/system message counts as read. */
  private markRead() {
    const c = this.conv;
    if (!c) return;
    const last = Math.max(0, ...c.turns.filter((t) => t.role !== 'owner').map((t) => t.at));
    if (last > (readMark(c.profile) ?? 0)) { setReadMark(c.profile, last); this.onUnreadChange?.(); setTitleCount(this.unreadTotal()); }
  }

  private turnView(t: Turn): HTMLElement {
    const li = el('li', { class: `turn ${t.role}${t.pending ? ' pending' : ''}`, 'data-turn': t.id });
    const who = t.role === 'owner' ? tr('Kamu') : t.role === 'system' ? tr('Sistem') : this.conv!.agent ?? tr('Agen');
    const where = t.pending ? ` · ${tr('dari RPG, menunggu')}` : t.via === 'rpg' ? ` · ${tr('dari RPG')}` : t.via === 'telegram' ? ' · Telegram' : '';
    li.append(el('span', { class: 'who' }, `${who}${where}`));
    const p = el('div', { class: 'text' });
    p.textContent = t.text; // agent output is untrusted: rendered as text, never HTML
    if (t.text) li.append(p);
    if (t.attachments?.length) {
      const box = el('div', { class: 'attachments' });
      for (const a of t.attachments) box.append(this.attachmentView(a));
      li.append(box);
    }
    const meta = el('span', { class: 'meta' });
    meta.append(el('time', { datetime: new Date(t.at).toISOString(), title: fmtTime(t.at) }, clock(t.at)));
    if (t.receipt) {
      const r = RECEIPT[t.receipt];
      meta.append(el('span', { class: `receipt ${t.receipt}`, title: tr(r.label), 'aria-label': tr(r.label), 'data-receipt': t.receipt }, r.mark));
    }
    li.append(meta);
    if (t.role !== 'system') {
      const acts = el('span', { class: 'turn-actions' });
      const reply = el('button', { type: 'button', class: 'btn link small', 'aria-label': tr('Balas pesan {who}', { who }) }, tr('Balas'));
      reply.addEventListener('click', () => this.replyTo(who, t.text));
      const copy = el('button', { type: 'button', class: 'btn link small', 'aria-label': tr('Salin pesan {who}', { who }) }, tr('Salin'));
      copy.addEventListener('click', () => { void navigator.clipboard?.writeText(t.text).then(() => toast(tr('Pesan disalin.')), () => toast(tr('Tidak bisa menyalin di browser ini.'))); });
      acts.append(reply, copy);
      li.append(acts);
    }
    if (t.optionsExpired) li.append(el('span', { class: 'muted small' }, tr('Pilihan di giliran ini sudah tidak berlaku.')));
    return li;
  }

  /** Photo inline (tap = full size), voice as player + transcript, other files as a download chip. */
  private attachmentView(a: Attachment): HTMLElement {
    if (!a.url) return el('span', { class: 'att-chip gone' }, `${a.name} (${t('sudah dihapus')})`);
    if (a.kind === 'image') {
      const link = el('a', { href: a.url, target: '_blank', rel: 'noopener', class: 'att-image' });
      link.append(el('img', { src: a.url, alt: t('Foto {name}', { name: a.name }), loading: 'lazy', decoding: 'async' }));
      return link;
    }
    if (a.kind === 'voice' || a.kind === 'video') {
      const wrap = el('div', { class: 'att-voice' });
      const player = el(a.kind === 'voice' ? 'audio' : 'video', { controls: '', preload: 'none', src: a.url });
      wrap.append(player);
      if (a.kind === 'voice') wrap.append(el('p', { class: 'muted small transcript' }, a.transcript ? `“${a.transcript}”` : a.transcribing ? t('Mengubah suara jadi teks…') : ''));
      return wrap;
    }
    const chip = el('a', { href: a.url, class: 'att-chip', target: '_blank', rel: 'noopener' }, `📄 ${a.name}`);
    if (a.size) chip.append(el('span', { class: 'muted small' }, ` ${fmtSize(a.size)}`));
    return chip;
  }

  private renderStaged(list: HTMLElement) {
    list.replaceChildren();
    list.hidden = !this.staged.length;
    for (const a of this.staged) {
      const li = el('li', { class: 'staged-item' });
      li.append(el('span', {}, `${a.kind === 'image' ? '🖼' : a.kind === 'voice' ? '🎤' : '📄'} ${a.name}`));
      if (a.kind === 'voice') li.append(el('span', { class: 'muted small', 'data-transcript': a.id }, a.transcript ? `“${a.transcript}”` : t('mengubah jadi teks…')));
      const rm = el('button', { type: 'button', class: 'btn link small', 'aria-label': t('Batalkan lampiran {name}', { name: a.name }) }, '✕');
      rm.addEventListener('click', () => { this.staged = this.staged.filter((x) => x.id !== a.id); this.renderStaged(list); });
      li.append(rm);
      list.append(li);
    }
  }

  private async attachFiles(files: File[], list: HTMLElement) {
    if (!this.conv || !files.length) return;
    for (const f of files.slice(0, 5 - this.staged.length)) {
      if (f.size > 10 * 1024 * 1024) { toast(t('{name} lebih dari 10 MB.', { name: f.name }), 4000); continue; }
      try {
        toast(t('Mengunggah {name}…', { name: f.name }), 1500);
        const { upload } = await api.upload(this.conv.id, f, f.name);
        this.staged.push(upload);
        this.renderStaged(document.getElementById('agent-staged') ?? list);
      } catch (e) { toast((e as Error).message, 5000); }
    }
    if (files.length + this.staged.length > 5) toast(t('Maksimal 5 lampiran per pesan.'), 3000);
    (document.getElementById('agent-manual-text') as HTMLTextAreaElement | null)?.focus();
  }

  /**
   * Mic button and status line follow `micState`, read from the live DOM by
   * id: the chat re-renders on every poll, so a captured button would be stale.
   */
  private paintMic() {
    const mic = document.getElementById('agent-mic') as HTMLButtonElement | null;
    const status = document.getElementById('agent-mic-status');
    if (!mic) return;
    const st = this.micState;
    mic.disabled = st === 'asking' || st === 'uploading';
    mic.setAttribute('aria-pressed', String(st === 'recording'));
    mic.classList.toggle('recording', st === 'recording');
    mic.textContent = st === 'recording' ? `■ ${t('Selesai rekam')}` : `🎤 ${t('Suara')}`;
    if (!status) return;
    status.classList.toggle('live', st === 'recording');
    status.textContent = st === 'asking' ? t('Meminta izin mikrofon…')
      : st === 'recording' ? `● ${t('Merekam')} ${fmtDur(Date.now() - this.recStarted)}`
      : st === 'uploading' ? t('Mengunggah pesan suara…') : '';
  }

  private setMic(st: MicState) {
    this.micState = st;
    window.clearInterval(this.recTimer);
    // The running time is the visible proof that recording works (Telegram shows it too).
    if (st === 'recording') this.recTimer = window.setInterval(() => this.paintMic(), 500);
    this.paintMic();
  }

  /** Drops whatever the mic is doing: pending permission, recording, or an upload's result. */
  private cancelMic() {
    this.micGen += 1;
    this.stopRecording(true);
    if (this.micState === 'asking') this.setMic('idle');
  }

  private stopRecording(discard = false) {
    const rec = this.recorder;
    if (!rec) return;
    if (discard) rec.discard = true;
    if (rec.state !== 'inactive') rec.stop();
  }

  /** Tap to start, tap again to stop; one file is uploaded and transcribed on the server. */
  private async toggleRecord(initialList: HTMLElement) {
    if (this.micState === 'recording') { this.stopRecording(); return; }
    if (this.micState !== 'idle') return;
    if (!window.isSecureContext) { toast(micError(undefined, false), 6000); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast(t('Browser ini tidak bisa merekam suara. Pakai Chrome, Edge, Firefox, atau Safari versi terbaru.'), 6000);
      return;
    }
    this.setMic('asking');
    const gen = ++this.micGen;
    const convId = this.conv?.id;
    let stream: MediaStream;
    let timer = 0;
    const ask = navigator.mediaDevices.getUserMedia({ audio: true });
    try {
      // A permission prompt that never shows (closed popup, blocked by the OS) must not leave the button silent.
      stream = await Promise.race([
        ask,
        new Promise<never>((_, no) => { timer = window.setTimeout(() => no(new DOMException('timeout', 'Timeout')), 20_000); }),
      ]);
    } catch (e) {
      // A grant that arrives after the timeout must not leave the mic open.
      ask.then((late) => late.getTracks().forEach((x) => x.stop()), () => {});
      if (gen !== this.micGen) return; // chat closed meanwhile: no toast for a chat that is gone
      this.micGen += 1;
      this.setMic('idle');
      toast(micError((e as DOMException)?.name), 7000);
      return;
    } finally { window.clearTimeout(timer); }
    if (gen !== this.micGen || this.conv?.id !== convId) { stream.getTracks().forEach((x) => x.stop()); return; }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    let rec: MediaRecorder & { discard?: boolean };
    try { rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined); } catch (e) {
      stream.getTracks().forEach((x) => x.stop());
      this.setMic('idle');
      toast(micError((e as DOMException)?.name), 7000);
      return;
    }
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    rec.onerror = () => { toast(t('Rekaman terhenti karena galat browser.'), 5000); };
    rec.onstop = async () => {
      stream.getTracks().forEach((x) => x.stop());
      this.recorder = null;
      const took = Date.now() - this.recStarted;
      if (rec.discard || !this.conv || gen !== this.micGen || !convId) { this.setMic('idle'); return; }
      if (took < 700 || !parts.length) { this.setMic('idle'); toast(t('Rekaman terlalu pendek. Tekan Suara, bicara, lalu tekan Selesai rekam.'), 4000); return; }
      this.setMic('uploading');
      const mime = (rec.mimeType || type || 'audio/webm').split(';')[0];
      try {
        const { upload } = await api.upload(convId, new Blob(parts, { type: mime }), 'pesan-suara');
        // The chat may have changed during the upload; the clip belongs to the one it was recorded in.
        if (gen !== this.micGen || this.conv?.id !== convId) { this.setMic('idle'); return; }
        this.staged.push(upload);
        const list = document.getElementById('agent-staged') ?? initialList;
        this.renderStaged(list);
        toast(t('Pesan suara {dur} siap. Transkrip menyusul; tekan Kirim kapan saja.', { dur: fmtDur(took) }), 4000);
        void this.followTranscript(upload.id, list);
      } catch (e) { toast((e as Error).message, 6000); }
      this.setMic('idle');
    };
    rec.start(1000);
    this.recorder = rec;
    this.recStarted = Date.now();
    this.setMic('recording');
    // Telegram caps voice notes too; 3 minutes keeps upload and transcription quick.
    window.setTimeout(() => { if (this.recorder === rec) this.stopRecording(); }, 180_000);
  }

  private async followTranscript(id: string, list: HTMLElement) {
    for (let i = 0; i < 150; i++) { // ~5 min: the first run after a restart can take minutes
      await new Promise((r) => setTimeout(r, 2000));
      const s = await api.uploadStatus(id).catch(() => null);
      const a = this.staged.find((x) => x.id === id);
      if (!a) return;
      if (s?.transcript) { a.transcript = s.transcript; this.renderStaged(document.getElementById('agent-staged') ?? list); return; }
      if (s && !s.transcribing) return;
    }
  }

  /** Search the whole chat history (Telegram session included), results jump-free as a list. */
  private searchBox(): HTMLElement {
    const c = this.conv!;
    const wrap = el('details', { class: 'chat-search' });
    if (this.searchTerm || this.searchOpen) wrap.setAttribute('open', '');
    wrap.addEventListener('toggle', () => { this.searchOpen = wrap.open; });
    wrap.append(el('summary', {}, `🔍 ${t('Cari pesan')}`));
    const form = el('form', { class: 'row', role: 'search' });
    const input = el('input', { type: 'search', id: 'agent-search', 'aria-label': t('Cari di chat {agent}', { agent: c.agent ?? '' }), placeholder: t('Kata yang dicari'), maxlength: '60' });
    input.value = this.searchTerm;
    const out = el('ol', { class: 'search-results', 'aria-live': 'polite' });
    const run = async () => {
      this.searchTerm = input.value.trim();
      out.replaceChildren();
      if (this.searchTerm.length < 2) return;
      try {
        const { results } = await api.search(c.id, this.searchTerm);
        if (!results.length) { out.append(el('li', { class: 'muted small' }, t('Tidak ada pesan yang cocok.'))); return; }
        for (const r of results) {
          const li = el('li', { class: `hit ${r.role}` });
          li.append(el('span', { class: 'who' }, `${r.role === 'owner' ? t('Kamu') : r.role === 'agent' ? c.agent ?? t('Agen') : t('Sistem')} · ${fmtTime(r.at)}`));
          const txt = el('span', { class: 'text' });
          const i = r.text.toLowerCase().indexOf(this.searchTerm.toLowerCase());
          const from = Math.max(0, i - 60);
          const snip = (from ? '…' : '') + r.text.slice(from, i + this.searchTerm.length + 100);
          const j = snip.toLowerCase().indexOf(this.searchTerm.toLowerCase());
          if (j >= 0) txt.append(document.createTextNode(snip.slice(0, j)), el('mark', {}, snip.slice(j, j + this.searchTerm.length)), document.createTextNode(snip.slice(j + this.searchTerm.length)));
          else txt.textContent = snip;
          li.append(txt);
          out.append(li);
        }
      } catch (e) { out.append(el('li', { class: 'warn' }, (e as Error).message)); }
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); void run(); });
    const go = el('button', { type: 'submit', class: 'btn' }, t('Cari'));
    form.append(input, go);
    wrap.append(form, out);
    if (this.searchTerm) void run();
    return wrap;
  }

  /** Per-device notification switch and per-bot mute, like Telegram's notification settings. */
  private async notifySettings(): Promise<HTMLElement> {
    const box = el('details', { class: 'notify-settings' });
    box.append(el('summary', {}, `🔔 ${t('Notifikasi')}`));
    const state = await pushState().catch(() => 'unsupported' as PushState);
    const help = el('p', { class: 'muted small', id: 'push-help' }, t(PUSH_HELP[state]));
    box.append(help);
    if (state === 'off' || state === 'on') {
      const toggle = el('button', { type: 'button', class: 'btn primary', id: 'push-toggle' }, t(state === 'on' ? 'Matikan notifikasi' : 'Aktifkan notifikasi'));
      toggle.addEventListener('click', async () => {
        toggle.disabled = true;
        try {
          const next = (await pushState()) === 'on' ? await disablePush() : await enablePush();
          help.textContent = t(PUSH_HELP[next]);
          toggle.textContent = t(next === 'on' ? 'Matikan notifikasi' : 'Aktifkan notifikasi');
          if (next === 'on') { await api.pushTest().catch(() => null); toast(t('Notifikasi uji dikirim.'), 3000); }
          box.querySelector('.mute-list')?.toggleAttribute('hidden', next !== 'on');
        } catch (e) { toast((e as Error).message, 5000); }
        toggle.disabled = false;
      });
      box.append(toggle);
      const muted = new Set(state === 'on' ? await mutedBots().catch(() => []) : []);
      const list = el('fieldset', { class: 'mute-list' });
      list.append(el('legend', {}, t('Bunyikan notifikasi dari')));
      if (state !== 'on') list.hidden = true;
      for (const a of this.agents) {
        const id = `mute-${a.profile}`;
        const lab = el('label', { for: id });
        const cb = el('input', { type: 'checkbox', id });
        cb.checked = !muted.has(a.profile);
        cb.addEventListener('change', () => { if (cb.checked) muted.delete(a.profile); else muted.add(a.profile); void setMutedBots([...muted]).catch(() => toast(t('Gagal menyimpan.'), 3000)); });
        lab.append(cb, document.createTextNode(` ${a.name}`));
        list.append(lab);
      }
      box.append(list);
    }
    const sound = el('label', { class: 'row small' });
    const sc = el('input', { type: 'checkbox', id: 'sound-toggle' });
    sc.checked = localStorage.getItem('kantor-rpg:sound') !== 'off';
    sc.addEventListener('change', () => localStorage.setItem('kantor-rpg:sound', sc.checked ? 'on' : 'off'));
    sound.append(sc, document.createTextNode(` ${t('Bunyi pesan masuk saat halaman terbuka')}`));
    box.append(sound);
    return box;
  }

  /** Opens the manual box with a quote of the message, like Telegram's reply. */
  private replyTo(who: string, text: string) {
    const manual = document.getElementById('agent-manual');
    const ta = document.getElementById('agent-manual-text') as HTMLTextAreaElement | null;
    if (!manual || !ta) return;
    manual.hidden = false;
    document.getElementById('agent-manual-toggle')?.setAttribute('aria-expanded', 'true');
    ta.value = quoteFor(who, text) + ta.value.replace(/^↩ (?:Membalas|Replying to)[^\n]*\n\n/, '');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  /** Keeps the open chat's "typing / last seen" line in step with presence ticks. */
  private refreshHeader() {
    const c = this.conv;
    const line = document.getElementById('agent-status');
    if (!c || !line) return;
    const p = this.presenceList.find((x) => x.profile === c.profile);
    const typing = c.typing || p?.typing;
    line.textContent = statusLine(typing, c.lastSeen ?? p?.lastSeen);
    line.classList.toggle('typing', !!typing);
  }

  private approvalView(id: string, taskId: string, action: string, impact: string, rollback: string, expiresAt: number): HTMLElement {
    const box = el('div', { class: 'approval', role: 'group', 'aria-label': t('Persetujuan aksi berisiko') });
    box.append(el('strong', {}, t('Butuh persetujuanmu')));
    const d = el('dl', { class: 'info-grid' });
    for (const [k, v] of [['Aksi', action], ['Dampak', impact], ['Jalan mundur', rollback], ['Berlaku sampai', `${fmtTime(expiresAt)} WITA`]]) d.append(el('dt', {}, t(k)), el('dd', {}, v));
    box.append(d);
    const yes = el('button', { type: 'button', class: 'btn primary' }, t('Setujui untuk tugas ini'));
    const no = el('button', { type: 'button', class: 'btn' }, t('Tolak'));
    const go = async (decision: 'approve' | 'reject') => {
      yes.disabled = no.disabled = true;
      try { this.conv = (await api.approve(id, taskId, decision)).conversation; this.renderConversation(); this.schedulePoll(); } catch (e) { toast((e as Error).message, 5000); yes.disabled = no.disabled = false; }
    };
    yes.addEventListener('click', () => void go('approve'));
    no.addEventListener('click', () => void go('reject'));
    box.append(el('div', { class: 'row' }));
    (box.lastChild as HTMLElement).append(no, yes);
    return box;
  }

  /** Runs a slash command picked from the menu (or the "new conversation" button). */
  private async runSlash(name: string, btn: HTMLButtonElement) {
    const box = document.getElementById('agent-manual-text') as HTMLTextAreaElement | null;
    if (box) box.value = `/${name}`;
    await this.send({ text: `/${name}` }, btn);
  }

  /** Server answer to a slash command, in the reader's language. */
  private commandText(r: CommandResult): string {
    const agent = this.conv?.agent ?? t('Agen');
    const list = (r.commands ?? SLASH).map((x) => `/${x.name}: ${t(x.help)}`).join('\n');
    switch (r.kind) {
      case 'help': return `${t('Perintah yang bisa dipakai di chat ini:')}\n${list}`;
      case 'unknown': return `${t('Perintah /{name} tidak dikenal, jadi tidak dikirim ke agen.', { name: r.name ?? '' })}\n${list}`;
      case 'stop': return r.stopped ? t('{n} tugas dihentikan. Efek yang sudah terjadi tidak dibatalkan.', { n: r.stopped }) : t('Tidak ada tugas yang sedang berjalan di percakapan ini.');
      case 'telegram': return r.ok ? t('Kembali ke chat Telegram {agent}.', { agent }) : t('{agent} belum punya chat Telegram denganmu.', { agent });
      case 'new': {
        const lines = [r.fromTelegram
          ? t('Percakapan baru khusus RPG dimulai. Sesi Telegram {agent} tidak ikut diganti: Hermes belum punya cara resmi untuk mengganti sesi bot Telegram dari luar. Ketik /new di Telegram untuk mengganti sesi di sana, atau /telegram untuk kembali ke chat Telegram.', { agent })
          : t('Percakapan baru dimulai. Pesan berikutnya membuka sesi Hermes baru.')];
        if (r.stillRunning) lines.push(t('{n} tugas di percakapan lama tetap berjalan sampai selesai.', { n: r.stillRunning }));
        return lines.join('\n');
      }
      case 'status': {
        const where = r.channel === 'telegram' ? t('chat Telegram') : r.channel === 'rpg-detached' ? t('khusus RPG (dari /new)') : t('khusus RPG');
        const tasks = (r.tasks ?? []).map((x) => `${x.n} ${(STATUS_LABEL[x.status] ? t(STATUS_LABEL[x.status]) : x.status).toLowerCase()}`).join(', ') || t('tidak ada');
        return [
          `${t('Percakapan')}: ${where}`,
          `${t('Sesi Hermes')}: ${r.session ?? t('belum ada (dibuat saat pesan pertama)')}`,
          `${t('Model')}: ${r.model ?? t('tidak diketahui')}`,
          `${t('Tugas')}: ${tasks}`,
          `${agent}: ${r.running ? t('sedang mengerjakan tugas') : t('siap')}`,
        ].join('\n');
      }
    }
  }

  /** One idempotency key per intended send: double clicks and retries reuse it. */
  private async send(payload: { text?: string; decision?: { turnId: string; optionId: string } }, btn: HTMLButtonElement) {
    if (this.sending || !this.conv) return;
    if (payload.text !== undefined && !payload.text.trim() && !this.staged.length) { toast(t('Pesan kosong.')); return; }
    if (this.micState !== 'idle' && !/^\/(stop|status|help)\b/i.test(payload.text?.trim() ?? '')) { toast(t(this.micState === 'uploading' ? 'Tunggu, pesan suara masih diunggah.' : 'Selesaikan rekaman dulu.')); return; }
    this.sending = true;
    btn.disabled = true;
    unlockAudio();
    const attachments = payload.text !== undefined ? this.staged.map((a) => a.id) : [];
    const what = JSON.stringify([this.conv.id, payload, attachments]);
    if (what !== this.pendingFor) { this.pendingIdem = null; this.pendingFor = what; }
    this.pendingIdem ??= newIdem();
    try {
      const r = await api.send(this.conv.id, { ...payload, idem: this.pendingIdem, ...(attachments.length ? { attachments } : {}) });
      this.pendingIdem = null;
      if (r.command) {
        // Commands run on the server and never reach the agent; staged files stay for the next message.
        const box = document.getElementById('agent-manual-text') as HTMLTextAreaElement | null;
        if (box) box.value = '';
        if (r.conversation.id !== this.conv.id) { this.staged = []; this.searchTerm = ''; this.readMarkAtOpen = null; }
        this.conv = r.conversation;
        this.commandNote = { text: this.commandText(r.command), at: Date.now() };
        this.renderConversation(false, r.command.kind === 'new' || r.command.kind === 'telegram');
        this.schedulePoll();
        if (r.command.kind === 'stop') void this.startPresence();
        btn.disabled = false;
        document.getElementById('agent-manual-text')?.focus();
        return;
      }
      this.commandNote = null;
      if (attachments.length) this.staged = [];
      if (payload.text !== undefined) { const t = document.getElementById('agent-manual-text') as HTMLTextAreaElement | null; if (t) t.value = ''; }
      this.conv = r.conversation;
      if (r.approval) toast(t('Pesan ditahan: butuh persetujuanmu dulu.'), 4000);
      else toast(t(r.duplicate ? 'Sudah terkirim sebelumnya (tidak dikirim dua kali).' : 'Diterima server. Belum berarti selesai.'), 3000);
      this.renderConversation();
      this.schedulePoll();
      void this.startPresence(); // the NPC heads for its desk now, not on the next tick
    } catch (e) {
      // 4xx: the server decided; a new attempt is a new intent. Network
      // errors keep the key so a retry cannot create a second task.
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) this.pendingIdem = null;
      toast((e as Error).message, 5000);
      btn.disabled = false;
    } finally { this.sending = false; }
  }
}
