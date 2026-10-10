// Notifikasi push di browser (Tahap 2). Service worker hanya untuk push;
// izin diminta lewat tombol, tidak otomatis saat halaman dibuka.
import { api } from './api';

export type PushState = 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on';

const isIos = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

let reg: Promise<ServiceWorkerRegistration | null> | null = null;
/** Registers sw.js once; the page works the same without it. */
export function swRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  reg ??= navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => null);
  return reg;
}

const within = <T,>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

export async function pushState(): Promise<PushState> {
  if (!('PushManager' in window) || !('Notification' in window) || !('serviceWorker' in navigator)) return isIos() && !standalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const r = await within(swRegistration(), 4000, null);
  if (!r) return 'unsupported';
  const sub = await within(r.pushManager.getSubscription(), 4000, null);
  return sub ? 'on' : 'off';
}

const keyBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

export async function enablePush(): Promise<PushState> {
  const r = await swRegistration();
  if (!r) return 'unsupported';
  if ((await Notification.requestPermission()) !== 'granted') return Notification.permission === 'denied' ? 'denied' : 'off';
  const { publicKey } = await api.pushInfo();
  const sub = (await r.pushManager.getSubscription()) ?? (await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await api.pushSubscribe(sub.toJSON());
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  const r = await swRegistration();
  const sub = await r?.pushManager.getSubscription();
  if (sub) { await api.pushUnsubscribe(sub.endpoint).catch(() => {}); await sub.unsubscribe(); }
  return 'off';
}

export async function currentEndpoint(): Promise<string | null> {
  const r = await within(swRegistration(), 4000, null);
  return (r ? (await within(r.pushManager.getSubscription(), 4000, null))?.endpoint : null) ?? null;
}

/** Bots muted for notifications on this device (server keeps it per subscription). */
export async function mutedBots(): Promise<string[]> {
  const ep = await currentEndpoint();
  if (!ep) return [];
  return (await api.pushInfo(ep)).muted ?? [];
}

export async function setMutedBots(list: string[]): Promise<void> {
  const ep = await currentEndpoint();
  if (ep) await api.pushMute(ep, list);
}

export const PUSH_HELP: Record<PushState, string> = {
  unsupported: 'Browser ini tidak mendukung notifikasi push.',
  'ios-install': 'Di iPhone/iPad: ketuk Bagikan → Tambah ke Layar Utama, buka Kantor RPG dari ikon itu, lalu aktifkan notifikasi di sini (iOS 16.4+).',
  denied: 'Notifikasi diblokir browser. Izinkan lewat pengaturan situs (ikon gembok di bilah alamat), lalu muat ulang.',
  off: 'Notifikasi mati di perangkat ini.',
  on: 'Notifikasi aktif di perangkat ini. Balasan agen muncul walau tab ditutup.',
};
