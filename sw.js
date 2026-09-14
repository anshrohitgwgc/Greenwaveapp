/* Offline cache for Greenwave Ops */
var CACHE = 'greenwave-v24-payments-finance-ops';
var FILES = [
  '/',
  '/index.html',
  '/manifest.webmanifest?v=20260913_financeops',
  '/assets/app.css?v=20260913_financeops',
  '/assets/api.js?v=20260913_financeops',
  '/assets/app.js?v=20260913_financeops',
  '/assets/store.js?v=20260913_financeops',
  '/assets/photos.js?v=20260913_financeops',
  '/assets/logo.png?v=20260913_financeops',
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

  var url = new URL(e.request.url);

  // Security Hardening: NEVER cache any API endpoint, auth, financial data,
  // payment portal, banking, accounting, employees, or SSE stream. Only static assets may be cached.
  if (
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/auth') ||
    url.pathname.startsWith('/pay') ||
    url.pathname.startsWith('/p/') ||
    url.pathname.startsWith('/payments') ||
    url.pathname.startsWith('/accounting') ||
    url.pathname.startsWith('/banking') ||
    url.pathname.startsWith('/payables') ||
    url.pathname.startsWith('/employees') ||
    url.pathname.startsWith('/divisions') ||
    url.pathname.startsWith('/roles') ||
    url.pathname.startsWith('/permissions') ||
    url.pathname.startsWith('/timesheets') ||
    url.pathname.startsWith('/photos') ||
    url.pathname.startsWith('/invoices') ||
    url.pathname.startsWith('/purchase-orders') ||
    url.pathname.match(/^\/(users|warehouses|customers|materials|containers|inventory|greenwave-photos|audit|pickups|chat)(\/.*)?$/)
  ) {
    return;
  }

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
