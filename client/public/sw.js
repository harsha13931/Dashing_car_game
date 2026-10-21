// Dash Arena service worker: makes the game installable and opens instantly.
// Hashed build files (/assets/*) are cached forever; the page itself is
// fetched fresh when online so updates show up on the next launch.
const CACHE = 'dash-arena-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys()
        .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    const url = new URL(req.url);
    if (req.method !== 'GET' || url.origin !== location.origin) return;
    if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api')) return;

    if (req.mode === 'navigate') {
        // Network first, cached page when offline
        e.respondWith(fetch(req).then(res => {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put('/', copy));
            return res;
        }).catch(() => caches.match('/')));
        return;
    }
    // Everything else: cache first, then network (and remember it)
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
    })));
});
