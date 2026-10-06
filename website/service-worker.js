/**
 * Service worker for offline support.
 *
 * Caches the catalog assets (skills.min.json, search.idx.json) and the
 * shell (index.html, CSS, JS bundle) so the catalog remains browsable
 * offline.
 *
 * Strategy:
 *   - Cache-first only for Vite's content-hashed files under /assets/ —
 *     their URL changes whenever their content does, so a cached copy is
 *     never stale.
 *   - Network-first for everything else (HTML, JSON data, unhashed files),
 *     falling back to the cache only when offline. A cache-first HTML shell
 *     would pin visitors to an old build until a hard reload.
 *   - Cross-origin and non-GET requests pass through untouched.
 *
 * Bump CACHE_NAME when the strategy changes; `activate` deletes every other
 * cache, which evicts responses stored under an older strategy.
 */
const CACHE_NAME = "asm-catalog-v2";
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
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function putInCache(request, response) {
  if (!response.ok) return;
  const clone = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            putInCache(request, response);
            return response;
          }),
      ),
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        putInCache(request, response);
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || Response.error()),
      ),
  );
});
