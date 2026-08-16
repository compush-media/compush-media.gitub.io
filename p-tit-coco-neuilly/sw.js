/* Service worker d'un wallet.

   Le slug se déduit de l'emplacement du fichier (/casa-loca/sw.js) au lieu
   d'être écrit en dur. Les 98 copies portaient toutes « resto1 », un dossier
   qui renvoie 404 : cache.addAll() est tout-ou-rien, l'installation était
   donc rejetée et AUCUN wallet n'a jamais eu de service worker actif.
   Se déduire du chemin rend la copie identique pour tous les restaurants,
   aujourd'hui comme pour les 929 à venir. */

const BASE = self.location.pathname.replace(/[^/]*$/, "");        // "/casa-loca/"
const SLUG = BASE.split("/").filter(Boolean).pop() || "resto";
const CACHE_NAME = "fidelavis-" + SLUG + "-v5";

const FILES_TO_CACHE = [
  BASE,
  BASE + "index.html",
  BASE + "indexnfc.html",
  BASE + "inscription.html",
  BASE + "redit.html"
];

// INSTALL
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // cache.add() page par page : une page absente ne doit plus faire
      // échouer l'installation entière, sinon plus rien ne fonctionne.
      Promise.all(FILES_TO_CACHE.map(url => cache.add(url).catch(() => null)))
    )
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
      fetch(request, { cache: "no-store" }).catch(() => caches.match(request))
    );
    return;
  }

  // /assets/ (JS, CSS partagés) = network first, no HTTP cache
  // → garantit que admin-trial.js, admin-billing.js sont toujours à jour
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      fetch(request, { cache: "no-cache" }).catch(() => caches.match(request))
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

  // Other static files (icons, images) = cache first
  event.respondWith(
    caches.match(request)
      .then(response => response || fetch(request))
  );
});
