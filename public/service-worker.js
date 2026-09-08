'use strict';

// Bump this on every deploy that changes any cached file — it's what
// forces old clients to pick up the new shell instead of a stale one.
const CACHE_VERSION = 'afripass-shell-v1';

const SHELL_FILES = [
  '/app.html',
  '/manifest.webmanifest',
  '/css/style.css',
  '/css/mobile.css',
  '/js/app.js',
  '/js/mobile/app.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache the API. Business data is per-session and can be
  // sensitive (a shared/borrowed device is a realistic scenario for a
  // trust-verification app) — always go to the network for it.
  if (url.pathname.startsWith('/api/')) {
    return; // let the browser handle it normally
  }

  if (event.request.method !== 'GET') return;

  // App-shell navigations: try the network first (so you always get the
  // latest build when online), fall back to the cached shell when offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/app.html'))
    );
    return;
  }

  // Static assets: cache-first, refresh the cache in the background.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, response.clone()));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
