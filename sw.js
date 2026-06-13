// ═══════════ Haushalts-Helpy Service Worker ═══════════
// Strategie: "Network first" für die App selbst — solange online, kommt IMMER
// die neueste Version (kein Hängenbleiben auf alten Ständen). Nur wenn offline,
// wird die zuletzt gecachte Version geliefert. PocketBase-API wird NIE gecacht.

const CACHE = 'hhelpy-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Nur GET-Anfragen behandeln
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // PocketBase-Backend & andere fremde Hosts: immer direkt durchs Netz, nie cachen
  if (url.origin !== self.location.origin) return;

  // Network-first für die App-Dateien
  e.respondWith(
    fetch(req)
      .then((res) => {
        // Frische Antwort in den Cache spiegeln (für Offline)
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
