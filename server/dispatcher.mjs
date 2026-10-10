// M5 dispatcher (PRD 17.2): satu pekerjaan aktif per profil, sisanya antre.
// Pesan diteruskan ke profil Hermes lewat `hermes chat --oneshot` dengan
// HERMES_HOME profil itu, jadi jobdesk, alat dan izin profil tetap berlaku.
// Percakapan bersumber Telegram (channel='telegram') melanjutkan sesi Telegram
// DM bot itu (-r <id>); Hermes mengunci giliran per sesi (turn lease), jadi
// pesan Telegram dan RPG yang datang bersamaan antre, tidak saling timpa.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OPTION_INSTRUCTION, LIMITS, parseOptions, sanitizeReply } from './policy.mjs';
import { token } from './auth.mjs';

export const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'unknown', 'waiting_owner']);

/** Real runner: one non-interactive Hermes turn, parsed from stream-json. */
export function hermesRunner({ home = os.homedir(), bin = 'hermes', budgetSeconds = 1800 } = {}) {
  return ({ profile, message, hermesSession, onStart }) => new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kantor-rpg-'));
    const qf = path.join(dir, 'q.txt');
    fs.writeFileSync(qf, message, { mode: 0o600 });
    const hh = profile === 'default' ? path.join(home, '.hermes') : path.join(home, '.hermes', 'profiles', profile);
    const args = ['chat', '-Q', '--oneshot', '--query-file', qf, '--format', 'stream-json', '--source', 'rpg', '--run-budget', String(budgetSeconds)];
    if (hermesSession) args.push('-r', hermesSession);
    const child = spawn(bin, args, { env: { ...process.env, HERMES_HOME: hh }, cwd: home, stdio: ['ignore', 'pipe', 'pipe'] });
    onStart?.(child);
    let buf = ''; let result = null; let session = hermesSession ?? null; let errTail = '';
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try {
          const ev = JSON.parse(line);
          if (ev.session_id) session = ev.session_id;
          if (ev.type === 'result') result = ev;
        } catch { /* non-JSON footer */ }
      }
    });
    child.stderr.on('data', (d) => { errTail = (errTail + d).slice(-400); });
    const killer = setTimeout(() => child.kill('SIGTERM'), (budgetSeconds + 60) * 1000);
    child.on('close', (code, signal) => {
      clearTimeout(killer);
      fs.rmSync(dir, { recursive: true, force: true });
      if (result && String(result.exit_code) === '0') resolve({ ok: true, text: String(result.text ?? ''), session });
      else if (signal) resolve({ ok: false, unknown: true, error: `Proses agen dihentikan (${signal}); efek yang sudah terjadi tidak diketahui.`, session });
      else resolve({ ok: false, error: `Agen gagal (kode ${code}). ${errTail.replace(/\/Users\/\S+/g, '[berkas]').slice(-160)}`.trim(), session });
    });
  });
}

export function createDispatcher(store, { runner, now = () => Date.now(), onChange, onReply, sessionFor, prepare } = {}) {
  const q = store.q;
  const running = new Map(); // profile -> { taskId, child }

  const event = (taskId, status, note) => {
    const at = now();
    q('insert into events(task_id,status,note,at) values(?,?,?,?)').run(taskId, status, note ?? null, at);
    q('update tasks set status=?, observed_at=? where id=?').run(status, at, taskId);
    onChange?.(taskId, status);
  };

  // A restart loses the child process: whatever it was doing is unknown, not done.
  for (const t of q("select id from tasks where status='working'").all()) {
    event(t.id, 'unknown', 'Server dimulai ulang saat agen bekerja; hasil tidak diketahui. Periksa sebelum mengirim ulang.');
    store.audit('system', 'task.unknown_after_restart', null, t.id);
  }

  async function runNext(profile) {
    if (running.has(profile)) return;
    const t = q("select * from tasks where profile=? and status='queued' order by created_at limit 1").get(profile);
    if (!t) return;
    const conv = q('select * from conversations where id=?').get(t.conversation_id);
    running.set(profile, { taskId: t.id, child: null });
    event(t.id, 'working', 'Pesan diteruskan ke profil.');
    store.audit('system', 'task.dispatch', profile, t.id);
    let out;
    // Telegram-bound: resolve the bot's live DM session now, it may have rotated (/new, reset).
    const wanted = conv?.channel === 'telegram' ? (sessionFor?.(profile) ?? null) : (conv?.hermes_session ?? null);
    if (conv?.channel === 'telegram' && !wanted) {
      running.delete(profile);
      q('update tasks set error=? where id=?').run('Sesi Telegram bot ini tidak ditemukan.', t.id);
      event(t.id, 'failed', 'Sesi Telegram bot ini tidak ditemukan; pesan tidak dikirim.');
      void runNext(profile);
      return;
    }
    try {
      out = await runner({
        profile, hermesSession: wanted, message: (prepare ? await prepare(t) : t.message) + OPTION_INSTRUCTION,
        onStart: (child) => { const r = running.get(profile); if (r) r.child = child; },
      });
    } catch (e) {
      out = { ok: false, error: `Adapter gagal: ${String(e?.message ?? e).slice(0, 160)}` };
    }
    const cur = q('select status from tasks where id=?').get(t.id);
    running.delete(profile);
    if (out.session) q('update conversations set hermes_session=?, updated_at=? where id=?').run(out.session, now(), t.conversation_id);
    if (conv?.channel === 'telegram' && out.session && out.session !== wanted) {
      out = { ...out, note: 'Hermes membuka sesi lain, bukan sesi Telegram; balasan ini tidak tersambung ke Telegram.' };
    }
    if (cur?.status === 'cancelled') { void runNext(profile); return; }
    if (out.ok) {
      const parsed = parseOptions(out.text);
      const turnId = `turn_${token(9)}`;
      q('insert into turns(id,conversation_id,role,text,options,expires_at,task_id,created_at) values(?,?,?,?,?,?,?,?)').run(
        turnId, t.conversation_id, 'agent', sanitizeReply(parsed.body), parsed.options ? JSON.stringify(parsed.options) : null,
        parsed.options ? now() + LIMITS.turnMinutes * 60_000 : null, t.id, now());
      q('update tasks set result_turn=? where id=?').run(turnId, t.id);
      onReply?.({ profile, ownerText: t.message, agentText: sanitizeReply(parsed.body), channel: conv?.channel, taskId: t.id });
      if (parsed.invalid) event(t.id, 'completed', `Balasan diterima. ${parsed.invalid} Hanya input manual yang tersedia.`);
      else event(t.id, parsed.options ? 'waiting_owner' : 'completed', `${parsed.options ? 'Agen menunggu keputusan Budi.' : 'Balasan agen diterima.'}${out.note ? ` ${out.note}` : ''}`);
    } else {
      q('update tasks set error=? where id=?').run(out.error ?? 'gagal', t.id);
      event(t.id, out.unknown ? 'unknown' : 'failed', out.error);
    }
    store.audit('system', 'task.result', profile, t.id, q('select status from tasks where id=?').get(t.id).status);
    void runNext(profile);
  }

  return {
    running,
    /** Idempotent: the same key returns the existing task instead of a second one. */
    enqueue({ conversationId, profile, message, decisionId, idem, risks = [], uploads = [] }) {
      const dup = q('select * from tasks where idem=?').get(idem);
      if (dup) return { task: dup, duplicate: true };
      const queued = q("select count(*) n from tasks where profile=? and status in ('queued','working','blocked')").get(profile).n;
      if (queued >= LIMITS.queuePerProfile) return { error: `Antrean ${profile} penuh (${LIMITS.queuePerProfile}). Tunggu sampai ada yang selesai.` };
      const id = `task_${token(9)}`;
      const at = now();
      q('insert into tasks(id,conversation_id,profile,idem,message,decision_id,status,source,observed_at,created_at) values(?,?,?,?,?,?,?,?,?,?)').run(
        id, conversationId, profile, idem, message, decisionId ?? null, 'queued', `hermes:${profile}`, at, at);
      q('insert into turns(id,conversation_id,role,text,options,expires_at,task_id,created_at) values(?,?,?,?,?,?,?,?)').run(`turn_${token(9)}`, conversationId, 'owner', message, null, null, id, at);
      for (const u of uploads) q('update uploads set task_id=? where id=? and task_id is null').run(id, u);
      q('update conversations set updated_at=? where id=?').run(at, conversationId);
      let approval = null;
      if (risks.length) {
        // Risky text is parked: nothing reaches the agent until a separate,
        // task-bound, expiring approval (PRD 17.4, AC-CMD-03).
        approval = {
          id: `appr_${token(9)}`, action: risks.map((r) => r.label).join('; '),
          impact: `Pesan akan diteruskan ke ${profile} dan agen boleh mengerjakan aksi itu sesuai aturan lanenya.`,
          rollback: 'Sebelum disetujui: tolak, tidak ada yang dikirim. Sesudah: hentikan tugas; efek yang sudah terjadi perlu dibatalkan manual.',
        };
        q('insert into approvals(id,task_id,action,impact,rollback,status,created_at,expires_at) values(?,?,?,?,?,?,?,?)').run(
          approval.id, id, approval.action, approval.impact, approval.rollback, 'pending', at, at + LIMITS.approvalMinutes * 60_000);
        event(id, 'blocked', `Menunggu persetujuan terpisah: ${approval.action}.`);
      } else {
        event(id, 'queued', 'Diterima server, menunggu giliran profil.');
        void runNext(profile);
      }
      return { task: q('select * from tasks where id=?').get(id), duplicate: false, approval };
    },
    /** Approval is bound to one task, one action and an expiry; replays fail. */
    decide(approvalId, decision) {
      const a = q('select * from approvals where id=?').get(approvalId);
      if (!a) return { error: 'Persetujuan tidak ditemukan.' };
      if (a.status !== 'pending') return { error: 'Persetujuan ini sudah diputuskan.' };
      const t = q('select * from tasks where id=?').get(a.task_id);
      if (!t || t.status !== 'blocked') return { error: 'Tugas tidak lagi menunggu persetujuan.' };
      if (now() > a.expires_at) {
        q("update approvals set status='expired', decided_at=? where id=?").run(now(), a.id);
        event(t.id, 'cancelled', 'Persetujuan kedaluwarsa; pesan tidak dikirim.');
        return { error: 'Persetujuan kedaluwarsa. Kirim ulang pesannya kalau masih perlu.' };
      }
      if (decision !== 'approve') {
        q("update approvals set status='rejected', decided_at=? where id=?").run(now(), a.id);
        event(t.id, 'cancelled', 'Ditolak Budi; pesan tidak dikirim.');
        return { ok: true, status: 'cancelled' };
      }
      q("update approvals set status='approved', decided_at=? where id=?").run(now(), a.id);
      q('update tasks set message=? where id=?').run(`${t.message}\n\n[Persetujuan Budi dari panel RPG, hanya untuk tugas ini: ${a.action}. Tunjukkan rencana + perintah + jalan mundur sebelum eksekusi bila aturan lanemu mewajibkan.]`, t.id);
      event(t.id, 'queued', 'Disetujui Budi, menunggu giliran profil.');
      void runNext(t.profile);
      return { ok: true, status: 'queued' };
    },
    cancel(taskId) {
      const t = q('select * from tasks where id=?').get(taskId);
      if (!t || TERMINAL.has(t.status)) return { error: 'Tugas sudah selesai atau tidak ada.' };
      const r = running.get(t.profile);
      if (t.status === 'working' && r?.taskId === taskId) {
        r.child?.kill('SIGTERM');
        event(taskId, 'cancelled', 'Dihentikan Budi. Efek eksternal yang sudah terjadi tidak dibatalkan.');
      } else {
        q("update approvals set status='cancelled', decided_at=? where task_id=? and status='pending'").run(now(), taskId);
        event(taskId, 'cancelled', 'Dibatalkan sebelum dikirim ke agen.');
      }
      return { ok: true };
    },
    drain: async () => { while (running.size) await new Promise((r) => setTimeout(r, 20)); },
  };
}
