// Backend privat kantor-rpg (PRD 17 M5 + 18 M4). Jalan di Mac mini (tempat
// profil Hermes), di belakang nginx employee-rpg yang meneruskan /api/.
// Fail-closed: tanpa owner.json, tanpa sesi, tanpa CSRF, atau dari luar
// proxy -> ditolak. Browser tidak pernah memegang token Hermes/model.
import { gzipSync } from 'node:zlib';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore, RETENTION } from './store.mjs';
import { loadOwner, verifyPassword, verifyTotp, hashPassword, base32Encode, token } from './auth.mjs';
import { boardCache, buildPresence, makeSources } from './boards.mjs';
import { agentReplyTimes, lastChatLine, ownerChatId, postToTelegram, telegramSession, telegramTranscript } from './telegram.mjs';
import { ROSTER, byProfile } from './roster.mjs';
import { checkMessage, LIMITS } from './policy.mjs';
import { createDispatcher, hermesRunner, TERMINAL } from './dispatcher.mjs';
import { setupPage } from './setup-page.mjs';
import { chatState, TYPING_WINDOW_MS } from './chat-state.mjs';
import { createMedia, MEDIA_LIMITS } from './media.mjs';
import { createPush, validSubscription } from './push.mjs';
import { searchTelegram } from './telegram.mjs';

const MAX_BODY = 16 * 1024;
const LOGIN_MAX = 5;

export function createServer(cfg) {
  const dataDir = cfg.dataDir;
  const ownerFile = path.join(dataDir, 'owner.json');
  const setupFile = path.join(dataDir, 'setup.json');
  const store = cfg.store ?? openStore(dataDir);
  const now = cfg.now ?? (() => Date.now());
  const media = createMedia({ dataDir, home: cfg.home ?? os.homedir(), secret: cfg.proxySecret || 'dev', q: store.q, now, transcriber: cfg.transcriber });
  const push = cfg.push ?? createPush({ dataDir, q: store.q, now, fetchImpl: cfg.pushFetch });
  const sources = makeSources(cfg.home ?? os.homedir());
  const boards = cfg.boards ?? boardCache(sources, cfg.boardTtlMs ?? 5000);
  let presenceMemo = { at: 0, value: null };
  const home = cfg.home ?? os.homedir();
  // Telegram sync (ADR-017). Tests inject `telegram` to avoid real state.db/Bot API.
  const tg = {
    chatId: () => ownerChatId(home),
    session: (profile) => telegramSession(home, profile, ownerChatId(home)),
    transcript: (profile, sessionId) => telegramTranscript(home, profile, sessionId),
    replyTimes: (profile, sessionId) => agentReplyTimes(home, profile, sessionId),
    lastLine: (profile, sessionId) => lastChatLine(home, profile, sessionId),
    post: (profile, text) => postToTelegram(home, profile, ownerChatId(home), text),
    search: (profile, sessionId, term) => searchTelegram(home, profile, sessionId, term),
    ...cfg.telegram,
  };
  const tgSession = (profile) => { try { return tg.session(profile); } catch { return null; } };
  const dispatcher = createDispatcher(store, {
    runner: cfg.runner ?? hermesRunner({ home }), now, sessionFor: tgSession,
    // A task changing state must show at once (typing on/off), not after the 4 s presence cache.
    onChange: () => { presenceMemo.at = 0; },
    // Attachments reach the agent as local paths (voice waits for its transcript), like Telegram's gateway.
    prepare: async (task) => {
      const rows = q('select * from uploads where task_id=? order by created_at, rowid').all(task.id);
      return rows.length ? `${task.message}\n\n${await media.agentText(rows)}` : task.message;
    },
    // The RPG exchange also shows up in the bot's Telegram chat (sent by the bot, labelled).
    onReply: ({ profile, ownerText, agentText, channel, taskId }) => {
      const name = byProfile(profile)?.name ?? profile;
      const n = taskId ? media.forTask(taskId).length : 0;
      const said = [ownerText, n ? `📎 ${n} lampiran (lihat di kantor RPG)` : ''].filter(Boolean).join('\n');
      const reply = media.fromTranscript(agentText).text;
      void Promise.resolve(push.notify(profile, { title: name, body: reply.replace(/\s+/g, ' ').slice(0, 120) || 'Balasan baru', tag: `chat-${profile}`, url: `./?chat=${encodeURIComponent(profile)}` })).catch(() => {});
      if (channel !== 'telegram') return;
      void Promise.resolve(tg.post(profile, `🎮 Dari kantor RPG\nBudi: ${said}\n\n${name}: ${reply}`))
        .then((r) => { if (!r?.ok) store.audit('system', 'telegram.post_failed', profile, null, r?.error ?? 'gagal'); })
        .catch(() => store.audit('system', 'telegram.post_failed', profile, null, 'error'));
    },
  });
  const q = store.q;
  const purgeTimer = setInterval(() => { store.purge(now()); media.purge(now() - RETENTION.messagesDays * 86400_000); }, 3600_000);
  purgeTimer.unref?.();

  const owner = () => { try { return loadOwner(ownerFile); } catch { return null; } };

  function send(res, code, body, headers = {}) {
    let data = typeof body === 'string' ? body : JSON.stringify(body);
    // Board snapshots are ~70 KB of JSON; gzip here so the size does not
    // depend on nginx gzip_proxied settings.
    if (data.length > 4096 && /\bgzip\b/.test(String(res.req?.headers['accept-encoding'] ?? ''))) {
      data = gzipSync(data);
      headers = { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' };
    }
    res.writeHead(code, {
      'Content-Type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      // HTML here is only the setup form; with no-referrer Chrome posts it
      // with `Origin: null`, which the origin check rightly rejects.
      'Referrer-Policy': typeof body === 'string' ? 'same-origin' : 'no-referrer',
      'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex, nofollow', ...headers,
    });
    res.end(data);
  }
  const fail = (res, code, message) => send(res, code, { error: message });

  function cookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie ?? '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }
  const sessionHash = (id) => crypto.createHash('sha256').update(id).digest('hex');
  function session(req) {
    const id = cookies(req).kr_sess;
    if (!id || id.length > 100) return null;
    const s = q('select * from sessions where id=?').get(sessionHash(id));
    if (!s || s.expires_at < now()) return null;
    return s;
  }
  const cookie = (value, maxAge) => `kr_sess=${value}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${cfg.cookieSecure === false ? '' : '; Secure'}`;

  function clientIp(req) {
    return (cfg.proxySecret && req.headers['x-real-ip']) ? String(req.headers['x-real-ip']) : (req.socket.remoteAddress ?? '?');
  }

  async function readJson(req) {
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > MAX_BODY) throw Object.assign(new Error('Body terlalu besar.'), { code: 413 }); chunks.push(c); }
    if (!chunks.length) return {};
    try {
      const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
      return v;
    } catch { throw Object.assign(new Error('JSON tidak sah.'), { code: 400 }); }
  }

  /** Telegram transcript of the profile, or null (no session / unreadable). */
  function tgTranscript(profile) {
    const sid = tgSession(profile);
    if (!sid) return null;
    try { return { sessionId: sid, turns: tg.transcript(profile, sid) }; } catch { return null; }
  }

  /**
   * Telegram-bound view: the turns ARE the Telegram DM transcript. RPG owner
   * messages not yet picked up by Hermes are shown as pending; the 3 options
   * of the latest RPG reply stay valid only while that reply is still the
   * newest agent message in the chat (a later Telegram reply expires them).
   */
  function telegramTurns(conv, rpgTurns, tasks) {
    const tr = tgTranscript(conv.profile);
    if (!tr) return null;
    const turns = tr.turns.map((t) => {
      const m = media.fromTranscript(t.text);
      return { id: t.id, role: t.role, via: t.via, text: m.text, attachments: m.attachments, taskId: null, at: t.at, options: null, optionsExpired: false, expiresAt: null };
    });
    const lastRpgAgent = [...rpgTurns].reverse().find((t) => t.role === 'agent');
    const lastTgAgent = [...turns].reverse().find((t) => t.role === 'agent');
    if (lastRpgAgent?.options && lastTgAgent && lastRpgAgent.expires_at > now() && Math.abs(lastTgAgent.at - lastRpgAgent.created_at) < 120_000) {
      Object.assign(lastTgAgent, { id: lastRpgAgent.id, taskId: lastRpgAgent.task_id, options: JSON.parse(lastRpgAgent.options), expiresAt: lastRpgAgent.expires_at });
    }
    const status = new Map(tasks.map((t) => [t.id, t.status]));
    for (const t of rpgTurns) {
      if (t.role !== 'owner' || !['queued', 'working'].includes(status.get(t.task_id))) continue;
      const seen = turns.some((x) => x.via === 'rpg' && x.at >= t.created_at - 5000 && x.text.trim() === t.text.trim());
      if (!seen) turns.push({ id: t.id, role: 'owner', via: 'rpg', pending: true, text: t.text, attachments: media.forTask(t.task_id), taskId: t.task_id, at: t.created_at, options: null, optionsExpired: false, expiresAt: null });
    }
    return { sessionId: tr.sessionId, turns };
  }

  /** Options of an RPG turn are still the live ones (Telegram-bound check included). */
  function optionsLive(conv, turn) {
    if (conv.channel !== 'telegram') return true;
    const tr = tgTranscript(conv.profile);
    const lastTgAgent = tr && [...tr.turns].reverse().find((t) => t.role === 'agent');
    return !!lastTgAgent && Math.abs(lastTgAgent.at - turn.created_at) < 120_000;
  }

  function conversationView(convId, after = 0) {
    const conv = q('select * from conversations where id=?').get(convId);
    if (!conv) return null;
    const turns = q('select id,role,text,options,expires_at,task_id,created_at from turns where conversation_id=? order by created_at, rowid').all(convId);
    const lastAgent = [...turns].reverse().find((t) => t.role === 'agent');
    const tasks = q('select id,status,source,observed_at,created_at,error,decision_id from tasks where conversation_id=? order by created_at').all(convId);
    const ids = tasks.map((t) => t.id);
    const events = ids.length ? q(`select seq,task_id,status,note,at from events where task_id in (${ids.map(() => '?').join(',')}) and seq > ? order by seq`).all(...ids, after) : [];
    const approvals = ids.length ? q(`select id,task_id,action,impact,rollback,status,expires_at from approvals where task_id in (${ids.map(() => '?').join(',')})`).all(...ids) : [];
    const r = byProfile(conv.profile);
    const tgView = conv.channel === 'telegram' ? telegramTurns(conv, turns, tasks) : null;
    const baseTurns = tgView ? tgView.turns : turns.map((t) => ({
      id: t.id, role: t.role, text: t.text, taskId: t.task_id, at: t.created_at,
      attachments: t.role === 'owner' && t.task_id ? media.forTask(t.task_id) : [],
      options: t.options && t.id === lastAgent?.id && t.expires_at > now() ? JSON.parse(t.options) : null,
      optionsExpired: !!(t.options && (t.id !== lastAgent?.id || t.expires_at <= now())),
      expiresAt: t.expires_at,
    }));
    const chat = chatState(baseTurns, tasks, now());
    return {
      id: conv.id, profile: conv.profile, agent: r?.name, lane: r?.lane,
      channel: conv.channel === 'telegram' ? (tgView ? 'telegram' : 'telegram-unavailable') : 'rpg',
      turns: chat.turns, typing: chat.typing, lastSeen: chat.lastSeen,
      tasks: tasks.map((t) => ({ ...t, terminal: TERMINAL.has(t.status) })),
      events, approvals, cursor: events.length ? events[events.length - 1].seq : after,
    };
  }

  const routes = [];
  const route = (method, re, opts, fn) => routes.push({ method, re, opts, fn });

  route('GET', /^\/api\/me$/, { auth: false }, (req, res) => {
    const s = session(req);
    send(res, 200, { mode: 'private', configured: !!owner(), authenticated: !!s, csrf: s?.csrf ?? null, retention: RETENTION, limits: LIMITS });
  });

  route('POST', /^\/api\/login$/, { auth: false, csrf: false }, async (req, res) => {
    const b = await readJson(req);
    const o = owner();
    if (!o) return fail(res, 503, 'Akun owner belum dibuat. Buka tautan setup yang dikirim ke Telegram Budi.');
    const key = `${clientIp(req)}|${String(b.username ?? '').slice(0, 40)}`;
    const recent = q('select count(*) n from login_attempts where key=? and at > ?').get(key, now() - RETENTION.loginWindowMin * 60_000).n;
    if (recent >= LOGIN_MAX) { store.audit('anon', 'login.locked', null, null, key.split('|')[0]); return fail(res, 429, `Terlalu banyak percobaan. Coba lagi ${RETENTION.loginWindowMin} menit lagi.`); }
    const userOk = typeof b.username === 'string' && b.username.length < 60 && crypto.timingSafeEqual(Buffer.from(crypto.createHash('sha256').update(b.username).digest()), Buffer.from(crypto.createHash('sha256').update(o.username).digest()));
    const pwOk = verifyPassword(String(b.password ?? '').slice(0, 200), o.passwordHash);
    const codeOk = verifyTotp(o.totpSecret, b.code, now());
    const usedKey = `${o.username}|${b.code}`;
    const reused = q('select count(*) n from audit where kind=? and detail=? and at > ?').get('login.ok', crypto.createHash('sha256').update(usedKey).digest('hex').slice(0, 16), now() - 120_000).n > 0;
    if (!(userOk && pwOk && codeOk) || reused) {
      q('insert into login_attempts(key,at) values(?,?)').run(key, now());
      store.audit('anon', 'login.fail', null, null, reused ? 'otp dipakai ulang' : '');
      return fail(res, 401, 'Nama, sandi, atau kode 2FA salah.');
    }
    const sid = token(32);
    const csrf = token(18);
    q('insert into sessions(id,csrf,created_at,expires_at,ua) values(?,?,?,?,?)').run(sessionHash(sid), csrf, now(), now() + RETENTION.sessionHours * 3600_000, String(req.headers['user-agent'] ?? '').slice(0, 120));
    q('delete from login_attempts where key=?').run(key);
    store.audit('owner', 'login.ok', null, null, crypto.createHash('sha256').update(usedKey).digest('hex').slice(0, 16));
    send(res, 200, { ok: true, csrf }, { 'Set-Cookie': cookie(sid, RETENTION.sessionHours * 3600) });
  });

  route('POST', /^\/api\/logout$/, {}, (req, res, s) => {
    q('delete from sessions where id=?').run(s.id);
    store.audit('owner', 'logout');
    send(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
  });

  route('GET', /^\/api\/boards$/, {}, (req, res) => send(res, 200, boards(now())));

  route('GET', /^\/api\/agents$/, {}, (req, res) => {
    const active = q("select profile, status, count(*) n from tasks where status in ('queued','working','blocked','waiting_owner') group by profile, status").all();
    send(res, 200, { agents: ROSTER.map((r) => ({ ...r, tasks: Object.fromEntries(active.filter((a) => a.profile === r.profile).map((a) => [a.status, a.n])) })) });
  });

  // Real per-agent status for the NPCs (owner only). Cached 4 s: polled every 10 s.
  route('GET', /^\/api\/presence$/, {}, (req, res) => {
    const t = now();
    if (!presenceMemo.value || t - presenceMemo.at > 4000) {
      const rpg = q("select profile, status, message from tasks where status in ('queued','working','waiting_owner') order by created_at desc").all();
      const agents = buildPresence(sources, rpg, t).map((a) => {
        // Agent reply times (Telegram DM, or RPG chat for bots without one) for unread badges.
        let replies = [];
        const sid = tgSession(a.profile);
        let line = null;
        if (sid) { try { replies = tg.replyTimes(a.profile, sid); line = tg.lastLine?.(a.profile, sid) ?? null; } catch { replies = []; } }
        else replies = q("select t.created_at at from turns t join conversations c on c.id=t.conversation_id where c.profile=? and t.role='agent' order by t.created_at desc limit 50").all(a.profile).map((r) => r.at).reverse();
        // Typing like Telegram: the bot is on an RPG task, or Budi's last Telegram line is still unanswered.
        const rpgWorking = rpg.some((x) => x.profile === a.profile && x.status === 'working');
        const typing = rpgWorking || (line?.role === 'owner' && t - line.at < TYPING_WINDOW_MS);
        return { ...a, replies, typing, lastSeen: replies.length ? replies[replies.length - 1] : null };
      });
      presenceMemo = { at: t, value: { observedAt: new Date(t).toISOString(), agents } };
    }
    send(res, 200, presenceMemo.value);
  });

  route('POST', /^\/api\/conversations$/, {}, async (req, res) => {
    const b = await readJson(req);
    const r = byProfile(b.profile);
    if (!r) return fail(res, 404, 'Profil tidak ada di roster RPG.');
    // A bot with a Telegram DM session gets the Telegram-bound conversation (ADR-017).
    const channel = tgSession(r.profile) ? 'telegram' : 'rpg';
    let conv = b.fresh ? null : q('select * from conversations where profile=? and channel=? order by updated_at desc limit 1').get(r.profile, channel);
    if (!conv) {
      const id = `conv_${token(9)}`;
      q('insert into conversations(id,profile,hermes_session,created_at,updated_at,channel) values(?,?,?,?,?,?)').run(id, r.profile, null, now(), now(), channel);
      store.audit('owner', 'conversation.create', r.profile, id, channel);
      conv = { id };
    }
    send(res, 200, conversationView(conv.id));
  });

  route('GET', /^\/api\/conversations\/(conv_[\w-]{6,20})$/, {}, (req, res, s, m, url) => {
    const after = Number(url.searchParams.get('after') ?? 0) || 0;
    const v = conversationView(m[1], after);
    if (!v) return fail(res, 404, 'Percakapan tidak ditemukan.');
    send(res, 200, v);
  });

  route('POST', /^\/api\/conversations\/(conv_[\w-]{6,20})\/messages$/, {}, async (req, res, s, m) => {
    const b = await readJson(req);
    const conv = q('select * from conversations where id=?').get(m[1]);
    if (!conv) return fail(res, 404, 'Percakapan tidak ditemukan.');
    if (typeof b.idem !== 'string' || !/^[\w-]{8,64}$/.test(b.idem)) return fail(res, 400, 'Idempotency key wajib.');
    const dup = q('select id,conversation_id from tasks where idem=?').get(b.idem);
    if (dup) {
      if (dup.conversation_id !== conv.id) return fail(res, 409, 'Idempotency key dipakai percakapan lain.');
      return send(res, 200, { taskId: dup.id, duplicate: true, conversation: conversationView(conv.id) });
    }
    let text; let decisionId = null;
    if (b.decision) {
      const turn = q("select * from turns where id=? and conversation_id=? and role='agent'").get(String(b.decision.turnId ?? ''), conv.id);
      const latest = q("select id from turns where conversation_id=? and role='agent' order by created_at desc, rowid desc limit 1").get(conv.id);
      if (!turn || !turn.options) return fail(res, 400, 'Pilihan tidak berasal dari giliran agen ini.');
      if (turn.id !== latest?.id || turn.expires_at <= now() || !optionsLive(conv, turn)) return fail(res, 410, 'Pilihan ini sudah kedaluwarsa. Pilih dari giliran terbaru atau ketik manual.');
      const opt = JSON.parse(turn.options).find((o) => o.id === b.decision.optionId);
      if (!opt) return fail(res, 400, 'Pilihan tidak dikenal.');
      text = opt.message; decisionId = `${turn.id}:${opt.id}`;
    } else text = typeof b.text === 'string' ? b.text : '';
    const claimed = media.claim(conv.id, b.attachments ?? []);
    if (claimed.error) return fail(res, 400, claimed.error);
    if (!text.trim() && claimed.rows.length) text = claimed.rows.some((r) => r.kind === 'voice') ? '🎤 Pesan suara' : `📎 ${claimed.rows.length} lampiran`;
    const check = checkMessage(text);
    if (!check.ok) { store.audit('owner', 'message.rejected', conv.profile, conv.id, check.reason); return fail(res, 422, check.reason); }
    const out = dispatcher.enqueue({ conversationId: conv.id, profile: conv.profile, message: text, decisionId, idem: b.idem, risks: check.risks, uploads: claimed.rows.map((r) => r.id) });
    if (out.error) return fail(res, 429, out.error);
    store.audit('owner', decisionId ? 'message.option' : 'message.manual', conv.profile, out.task.id, decisionId);
    send(res, 202, { taskId: out.task.id, duplicate: out.duplicate, approval: out.approval, conversation: conversationView(conv.id) });
  });

  route('POST', /^\/api\/approvals\/(appr_[\w-]{6,20})$/, {}, async (req, res, s, m) => {
    const b = await readJson(req);
    if (b.decision !== 'approve' && b.decision !== 'reject') return fail(res, 400, 'Keputusan harus approve atau reject.');
    const a = q('select a.*, t.conversation_id from approvals a join tasks t on t.id=a.task_id where a.id=?').get(m[1]);
    if (!a || (b.taskId && b.taskId !== a.task_id)) return fail(res, 404, 'Persetujuan tidak ditemukan untuk tugas ini.');
    const out = dispatcher.decide(m[1], b.decision);
    store.audit('owner', `approval.${b.decision}`, null, m[1], out.error ?? out.status);
    if (out.error) return fail(res, 409, out.error);
    send(res, 200, { ...out, conversation: conversationView(a.conversation_id) });
  });

  route('POST', /^\/api\/tasks\/(task_[\w-]{6,20})\/cancel$/, {}, (req, res, s, m) => {
    const out = dispatcher.cancel(m[1]);
    store.audit('owner', 'task.cancel', null, m[1], out.error ?? 'ok');
    if (out.error) return fail(res, 409, out.error);
    send(res, 200, out);
  });

  // ---- setup owner: one-time token (hash on disk), owner picks password + TOTP
  function setupState(t) {
    try {
      const st = JSON.parse(fs.readFileSync(setupFile, 'utf8'));
      if (st.expires < now() || owner()) return null;
      const h = crypto.createHash('sha256').update(String(t ?? '')).digest('hex');
      return h.length === st.tokenHash.length && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(st.tokenHash)) ? st : null;
    } catch { return null; }
  }
  // ---- lampiran (Tahap 3) ----
  route('POST', /^\/api\/conversations\/(conv_[\w-]{6,20})\/uploads$/, {}, async (req, res, s, m) => {
    const conv = q('select id from conversations where id=?').get(m[1]);
    if (!conv) return fail(res, 404, 'Percakapan tidak ditemukan.');
    const open = q('select count(*) n from uploads where conversation_id=? and task_id is null').get(conv.id).n;
    if (open >= MEDIA_LIMITS.perMessage * 2) return fail(res, 429, 'Terlalu banyak lampiran yang belum dikirim.');
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MEDIA_LIMITS.bytes) return fail(res, 413, 'Berkas lebih dari 10 MB.');
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > MEDIA_LIMITS.bytes) return fail(res, 413, 'Berkas lebih dari 10 MB.'); chunks.push(c); }
    let name = '';
    try { name = decodeURIComponent(String(req.headers['x-file-name'] ?? '')); } catch { name = ''; }
    const out = await media.save(conv.id, String(req.headers['content-type'] ?? ''), name, Buffer.concat(chunks));
    if (out.error) return fail(res, 415, out.error);
    store.audit('owner', 'upload', null, out.upload.id, `${out.upload.kind} ${size}`);
    send(res, 201, out);
  });

  route('GET', /^\/api\/uploads\/(up_[\w-]{6,20})$/, {}, (req, res, s, m) => {
    const r = q('select * from uploads where id=?').get(m[1]);
    if (!r) return fail(res, 404, 'Lampiran tidak ditemukan.');
    send(res, 200, { transcript: r.transcript, transcribing: r.kind === 'voice' && r.transcript === null && media.pending.has(r.id) });
  });

  route('GET', /^\/api\/media\/([\w-]+\.[\w-]+)$/, {}, (req, res, s, m) => {
    const file = media.resolveToken(m[1]);
    if (!file) return fail(res, 404, 'Lampiran tidak ada atau sudah dihapus.');
    media.stream(res, file);
  });

  // ---- cari pesan (Tahap 3) ----
  route('GET', /^\/api\/conversations\/(conv_[\w-]{6,20})\/search$/, {}, (req, res, s, m, url) => {
    const conv = q('select * from conversations where id=?').get(m[1]);
    if (!conv) return fail(res, 404, 'Percakapan tidak ditemukan.');
    const term = String(url.searchParams.get('q') ?? '').trim().slice(0, 60);
    if (term.length < 2) return send(res, 200, { results: [] });
    let results = [];
    const sid = conv.channel === 'telegram' ? tgSession(conv.profile) : null;
    if (sid) { try { results = tg.search(conv.profile, sid, term).map((r) => ({ ...r, text: media.fromTranscript(r.text).text })); } catch { return fail(res, 503, 'Riwayat Telegram tidak terbaca sekarang.'); } }
    else {
      const like = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      results = q("select id, role, text, created_at at from turns where conversation_id=? and text like ? escape '\\' order by created_at desc limit 30").all(conv.id, like);
    }
    send(res, 200, { results });
  });

  // ---- notifikasi push (Tahap 2) ----
  route('GET', /^\/api\/push$/, {}, (req, res, s, m, url) => {
    send(res, 200, { publicKey: push.publicKey, muted: push.muted(url.searchParams.get('endpoint') ?? '') });
  });
  route('POST', /^\/api\/push\/subscribe$/, {}, async (req, res) => {
    const b = await readJson(req);
    if (!validSubscription(b.subscription ?? {})) return fail(res, 400, 'Langganan push tidak sah.');
    const id = push.subscribe(b.subscription, req.headers['user-agent']);
    store.audit('owner', 'push.subscribe', null, id);
    send(res, 200, { ok: true });
  });
  route('POST', /^\/api\/push\/unsubscribe$/, {}, async (req, res) => {
    const b = await readJson(req);
    push.unsubscribe(String(b.endpoint ?? ''));
    send(res, 200, { ok: true });
  });
  route('POST', /^\/api\/push\/mute$/, {}, async (req, res) => {
    const b = await readJson(req);
    const list = Array.isArray(b.muted) ? b.muted.filter((p) => byProfile(p)).map(String) : [];
    push.setMuted(String(b.endpoint ?? ''), list);
    send(res, 200, { ok: true, muted: list });
  });
  route('POST', /^\/api\/push\/test$/, {}, async (req, res) => {
    const n = await push.notify('__test__', { title: 'Kantor RPG', body: 'Notifikasi aktif. Balasan agen akan muncul seperti ini.', tag: 'test', url: './' });
    send(res, 200, { delivered: n });
  });

  route('GET', /^\/api\/setup$/, { auth: false }, async (req, res, s, m, url) => {
    const st = setupState(url.searchParams.get('t'));
    if (!st) return send(res, 410, setupPage({ error: 'Tautan setup tidak berlaku (kedaluwarsa, salah, atau owner sudah dibuat).' }));
    send(res, 200, await setupPage({ secret: st.totpSecret, username: st.username, token: url.searchParams.get('t') }), { 'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'self'" });
  });
  route('POST', /^\/api\/setup$/, { auth: false, csrf: false }, async (req, res) => {
    let b;
    const ct = String(req.headers['content-type'] ?? '');
    if (ct.startsWith('application/x-www-form-urlencoded')) {
      let raw = ''; for await (const c of req) { raw += c; if (raw.length > MAX_BODY) return fail(res, 413, 'Terlalu besar'); }
      b = Object.fromEntries(new URLSearchParams(raw));
    } else b = await readJson(req);
    const st = setupState(b.t);
    if (!st) return send(res, 410, setupPage({ error: 'Tautan setup tidak berlaku.' }));
    const pw = String(b.password ?? '');
    if (pw.length < 12 || pw !== String(b.password2 ?? '')) return send(res, 400, await setupPage({ secret: st.totpSecret, username: st.username, token: b.t, error: 'Sandi minimal 12 karakter dan kedua isian harus sama.' }));
    if (!verifyTotp(st.totpSecret, b.code, now())) return send(res, 400, await setupPage({ secret: st.totpSecret, username: st.username, token: b.t, error: 'Kode 2FA salah. Pastikan jam HP benar lalu coba kode terbaru.' }));
    fs.writeFileSync(ownerFile, JSON.stringify({ username: st.username, passwordHash: hashPassword(pw), totpSecret: st.totpSecret, createdAt: new Date(now()).toISOString() }), { mode: 0o600 });
    fs.rmSync(setupFile, { force: true });
    store.audit('owner', 'setup.done');
    send(res, 200, setupPage({ done: true }));
  });

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    if (cfg.proxySecret) {
      const got = String(req.headers['x-kantor-proxy'] ?? '');
      if (got.length !== cfg.proxySecret.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(cfg.proxySecret))) return fail(res, 403, 'Hanya lewat proxy employee-rpg.');
    }
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) {
      const known = routes.some((x) => x.re.test(url.pathname));
      return fail(res, known ? 405 : 404, known ? 'Metode tidak didukung.' : 'Tidak ditemukan.');
    }
    const m = r.re.exec(url.pathname);
    let s = null;
    if (r.opts.auth !== false) {
      s = session(req);
      if (!s) { store.audit('anon', 'denied', null, url.pathname); return fail(res, 401, 'Perlu login owner.'); }
    }
    if (req.method !== 'GET') {
      const origin = req.headers.origin;
      if (origin && cfg.allowedOrigin && origin !== cfg.allowedOrigin) { store.audit('anon', 'origin.denied', null, url.pathname, origin); return fail(res, 403, 'Origin ditolak.'); }
      if (r.opts.csrf !== false && r.opts.auth !== false) {
        const h = String(req.headers['x-csrf'] ?? '');
        if (!s || h.length !== s.csrf.length || !crypto.timingSafeEqual(Buffer.from(h), Buffer.from(s.csrf))) { store.audit('owner', 'csrf.denied', null, url.pathname); return fail(res, 403, 'Token CSRF salah.'); }
      }
    }
    try { await r.fn(req, res, s, m, url); } catch (e) {
      if (!res.headersSent) fail(res, e.code && e.code < 600 ? e.code : 500, e.code ? e.message : 'Kesalahan server.');
      if (!e.code) console.error(e);
    }
  }

  const server = http.createServer((req, res) => { void handle(req, res); });
  server.on('close', () => clearInterval(purgeTimer));
  return { server, store, dispatcher };
}

/** Creates setup.json with a fresh TOTP secret and returns the one-time URL. */
export function createSetup(dataDir, { username = 'budi', publicUrl, hours = 24 } = {}) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const t = token(24);
  const totpSecret = base32Encode(crypto.randomBytes(20));
  fs.writeFileSync(path.join(dataDir, 'setup.json'), JSON.stringify({ tokenHash: crypto.createHash('sha256').update(t).digest('hex'), totpSecret, username, expires: Date.now() + hours * 3600_000 }), { mode: 0o600 });
  return `${publicUrl.replace(/\/$/, '')}/api/setup?t=${t}`;
}
