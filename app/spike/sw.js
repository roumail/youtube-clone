// Spike service worker: cache-first app shell so the installed spike opens
// offline. Videos are not here; they live in Shaka's IndexedDB storage.
const CACHE = 'spike-v3';
const SHELL = [
  './', './index.html', './spike.js', './manifest.webmanifest', './icon-180.png', './icon-512.png',
  '../local-scheme.js', '../vendor/shaka-player-5.3.5.compiled.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit ?? fetch(e.request)));
});
