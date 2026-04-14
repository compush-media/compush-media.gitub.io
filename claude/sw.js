const CACHE_NAME = "fidelavis-claude-v2";

const FILES_TO_CACHE = [
  "/claude/",
  "/claude/index.html",
  "/claude/indexnfc.html",
  "/claude/inscription.html",
  "/claude/redit.html",
  "/claude/config.json"
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

// FETCH (network first for HTML, cache first for assets)
self.addEventListener("fetch", (event) => {
  const request = event.request;

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
