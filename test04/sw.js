const CACHE_NAME = "fidelavis-test04-v2";

const FILES_TO_CACHE = [
  "/test04/",
  "/test04/index.html",
  "/test04/indexnfc.html",
  "/test04/inscription.html",
  "/test04/redit.html",
  "/test04/config.json"
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
