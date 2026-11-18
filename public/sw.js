/* Share MUSIC service worker: network-first, falls back to cache when offline. */
const CACHE = 'ps-v43';
const SHELL = ['/', '/index.html', '/app.js', '/hooks.js', '/fx.js', '/media.js', '/community.js', '/posts.js', '/party.js', '/discover.js', '/css/discover.css', '/today.js', '/css/today.css', '/topics.js', '/css/topics.css', '/spread.js', '/css/spread.css', '/style.css', '/config.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/favicon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && !url.pathname.startsWith('/p/') && !url.pathname.startsWith('/api/')) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
      return res;
    } catch {
      return (await caches.match(req)) || (req.mode === 'navigate' ? caches.match('/index.html') : Response.error());
    }
  })());
});
