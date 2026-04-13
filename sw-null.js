/**
 * sw-null.js — Service Worker de nettoyage à la racine
 * S'installe avec scope "/" et remplace tous les autres SW (Progressier, etc.)
 * Ne fait AUCUN cache — laisse passer toutes les requêtes vers le réseau.
 */

// Activation immédiate sans attendre la fermeture des onglets
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Toutes les requêtes → réseau directement, aucun cache
self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
});
