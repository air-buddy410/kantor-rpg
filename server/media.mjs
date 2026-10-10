// Lampiran chat (Tahap 3 "rasa Telegram"): foto, berkas, dan pesan suara.
// Unggahan disimpan di folder data backend (0700) dan dihapus bersama pesan
// (retensi 30 hari). Agen menerima path lokal dengan format yang sama seperti
// gateway Telegram Hermes, jadi alat agen membacanya seperti lampiran Telegram.
// Browser hanya melihat token bertanda tangan, tidak pernah path asli.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const MEDIA_LIMITS = { bytes: 10 * 1024 * 1024, perMessage: 5, transcribeSeconds: 180 };

// Whitelist by declared type; the extension comes from here, never from the client name.
const TYPES = {
  'image/jpeg': ['jpg', 'image'], 'image/png': ['png', 'image'], 'image/webp': ['webp', 'image'], 'image/gif': ['gif', 'image'],
  'application/pdf': ['pdf', 'file'], 'text/plain': ['txt', 'file'], 'text/csv': ['csv', 'file'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx', 'file'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx', 'file'],
  'application/zip': ['zip', 'file'],
  'audio/webm': ['webm', 'voice'], 'audio/ogg': ['ogg', 'voice'], 'audio/mp4': ['m4a', 'voice'], 'audio/mpeg': ['mp3', 'voice'], 'audio/wav': ['wav', 'voice'],
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(TYPES).map(([m, [e]]) => [e, m]));
Object.assign(MIME_BY_EXT, { jpeg: 'image/jpeg', oga: 'audio/ogg', mp4: 'video/mp4', mov: 'video/quicktime', doc: 'application/msword', xls: 'application/vnd.ms-excel' });

// Magic bytes for the types where a lie would matter (rendered inline by the browser).
const MAGIC = { jpg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47], gif: [0x47, 0x49, 0x46], pdf: [0x25, 0x50, 0x44, 0x46] };
function magicOk(ext, buf) {
  if (ext === 'webp') return buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP';
  const m = MAGIC[ext];
  return !m || m.every((b, i) => buf[i] === b);
}

export const kindOf = (file) => {
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
  return { ext, mime, kind: mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'voice' : mime.startsWith('video/') ? 'video' : 'file' };
};

const cleanName = (n) => String(n ?? '').replace(/[^\p{L}\p{N} ._()-]/gu, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'berkas';

export function createMedia({ dataDir, home, secret, q, now, transcriber = whisperTranscriber() }) {
  const dir = path.join(dataDir, 'uploads');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const key = crypto.createHash('sha256').update(`kantor-media|${secret}`).digest();
  // Files the agent world already has (Telegram attachments) may be shown too, read-only.
  const roots = [dir, path.join(home, '.hermes', 'cache'), path.join(home, '.hermes', 'profiles')].map((r) => { try { return fs.realpathSync(r); } catch { return r; } });
  const pending = new Map(); // upload id -> transcription promise

  const sign = (p) => {
    const b = Buffer.from(p).toString('base64url');
    return `${b}.${crypto.createHmac('sha256', key).update(b).digest('base64url').slice(0, 32)}`;
  };
  function resolveToken(tok) {
    const [b, mac] = String(tok).split('.');
    if (!b || !mac) return null;
    const want = crypto.createHmac('sha256', key).update(b).digest('base64url').slice(0, 32);
    if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
    let real;
    try { real = fs.realpathSync(Buffer.from(b, 'base64url').toString('utf8')); } catch { return null; }
    if (!roots.some((r) => real === r || real.startsWith(r + path.sep))) return null;
    if (!/[/\\](uploads|cache)[/\\]/.test(real)) return null; // profiles/<x>/cache/... only, not state.db etc.
    return real;
  }

  const view = (row) => ({ id: row.id, kind: row.kind, name: row.name, size: row.size, url: `api/media/${sign(row.path)}`, transcript: row.transcript ?? null, transcribing: row.kind === 'voice' && row.transcript === null && pending.has(row.id) });

  async function save(convId, mime, name, buf) {
    const t = TYPES[String(mime).split(';')[0].trim().toLowerCase()];
    if (!t) return { error: 'Jenis berkas tidak didukung. Kirim foto (JPG/PNG/WebP/GIF), PDF, DOCX, XLSX, TXT/CSV, ZIP, atau pesan suara.' };
    if (!buf.length) return { error: 'Berkas kosong.' };
    if (buf.length > MEDIA_LIMITS.bytes) return { error: 'Berkas lebih dari 10 MB.' };
    const [ext, kind] = t;
    if (!magicOk(ext, buf)) return { error: 'Isi berkas tidak cocok dengan jenisnya.' };
    const id = `up_${crypto.randomBytes(9).toString('base64url')}`;
    const file = path.join(dir, `${id}.${ext}`);
    fs.writeFileSync(file, buf, { mode: 0o600 });
    const nm = kind === 'voice' ? `pesan-suara.${ext}` : cleanName(name).replace(/\.[^.]*$/, '') + `.${ext}`;
    q('insert into uploads(id,conversation_id,kind,name,path,size,mime,transcript,created_at) values(?,?,?,?,?,?,?,?,?)').run(id, convId, kind, nm, file, buf.length, mime, null, now());
    if (kind === 'voice') {
      const p = Promise.resolve(transcriber(file)).then((text) => {
        q('update uploads set transcript=? where id=?').run(String(text ?? '').trim() || '(tidak ada ucapan yang terdengar)', id);
      }).catch(() => { q('update uploads set transcript=? where id=?').run('(transkrip gagal)', id); }).finally(() => pending.delete(id));
      pending.set(id, p);
    }
    return { upload: view(q('select * from uploads where id=?').get(id)) };
  }

  /** Uploads of this conversation not yet attached to a message, in the given order. */
  function claim(convId, ids) {
    if (!Array.isArray(ids)) return { rows: [] };
    if (ids.length > MEDIA_LIMITS.perMessage) return { error: `Maksimal ${MEDIA_LIMITS.perMessage} lampiran per pesan.` };
    const rows = [];
    for (const id of ids) {
      const r = q('select * from uploads where id=? and conversation_id=? and task_id is null').get(String(id), convId);
      if (!r) return { error: 'Lampiran tidak ditemukan atau sudah terkirim. Unggah ulang.' };
      rows.push(r);
    }
    return { rows };
  }

  /**
   * Text the agent receives for the attachments, in the gateway's own words so
   * the agent handles them like Telegram ones. Voice waits for its transcript.
   */
  async function agentText(rows) {
    const parts = [];
    for (const r of rows) {
      if (r.kind === 'image') parts.push(`[Image attached at: ${r.path}]`);
      else if (r.kind === 'voice') {
        await pending.get(r.id);
        const t = q('select transcript from uploads where id=?').get(r.id)?.transcript ?? '(transkrip gagal)';
        parts.push(`[Budi mengirim pesan suara dari kantor RPG. Transkrip otomatis: "${t}". Audio asli: ${r.path}]`);
      } else parts.push(`[The user sent a document: '${r.name}'. It is saved at: ${r.path}. If the user's request involves what the document contains, read it yourself.]`);
    }
    return parts.join('\n');
  }

  function forTask(taskId) { return q('select * from uploads where task_id=? order by created_at, rowid').all(taskId).map(view); }

  /**
   * Attachment markers inside a Telegram transcript line (written by the
   * gateway or by agentText) become chips; the raw path never reaches the browser.
   */
  function fromTranscript(text) {
    const atts = [];
    const add = (p, extra = {}) => {
      if (!fs.existsSync(p)) { atts.push({ id: `gone_${atts.length}`, kind: kindOf(p).kind, name: path.basename(p), size: 0, url: null, transcript: null, ...extra }); return; }
      const k = kindOf(p);
      const up = q('select * from uploads where path=?').get(p);
      atts.push(up ? view(up) : { id: `tg_${crypto.createHash('sha1').update(p).digest('hex').slice(0, 10)}`, kind: k.kind, name: path.basename(p), size: fs.statSync(p).size, url: `api/media/${sign(p)}`, transcript: null, ...extra });
    };
    let out = String(text);
    out = out.replace(/\[Budi mengirim pesan suara dari kantor RPG\. Transkrip otomatis: "([\s\S]*?)"\. Audio asli: ([^\]\n]+)\]/g, (_, t, p) => { add(p.trim(), { transcript: t }); return ''; });
    out = out.replace(/\[(?:Replied-to )?[Ii]mage(?: '[^']*')? (?:attached|saved) at: ([^\]\n]+)\]/g, (_, p) => { add(p.trim()); return ''; });
    out = out.replace(/\[The user sent an? (?:document|video|audio|voice|image|photo)[^\]]*?(?:attachment)?: '([^']*)'\. It is saved at: ([^\s\]]+?)\.?(?: [^\]]*)?\]/g, (_, n, p) => { add(p.trim()); return ''; });
    return { text: out.replace(/\n{3,}/g, '\n\n').trim(), attachments: atts };
  }

  function stream(res, file, extraHeaders) {
    const { mime } = kindOf(file);
    const st = fs.statSync(file);
    // Inline only for types the browser shows safely; the rest download.
    const inline = /^(image\/(jpeg|png|webp|gif)|audio\/|video\/(mp4|quicktime)|application\/pdf)/.test(mime);
    res.writeHead(200, {
      'Content-Type': mime, 'Content-Length': st.size, 'Cache-Control': 'private, max-age=86400',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`,
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
      'X-Robots-Tag': 'noindex, nofollow', ...extraHeaders,
    });
    fs.createReadStream(file).pipe(res);
  }

  function purge(cutoff) {
    for (const r of q('select id,path from uploads where created_at < ?').all(cutoff)) { fs.rmSync(r.path, { force: true }); q('delete from uploads where id=?').run(r.id); }
  }

  return { save, claim, agentText, forTask, fromTranscript, resolveToken, stream, purge, sign, pending };
}

/** Local speech-to-text with mlx-whisper (Apple Silicon, no paid API), Indonesian first. */
export function whisperTranscriber({ bin = 'uvx', model = 'mlx-community/whisper-small-mlx', seconds = MEDIA_LIMITS.transcribeSeconds } = {}) {
  return (file) => new Promise((resolve, reject) => {
    const outDir = fs.mkdtempSync(path.join(path.dirname(file), '.stt-'));
    const wav = path.join(outDir, 'a.wav');
    const run = (cmd, args) => new Promise((ok, no) => {
      const c = spawn(cmd, args, { stdio: 'ignore' });
      const k = setTimeout(() => c.kill('SIGKILL'), seconds * 1000);
      c.on('error', no); c.on('close', (code) => { clearTimeout(k); code === 0 ? ok() : no(new Error(`${cmd} ${code}`)); });
    });
    run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-ar', '16000', '-ac', '1', wav])
      .then(() => run(bin, ['--from', 'mlx-whisper', 'mlx_whisper', wav, '--model', model, '--language', 'id', '-f', 'txt', '-o', outDir]))
      .then(() => resolve(fs.readFileSync(path.join(outDir, 'a.txt'), 'utf8').replace(/\s+/g, ' ').trim()))
      .catch(reject)
      .finally(() => fs.rmSync(outDir, { recursive: true, force: true }));
  });
}
