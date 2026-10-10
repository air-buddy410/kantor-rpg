// Kebijakan pesan (PRD 17.4). Dua gerbang sebelum pesan dikirim ke profil:
//  1. rahasia: sandi/OTP/token/kartu tidak boleh diketik di chat RPG -> tolak.
//  2. aksi berisiko: produksi ISP, homelab, biaya, kredensial, kirim klien,
//     hapus/deploy -> butuh approval terpisah yang terikat task + kedaluwarsa.
// Memilih salah satu dari tiga opsi bukan izin umum: opsi melewati gerbang yang sama.
export const LIMITS = { messageChars: 4000, optionLabelChars: 80, optionMessageChars: 600, approvalMinutes: 15, turnMinutes: 60, queuePerProfile: 5 };

const SECRET = [
  /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:sandi|password|passwd|pwd|pin|otp|kode verifikasi|token|api[_ -]?key)\s*(?:nya|ku)?\s*(?:[:=]|adalah|=>)\s*\S{4,}/i,
  /\b(?:\d[ -]?){15,16}\b/, // nomor kartu
];

const RISK = [
  { id: 'isp', re: /\b(mikrotik|routeros|olt|onu|ont|switch antar|core router|router core|pop\b|sistem lama|alus|radius|pppoe|bras|produksi isp)\b/i, label: 'Perangkat/sistem produksi ISP PerumNet' },
  { id: 'homelab', re: /\b(proxmox|pve|vm\s?\d+|lxc|docker-01|restart|reboot|matikan|shutdown|upgrade firmware)\b/i, label: 'Homelab/server: restart, VM, atau upgrade' },
  { id: 'destroy', re: /\b(hapus|delete|drop table|rm -rf|truncate|reset|wipe|format ulang)\b/i, label: 'Menghapus atau mereset data' },
  { id: 'deploy', re: /\b(deploy|publish|rilis ke produksi|merge|push ke main|go live)\b/i, label: 'Deploy/merge ke produksi' },
  { id: 'money', re: /\b(bayar|transfer|top.?up|beli|langganan berbayar|checkout|invoice ke klien)\b/i, label: 'Biaya atau pembayaran' },
  { id: 'client', re: /\b(kirim (?:ke )?(?:klien|customer|pelanggan)|email (?:ke )?klien|wa (?:ke )?klien|kirim penawaran)\b/i, label: 'Mengirim sesuatu ke klien' },
  { id: 'cred', re: /\b(ganti (?:sandi|password)|reset (?:sandi|password)|kredensial|credential|ssh key|hak akses)\b/i, label: 'Kredensial atau hak akses' },
];

export function checkMessage(text) {
  const t = String(text ?? '');
  if (!t.trim()) return { ok: false, reason: 'Pesan kosong.' };
  if (t.length > LIMITS.messageChars) return { ok: false, reason: `Pesan lebih dari ${LIMITS.messageChars} karakter.` };
  if (SECRET.some((re) => re.test(t))) return { ok: false, reason: 'Pesan tampak berisi sandi, OTP, token atau nomor kartu. Jangan ketik rahasia di chat RPG; pakai vault atau alur login resmi.' };
  const risks = RISK.filter((r) => r.re.test(t)).map((r) => ({ id: r.id, label: r.label }));
  return { ok: true, risks };
}

/**
 * Parses the decision block the agent appends. Exactly three distinct options
 * are required; anything else is rejected (the UI then offers manual only).
 */
export function parseOptions(reply) {
  const text = String(reply ?? '');
  const fence = /```(?:json)?\s*(\{[\s\S]*?"pilihan"[\s\S]*?\})\s*```\s*$/i.exec(text.trimEnd());
  const body = fence ? text.slice(0, fence.index).trimEnd() : text.trimEnd();
  if (!fence) return { body, options: null, invalid: null };
  let data;
  try { data = JSON.parse(fence[1]); } catch { return { body, options: null, invalid: 'Blok pilihan agen bukan JSON yang sah.' }; }
  if (data.pilihan === null || (Array.isArray(data.pilihan) && data.pilihan.length === 0)) return { body, options: null, invalid: null };
  if (!Array.isArray(data.pilihan) || data.pilihan.length !== 3) return { body, options: null, invalid: 'Agen tidak memberi tepat tiga pilihan.' };
  const opts = [];
  for (const [i, o] of data.pilihan.entries()) {
    const label = typeof o === 'string' ? o : o?.label;
    const message = typeof o === 'string' ? o : (o?.pesan ?? o?.message ?? o?.label);
    if (typeof label !== 'string' || !label.trim() || typeof message !== 'string' || !message.trim()) return { body, options: null, invalid: 'Pilihan agen tidak lengkap.' };
    opts.push({ id: `o${i + 1}`, label: label.trim().slice(0, LIMITS.optionLabelChars), message: message.trim().slice(0, LIMITS.optionMessageChars) });
  }
  if (new Set(opts.map((o) => o.label.toLowerCase())).size !== 3) return { body, options: null, invalid: 'Tiga pilihan agen tidak berbeda.' };
  for (const o of opts) {
    const c = checkMessage(o.message);
    o.requiresApproval = !!(c.ok && c.risks.length);
    if (!c.ok) return { body, options: null, invalid: 'Pilihan agen memuat isi yang ditolak kebijakan.' };
  }
  return { body, options: opts, invalid: null };
}

/** Markdown from the agent is untrusted: strip HTML and script-like links. */
export function sanitizeReply(text) {
  return String(text ?? '')
    .replace(/<[^>]{0,400}>/g, '')
    .replace(/\]\(\s*(?:javascript|data|vbscript):[^)]*\)/gi, '](#)')
    .slice(0, 12000);
}

export const OPTION_INSTRUCTION = `

[Catatan sistem dari kantor RPG, bukan bagian pesan Budi]
Pesan ini dikirim Budi lewat panel privat kantor RPG (employee-rpg), sudah login sandi + 2FA. Aturan lanemu, jobdesk, dan batas produksi ISP tetap berlaku persis seperti di Telegram.
Balas dalam bahasa Indonesia, ringkas. Kalau balasanmu meminta keputusan Budi, akhiri dengan SATU blok kode json berisi tepat tiga pilihan yang berbeda, aman, dan relevan:
\`\`\`json
{"pilihan":[{"label":"maks 60 karakter","pesan":"teks lengkap yang akan dikirim balik kalau Budi memilih ini"},{"label":"...","pesan":"..."},{"label":"...","pesan":"..."}]}
\`\`\`
Kalau tidak perlu keputusan (jawaban akhir, laporan, error), tulis {"pilihan":[]} di blok itu. Jangan menulis sandi/token.`;
