// Penyimpanan backend privat (PRD 17.2, 17.4): sesi login, percakapan,
// giliran, tugas, peristiwa, approval dan audit dalam satu SQLite (node:sqlite).
// Retensi dibatasi (ADR-016); purge() menghapus yang lewat TTL.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
create table if not exists sessions (id text primary key, csrf text not null, created_at integer not null, expires_at integer not null, ua text);
create table if not exists login_attempts (key text not null, at integer not null);
create table if not exists conversations (id text primary key, profile text not null, hermes_session text, created_at integer not null, updated_at integer not null);
create table if not exists turns (
  id text primary key, conversation_id text not null, role text not null, text text not null,
  options text, expires_at integer, task_id text, created_at integer not null
);
create table if not exists tasks (
  id text primary key, conversation_id text not null, profile text not null, idem text not null unique,
  message text not null, decision_id text, status text not null, source text not null,
  observed_at integer not null, created_at integer not null, result_turn text, error text
);
create table if not exists events (seq integer primary key autoincrement, task_id text not null, status text not null, note text, at integer not null);
create table if not exists approvals (
  id text primary key, task_id text not null, action text not null, impact text not null, rollback text not null,
  status text not null, created_at integer not null, expires_at integer not null, decided_at integer
);
create table if not exists audit (seq integer primary key autoincrement, at integer not null, actor text not null, kind text not null, profile text, ref text, detail text);
create table if not exists uploads (id text primary key, conversation_id text not null, task_id text, kind text not null, name text not null, path text not null, size integer not null, mime text not null, transcript text, created_at integer not null);
create table if not exists push_subs (id text primary key, sub text not null, ua text, muted text not null default '[]', created_at integer not null);
create table if not exists notified (profile text primary key, at integer not null);
create index if not exists ix_uploads_task on uploads(task_id);
create index if not exists ix_turns_conv on turns(conversation_id, created_at);
create index if not exists ix_events_task on events(task_id, seq);
`;

export const RETENTION = { messagesDays: 30, auditDays: 90, sessionHours: 12, loginWindowMin: 15 };

export function openStore(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'kantor-rpg.db');
  const db = new DatabaseSync(file);
  db.exec('pragma journal_mode=wal; pragma foreign_keys=on;');
  db.exec(SCHEMA);
  // Telegram sync (ADR-017): a conversation can be bound to the bot's Telegram DM session.
  const cols = db.prepare('pragma table_info(conversations)').all().map((c) => c.name);
  if (!cols.includes('channel')) db.exec("alter table conversations add column channel text not null default 'rpg'");
  try { fs.chmodSync(file, 0o600); } catch { /* best effort */ }
  const q = (sql) => db.prepare(sql);
  return {
    db,
    file,
    q,
    audit(actor, kind, profile, ref, detail) {
      q('insert into audit(at,actor,kind,profile,ref,detail) values(?,?,?,?,?,?)').run(Date.now(), actor, kind, profile ?? null, ref ?? null, detail ? String(detail).slice(0, 300) : null);
    },
    purge(now = Date.now()) {
      const msgCut = now - RETENTION.messagesDays * 86400_000;
      const auditCut = now - RETENTION.auditDays * 86400_000;
      q('delete from sessions where expires_at < ?').run(now);
      q('delete from login_attempts where at < ?').run(now - RETENTION.loginWindowMin * 60_000);
      q('delete from turns where created_at < ?').run(msgCut);
      q('delete from events where at < ?').run(msgCut);
      q("delete from tasks where created_at < ? and status in ('completed','failed','cancelled','unknown')").run(msgCut);
      q('delete from approvals where created_at < ?').run(msgCut);
      q('delete from conversations where updated_at < ?').run(msgCut);
      q('delete from audit where at < ?').run(auditCut);
    },
    close() { db.close(); },
  };
}
