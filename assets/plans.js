/* =====================================================
   Fidelavis — plans.js
   Configuration des offres + helpers plan/feature
   ===================================================== */

/* --------------------------------------------------
   STRIPE CONFIG
   Remplacer les valeurs par vos vraies clés Stripe
-------------------------------------------------- */
var STRIPE_CONFIG = {
  // Clé publique Stripe (mode test)
  publishableKey: "pk_test_bb0bwiR1lGv5bUv2cHCNZSq6",

  // URL du Google Apps Script proxy (crée les Checkout Sessions)
  checkoutGasUrl: "https://script.google.com/macros/s/AKfycbyUEPhWO-AhN3XefyYqOBnmaDDfd8oOV1YAaMaZizN9dEKbeY-9zabt8Dt318OWDxDXkQ/exec",

  // URL du Google Apps Script proxy (portail client Stripe)
  portalGasUrl: "https://script.google.com/macros/s/AKfycbyUEPhWO-AhN3XefyYqOBnmaDDfd8oOV1YAaMaZizN9dEKbeY-9zabt8Dt318OWDxDXkQ/exec",

  // IDs des prix Stripe — Offre Terrain unique
  //
  // ⚠️ MODE TEST. Le script Apps Script tourne avec une clé sk_test_ ; ce
  //    price doit donc être celui du catalogue de test. Pour passer en
  //    production, changer LES DEUX ensemble :
  //      1. STRIPE_SECRET_KEY → sk_live_… dans les propriétés du script
  //      2. le price ci-dessous → price_1U44HiDpSXl9WhzrjHE1ALcL (79 €, réel)
  priceIds: {
    terrain: "price_1U45nyDpSXl9WhzrCbOobjru"  // 79 €/mois
  }
};

/* --------------------------------------------------
   PLANS — Offre Terrain unique 79€/mois
-------------------------------------------------- */
var PLANS = {
  terrain: {
    id:           "terrain",
    name:         "Offre Terrain",
    monthlyPrice: 79,
    setupPrice:   0,        // Mise en place offerte
    currency:     "EUR",
    recommended:  true,
    description:  "Tout-en-un pour fidéliser vos clients dès aujourd'hui",
    features: [
      "10 cartes NFC prêtes à poser",
      "Notifications push illimitées",
      "Offres & coupons fidélité",
      "Collecte automatique des emails",
      "Plus d'avis Google naturellement",
      "Tableau de bord simple"
    ],
    priceId:      null,
    setupPriceId: null
  }
};

// Injecter les priceIds depuis STRIPE_CONFIG
PLANS.terrain.priceId = STRIPE_CONFIG.priceIds.terrain;
// setupPriceId reste null (mise en place offerte)

/* --------------------------------------------------
   PENNYLANE — facturation électronique
   Remplacer apiKey par votre clé Pennylane
-------------------------------------------------- */
var PENNYLANE = {
  apiKey:    "REMPLACER_PAR_CLE_API_PENNYLANE",
  apiUrl:    "https://app.pennylane.com/api/external/v1",
  // GAS proxy pour appels Pennylane (clé jamais exposée côté client)
  gasUrl:    "REMPLACER_PAR_URL_GAS_PENNYLANE"
};

/* --------------------------------------------------
   Helpers publics
-------------------------------------------------- */

/**
 * isPro(plan) — déprécié (1 seul plan désormais).
 * Retourne true si le plan est actif (terrain).
 */
function isPro(plan) {
  var p = (plan || "").toLowerCase();
  return p === "terrain" || p === "pro";   // "pro" toléré pour ancien data
}

/**
 * hasFeature(plan, featureKey) — vérifie si une feature
 * est disponible pour le plan donné
 * @param {string} plan — "terrain"
 * @param {string} featureKey — mot-clé à chercher dans les features
 */
function hasFeature(plan, featureKey) {
  var p = (plan || "terrain").toLowerCase();
  // Compat ascendante : essentiel/pro → on traite comme terrain
  if (p === "essentiel" || p === "pro") p = "terrain";
  if (!PLANS[p]) return false;
  var key = featureKey.toLowerCase();
  return PLANS[p].features.some(function(f) {
    return f.toLowerCase().indexOf(key) !== -1;
  });
}

/**
 * getPlan(planId) — retourne l'objet plan complet
 * Compat : essentiel/pro mappés vers terrain.
 */
function getPlan(planId) {
  var p = (planId || "").toLowerCase();
  if (p === "essentiel" || p === "pro") p = "terrain";
  return PLANS[p] || null;
}

/**
 * getPlanLabel(plan) — retourne le libellé affiché
 */
function getPlanLabel(plan) {
  var p = getPlan(plan);
  return p ? p.name : (plan || "—");
}

/**
 * getPlanPrice(plan) — retourne le prix mensuel (€)
 */
function getPlanPrice(plan) {
  var p = getPlan(plan);
  return p ? p.monthlyPrice : null;
}

/**
 * formatPrice(amount, currency) — formate un montant
 */
function formatPrice(amount, currency) {
  currency = currency || "EUR";
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency", currency: currency, maximumFractionDigits: 0
    }).format(amount);
  } catch(e) {
    return amount + " €";
  }
}

/**
 * getStatusLabel(status) — libellé francisé d'un statut Stripe
 */
function getStatusLabel(status) {
  var map = {
    active:            "Actif",
    past_due:          "Paiement en retard",
    canceled:          "Résilié",
    incomplete:        "En attente",
    incomplete_expired:"Expiré",
    trialing:          "Période d'essai",
    unpaid:            "Impayé",
    paused:            "Suspendu"
  };
  return map[status] || status || "—";
}

/**
 * getStatusColor(status) — couleur CSS selon statut
 */
function getStatusColor(status) {
  var colors = {
    active:   "#16a34a",
    trialing: "#2563eb",
    past_due: "#d97706",
    unpaid:   "#dc2626",
    canceled: "#6b7280",
    paused:   "#9333ea"
  };
  return colors[status] || "#6b7280";
}
