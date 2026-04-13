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
    } else if (action === "getSession") {
      result = _getCheckoutSession(body.sessionId);
    } else if (action === "provision") {
      result = _provisionRestaurant(body);
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
   _getCheckoutSession(sessionId)
   Retourne email, customerId, planId d'une Checkout Session
   ===================================================== */
function _getCheckoutSession(sessionId) {
  if (!sessionId) return { error: "sessionId manquant" };
  var secretKey = PropertiesService.getScriptProperties().getProperty("STRIPE_SECRET_KEY");
  try {
    var res  = UrlFetchApp.fetch(STRIPE_API + "/checkout/sessions/" + sessionId, {
      headers: { Authorization: "Bearer " + secretKey },
      muteHttpExceptions: true
    });
    var data = JSON.parse(res.getContentText());
    if (data.error) return { error: data.error.message };
    return {
      email:      data.customer_email || (data.customer_details && data.customer_details.email) || "",
      customerId: data.customer || "",
      planId:     (data.metadata && data.metadata.planId) || "essentiel"
    };
  } catch(e) {
    return { error: e.message };
  }
}

/* =====================================================
   _provisionRestaurant(body)
   Copie tous les fichiers de _template/ vers /{slug}/
   sur GitHub, en remplaçant "Resto1" par le vrai nom.
   ===================================================== */
function _provisionRestaurant(body) {
  var slug       = (body.slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "").substring(0, 30);
  var name       = (body.name       || slug).trim();
  var color      = body.color       || "#B8924F";
  var color2     = body.color2      || "#9E7A3E";
  var password   = body.password    || "";
  var customerId = body.customerId  || "";

  if (!slug)  return { error: "slug manquant" };
  if (!name)  return { error: "name manquant" };

  var token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  var repo  = PropertiesService.getScriptProperties().getProperty("GITHUB_REPO")
              || "compush-media/compush-media.gitub.io";

  if (!token) return { error: "GITHUB_TOKEN non configuré dans les propriétés du script" };

  // ── Fichiers à copier depuis _template/ ──
  var FILES = [
    { path: "index.html",                       binary: false },
    { path: "avis.html",                        binary: false },
    { path: "contact.html",                     binary: false },
    { path: "inscription.html",                 binary: false },
    { path: "merci.html",                       binary: false },
    { path: "offre-du-jour.html",               binary: false },
    { path: "redit.html",                       binary: false },
    { path: "reservation.html",                 binary: false },
    { path: "indexnfc.html",                    binary: false },
    { path: "progressier.json",                 binary: false },
    { path: "sw.js",                            binary: false },
    { path: "admin/1stat.html",                 binary: false },
    { path: "admin/billing.html",               binary: false },
    { path: "admin/espace-admin.html",          binary: false },
    { path: "admin/login.html",                 binary: false },
    { path: "admin/reputation-google.html",     binary: false },
    { path: "admin/setup-google.html",          binary: false },
    { path: "admin/state.html",                 binary: false },
    { path: "admin/state_admin_fidelavis.html", binary: false },
    { path: "admin/state_resto.html",           binary: false },
    { path: "icons/icon-512.png",               binary: true  },
    { path: "icons/icon-maskable-512.png",      binary: true  }
  ];

  var errors = [];
  var copied = 0;

  for (var i = 0; i < FILES.length; i++) {
    var file    = FILES[i];
    var srcPath = "_template/" + file.path;
    var dstPath = slug + "/" + file.path;

    try {
      // GET source file
      var getRes = UrlFetchApp.fetch(
        "https://api.github.com/repos/" + repo + "/contents/" + srcPath + "?ref=main",
        { headers: { Authorization: "token " + token, Accept: "application/vnd.github.v3+json" },
          muteHttpExceptions: true }
      );
      if (getRes.getResponseCode() !== 200) {
        errors.push("GET failed (" + getRes.getResponseCode() + "): " + srcPath);
        continue;
      }

      var srcData = JSON.parse(getRes.getContentText());
      var b64     = (srcData.content || "").replace(/\n/g, "");

      // Substitutions dans les fichiers texte
      var newB64;
      if (file.binary) {
        newB64 = b64;
      } else {
        var bytes = Utilities.base64Decode(b64);
        var text  = Utilities.newBlob(bytes).getDataAsString();
        text = text.replace(/Resto1/g, name);
        text = text.replace(/#B8924F/g, color);
        text = text.replace(/#9E7A3E/g, color2);
        // Remplacer le mot de passe admin par défaut si fourni
        if (password && file.path === "admin/login.html") {
          text = text.replace(/voltaire2025/g, password);
        }
        newB64 = Utilities.base64Encode(Utilities.newBlob(text).getBytes());
      }

      // PUT vers destination (avec gestion fichier existant)
      var ok = _githubPut(token, repo, dstPath,  newB64,
                          "provision: " + slug + "/" + file.path);
      if (ok) { copied++; } else { errors.push("PUT failed: " + dstPath); }

    } catch(e) {
      errors.push("Exception " + file.path + ": " + e.message);
    }
  }

  // Mettre à jour config.json avec le nom et les couleurs
  _updateSlugConfig(token, repo, slug, name, color, color2, customerId);

  Logger.log("_provisionRestaurant: " + slug + " — " + copied + "/" + FILES.length + " fichiers, " + errors.length + " erreurs");

  if (errors.length > 0) {
    Logger.log("Erreurs provision: " + errors.join("; "));
  }

  return { ok: true, slug: slug, copied: copied, total: FILES.length, errors: errors };
}

/**
 * _githubPut — écrit un fichier sur GitHub (crée ou met à jour)
 */
function _githubPut(token, repo, path, b64Content, message) {
  var apiUrl  = "https://api.github.com/repos/" + repo + "/contents/" + path;
  var headers = {
    Authorization: "token " + token,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json"
  };

  // Essai sans SHA (nouveau fichier)
  var payload = { message: message, content: b64Content, branch: "main" };
  var res = UrlFetchApp.fetch(apiUrl, {
    method: "put", headers: headers,
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code === 200 || code === 201) return true;

  // Fichier existant → récupérer le SHA et réessayer
  if (code === 422 || code === 409) {
    var getRes = UrlFetchApp.fetch(apiUrl + "?ref=main", {
      headers: { Authorization: "token " + token, Accept: "application/vnd.github.v3+json" },
      muteHttpExceptions: true
    });
    if (getRes.getResponseCode() === 200) {
      payload.sha = JSON.parse(getRes.getContentText()).sha;
      var retry = UrlFetchApp.fetch(apiUrl, {
        method: "put", headers: headers,
        payload: JSON.stringify(payload), muteHttpExceptions: true
      });
      var retryCode = retry.getResponseCode();
      return retryCode === 200 || retryCode === 201;
    }
  }

  Logger.log("_githubPut failed (" + code + "): " + path + " — " + res.getContentText().substring(0, 200));
  return false;
}

/**
 * _updateSlugConfig — met à jour config.json avec nom/couleurs
 * Si le config.json a déjà été créé par le webhook (billing data),
 * on merge pour ne pas écraser les données Stripe.
 */
function _updateSlugConfig(token, repo, slug, name, color, color2, customerId) {
  var apiUrl = "https://api.github.com/repos/" + repo + "/contents/" + slug + "/config.json";
  var headers = {
    Authorization: "token " + token,
    Accept: "application/vnd.github.v3+json"
  };

  var existing = {};
  var sha = null;

  var getRes = UrlFetchApp.fetch(apiUrl + "?ref=main", { headers: headers, muteHttpExceptions: true });
  if (getRes.getResponseCode() === 200) {
    var fd = JSON.parse(getRes.getContentText());
    sha = fd.sha;
    try {
      var raw = Utilities.newBlob(Utilities.base64Decode((fd.content || "").replace(/\n/g, ""))).getDataAsString();
      existing = JSON.parse(raw);
    } catch(e) {}
  }

  // Merger : préserver les données billing, mettre à jour name/color
  var updated = {
    name:                 name,
    color:                color,
    color2:               color2,
    brevoListId:          existing.brevoListId          || "",
    brevoGasUrl:          existing.brevoGasUrl          || "",
    plan:                 existing.plan                 || "pro",
    subscriptionStatus:   existing.subscriptionStatus   || "trialing",
    setupPaid:            existing.setupPaid            || false,
    trialEndDate:         existing.trialEndDate         || "",
    billingEmail:         existing.billingEmail         || "",
    stripeCustomerId:     existing.stripeCustomerId     || customerId,
    stripeSubscriptionId: existing.stripeSubscriptionId || "",
    nextBillingDate:      existing.nextBillingDate      || "",
    invoices:             existing.invoices             || []
  };

  var b64 = Utilities.base64Encode(Utilities.newBlob(JSON.stringify(updated, null, 2) + "\n").getBytes());
  var payload = { message: "provision: " + slug + "/config.json — name & colors", content: b64, branch: "main" };
  if (sha) payload.sha = sha;

  UrlFetchApp.fetch(apiUrl, {
    method: "put",
    headers: { Authorization: "token " + token, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
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
  // Modèle : 0€ aujourd'hui — 14 jours d'essai gratuit
  // Frais d'installation (199€) → InvoiceItem créé par le webhook après checkout
  //   → facturé automatiquement avec le 1er prélèvement (J+14)
  // Abonnement mensuel → démarre après le trial
  var lineItems = [
    "line_items[0][price]=" + priceId,
    "line_items[0][quantity]=1"
  ];

  // Construire le payload
  var params = [
    "mode=subscription",
    "payment_method_types[0]=card",
    successUrl ? ("success_url=" + encodeURIComponent(successUrl)) : "",
    cancelUrl  ? ("cancel_url="  + encodeURIComponent(cancelUrl))  : "",
    email      ? ("customer_email=" + encodeURIComponent(email))   : "",
    "metadata[planId]="     + encodeURIComponent(planId),
    "metadata[source]=fidelavis-web",
    // Passer setupPriceId en metadata → webhook crée l'InvoiceItem
    setupPriceId ? ("metadata[setupPriceId]=" + encodeURIComponent(setupPriceId)) : "",
    "allow_promotion_codes=true",
    "billing_address_collection=auto",
    "subscription_data[trial_period_days]=14",
    // Forcer la collecte du moyen de paiement même sans débit immédiat
    "payment_method_collection=always"
  ].concat(lineItems).filter(Boolean).join("&");

  // Ajouter les metadata custom
  Object.keys(metadata).forEach(function(k) {
    if (k !== "planId" && k !== "source" && k !== "setupPriceId") {
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
