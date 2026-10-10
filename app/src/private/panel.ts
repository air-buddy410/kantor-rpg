// Panel privat (PRD 17 M5 + 18 M4): login owner, tiga papan kerja, dan
// percakapan dengan agen Hermes nyata (3 pilihan + Ketik manual).
// Tanpa login atau tanpa backend, papan memakai data demo berlabel `Demo`
// dan tombol kirim tidak ada: halaman publik tidak bisa memerintah agen.
import { $, el, openDialog, toast } from '../ui/dom';
import { DEMO_BOARDS } from './demo';
import { disablePush, enablePush, mutedBots, PUSH_HELP, pushState, setMutedBots, type PushState } from './push';
import { clock, dayLabel, ping, quoteFor, RECEIPT, sameDay, setTitleCount, statusLine, unlockAudio } from './chat-ui';
import { api, ApiError, type Boards, type Conversation, type Me, type Agent, type Presence, type HandoffItem, type TaskItem, type LogItem, type Turn, type Attachment } from './api';

type Tab = 'handoffs' | 'tasks' | 'log';
const STATUS_LABEL: Record<string, string> = {
  queued: 'Antre', working: 'Dikerjakan', waiting_owner: 'Menunggu keputusanmu', blocked: 'Menunggu persetujuan', completed: 'Selesai',
  failed: 'Gagal', cancelled: 'Dibatalkan', unknown: 'Tidak diketahui',
};
const TASK_STATUS: Record<string, string> = { todo: 'Antre', ready: 'Antre', triage: 'Antre', scheduled: 'Terjadwal', running: 'Sedang jalan', claimed: 'Diambil', blocked: 'Diblokir', done: 'Selesai' };

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleString('id-ID', { timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });

// Read position per agent, kept in this browser only (no server state, no content).
const READ_KEY = 'kantor-rpg:read:';
export function readMark(profile: string): number | null {
  try { const v = localStorage.getItem(READ_KEY + profile); return v ? Number(v) || null : null; } catch { return null; }
}
function setReadMark(profile: string, at: number) {
  try { localStorage.setItem(READ_KEY + profile, String(at)); } catch { /* private mode: unread state just isn't kept */ }
}
const fmtSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);
const fmtAge = (h: number) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} mnt` : h < 48 ? `${Math.round(h)} jam` : `${Math.round(h / 24)} hari`);
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
  private recorder: MediaRecorder | null = null;
  private searchTerm = '';

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
    await this.refreshMe();
    const dlg = $('dlg-agent') as HTMLDialogElement;
    $('agent-title').textContent = 'Chat agen';
    const body = $('agent-body');
    body.replaceChildren();
    if (!this.authenticated) {
      body.append(el('p', {}, 'Chat dengan agen nyata hanya untuk owner yang login.'));
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
      body.append(el('p', { class: 'warn', role: 'alert' }, `Daftar agen tidak dapat dibuka: ${(e as Error).message}`));
      if (!dlg.open) openDialog(dlg, opener);
      return;
    }
    const list = el('ul', { class: 'agent-pick', 'aria-label': 'Pilih agen' });
    for (const a of this.agents) {
      const p = presence.find((x) => x.profile === a.profile);
      const state = p?.typing ? 'mengetik…' : p?.status === 'working' ? 'Bekerja' : p?.status === 'waiting' ? 'Menunggu kamu' : p?.status === 'unknown' ? 'Tidak diketahui' : 'Siap';
      const btn = el('button', { type: 'button', class: 'btn agent-pick-btn', 'data-agent': a.profile });
      btn.append(el('span', { class: 'agent-pick-name' }, a.name), el('span', { class: 'muted small' }, p?.typing ? 'sedang mengetik…' : statusLine(false, p?.lastSeen) || a.lane),
        el('span', { class: `tag ${p?.status === 'working' ? 'live' : p?.status === 'waiting' ? 'warn' : 'demo'}` }, state));
      const unread = this.unreadFor(a.profile);
      if (unread) btn.append(el('span', { class: 'unread-badge', 'aria-label': `${unread} pesan belum dibaca` }, unread > 9 ? '9+' : String(unread)));
      if (p?.summary) btn.title = p.summary;
      btn.addEventListener('click', () => void this.openAgent(a.profile, opener));
      const li = el('li'); li.append(btn); list.append(li);
    }
    body.append(el('p', { class: 'muted small' }, 'Pilih agen untuk chat atau memberi tugas. Tombol C membuka daftar ini dari mana saja.'), list);
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
    body.replaceChildren();
    const head = el('div', { class: 'board-head' });
    head.append(el('span', { class: demo ? 'tag demo' : 'tag live' }, demo ? 'Demo' : 'Data nyata'));
    head.append(el('span', { class: 'muted small' }, demo
      ? 'Data simulasi. Login owner untuk melihat papan tim yang sebenarnya.'
      : `Diamati ${fmtTime(Date.parse(b.observedAt))} WITA. Baca-saja; ubah tugas tetap lewat bot.`));
    if (!demo) {
      const out = el('button', { type: 'button', class: 'btn link', id: 'btn-logout' }, 'Keluar');
      out.addEventListener('click', async () => { try { await api.logout(); } catch { /* session already gone */ } this.me = null; this.loggedOut(); toast('Sudah keluar.'); void this.openBoards(this.tab); });
      head.append(out);
    }
    body.append(head);
    if (this.stale && !demo) body.append(el('p', { class: 'warn', role: 'status' }, `Basi: pembaruan gagal (${this.stale}). Data di bawah dari ${fmtTime(Date.parse(b.observedAt))} WITA.`));
    const tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Papan kerja' });
    const names: [Tab, string][] = [['handoffs', 'Papan Handoff'], ['tasks', 'Daftar Pekerjaan'], ['log', 'Log Aktivitas']];
    for (const [id, label] of names) {
      const t = el('button', { type: 'button', role: 'tab', class: 'tab', id: `tab-${id}`, 'aria-selected': String(this.tab === id), 'aria-controls': 'board-panel' }, label);
      t.addEventListener('click', () => { this.tab = id; this.renderBoards(); $(`tab-${id}`).focus(); });
      t.addEventListener('keydown', (e) => {
        const i = names.findIndex(([n]) => n === this.tab);
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          this.tab = names[(i + (e.key === 'ArrowRight' ? 1 : names.length - 1)) % names.length][0];
          this.renderBoards(); $(`tab-${this.tab}`).focus();
        }
      });
      tabs.append(t);
    }
    body.append(tabs);
    const panel = el('div', { role: 'tabpanel', id: 'board-panel', 'aria-labelledby': `tab-${this.tab}`, class: 'board-panel' });
    body.append(panel);
    const board = b[this.tab];
    if (!board.ok) {
      panel.append(el('p', { class: 'warn', role: 'status' }, `Tidak diketahui: sumber ${board.source} tidak terbaca (${board.error ?? 'galat'}). Terakhir diamati ${fmtTime(Date.parse(b.observedAt))}.`));
    } else if (this.tab === 'handoffs') this.renderHandoffs(panel, board.items as HandoffItem[]);
    else if (this.tab === 'tasks') this.renderTasks(panel, board.items as TaskItem[]);
    else this.renderLog(panel, board.items as LogItem[]);
    if (!this.authenticated) body.append(this.loginForm(() => void this.openBoards(this.tab)));
    if (active && document.getElementById(active)) document.getElementById(active)!.focus();
  }

  private renderHandoffs(panel: HTMLElement, items: HandoffItem[]) {
    const attention = items.filter((h) => h.attention).length;
    panel.append(el('p', { class: 'muted small' }, `${items.length} handoff, ${attention} perlu perhatian (diblokir atau >24 jam belum diterima).`));
    const order = ['Diblokir', 'Dikirim', 'Diterima', 'Dikerjakan', 'Selesai', 'Dibatalkan', 'Belum tercatat'];
    const list = el('ul', { class: 'cards' });
    for (const h of [...items].sort((a, b) => Number(b.attention) - Number(a.attention) || order.indexOf(a.status) - order.indexOf(b.status) || b.createdAt - a.createdAt)) {
      const li = el('li', { class: `card${h.attention ? ' attention' : ''}` });
      const top = el('div', { class: 'card-top' });
      top.append(el('strong', {}, `${h.from} → ${h.to}`), el('span', { class: `tag st-${h.status.toLowerCase().replace(/\s/g, '-')}` }, h.status));
      if (h.attention) top.append(el('span', { class: 'tag warn' }, 'Perlu perhatian'));
      li.append(top, el('p', {}, h.summary));
      if (h.chain && h.chain.length > 2) {
        const ch = el('p', { class: 'chain', 'aria-label': `Rantai kerja: ${h.chain.join(', lalu ')}` });
        h.chain.forEach((n, i) => {
          if (i) ch.append(el('span', { 'aria-hidden': 'true' }, ' → '));
          ch.append(el('span', { class: i === h.chainActive ? 'step active' : 'step' }, n));
        });
        li.append(ch);
      }
      if (h.diminta) li.append(el('p', { class: 'muted small' }, `Yang diminta: ${h.diminta}`));
      li.append(el('p', { class: 'meta' }, `${h.project} · ${h.badan} · umur ${fmtAge(h.ageHours)}${h.hasFile ? '' : ' · berkas belum tercatat'}`));
      list.append(li);
    }
    if (!items.length) panel.append(el('p', {}, 'Tidak ada handoff dalam 7 hari terakhir.'));
    panel.append(list);
  }

  private renderTasks(panel: HTMLElement, items: TaskItem[]) {
    const lanes = [...new Set(items.map((t) => t.owner))].sort();
    const statuses = [...new Set(items.map((t) => t.status))];
    const badans = [...new Set(items.map((t) => t.badan ?? 'Belum tercatat'))].sort();
    const bar = el('div', { class: 'filters' });
    const sel = (key: 'lane' | 'status' | 'badan', label: string, values: string[], text: (v: string) => string) => {
      const id = `filter-${key}`;
      const s = el('select', { id });
      s.append(el('option', { value: '' }, 'Semua'));
      for (const v of values) { const o = el('option', { value: v }, text(v)); if (this.filters[key] === v) o.selected = true; s.append(o); }
      s.addEventListener('change', () => { this.filters[key] = s.value; this.renderBoards(); $(id).focus(); });
      const l = el('label', { for: id }, label);
      bar.append(l, s);
    };
    sel('lane', 'Bot', lanes, (v) => v);
    sel('badan', 'Badan', badans, (v) => v);
    sel('status', 'Status', statuses, (v) => TASK_STATUS[v] ?? v);
    panel.append(bar);
    const shown = items.filter((t) => (!this.filters.lane || t.owner === this.filters.lane) && (!this.filters.status || t.status === this.filters.status) && (!this.filters.badan || (t.badan ?? 'Belum tercatat') === this.filters.badan));
    panel.append(el('p', { class: 'muted small', role: 'status', id: 'task-count' }, `${shown.length} dari ${items.length} tugas.`));
    const table = el('table', { class: 'board-table' });
    const thead = el('thead'); const hr = el('tr');
    for (const h of ['Tugas', 'Bot', 'Peminta', 'Status', 'Umur']) hr.append(el('th', { scope: 'col' }, h));
    thead.append(hr); table.append(thead);
    const tb = el('tbody');
    for (const t of shown) {
      const tr = el('tr', { 'data-task': t.id, id: `row-${t.id}`, class: this.focusTask === t.id ? 'focus-row' : '' });
      tr.append(el('td', {}, t.title), el('td', {}, t.owner), el('td', {}, t.requester), el('td', {}, TASK_STATUS[t.status] ?? t.status), el('td', {}, fmtAge(t.ageHours)));
      tb.append(tr);
    }
    table.append(tb);
    panel.append(el('div', { class: 'table-wrap' }));
    (panel.lastChild as HTMLElement).append(table);
  }

  private renderLog(panel: HTMLElement, items: LogItem[]) {
    panel.append(el('p', { class: 'muted small' }, `${items.length} peristiwa dalam 24 jam terakhir (maks. 50 tugas + 110 aksi alat). Isi perintah dan obrolan tidak ditampilkan.`));
    const ol = el('ol', { class: 'log' });
    for (const r of items) {
      const li = el('li', { class: r.kind === 'task' ? 'log-task' : 'log-tool' });
      li.append(el('time', { datetime: new Date(r.at).toISOString() }, fmtTime(r.at)), el('strong', {}, r.bot));
      const text = `${r.verb}${r.object ? `: ${r.object}` : ''}`;
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
    wrap.append(el('h3', { id: 'login-title' }, 'Login owner'));
    if (this.backend === 'none') {
      wrap.append(el('p', { class: 'muted small' }, 'Backend privat tidak terjangkau dari halaman ini. Papan dan perintah agen hanya tersedia di employee-rpg.air-buddy.site.'));
      return wrap;
    }
    if (!this.me?.configured) {
      wrap.append(el('p', { class: 'muted small' }, 'Akun owner belum dibuat. Buka tautan setup sekali pakai yang dikirim Max ke Telegram.'));
      return wrap;
    }
    const form = el('form', { class: 'settings', autocomplete: 'on' });
    const field = (id: string, label: string, attrs: Record<string, string>) => {
      form.append(el('label', { for: id }, label));
      form.append(el('input', { id, ...attrs }));
    };
    field('login-user', 'Nama', { name: 'username', autocomplete: 'username', required: '' });
    field('login-pass', 'Sandi', { name: 'password', type: 'password', autocomplete: 'current-password', required: '' });
    field('login-code', 'Kode 2FA (6 digit)', { name: 'code', inputmode: 'numeric', pattern: '[0-9]{6}', autocomplete: 'one-time-code', required: '' });
    const err = el('p', { class: 'warn', role: 'alert' });
    err.hidden = true;
    const btn = el('button', { type: 'submit', class: 'btn primary' }, 'Masuk');
    form.append(err, btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      const fd = new FormData(form);
      try {
        await api.login(String(fd.get('username')), String(fd.get('password')), String(fd.get('code')));
        this.loggedIn();
        await this.refreshMe();
        toast('Login owner berhasil.');
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
    $('agent-title').textContent = 'Bicara & beri tugas';
    const body = $('agent-body');
    body.replaceChildren();
    if (!this.authenticated) {
      body.append(el('p', {}, 'Memberi tugas ke agen nyata hanya untuk owner yang login. Pengunjung tidak dapat mengirim apa pun ke agen.'));
      body.append(this.loginForm(() => void this.openAgent(profile, opener)));
      if (!dlg.open) openDialog(dlg, opener);
      return;
    }
    try {
      this.agents = (await api.agents()).agents;
      const next = await api.conversation(profile);
      if (next.id !== this.conv?.id) { this.staged = []; this.searchTerm = ''; }
      this.conv = next;
    } catch (e) {
      body.append(el('p', { class: 'warn', role: 'alert' }, `Agen tidak dapat dibuka: ${(e as Error).message}`));
      if (!dlg.open) openDialog(dlg, opener);
      return;
    }
    this.renderConversation(false, true);
    if (!dlg.open) {
      openDialog(dlg, opener);
      this.onOpenChange?.(true);
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
        const next = await api.conversationById(this.conv.id);
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
    $('agent-title').textContent = `${c.agent} · bicara & beri tugas`;
    const body = $('agent-body');
    body.replaceChildren();
    body.append(el('p', { class: `chat-status${c.typing ? ' typing' : ''}`, id: 'agent-status', role: 'status', 'aria-live': 'polite' }, statusLine(c.typing, c.lastSeen)));
    const info = el('dl', { class: 'info-grid' });
    const mode = c.channel === 'telegram' ? 'Sama dengan chat Telegram' : c.channel === 'telegram-unavailable' ? 'Telegram tidak terbaca' : 'Khusus RPG';
    for (const [k, v] of [['Profil', c.profile], ['Lane', c.lane ?? '-'], ['Percakapan', mode]]) info.append(el('dt', {}, k), el('dd', {}, v));
    body.append(info);
    if (c.channel === 'telegram') body.append(el('p', { class: 'muted small', id: 'agent-sync-note' }, `Ini percakapan Telegram-mu dengan ${c.agent}. Pesan dari sini masuk ke sesi yang sama, dan balasannya juga dikirim bot ke Telegram. Jangan ketik sandi, OTP, atau token.`));
    else if (c.channel === 'telegram-unavailable') body.append(el('p', { class: 'warn', role: 'status' }, 'Riwayat Telegram bot ini tidak bisa dibaca sekarang. Pesan yang kamu kirim tetap masuk ke sesi Telegram-nya bila sesinya ada.'));
    else body.append(el('p', { class: 'muted small' }, 'Bot ini belum punya chat Telegram denganmu, jadi percakapan ini khusus RPG. Jangan ketik sandi, OTP, atau token di sini.'));
    body.append(this.searchBox());
    const log = el('ol', { class: 'chat', 'aria-live': 'polite', 'aria-label': `Percakapan dengan ${c.agent}` });
    // Unread = agent/system messages newer than what Budi last saw (per profile, this browser).
    if (opening) this.readMarkAtOpen = readMark(c.profile);
    const mark = this.readMarkAtOpen;
    let divider: HTMLElement | null = null;
    let prevAt: number | null = null;
    for (const t of c.turns) {
      if (prevAt === null || !sameDay(prevAt, t.at)) log.append(el('li', { class: 'day-divider', role: 'separator' }, dayLabel(t.at)));
      prevAt = t.at;
      if (!divider && mark !== null && t.role !== 'owner' && t.at > mark) {
        divider = el('li', { class: 'unread-divider', role: 'separator' }, 'Belum dibaca');
        log.append(divider);
      }
      log.append(this.turnView(t));
    }
    if (c.typing) {
      const bubble = el('li', { class: 'turn agent typing-bubble', 'aria-label': `${c.agent} sedang mengetik` });
      bubble.append(el('span', { class: 'dots', 'aria-hidden': 'true' }, '•••'));
      log.append(bubble);
    }
    if (!c.turns.length) log.append(el('li', { class: 'muted' }, `Belum ada pesan. Tulis tugas pertama untuk ${c.agent}.`));
    body.append(log);
    for (const t of c.tasks.filter((x) => !x.terminal || x.status === 'blocked' || x.status === 'waiting_owner')) {
      const last = [...c.events].reverse().find((e) => e.task_id === t.id);
      const row = el('div', { class: 'task-status', role: 'status', 'data-task': t.id, 'data-status': t.status });
      row.append(el('span', { class: `tag st-${t.status}` }, STATUS_LABEL[t.status] ?? t.status), el('span', { class: 'muted small' }, `${last?.note ?? ''} Sumber ${t.source}, ${fmtTime(t.observed_at)}.`));
      const appr = c.approvals.find((a) => a.task_id === t.id && a.status === 'pending');
      if (appr && t.status === 'blocked') row.append(this.approvalView(appr.id, t.id, appr.action, appr.impact, appr.rollback, appr.expires_at));
      if (t.status === 'queued' || t.status === 'working' || t.status === 'blocked') {
        const stop = el('button', { type: 'button', class: 'btn' }, t.status === 'working' ? 'Hentikan' : 'Batalkan');
        stop.addEventListener('click', async () => {
          try { await api.cancel(t.id); this.conv = await api.conversationById(c.id); this.renderConversation(); } catch (e) { toast((e as Error).message, 4000); }
        });
        row.append(stop);
      }
      body.append(row);
    }
    for (const t of c.tasks.filter((x) => x.status === 'failed' || x.status === 'unknown').slice(-1)) {
      if (c.tasks.at(-1)?.id === t.id) body.append(el('p', { class: 'warn', role: 'alert' }, `${STATUS_LABEL[t.status]}: ${t.error ?? 'tanpa keterangan'}. Tidak dicoba ulang otomatis.`));
    }
    const lastAgent = [...c.turns].reverse().find((t) => t.role === 'agent');
    const choices = el('div', { class: 'choices', role: 'group', 'aria-label': 'Pilihan balasan' });
    if (lastAgent?.options) {
      lastAgent.options.forEach((o, i) => {
        const b = el('button', { type: 'button', class: `btn choice${i === 0 ? ' recommended' : ''}`, 'data-option': o.id }, `${i + 1}. ${o.label}${o.requiresApproval ? ' (perlu persetujuan)' : ''}`);
        b.title = o.message;
        b.addEventListener('click', () => void this.send({ decision: { turnId: lastAgent.id, optionId: o.id } }, b));
        choices.append(b);
      });
    }
    const manualBtn = el('button', { type: 'button', class: 'btn choice', id: 'agent-manual-toggle', 'aria-expanded': 'false', 'aria-controls': 'agent-manual' }, lastAgent?.options ? '4. Ketik manual' : 'Ketik pesan');
    choices.append(manualBtn);
    body.append(choices);
    const manual = el('form', { id: 'agent-manual', class: 'manual' });
    manual.hidden = !(manualOpen || !lastAgent?.options);
    const ta = el('textarea', { id: 'agent-manual-text', rows: '3', maxlength: '4000', 'aria-label': `Pesan untuk ${c.agent}` });
    if (draft) ta.value = draft;
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); manual.hidden = true; manualBtn.setAttribute('aria-expanded', 'false'); manualBtn.focus(); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); manual.requestSubmit(); }
    });
    const sendBtn = el('button', { type: 'submit', class: 'btn primary', id: 'agent-send' }, 'Kirim');
    const chips = el('ul', { class: 'staged', id: 'agent-staged', 'aria-label': 'Lampiran siap dikirim' });
    this.renderStaged(chips);
    const file = el('input', { type: 'file', id: 'agent-file', multiple: '', class: 'visually-hidden', accept: 'image/*,application/pdf,.docx,.xlsx,.txt,.csv,.zip,audio/*' });
    file.addEventListener('change', () => { void this.attachFiles([...(file.files ?? [])], chips); file.value = ''; });
    const attach = el('button', { type: 'button', class: 'btn', id: 'agent-attach', 'aria-label': 'Lampirkan foto atau berkas' }, '📎 Lampiran');
    attach.addEventListener('click', () => file.click());
    const mic = el('button', { type: 'button', class: 'btn', id: 'agent-mic', 'aria-pressed': String(!!this.recorder) }, this.recorder ? '■ Selesai rekam' : '🎤 Suara');
    mic.addEventListener('click', () => void this.toggleRecord(mic, chips));
    if (!('MediaRecorder' in window) || !navigator.mediaDevices?.getUserMedia) mic.hidden = true;
    ta.addEventListener('paste', (e) => {
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) { e.preventDefault(); void this.attachFiles(files, chips); }
    });
    manual.addEventListener('dragover', (e) => { e.preventDefault(); manual.classList.add('drop'); });
    manual.addEventListener('dragleave', () => manual.classList.remove('drop'));
    manual.addEventListener('drop', (e) => { e.preventDefault(); manual.classList.remove('drop'); void this.attachFiles([...(e.dataTransfer?.files ?? [])], chips); });
    const tools = el('div', { class: 'row composer-tools' });
    tools.append(attach, mic, file);
    manual.append(chips, ta, tools, el('div', { class: 'row' }));
    (manual.lastChild as HTMLElement).append(el('span', { class: 'muted small' }, 'Ctrl/⌘+Enter untuk kirim. Esc menutup tanpa mengirim. Foto bisa ditempel atau diseret ke sini.'), sendBtn);
    manual.addEventListener('submit', (e) => { e.preventDefault(); void this.send({ text: ta.value }, sendBtn); });
    manualBtn.setAttribute('aria-expanded', String(!manual.hidden));
    manualBtn.addEventListener('click', () => { manual.hidden = !manual.hidden; manualBtn.setAttribute('aria-expanded', String(!manual.hidden)); if (!manual.hidden) ta.focus(); });
    body.append(manual);
    const fresh = el('button', { type: 'button', class: 'btn link' }, 'Mulai percakapan baru');
    fresh.addEventListener('click', async () => { this.conv = await api.conversation(c.profile, true); this.renderConversation(); });
    // A Telegram-bound chat has one history (Telegram's); /new is done in Telegram.
    if (c.channel !== 'telegram') body.append(fresh);
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
    const who = t.role === 'owner' ? 'Kamu' : t.role === 'system' ? 'Sistem' : this.conv!.agent ?? 'Agen';
    const where = t.pending ? ' · dari RPG, menunggu' : t.via === 'rpg' ? ' · dari RPG' : t.via === 'telegram' ? ' · Telegram' : '';
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
      meta.append(el('span', { class: `receipt ${t.receipt}`, title: r.label, 'aria-label': r.label, 'data-receipt': t.receipt }, r.mark));
    }
    li.append(meta);
    if (t.role !== 'system') {
      const acts = el('span', { class: 'turn-actions' });
      const reply = el('button', { type: 'button', class: 'btn link small', 'aria-label': `Balas pesan ${who}` }, 'Balas');
      reply.addEventListener('click', () => this.replyTo(who, t.text));
      const copy = el('button', { type: 'button', class: 'btn link small', 'aria-label': `Salin pesan ${who}` }, 'Salin');
      copy.addEventListener('click', () => { void navigator.clipboard?.writeText(t.text).then(() => toast('Pesan disalin.'), () => toast('Tidak bisa menyalin di browser ini.')); });
      acts.append(reply, copy);
      li.append(acts);
    }
    if (t.optionsExpired) li.append(el('span', { class: 'muted small' }, 'Pilihan di giliran ini sudah tidak berlaku.'));
    return li;
  }

  /** Photo inline (tap = full size), voice as player + transcript, other files as a download chip. */
  private attachmentView(a: Attachment): HTMLElement {
    if (!a.url) return el('span', { class: 'att-chip gone' }, `${a.name} (sudah dihapus)`);
    if (a.kind === 'image') {
      const link = el('a', { href: a.url, target: '_blank', rel: 'noopener', class: 'att-image' });
      link.append(el('img', { src: a.url, alt: `Foto ${a.name}`, loading: 'lazy', decoding: 'async' }));
      return link;
    }
    if (a.kind === 'voice' || a.kind === 'video') {
      const wrap = el('div', { class: 'att-voice' });
      const player = el(a.kind === 'voice' ? 'audio' : 'video', { controls: '', preload: 'none', src: a.url });
      wrap.append(player);
      if (a.kind === 'voice') wrap.append(el('p', { class: 'muted small transcript' }, a.transcript ? `“${a.transcript}”` : a.transcribing ? 'Mengubah suara jadi teks…' : ''));
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
      if (a.kind === 'voice') li.append(el('span', { class: 'muted small', 'data-transcript': a.id }, a.transcript ? `“${a.transcript}”` : 'mengubah jadi teks…'));
      const rm = el('button', { type: 'button', class: 'btn link small', 'aria-label': `Batalkan lampiran ${a.name}` }, '✕');
      rm.addEventListener('click', () => { this.staged = this.staged.filter((x) => x.id !== a.id); this.renderStaged(list); });
      li.append(rm);
      list.append(li);
    }
  }

  private async attachFiles(files: File[], list: HTMLElement) {
    if (!this.conv || !files.length) return;
    for (const f of files.slice(0, 5 - this.staged.length)) {
      if (f.size > 10 * 1024 * 1024) { toast(`${f.name} lebih dari 10 MB.`, 4000); continue; }
      try {
        toast(`Mengunggah ${f.name}…`, 1500);
        const { upload } = await api.upload(this.conv.id, f, f.name);
        this.staged.push(upload);
        this.renderStaged(document.getElementById('agent-staged') ?? list);
      } catch (e) { toast((e as Error).message, 5000); }
    }
    if (files.length + this.staged.length > 5) toast('Maksimal 5 lampiran per pesan.', 3000);
    (document.getElementById('agent-manual-text') as HTMLTextAreaElement | null)?.focus();
  }

  /** Hold-free voice note: tap to start, tap again to stop; uploaded as one file, transcribed on the server. */
  private async toggleRecord(btn: HTMLButtonElement, initialList: HTMLElement) {
    let list = initialList;
    if (this.recorder) { this.recorder.stop(); return; }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { toast('Mikrofon tidak diizinkan.', 4000); return; }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const parts: Blob[] = [];
    const started = Date.now();
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      this.recorder = null;
      // The chat may have re-rendered while recording: update the live controls, not the captured ones.
      const live = (document.getElementById('agent-mic') as HTMLButtonElement | null) ?? btn;
      live.textContent = '🎤 Suara'; live.setAttribute('aria-pressed', 'false');
      list = document.getElementById('agent-staged') ?? list;
      if (Date.now() - started < 700 || !this.conv) return;
      const mime = (rec.mimeType || 'audio/webm').split(';')[0];
      try {
        const { upload } = await api.upload(this.conv.id, new Blob(parts, { type: mime }), 'pesan-suara');
        this.staged.push(upload);
        this.renderStaged(list);
        void this.followTranscript(upload.id, list);
      } catch (e) { toast((e as Error).message, 5000); }
    };
    rec.start();
    this.recorder = rec;
    btn.textContent = '■ Selesai rekam'; btn.setAttribute('aria-pressed', 'true');
    // Telegram caps voice notes too; 3 minutes keeps upload and transcription quick.
    window.setTimeout(() => { if (this.recorder === rec) rec.stop(); }, 180_000);
  }

  private async followTranscript(id: string, list: HTMLElement) {
    for (let i = 0; i < 60; i++) {
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
    if (this.searchTerm) wrap.setAttribute('open', '');
    wrap.append(el('summary', {}, '🔍 Cari pesan'));
    const form = el('form', { class: 'row', role: 'search' });
    const input = el('input', { type: 'search', id: 'agent-search', 'aria-label': `Cari di chat ${c.agent}`, placeholder: 'Kata yang dicari', maxlength: '60' });
    input.value = this.searchTerm;
    const out = el('ol', { class: 'search-results', 'aria-live': 'polite' });
    const run = async () => {
      this.searchTerm = input.value.trim();
      out.replaceChildren();
      if (this.searchTerm.length < 2) return;
      try {
        const { results } = await api.search(c.id, this.searchTerm);
        if (!results.length) { out.append(el('li', { class: 'muted small' }, 'Tidak ada pesan yang cocok.')); return; }
        for (const r of results) {
          const li = el('li', { class: `hit ${r.role}` });
          li.append(el('span', { class: 'who' }, `${r.role === 'owner' ? 'Kamu' : r.role === 'agent' ? c.agent ?? 'Agen' : 'Sistem'} · ${fmtTime(r.at)}`));
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
    const go = el('button', { type: 'submit', class: 'btn' }, 'Cari');
    form.append(input, go);
    wrap.append(form, out);
    if (this.searchTerm) void run();
    return wrap;
  }

  /** Per-device notification switch and per-bot mute, like Telegram's notification settings. */
  private async notifySettings(): Promise<HTMLElement> {
    const box = el('details', { class: 'notify-settings' });
    box.append(el('summary', {}, '🔔 Notifikasi'));
    const state = await pushState().catch(() => 'unsupported' as PushState);
    const help = el('p', { class: 'muted small', id: 'push-help' }, PUSH_HELP[state]);
    box.append(help);
    if (state === 'off' || state === 'on') {
      const toggle = el('button', { type: 'button', class: 'btn primary', id: 'push-toggle' }, state === 'on' ? 'Matikan notifikasi' : 'Aktifkan notifikasi');
      toggle.addEventListener('click', async () => {
        toggle.disabled = true;
        try {
          const next = (await pushState()) === 'on' ? await disablePush() : await enablePush();
          help.textContent = PUSH_HELP[next];
          toggle.textContent = next === 'on' ? 'Matikan notifikasi' : 'Aktifkan notifikasi';
          if (next === 'on') { await api.pushTest().catch(() => null); toast('Notifikasi uji dikirim.', 3000); }
          box.querySelector('.mute-list')?.toggleAttribute('hidden', next !== 'on');
        } catch (e) { toast((e as Error).message, 5000); }
        toggle.disabled = false;
      });
      box.append(toggle);
      const muted = new Set(state === 'on' ? await mutedBots().catch(() => []) : []);
      const list = el('fieldset', { class: 'mute-list' });
      list.append(el('legend', {}, 'Bunyikan notifikasi dari'));
      if (state !== 'on') list.hidden = true;
      for (const a of this.agents) {
        const id = `mute-${a.profile}`;
        const lab = el('label', { for: id });
        const cb = el('input', { type: 'checkbox', id });
        cb.checked = !muted.has(a.profile);
        cb.addEventListener('change', () => { if (cb.checked) muted.delete(a.profile); else muted.add(a.profile); void setMutedBots([...muted]).catch(() => toast('Gagal menyimpan.', 3000)); });
        lab.append(cb, document.createTextNode(` ${a.name}`));
        list.append(lab);
      }
      box.append(list);
    }
    const sound = el('label', { class: 'row small' });
    const sc = el('input', { type: 'checkbox', id: 'sound-toggle' });
    sc.checked = localStorage.getItem('kantor-rpg:sound') !== 'off';
    sc.addEventListener('change', () => localStorage.setItem('kantor-rpg:sound', sc.checked ? 'on' : 'off'));
    sound.append(sc, document.createTextNode(' Bunyi pesan masuk saat halaman terbuka'));
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
    ta.value = quoteFor(who, text) + ta.value.replace(/^↩ Membalas[^\n]*\n\n/, '');
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
    const box = el('div', { class: 'approval', role: 'group', 'aria-label': 'Persetujuan aksi berisiko' });
    box.append(el('strong', {}, 'Butuh persetujuanmu'));
    const d = el('dl', { class: 'info-grid' });
    for (const [k, v] of [['Aksi', action], ['Dampak', impact], ['Jalan mundur', rollback], ['Berlaku sampai', `${fmtTime(expiresAt)} WITA`]]) d.append(el('dt', {}, k), el('dd', {}, v));
    box.append(d);
    const yes = el('button', { type: 'button', class: 'btn primary' }, 'Setujui untuk tugas ini');
    const no = el('button', { type: 'button', class: 'btn' }, 'Tolak');
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

  /** One idempotency key per intended send: double clicks and retries reuse it. */
  private async send(payload: { text?: string; decision?: { turnId: string; optionId: string } }, btn: HTMLButtonElement) {
    if (this.sending || !this.conv) return;
    if (payload.text !== undefined && !payload.text.trim() && !this.staged.length) { toast('Pesan kosong.'); return; }
    if (this.recorder) { toast('Selesaikan rekaman dulu.'); return; }
    this.sending = true;
    btn.disabled = true;
    unlockAudio();
    this.pendingIdem ??= newIdem();
    try {
      const attachments = payload.text !== undefined ? this.staged.map((a) => a.id) : [];
      const r = await api.send(this.conv.id, { ...payload, idem: this.pendingIdem, ...(attachments.length ? { attachments } : {}) });
      this.pendingIdem = null;
      if (attachments.length) this.staged = [];
      if (payload.text !== undefined) { const t = document.getElementById('agent-manual-text') as HTMLTextAreaElement | null; if (t) t.value = ''; }
      this.conv = r.conversation;
      if (r.approval) toast('Pesan ditahan: butuh persetujuanmu dulu.', 4000);
      else toast(r.duplicate ? 'Sudah terkirim sebelumnya (tidak dikirim dua kali).' : 'Diterima server. Belum berarti selesai.', 3000);
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
