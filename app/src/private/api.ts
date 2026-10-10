// Klien API backend privat. Same-origin /api/ (nginx employee-rpg meneruskan
// ke Mac mini). Cookie sesi HttpOnly; CSRF dari /api/me dikirim per POST.
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'ApiError'; }
}

export interface Me { mode: 'private'; configured: boolean; authenticated: boolean; csrf: string | null }
export interface HandoffItem { id: string; project: string; badan: string; from: string; to: string; summary: string; diminta: string; hasFile: boolean; status: string; createdAt: number; ageHours: number; attention: boolean; chain?: string[]; chainActive?: number }
export interface TaskItem { id: string; title: string; owner: string; requester: string; status: string; createdAt: number; ageHours: number; handoff: boolean; badan?: string }
export interface LogItem { at: number; kind: 'task' | 'tool'; bot: string; verb: string; object: string; taskId: string | null }
export interface Board<T> { ok: boolean; source: string; error?: string; items: T[] }
export interface Boards { observedAt: string; mode: 'private' | 'demo'; handoffs: Board<HandoffItem>; tasks: Board<TaskItem>; log: Board<LogItem> }
export interface Agent { profile: string; name: string; lane: string; actorId: string | null; badan: string; tasks: Record<string, number> }
export interface Presence { profile: string; name: string; actorId: string | null; status: 'working' | 'waiting' | 'idle' | 'unknown'; source: string; summary: string; replies?: number[]; typing?: boolean; lastSeen?: number | null }
export interface Option { id: string; label: string; message: string; requiresApproval: boolean }
export type Receipt = 'sent' | 'delivered' | 'read';
export interface Attachment { id: string; kind: 'image' | 'file' | 'voice' | 'video'; name: string; size: number; url: string | null; transcript: string | null; transcribing?: boolean }
export interface SearchHit { id: string; role: 'owner' | 'agent' | 'system'; text: string; at: number }
export interface Turn { id: string; role: 'owner' | 'agent' | 'system'; via?: 'telegram' | 'rpg' | 'agent' | 'system'; pending?: boolean; receipt?: Receipt; attachments?: Attachment[]; text: string; taskId: string | null; at: number; options: Option[] | null; optionsExpired: boolean; expiresAt: number | null }
export interface TaskView { id: string; status: string; source: string; observed_at: number; created_at: number; error: string | null; terminal: boolean }
export interface EventView { seq: number; task_id: string; status: string; note: string | null; at: number }
export interface ApprovalView { id: string; task_id: string; action: string; impact: string; rollback: string; status: string; expires_at: number }
export interface Conversation { id: string; profile: string; agent?: string; lane?: string; channel?: 'telegram' | 'telegram-unavailable' | 'rpg'; turns: Turn[]; typing?: boolean; lastSeen?: number | null; tasks: TaskView[]; events: EventView[]; approvals: ApprovalView[]; cursor: number }

let csrf: string | null = null;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrf) headers['X-CSRF'] = csrf;
  let res: Response;
  try {
    res = await fetch(`api/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'Jaringan putus. Status pesan belum diketahui; kirim ulang memakai kunci yang sama tidak membuat tugas ganda.');
  }
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) throw new ApiError(res.status || 502, 'Backend privat tidak tersedia.');
  const data = await res.json() as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`);
  return data;
}

export const api = {
  async me() { const m = await call<Me>('GET', 'me'); csrf = m.csrf; return m; },
  async login(username: string, password: string, code: string) { const r = await call<{ csrf: string }>('POST', 'login', { username, password, code }); csrf = r.csrf; return r; },
  logout: () => call<{ ok: true }>('POST', 'logout'),
  boards: () => call<Boards>('GET', 'boards'),
  agents: () => call<{ agents: Agent[] }>('GET', 'agents'),
  presence: () => call<{ observedAt: string; agents: Presence[] }>('GET', 'presence'),
  conversation: (profile: string, fresh = false) => call<Conversation>('POST', 'conversations', { profile, fresh }),
  conversationById: (id: string) => call<Conversation>('GET', `conversations/${encodeURIComponent(id)}`),
  send: (id: string, body: { text?: string; decision?: { turnId: string; optionId: string }; idem: string; attachments?: string[] }) =>
    call<{ taskId: string; duplicate: boolean; approval: { id: string } | null; conversation: Conversation }>('POST', `conversations/${encodeURIComponent(id)}/messages`, body),
  approve: (id: string, taskId: string, decision: 'approve' | 'reject') => call<{ conversation: Conversation }>('POST', `approvals/${encodeURIComponent(id)}`, { decision, taskId }),
  async upload(convId: string, file: Blob, name: string): Promise<{ upload: Attachment }> {
    let res: Response;
    try {
      res = await fetch(`api/conversations/${encodeURIComponent(convId)}/uploads`, {
        method: 'POST', body: file, credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(name), ...(csrf ? { 'X-CSRF': csrf } : {}) },
      });
    } catch { throw new ApiError(0, 'Jaringan putus saat mengunggah. Coba lagi.'); }
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { upload: Attachment; error?: string };
    if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`);
    return data;
  },
  uploadStatus: (id: string) => call<{ transcript: string | null; transcribing: boolean }>('GET', `uploads/${encodeURIComponent(id)}`),
  search: (convId: string, q: string) => call<{ results: SearchHit[] }>('GET', `conversations/${encodeURIComponent(convId)}/search?q=${encodeURIComponent(q)}`),
  pushInfo: (endpoint = '') => call<{ publicKey: string; muted: string[] | null }>('GET', `push?endpoint=${encodeURIComponent(endpoint)}`),
  pushSubscribe: (subscription: PushSubscriptionJSON) => call<{ ok: true }>('POST', 'push/subscribe', { subscription }),
  pushUnsubscribe: (endpoint: string) => call<{ ok: true }>('POST', 'push/unsubscribe', { endpoint }),
  pushMute: (endpoint: string, muted: string[]) => call<{ ok: true; muted: string[] }>('POST', 'push/mute', { endpoint, muted }),
  pushTest: () => call<{ delivered: number }>('POST', 'push/test'),
  cancel: (taskId: string) => call<{ ok: true }>('POST', `tasks/${encodeURIComponent(taskId)}/cancel`),
};
