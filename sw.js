const CACHE = 'kalometr-v6';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/foods.js',
  './js/off.js',
  './js/store.js',
  './js/supabase-config.js',
  './js/firebase-config.js',
  './js/cloud.js',
  './js/photos.js',
  './js/app.js',
  './manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(ASSETS.map(async (u) => {
      const r = await fetch(u, { cache: 'no-cache' });
      if (r.ok) await c.put(u, r);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// network-first: онлайн — всегда свежие файлы, офлайн — из кеша
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // внешние API (Open Food Facts, Supabase) не трогаем
  if (e.request.method !== 'GET') return;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' });
      if (res.ok) {
        const clone = res.clone();
        const c = await caches.open(CACHE);
        c.put(e.request, clone).catch(() => {});
      }
      return res;
    } catch (err) {
      const cached = await caches.match(e.request);
      if (cached) return cached;
      if (e.request.mode === 'navigate') return (await caches.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});
