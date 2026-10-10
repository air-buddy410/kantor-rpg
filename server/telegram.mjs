// Sinkron Telegram (opsi 3, keputusan Budi 2026-10-10): chat agen di RPG
// adalah percakapan Telegram DM yang sama. Transkrip dibaca dari state.db
// profil (baca-saja); perintah RPG melanjutkan sesi Telegram itu lewat
// `hermes chat -r`, dan Hermes sendiri yang mengunci giliran (turn lease)
// supaya Telegram dan RPG tidak menulis sesi yang sama bersamaan.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseOptions } from './policy.mjs';

export const RPG_NOTE = '[Catatan sistem dari kantor RPG';
const TRANSCRIPT_LIMIT = 40;
const TEXT_LIMIT = 4000;

export const profileHome = (home, profile) => (profile === 'default' ? path.join(home, '.hermes') : path.join(home, '.hermes', 'profiles', profile));

function sql(db, query, params = []) {
  // sqlite3 CLI has no bind parameters; values here are validated ids/ints.
  for (const p of params) if (!/^[\w:.-]{1,80}$/.test(String(p))) throw new Error('parameter tidak sah');
  let i = 0;
  const text = query.replace(/\?/g, () => `'${params[i++]}'`);
  const out = execFileSync('sqlite3', ['-readonly', '-json', db, text], { timeout: 4000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return out.trim() ? JSON.parse(out) : [];
}

/** Owner chat id: first TELEGRAM_ALLOWED_USERS entry of the main profile. */
export function ownerChatId(home) {
  try {
    const env = fs.readFileSync(path.join(home, '.hermes', '.env'), 'utf8');
    const m = /^TELEGRAM_ALLOWED_USERS=\s*"?(\d+)/m.exec(env);
    return m ? m[1] : null;
  } catch { return null; }
}

/** Live Telegram DM session of a profile, or null when the bot has none. */
export function telegramSession(home, profile, chatId) {
  if (!chatId) return null;
  const db = path.join(profileHome(home, profile), 'state.db');
  if (!fs.existsSync(db)) return null;
  const key = `agent:${profile === 'default' ? 'main' : profile}:telegram:dm:${chatId}`;
  const row = sql(db, "select id from sessions where session_key=? and source='telegram' order by (ended_at is null) desc, started_at desc limit 1", [key])[0];
  return row?.id ?? null;
}

/** Strips the RPG system note appended to owner messages sent from the game. */
export function stripRpgNote(text) {
  const i = text.indexOf(RPG_NOTE);
  return i >= 0 ? text.slice(0, i).trimEnd() : text;
}

/**
 * Last user/assistant messages of the session (tool steps skipped). `via`
 * says where an owner line came from: telegram, rpg, or system (kanban/cron
 * notices the gateway injects as user turns).
 */
export function telegramTranscript(home, profile, sessionId, limit = TRANSCRIPT_LIMIT) {
  const db = path.join(profileHome(home, profile), 'state.db');
  const rows = sql(db, `select id, role, content, timestamp, platform_message_id from messages
    where session_id=? and role in ('user','assistant') and coalesce(content,'') <> '' and _compressed_summary = 0
    order by id desc limit ${Number(limit) | 0}`, [sessionId]).reverse();
  return rows.map((r) => {
    const raw = String(r.content);
    const fromRpg = raw.includes(RPG_NOTE);
    const via = r.role === 'assistant' ? 'agent' : fromRpg ? 'rpg' : r.platform_message_id ? 'telegram' : 'system';
    return { id: `tg_${r.id}`, seq: r.id, role: r.role === 'assistant' ? 'agent' : via === 'system' ? 'system' : 'owner', via, text: (r.role === 'assistant' ? parseOptions(raw).body : stripRpgNote(raw)).slice(0, TEXT_LIMIT), at: Math.round(r.timestamp * 1000) };
  });
}

/** Times (ms) of the agent replies in the session, newest last; for unread counts. */
export function agentReplyTimes(home, profile, sessionId, limit = 50) {
  const db = path.join(profileHome(home, profile), 'state.db');
  const rows = sql(db, `select timestamp from messages where session_id=? and role='assistant' and coalesce(content,'') <> '' and _compressed_summary = 0
    order by id desc limit ${Number(limit) | 0}`, [sessionId]);
  return rows.map((r) => Math.round(r.timestamp * 1000)).reverse();
}

/** Newest owner-or-agent line of the session (system notices skipped), for the "typing" dot. */
export function lastChatLine(home, profile, sessionId) {
  const db = path.join(profileHome(home, profile), 'state.db');
  const row = sql(db, `select role, timestamp from messages where session_id=? and coalesce(content,'') <> '' and _compressed_summary = 0
    and (role='assistant' or (role='user' and (platform_message_id is not null or content like '%${RPG_NOTE}%')))
    order by id desc limit 1`, [sessionId])[0];
  return row ? { role: row.role === 'assistant' ? 'agent' : 'owner', at: Math.round(row.timestamp * 1000) } : null;
}

/**
 * Full-history search of the session (not just the last 40 lines). The term
 * is a quoted SQL literal (quotes doubled, control chars dropped) because the
 * sqlite3 CLI has no bind parameters.
 */
export function searchTelegram(home, profile, sessionId, term, limit = 30) {
  const db = path.join(profileHome(home, profile), 'state.db');
  const t = String(term ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60).toLowerCase();
  if (t.length < 2 || !/^[\w:.-]{1,80}$/.test(String(sessionId))) return [];
  const lit = `'${t.replace(/'/g, "''")}'`;
  const rows = execFileSync('sqlite3', ['-readonly', '-json', db, `select id, role, content, timestamp, platform_message_id from messages
    where session_id='${sessionId}' and role in ('user','assistant') and _compressed_summary = 0 and instr(lower(content), ${lit}) > 0
    order by id desc limit ${Number(limit) | 0}`], { timeout: 4000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  return (rows ? JSON.parse(rows) : []).map((r) => {
    const raw = String(r.content);
    const fromRpg = raw.includes(RPG_NOTE);
    return { id: `tg_${r.id}`, role: r.role === 'assistant' ? 'agent' : r.platform_message_id || fromRpg ? 'owner' : 'system', text: (r.role === 'assistant' ? parseOptions(raw).body : stripRpgNote(raw)).slice(0, TEXT_LIMIT), at: Math.round(r.timestamp * 1000) };
  });
}

function botToken(home, profile) {
  try {
    const env = fs.readFileSync(path.join(profileHome(home, profile), '.env'), 'utf8');
    return /^TELEGRAM_BOT_TOKEN=\s*"?([\w:-]+)/m.exec(env)?.[1] ?? null;
  } catch { return null; }
}

/**
 * Posts an RPG exchange into the bot's Telegram chat so the chat there shows
 * it too. Sent by the bot itself (a bot cannot post as Budi), labelled. The
 * token is read here on the server and never leaves it.
 */
export async function postToTelegram(home, profile, chatId, text, fetchImpl = fetch) {
  const tok = botToken(home, profile);
  if (!tok || !chatId) return { ok: false, error: 'bot Telegram tidak dikonfigurasi' };
  const chunks = [];
  for (let s = String(text); s.length; s = s.slice(3900)) chunks.push(s.slice(0, 3900));
  for (const chunk of chunks) {
    const r = await fetchImpl(`https://api.telegram.org/bot${tok}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: chunk, disable_web_page_preview: true }),
    }).catch(() => null);
    if (!r?.ok) return { ok: false, error: `Telegram menolak (${r?.status ?? 'jaringan'})` };
  }
  return { ok: true };
}
