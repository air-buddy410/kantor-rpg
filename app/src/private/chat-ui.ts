// Detail tampilan chat ala Telegram (Tahap 1): pemisah tanggal, centang,
// "terakhir dilihat", bunyi pesan masuk, dan penghitung di judul tab.
import type { Receipt } from './api';

const TZ = 'Asia/Makassar';
const dayKey = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ });

/** "Hari ini" / "Kemarin" / "8 Okt 2026", in WITA like the rest of the panel. */
export function dayLabel(ms: number, now = Date.now()): string {
  const k = dayKey(ms);
  if (k === dayKey(now)) return 'Hari ini';
  if (k === dayKey(now - 86_400_000)) return 'Kemarin';
  return new Date(ms).toLocaleDateString('id-ID', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
}

export const sameDay = (a: number, b: number) => dayKey(a) === dayKey(b);

export const clock = (ms: number) => new Date(ms).toLocaleTimeString('id-ID', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

export const RECEIPT: Record<Receipt, { mark: string; label: string }> = {
  sent: { mark: '✓', label: 'Terkirim ke server, belum diambil agen' },
  delivered: { mark: '✓✓', label: 'Diterima agen' },
  read: { mark: '✓✓', label: 'Dibaca dan dibalas agen' },
};

/** Header status line: typing wins, then a real reply time, else nothing invented. */
export function statusLine(typing: boolean | undefined, lastSeen: number | null | undefined, now = Date.now()): string {
  if (typing) return 'sedang mengetik…';
  if (!lastSeen) return '';
  const min = Math.round((now - lastSeen) / 60_000);
  if (min < 2) return 'aktif barusan';
  if (min < 60) return `aktif ${min} menit lalu`;
  if (sameDay(lastSeen, now)) return `aktif hari ini ${clock(lastSeen)}`;
  return `aktif ${dayLabel(lastSeen, now).toLowerCase()} ${clock(lastSeen)}`;
}

let audio: AudioContext | null = null;
/** Short two-tone "ting" made in WebAudio (no asset). Silent until the page had a user gesture. */
export function ping() {
  if (localStorage.getItem('kantor-rpg:sound') === 'off') return;
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') return;
    const t = audio.currentTime;
    for (const [f, d] of [[880, 0], [1320, 0.09]] as const) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.12, t + d + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.18);
      o.connect(g).connect(audio.destination);
      o.start(t + d); o.stop(t + d + 0.2);
    }
  } catch { /* no audio device: the badge still shows */ }
}
export function unlockAudio() { try { audio ??= new AudioContext(); void audio.resume(); } catch { /* ignore */ } }

const BASE_TITLE = document.title;
/** "(3) Kantor RPG" like a messaging tab; plain title when nothing is unread. */
export function setTitleCount(n: number) { document.title = n > 0 ? `(${n > 99 ? '99+' : n}) ${BASE_TITLE}` : BASE_TITLE; }

/** Quote prefix for a reply; plain text so it reads the same in Telegram. */
export function quoteFor(who: string, text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return `↩ Membalas ${who}: "${one.length > 120 ? `${one.slice(0, 117)}…` : one}"\n\n`;
}
