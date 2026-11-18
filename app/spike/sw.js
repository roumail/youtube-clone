// Spike service worker. Online: network first (so updates always show up).
// Offline: fall back to the cached app shell. Videos are not here; they live
// in Shaka's IndexedDB storage. `cache: 'reload'` bypasses the HTTP cache so a
// new version never caches stale files.
const CACHE = 'spike-v5';
const SHELL = [
  './', './index.html', './spike.js', './manifest.webmanifest', './icon-180.png', './icon-512.png',
  '../local-scheme.js', '../vendor/shaka-player-5.3.5.compiled.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith((async () => {
    try {
      const fresh = await fetch(e.request, { cache: 'no-cache' });
      if (fresh.ok) {
        const copy = fresh.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return fresh;
    } catch {
      return (await caches.match(e.request, { ignoreSearch: true })) ?? Response.error();
    }
  })());
});
