// Service worker kantor-rpg: hanya notifikasi push (Tahap 2). Tidak meng-cache
// aset; dunia 3D tetap dimuat dari jaringan seperti sebelumnya.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    // An open, visible chat already shows the message and plays its own sound.
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === 'visible' && w.focused)) return;
    await self.registration.showNotification(d.title || 'Kantor RPG', {
      body: d.body || 'Pesan baru', tag: d.tag || 'kantor-rpg', renotify: true,
      icon: 'assets/icons/icon-192.png', badge: 'assets/icons/badge-96.png', data: { url: d.url || './' },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) { await w.focus(); w.postMessage({ type: 'open-chat', url }); return; }
    }
    await self.clients.openWindow(url);
  })());
});
