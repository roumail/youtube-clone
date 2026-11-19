// App service worker. Online: network first, so a
// deploy shows up on the next open. Offline: the cached app shell. Videos are
// not here; they live in Shaka's IndexedDB storage.
const CACHE = 'app-v2';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './library.js', './pin.js', './player.js',
  './local-scheme.js', './features.js', './features/watch-time.js', './vendor/shaka-player-5.3.5.compiled.js',
  './manifest.webmanifest', './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
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
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('app-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  e.respondWith((async () => {
    try {
      const fresh = await fetch(request, { cache: 'no-cache' });
      if (fresh.ok) {
        const copy = fresh.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
      }
      return fresh;
    } catch {
      // Run by "the app and a stored video work with no network"; Chrome reports
      // no block coverage inside an installed service worker (owner OK).
      // v8 ignore next
      return (await caches.match(request, { ignoreSearch: true })) ?? Response.error();
    }
  })());
});
