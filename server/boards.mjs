// M4: tiga papan kerja (PRD 18) dari sumber yang sama dengan kantor 3D:
// Kanban (SELECT lewat sqlite3 CLI; -readonly gagal pada DB WAL), berkas
// handoff di ~/Hermes/_Bersama, dan ekor agent.log per profil. Hanya
// ringkasan yang keluar: tanpa argumen perintah, path rumah, token atau isi
// obrolan. Profil pribadi hanya tampil sebagai "Tugas pribadi".
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROSTER, PRIVATE_PROFILES, byProfile } from './roster.mjs';

const TAIL_BYTES = 512 * 1024;
const DONE_WINDOW_S = 7 * 86400;
const LOG_WINDOW_MS = 24 * 3600_000;
export const QUOTA = { taskEvents: 50, toolEvents: 110 };
export const STALE_HANDOFF_HOURS = 24;

const VERB = {
  terminal: 'Menjalankan perintah', process_manage: 'Mengelola proses', execute_code: 'Menjalankan skrip',
  read_file: 'Membaca berkas', search_files: 'Mencari di berkas', write_file: 'Menulis berkas', patch: 'Mengubah berkas',
  web_search: 'Riset web', web_extract: 'Membaca halaman web', browser_exec: 'Memakai browser', delegate_task: 'Mendelegasikan tugas',
  vision_analyze: 'Melihat gambar', skill_view: 'Memuat skill', skill_manage: 'Memperbarui skill', clarify: 'Bertanya ke Budi',
  context_notes: 'Mencatat memori', text_to_speech: 'Membuat suara', tool_call: 'Memakai alat tambahan', tool_search: 'Mencari alat',
  kanban_complete: 'Menutup tugas Kanban', kanban_create: 'Membuat tugas Kanban',
};
const TASK_VERB = { created: 'Membuat tugas', claimed: 'Mengambil tugas', completed: 'Menyelesaikan tugas', blocked: 'Tugas diblokir', gave_up: 'Menyerah pada tugas', crashed: 'Tugas gagal' };
const HANDOFF_STATUS = { todo: 'Dikirim', ready: 'Dikirim', triage: 'Dikirim', scheduled: 'Dikirim', running: 'Dikerjakan', claimed: 'Diterima', blocked: 'Diblokir', done: 'Selesai', archived: 'Dibatalkan' };
const TASK_ORDER = { blocked: 0, running: 1, claimed: 1, todo: 2, ready: 2, triage: 2, scheduled: 2, done: 3, archived: 4 };

export const clip = (s, n) => {
  const a = Array.from(String(s ?? '').replace(/\s+/g, ' ').trim());
  return a.length > n ? `${a.slice(0, n - 1).join('')}…` : a.join('');
};

/** Removes things that must never reach a board: home paths, URLs, tokens, IPs. */
export function scrub(s) {
  return String(s ?? '')
    .replace(/(?:~|\/Users\/[^/\s]+|\/home\/[^/\s]+|\/Volumes\/[^\s]+)\/[^\s)'"`]*/g, '[berkas]')
    .replace(/https?:\/\/\S+/g, '[tautan]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g, '[rahasia]')
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[ip]');
}

const lane = (profile) => ROSTER.find((r) => r.profile === profile)?.name ?? profile ?? '?';

export function makeSources(home) {
  const H = path.join(home, '.hermes');
  return {
    kanbanDb: path.join(H, 'kanban.db'),
    bersama: path.join(home, 'Hermes', '_Bersama'),
    ompDir: path.join(home, '.omp', 'agent', 'sessions'),
    logFile: (p) => (p === 'default' ? path.join(H, 'logs', 'agent.log') : path.join(H, 'profiles', p, 'logs', 'agent.log')),
  };
}

function sql(db, query) {
  const out = execFileSync('sqlite3', ['-json', db, query], { timeout: 4000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return out.trim() ? JSON.parse(out) : [];
}

/** Handoff file fields from the template: Badan, Dari, Untuk, Yang diminta. */
export function readHandoffFile(file) {
  const txt = fs.readFileSync(file, 'utf8').slice(0, 20000);
  const section = (name) => {
    const m = new RegExp(`^##\\s*${name}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`, 'mi').exec(txt);
    return m ? m[1].trim() : '';
  };
  const title = (/^#\s*(?:HANDOFF[:\s—-]*)?(.+)$/m.exec(txt)?.[1] ?? '').trim();
  const badan = (/\b(ISP|ENT|LABS|PRIBADI)\b/.exec(section('Badan'))?.[1]) ?? 'Belum tercatat';
  return { title, badan, diminta: section('Yang diminta') };
}

function handoffPath(body, bersama) {
  const m = /Baca berkas handoff LENGKAP dulu:\s*(\S+\.md)/.exec(body ?? '');
  if (!m) return null;
  const p = path.resolve(m[1].replace(/^~/, path.dirname(path.dirname(bersama))));
  return p.startsWith(bersama + path.sep) ? p : null;
}

function tailTools(file, sinceMs) {
  let st;
  try { st = fs.statSync(file); } catch { return []; }
  const start = Math.max(0, st.size - TAIL_BYTES);
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(st.size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  const out = [];
  for (const line of buf.toString('utf8').split('\n')) {
    const m = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d),\d{3} \w+ \[[^\]]+\] agent\.tool_executor: tool (\S+) (completed|failed)/.exec(line);
    if (!m) continue;
    const at = Date.parse(`${m[1]}T${m[2]}+08:00`);
    if (at >= sinceMs) out.push({ at, tool: m[3], ok: m[4] === 'completed' });
  }
  return out;
}

export const PRESENCE_ACTIVE_MS = 5 * 60_000;

/**
 * What each roster agent is really doing right now, for the NPCs. Order of
 * evidence: an RPG task in flight, a running Kanban task, tool calls in the
 * profile's agent.log in the last 5 minutes. No evidence = idle.
 * `rpg` is [{profile, status, message}] from the dispatcher.
 */
export function buildPresence(src, rpg = [], now = Date.now()) {
  let kanban = null;
  try {
    kanban = sql(src.kanbanDb, "select assignee,status,title from tasks where status in ('running','claimed','blocked') order by created_at desc limit 200");
  } catch { kanban = null; }
  const since = now - PRESENCE_ACTIVE_MS;
  return ROSTER.map((r) => {
    const base = { profile: r.profile, name: r.name, actorId: r.actorId };
    const mine = rpg.filter((t) => t.profile === r.profile);
    const w = mine.find((t) => t.status === 'working' || t.status === 'queued');
    if (w) return { ...base, status: 'working', source: 'perintah dari RPG', summary: clip(scrub(w.message), 70) };
    if (mine.some((t) => t.status === 'waiting_owner')) return { ...base, status: 'waiting', source: 'perintah dari RPG', summary: 'Menunggu persetujuanmu' };
    const k = kanban?.filter((t) => t.assignee === r.profile) ?? [];
    const run = k.find((t) => t.status === 'running' || t.status === 'claimed');
    if (run) return { ...base, status: 'working', source: 'Kanban', summary: clip(scrub(run.title), 70) };
    const tools = tailTools(src.logFile(r.profile), since);
    if (tools.length) return { ...base, status: 'working', source: 'agent.log', summary: `Aktif di Hermes (${tools.length} langkah, 5 menit terakhir)` };
    if (kanban === null) return { ...base, status: 'unknown', source: 'Kanban tidak terbaca', summary: '' };
    return { ...base, status: 'idle', source: 'Kanban + agent.log', summary: k.length ? `${k.length} tugas diblokir` : '' };
  });
}

/**
 * Builds the three boards. Each board carries its own source/observedAt and
 * an `ok` flag; a source that fails yields ok=false, never an empty success.
 */
export function buildBoards(src, now = Date.now()) {
  const nowS = Math.floor(now / 1000);
  const boards = { observedAt: new Date(now).toISOString(), mode: 'private', handoffs: null, tasks: null, log: null };

  let tasks = null; let events = null; let kanbanErr = null;
  try {
    tasks = sql(src.kanbanDb, `select id,title,body,assignee,created_by,status,created_at,started_at,completed_at from tasks where status not in ('done','archived') or coalesce(completed_at,created_at) > ${nowS - DONE_WINDOW_S} order by created_at desc limit 400`);
    events = sql(src.kanbanDb, `select e.id,e.kind,e.created_at,t.id as task,t.title,t.assignee,t.created_by from task_events e join tasks t on t.id=e.task_id where e.created_at > ${Math.floor((now - LOG_WINDOW_MS) / 1000)} and e.kind in ('created','claimed','completed','blocked','gave_up','crashed') order by e.id desc limit ${QUOTA.taskEvents}`);
  } catch (e) { kanbanErr = clip(scrub(e.message), 120); }

  const priv = (p) => PRIVATE_PROFILES.has(p);
  const handoffBadan = new Map();
  const badanOf = (t) => handoffBadan.get(t.id) ?? (priv(t.assignee) ? 'PRIBADI' : (byProfile(t.assignee)?.badan ?? 'Belum tercatat'));
  if (tasks) {
    const hand = tasks.filter((t) => /^HANDOFF\b/.test(t.title));
    boards.handoffs = { ok: true, source: 'Kanban HANDOFF + berkas _Bersama', items: hand.map((t) => {
      let file = null;
      const hp = handoffPath(t.body, src.bersama);
      if (hp) { try { file = readHandoffFile(hp); } catch { file = null; } }
      const project = /^HANDOFF\s+([^:]+):/.exec(t.title)?.[1] ?? '-';
      const status = HANDOFF_STATUS[t.status] ?? 'Belum tercatat';
      const ageH = (nowS - t.created_at) / 3600;
      const attention = status === 'Diblokir' || (status === 'Dikirim' && ageH > STALE_HANDOFF_HOURS);
      if (file?.badan) handoffBadan.set(t.id, file.badan);
      return {
        id: t.id, project: clip(scrub(project), 60), badan: file?.badan ?? 'Belum tercatat',
        from: lane(t.created_by), to: lane(t.assignee),
        summary: priv(t.assignee) || priv(t.created_by) ? 'Tugas pribadi' : clip(scrub(t.title.replace(/^HANDOFF\s+[^:]+:\s*/, '')), 90),
        diminta: file && !priv(t.assignee) ? clip(scrub(file.diminta), 160) : '',
        hasFile: !!file, status, createdAt: t.created_at * 1000, ageHours: Math.round(ageH * 10) / 10, attention,
      };
    }) };
    // Work chain per project (e.g. Hugo -> Nova -> Clara), oldest first.
    const byProject = new Map();
    for (const h of [...boards.handoffs.items].sort((a, b) => a.createdAt - b.createdAt)) {
      if (!byProject.has(h.project)) byProject.set(h.project, []);
      byProject.get(h.project).push(h);
    }
    for (const h of boards.handoffs.items) {
      const steps = byProject.get(h.project);
      const chain = [steps[0].from, ...steps.map((x) => x.to)];
      h.chain = chain.filter((n, i) => n !== chain[i - 1]);
      h.chainActive = steps.findIndex((x) => x.id === h.id) + 1;
    }
    boards.tasks = { ok: true, source: 'Kanban tasks', items: tasks
      .filter((t) => t.status !== 'archived')
      .map((t) => ({
        id: t.id, title: priv(t.assignee) ? 'Tugas pribadi' : clip(scrub(t.title), 56), owner: lane(t.assignee), ownerProfile: t.assignee,
        requester: lane(t.created_by), status: t.status, createdAt: t.created_at * 1000, ageHours: Math.round(((nowS - t.created_at) / 3600) * 10) / 10,
        handoff: /^HANDOFF\b/.test(t.title), badan: badanOf(t),
      }))
      .concat(src.ompDir ? ompDrops(src.ompDir, now).items : [])
      .sort((a, b) => (TASK_ORDER[a.status] ?? 5) - (TASK_ORDER[b.status] ?? 5) || b.createdAt - a.createdAt) };
  } else {
    const fail = { ok: false, source: 'Kanban', error: kanbanErr ?? 'tidak terbaca', items: [] };
    boards.handoffs = fail; boards.tasks = fail;
  }

  const rows = [];
  for (const e of events ?? []) {
    rows.push({ at: e.created_at * 1000, kind: 'task', bot: lane(e.assignee), verb: TASK_VERB[e.kind] ?? e.kind, object: priv(e.assignee) ? 'Tugas pribadi' : clip(scrub(e.title), 56), taskId: e.task });
  }
  let toolCount = 0;
  const toolRows = [];
  for (const r of ROSTER) {
    for (const t of tailTools(src.logFile(r.profile), now - LOG_WINDOW_MS)) {
      toolRows.push({ at: t.at, kind: 'tool', bot: r.name, verb: priv(r.profile) ? 'Sedang bekerja' : (VERB[t.tool] ?? 'Memakai alat'), object: t.ok ? '' : 'gagal', taskId: null });
    }
  }
  toolRows.sort((a, b) => b.at - a.at);
  for (const t of toolRows) { if (toolCount++ >= QUOTA.toolEvents) break; rows.push(t); }
  rows.sort((a, b) => b.at - a.at);
  boards.log = { ok: events !== null, source: 'Kanban task_events + agent.log', error: events === null ? kanbanErr : undefined, items: rows };
  return boards;
}

const OMP_ROLES = ['SUN', 'MOON', 'MARS', 'JUPITER', 'NEPTUNE', 'SATURN', 'VENUS', 'MERCURY'];
const OMP_RE = new RegExp(`(?:PERAN\\s*:\\s*|Kamu\\s+(?:adalah\\s+)?|^#\\s*)(${OMP_ROLES.join('|')})\\b`, 'm');
const OMP_ACTIVE_MS = 30 * 60_000;
const ompMemo = new Map();

/**
 * omp drops that are still running: sessions touched in the last 30 minutes
 * without a session_exit. Only the role and the repo folder name are kept.
 */
export function ompDrops(dir, now = Date.now()) {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(dir); } catch { return { ok: false, items: out }; }
  for (const d of dirs) {
    let files = [];
    try { files = fs.readdirSync(path.join(dir, d)).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const file = path.join(dir, d, f);
      let st; try { st = fs.statSync(file); } catch { continue; }
      if (now - st.mtimeMs > OMP_ACTIVE_MS) continue;
      const m = ompMemo.get(file);
      let info = m && m.size === st.size ? m.info : undefined;
      if (info === undefined) {
        info = null;
        try {
          const txt = fs.readFileSync(file, 'utf8');
          const role = OMP_RE.exec(txt.slice(0, 40000))?.[1];
          if (role && !txt.includes('"session_exit"')) {
            const first = txt.slice(0, txt.indexOf('\n'));
            let cwd = ''; let started = st.birthtimeMs;
            try { const r = JSON.parse(first); cwd = String(r.cwd ?? ''); started = Date.parse(r.timestamp) || started; } catch { /* header optional */ }
            info = { role, repo: path.basename(cwd) || '-', started };
          }
        } catch { info = null; }
        ompMemo.set(file, { size: st.size, info });
      }
      if (info) out.push({ id: `omp-${f.slice(0, 12)}`, title: `Drop omp ${info.role} di ${clip(scrub(info.repo), 30)}`, owner: info.role, ownerProfile: 'omp', requester: 'Max', status: 'running', badan: 'ISP', createdAt: info.started, ageHours: Math.round(((now - info.started) / 3600_000) * 10) / 10, handoff: false });
    }
  }
  return { ok: true, items: out };
}

/** Snapshot shared by every viewer; sources are read at most once per TTL. */
export function boardCache(src, ttlMs = 5000) {
  let memo = { at: 0, data: null };
  return (now = Date.now()) => {
    if (!memo.data || now - memo.at >= ttlMs) memo = { at: now, data: buildBoards(src, now) };
    return memo.data;
  };
}
