/**
 * Fidelavis — stripeCheckout.gs
 * Google Apps Script proxy pour Stripe Checkout
 *
 * Ce script crée des Checkout Sessions Stripe et des portails clients.
 * La clé secrète Stripe est stockée dans les propriétés du script (jamais exposée).
 *
 * DÉPLOIEMENT :
 * 1. Aller sur https://script.google.com → Nouveau projet
 * 2. Coller ce code
 * 3. Extensions > Propriétés du script > Ajouter :
 *    - STRIPE_SECRET_KEY  : sk_live_xxx  (ou sk_test_xxx pour les tests)
 *    - FIDELAVIS_SITE_URL : https://app.cartefidelavis.com
 * 4. Déployer > Nouveau déploiement > Application Web
 *    - Exécuter en tant que : Moi
 *    - Accès : Tout le monde (anonyme)
 * 5. Copier l'URL et la mettre dans assets/plans.js → STRIPE_CONFIG.checkoutGasUrl
 */

var STRIPE_API = "https://api.stripe.com/v1";

/* =====================================================
   doPost — point d'entrée principal
   ===================================================== */
function doPost(e) {
  // CORS headers
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    var body    = JSON.parse(e.postData.contents);
    var action  = body.action || "";
    var result  = {};

    if (action === "createCheckoutSession") {
      result = createCheckoutSession(body);
    } else if (action === "createPortalSession") {
      result = createPortalSession(body);
    } else {
      result = { error: "Action inconnue : " + action };
    }

    output.setContent(JSON.stringify(result));
  } catch(err) {
    output.setContent(JSON.stringify({ error: err.message || "Erreur interne" }));
  }

  return output;
}

/* doGet pour les tests CORS preflight */
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: "Fidelavis Stripe Checkout" }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* =====================================================
   createCheckoutSession(body)
   Crée une session Checkout Stripe avec :
   - frais d'installation one-time (199€)
   - abonnement mensuel (essentiel 97€ ou pro 149€)
   ===================================================== */
function createCheckoutSession(body) {
  var secretKey    = PropertiesService.getScriptProperties().getProperty("STRIPE_SECRET_KEY");
  var siteUrl      = PropertiesService.getScriptProperties().getProperty("FIDELAVIS_SITE_URL") || "https://app.cartefidelavis.com";

  if (!secretKey) return { error: "STRIPE_SECRET_KEY non configurée" };

  var planId       = body.planId       || "essentiel";
  var priceId      = body.priceId      || "";
  var setupPriceId = body.setupPriceId || "";
  var email        = body.email        || "";
  var successUrl   = body.successUrl   || (siteUrl + "/fidelavis-admin/merci-abonnement.html?session_id={CHECKOUT_SESSION_ID}");
  var cancelUrl    = body.cancelUrl    || (siteUrl + "/fidelavis-admin/");
  var metadata     = body.metadata     || {};

  if (!priceId) return { error: "priceId manquant" };

  // Construire les line_items
  // 1) Frais d'installation (one-time) si setupPriceId fourni
  // 2) Abonnement mensuel
  var lineItems = [];

  if (setupPriceId) {
    lineItems.push("line_items[0][price]=" + setupPriceId);
    lineItems.push("line_items[0][quantity]=1");
    lineItems.push("line_items[1][price]=" + priceId);
    lineItems.push("line_items[1][quantity]=1");
  } else {
    lineItems.push("line_items[0][price]=" + priceId);
    lineItems.push("line_items[0][quantity]=1");
  }

  // Construire le payload
  var params = [
    "mode=subscription",
    "payment_method_types[0]=card",
    successUrl ? ("success_url=" + encodeURIComponent(successUrl)) : "",
    cancelUrl  ? ("cancel_url="  + encodeURIComponent(cancelUrl))  : "",
    email      ? ("customer_email=" + encodeURIComponent(email))   : "",
    "metadata[planId]=" + encodeURIComponent(planId),
    "metadata[source]=fidelavis-web",
    "allow_promotion_codes=true",
    "billing_address_collection=auto"
  ].concat(lineItems).filter(Boolean).join("&");

  // Ajouter les metadata custom
  var metaIdx = 2;
  Object.keys(metadata).forEach(function(k) {
    if (k !== "planId" && k !== "source") {
      params += "&metadata[" + encodeURIComponent(k) + "]=" + encodeURIComponent(metadata[k]);
    }
  });

  var response = UrlFetchApp.fetch(STRIPE_API + "/checkout/sessions", {
    method:             "post",
    headers:            { Authorization: "Bearer " + secretKey },
    contentType:        "application/x-www-form-urlencoded",
    payload:            params,
    muteHttpExceptions: true
  });

  var data = JSON.parse(response.getContentText());
  if (data.error) return { error: data.error.message || "Erreur Stripe" };

  return { url: data.url, sessionId: data.id };
}

/* =====================================================
   createPortalSession(body)
   Crée une session portail client Stripe
   (gestion abonnement, CB, téléchargement factures)
   ===================================================== */
function createPortalSession(body) {
  var secretKey = PropertiesService.getScriptProperties().getProperty("STRIPE_SECRET_KEY");
  var siteUrl   = PropertiesService.getScriptProperties().getProperty("FIDELAVIS_SITE_URL") || "https://app.cartefidelavis.com";

  if (!secretKey)         return { error: "STRIPE_SECRET_KEY non configurée" };
  if (!body.customerId)   return { error: "customerId manquant" };

  var returnUrl = body.returnUrl || siteUrl;

  var params = [
    "customer="    + encodeURIComponent(body.customerId),
    "return_url="  + encodeURIComponent(returnUrl)
  ].join("&");

  var response = UrlFetchApp.fetch(STRIPE_API + "/billing_portal/sessions", {
    method:             "post",
    headers:            { Authorization: "Bearer " + secretKey },
    contentType:        "application/x-www-form-urlencoded",
    payload:            params,
    muteHttpExceptions: true
  });

  var data = JSON.parse(response.getContentText());
  if (data.error) return { error: data.error.message || "Erreur Stripe" };

  return { url: data.url };
}
