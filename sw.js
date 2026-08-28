/* Offline cache for Greenwave Ops */
var CACHE = 'greenwave-v4';
var FILES = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/assets/app.css',
  '/assets/app.js',
  '/assets/store.js',
  '/assets/photos.js',
  '/assets/logo.png',
  '/assets/icon-192.png',
  '/assets/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(FILES);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith('http')) return;

  e.respondWith(
    fetch(e.request).then(function (res) {
      if (res && res.status === 200 && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (r) {
        if (r) return r;
        var accept = e.request.headers.get('accept') || '';
        if (e.request.mode === 'navigate' || accept.indexOf('text/html') !== -1) {
          return caches.match('/index.html') || caches.match('/');
        }
        return new Response('Network error', { status: 408, statusText: 'Request Timeout' });
      });
    })
  );
});
