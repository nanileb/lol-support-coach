// Coach Support — service worker : app hors-ligne, méta toujours rafraîchie, images Data Dragon en cache.
const SHELL = 'cs-shell-v8', IMG = 'cs-img-v1';
const FILES = ['./', 'index.html', 'app.js', 'analyse.js', 'meta.json', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => ![SHELL, IMG].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.hostname === 'ddragon.leagueoflegends.com' && u.pathname.includes('/img/')) {
    e.respondWith(caches.open(IMG).then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { c.put(e.request, r.clone()); return r; })));
    return;
  }
  if (u.origin !== location.origin) return;
  // réseau d'abord (pour suivre les mises à jour du patch), cache si hors-ligne
  e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(SHELL).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs => cs[0] ? cs[0].focus() : self.clients.openWindow('./'))); });
