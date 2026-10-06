// Service worker : l'application fonctionne hors ligne une fois chargée ; les tuiles satellite consultées sont gardées en cache.
const VERSION = 'scanlow-terrain-1.2.3';
const SHELL = ['./', 'index.html', 'app.js', 'db.js', 'zip.js', 'app.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/vue.global.prod.js'];
const TILES = 'scanlow-terrain-tuiles', MAX_TILES = 3000;

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== TILES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (/arcgisonline\.com|tile\.openstreetmap/.test(url.host)) {   // tuiles : cache d'abord, réseau ensuite
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      try {
        const r = await fetch(e.request);
        if (r.ok || r.type === 'opaque') {
          c.put(e.request, r.clone());
          c.keys().then(k => { if (k.length > MAX_TILES) for (const x of k.slice(0, k.length - MAX_TILES)) c.delete(x); });
        }
        return r;
      } catch { return new Response('', { status: 504 }); }
    }));
    return;
  }
  if (url.origin === location.origin) {   // application : réseau d'abord (mises à jour), cache hors ligne
    e.respondWith(fetch(e.request).then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
  }
});
