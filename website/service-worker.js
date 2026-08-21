/**
 * Service worker for offline support.
 *
 * Caches the catalog assets (skills.min.json, search.idx.json) and the
 * shell (index.html, CSS, JS bundle) so the catalog remains browsable
 * offline. Cache is invalidated on build by the `generatedAt` timestamp
 * embedded in each JSON file — a new build triggers a cache swap.
 *
 * Strategy:
 *   - Network-first for JSON data files (always fetch fresh, fall back to cache)
 *   - Cache-first for static assets (HTML, CSS, JS)
 */
const CACHE_NAME = "asm-catalog-v1";
const DATA_FILES = ["/skills.min.json", "/search.idx.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(DATA_FILES);
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)),
      );
    }),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { url } = event.request;

  // JSON data files — network-first with cache fallback
  if (DATA_FILES.some((path) => url.includes(path))) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Clone response to cache and return
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  // Everything else — cache-first for static assets
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        // Cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    }),
  );
});
