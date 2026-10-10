// Status ala aplikasi chat (Tahap 1 "rasa Telegram", Budi 2026-10-10):
// tanda mengetik, centang pesan, dan terakhir aktif. Diturunkan dari data
// yang sudah ada (giliran + tugas); tidak ada status yang dikarang.

/** An owner message with no agent reply after it, newer than this, means the bot is still on it. */
export const TYPING_WINDOW_MS = 10 * 60_000;

/**
 * receipt per owner turn: 'sent' (server holds it, agent has not picked it up),
 * 'delivered' (agent is working on it / Hermes has it), 'read' (agent replied after it).
 * typing: a task is running, or the newest chat line is Budi's and still fresh.
 */
export function chatState(turns, tasks, now) {
  const status = new Map(tasks.map((t) => [t.id, t.status]));
  let answered = false;
  let lastSeen = null;
  const out = new Array(turns.length);
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t.role === 'agent') { answered = true; lastSeen ??= t.at; out[i] = t; continue; }
    if (t.role !== 'owner') { out[i] = t; continue; }
    const st = t.taskId ? status.get(t.taskId) : null;
    const receipt = answered ? 'read' : t.pending || st === 'queued' || st === 'blocked' ? 'sent' : 'delivered';
    out[i] = { ...t, receipt };
  }
  const working = tasks.some((t) => t.status === 'working');
  const lastChat = [...out].reverse().find((t) => t.role === 'owner' || t.role === 'agent');
  const waitingOnBot = lastChat?.role === 'owner' && lastChat.receipt === 'delivered' && now - lastChat.at < TYPING_WINDOW_MS;
  return { turns: out, typing: working || !!waitingOnBot, lastSeen };
}
