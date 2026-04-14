/**
 * sw-null.js — Service Worker de nettoyage à la racine
 * S'installe avec scope "/" et remplace tous les autres SW (Progressier, etc.)
 * Ne cache RIEN et n'intercepte AUCUNE requête.
 */

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Pas de fetch handler = toutes les requêtes vont directement au réseau
