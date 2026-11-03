// Service worker: rende l'app utilizzabile offline.
// Al primo avvio (online) salva in cache la pagina e le librerie esterne; poi funziona senza rete.
const CACHE = 'valmaura-locale-v10';
const LOCALI = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './logo-ater.jpg', './export-zip.js', './scheda-foto.js'];
const ESTERNI = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(LOCALI.map(url => new Request(url, { cache: 'reload' })));
    // Le librerie esterne vengono salvate anche come risposta "opaca" (no-cors)
    await Promise.all(ESTERNI.map(async url => {
      try { await cache.put(url, await fetch(new Request(url, { mode: 'no-cors' }))); } catch (e) {}
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const nomi = await caches.keys();
    await Promise.all(nomi.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // File dell'app (pagina, script): prima la rete, cosi' gli aggiornamenti si vedono subito; cache solo offline
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const risposta = await fetch(event.request, { cache: 'no-cache' });
        if (risposta && risposta.ok) cache.put(event.request, risposta.clone());
        return risposta;
      } catch (e) {
        const inCache = await cache.match(event.request, { ignoreSearch: true });
        if (inCache) return inCache;
        if (event.request.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
        return Response.error();
      }
    })());
    return;
  }
  // Librerie esterne: cache-first
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const inCache = await cache.match(event.request, { ignoreSearch: true });
    if (inCache) return inCache;                 // cache-first: parte subito anche senza rete
    try {
      const risposta = await fetch(event.request);
      if (risposta && (risposta.ok || risposta.type === 'opaque')) cache.put(event.request, risposta.clone());
      return risposta;
    } catch (e) {
      if (event.request.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});
