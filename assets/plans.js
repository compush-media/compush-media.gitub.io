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
  checkoutGasUrl: "https://script.google.com/macros/s/AKfycbzHJTQS6BoHH1r4VfMOGRsI5yi5uHFPT_HPPIObnRcheJIYurrFGVD3k36NfnMpQJHaWA/exec",

  // URL du Google Apps Script proxy (portail client Stripe)
  portalGasUrl: "https://script.google.com/macros/s/AKfycbzHJTQS6BoHH1r4VfMOGRsI5yi5uHFPT_HPPIObnRcheJIYurrFGVD3k36NfnMpQJHaWA/exec",

  // IDs des prix Stripe (mode test)
  priceIds: {
    setup:     "price_1TKmDvDpSXl9Whzr1VHwlRj5",   // 199 € installation (one-time)
    essentiel: "price_1TKmIoDpSXl9Whzr8iKy2Dhl",   // 97 €/mois
    pro:       "price_1TKmNtDpSXl9WhzrsMhfAShh"    // 149 €/mois
  }
};

/* --------------------------------------------------
   PLANS — définition des offres
-------------------------------------------------- */
var PLANS = {
  essentiel: {
    id:           "essentiel",
    name:         "Essentiel",
    monthlyPrice: 97,
    setupPrice:   199,
    currency:     "EUR",
    recommended:  false,
    description:  "Pour démarrer avec la fidélité digitale",
    features: [
      "QR code fidélité personnalisé",
      "Coupon mensuel automatique",
      "Tableau de bord admin",
      "Notifications push clients",
      "1 établissement"
    ],
    priceId:      null, // défini dynamiquement depuis STRIPE_CONFIG
    setupPriceId: null
  },
  pro: {
    id:           "pro",
    name:         "Pro",
    monthlyPrice: 149,
    setupPrice:   199,
    currency:     "EUR",
    recommended:  true,
    description:  "Pour les restaurateurs qui veulent tout maîtriser",
    features: [
      "Tout le plan Essentiel",
      "Réponses avis IA (Claude)",
      "Google Business intégré",
      "Statistiques avancées",
      "Support prioritaire"
    ],
    priceId:      null,
    setupPriceId: null
  }
};

// Injecter les priceIds depuis STRIPE_CONFIG
PLANS.essentiel.priceId      = STRIPE_CONFIG.priceIds.essentiel;
PLANS.essentiel.setupPriceId = STRIPE_CONFIG.priceIds.setup;
PLANS.pro.priceId            = STRIPE_CONFIG.priceIds.pro;
PLANS.pro.setupPriceId       = STRIPE_CONFIG.priceIds.setup;

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
 * isPro(plan) — true si le plan est "pro"
 */
function isPro(plan) {
  return (plan || "").toLowerCase() === "pro";
}

/**
 * hasFeature(plan, featureKey) — vérifie si une feature
 * est disponible pour le plan donné
 * @param {string} plan — "essentiel" | "pro"
 * @param {string} featureKey — mot-clé à chercher dans les features
 */
function hasFeature(plan, featureKey) {
  var p = (plan || "essentiel").toLowerCase();
  if (!PLANS[p]) return false;
  var key = featureKey.toLowerCase();
  return PLANS[p].features.some(function(f) {
    return f.toLowerCase().indexOf(key) !== -1;
  });
}

/**
 * getPlan(planId) — retourne l'objet plan complet
 */
function getPlan(planId) {
  return PLANS[(planId || "").toLowerCase()] || null;
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
