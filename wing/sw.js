const CACHE_NAME = "fidelavis-wing-v3";

const FILES_TO_CACHE = [
  "/wing/",
  "/wing/index.html",
  "/wing/indexnfc.html",
  "/wing/inscription.html",
  "/wing/redit.html"
];

// INSTALL
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

// ACTIVATE
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

// FETCH
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url     = new URL(request.url);

  // config.json = TOUJOURS réseau (jamais cache, données billing en temps réel)
  if (url.pathname.endsWith("/config.json")) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // HTML = network first
  if (request.headers.get("accept")?.includes("text/html")) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Static files = cache first
  event.respondWith(
    caches.match(request)
      .then(response => response || fetch(request))
  );
});
