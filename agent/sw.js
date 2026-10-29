// Fidelavis Agent — service worker de l'espace commerçant (/agent/).
// Il rend l'espace installable sur l'écran d'accueil et reçoit les notifications de l'Action du jour.
// Rien n'est mis en cache : l'Action du jour et les positions doivent toujours être celles du jour.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (evenement) => evenement.waitUntil(self.clients.claim()));
// La page de l'espace est toujours redemandée au serveur, jamais reprise du cache du navigateur :
// une nouvelle version publiée est visible à la prochaine ouverture. Hors connexion, la requête normale.
self.addEventListener("fetch", (evenement) => {
  const requete = evenement.request;
  if (requete.mode !== "navigate" || !new URL(requete.url).pathname.startsWith("/agent/")) return;
  evenement.respondWith(
    fetch(requete.url, { cache: "no-store", credentials: "same-origin" }).catch(() => fetch(requete)),
  );
});

self.addEventListener("push", (evenement) => {
  let message = {};
  try {
    message = evenement.data ? evenement.data.json() : {};
  } catch {
    // Charge illisible : la notification générique ci-dessous suffit.
  }
  evenement.waitUntil(
    self.registration.showNotification(message.titre || "Votre Action du jour est prête", {
      body: message.corps || "2 minutes depuis votre téléphone.",
      icon: "/agent/icons/icon-512.png",
      badge: "/agent/icons/icon-512.png",
      tag: "action-du-jour",
      data: { url: message.url || "/agent/" },
    }),
  );
});

// Un appui ouvre l'espace (ou y revient s'il est déjà ouvert), directement sur l'Action du jour.
self.addEventListener("notificationclick", (evenement) => {
  evenement.notification.close();
  const adresse = new URL(evenement.notification.data?.url || "/agent/", self.location.origin);
  evenement.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((fenetres) => {
      const ouverte = fenetres.find((f) => new URL(f.url).pathname.startsWith("/agent/"));
      if (ouverte) {
        ouverte.navigate(adresse.href).catch(() => {});
        return ouverte.focus();
      }
      return self.clients.openWindow(adresse.href);
    }),
  );
});
