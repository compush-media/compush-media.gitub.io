// Fidelavis Agent — service worker de l'espace commerçant (/agent/).
// Il rend l'espace installable sur l'écran d'accueil. Rien n'est mis en cache : l'Action du jour et
// les positions doivent toujours être celles du jour. Les notifications arriveront avec l'Action du jour.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (evenement) => evenement.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
