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
 *    - BREVO_API_KEY      : xkeysib-xxx (pour envoyer depuis support@fidelavis.com)
 *    - BILLING_SHEET_ID   : ID de la Google Sheet fidelavis-billing
 * 4. Déployer > Nouveau déploiement > Application Web
 *    - Exécuter en tant que : Moi
 *    - Accès : Tout le monde (anonyme)
 * 5. Copier l'URL et la mettre dans assets/plans.js → STRIPE_CONFIG.checkoutGasUrl
 */

var STRIPE_API = "https://api.stripe.com/v1";

/**
 * _sendEmail(to, subject, body)
 * Envoie depuis support@fidelavis.com via Brevo.
 * Fallback MailApp si BREVO_API_KEY absent.
 */
function _sendEmail(to, subject, body) {
  if (!to) return;
  var apiKey = PropertiesService.getScriptProperties().getProperty("BREVO_API_KEY");
  if (apiKey) {
    try {
      var res = UrlFetchApp.fetch("https://api.brevo.com/v3/smtp/email", {
        method:             "post",
        headers:            { "api-key": apiKey, "Content-Type": "application/json" },
        payload:            JSON.stringify({
          sender:      { name: "Fidelavis", email: "support@fidelavis.com" },
          to:          [{ email: to }],
          subject:     subject,
          textContent: body
        }),
        muteHttpExceptions: true
      });
      Logger.log("_sendEmail Brevo → " + to + " | " + res.getResponseCode());
      return;
    } catch(e) {
      Logger.log("_sendEmail Brevo error: " + e.message);
    }
  }
  try {
    MailApp.sendEmail(to, subject, body);
    Logger.log("_sendEmail MailApp → " + to);
  } catch(e) {
    Logger.log("_sendEmail MailApp error: " + e.message);
  }
}

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
    } else if (action === "createSetupSession") {
      result = createSetupSession(body);
    } else if (action === "finalizeSetup") {
      result = _finalizeSetup(body);
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
      planId:     (data.metadata && data.metadata.planId) || "terrain"
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
  var email      = body.email       || "";
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
    { path: "admin/print-qr.html",              binary: false },
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
        text = text.replace(/resto1/g, slug);    // chemins URL, cache names, scopes
        text = text.replace(/#B8924F/gi, color); // insensible à la casse (#b8924f aussi)
        text = text.replace(/#9E7A3E/gi, color2);
        text = text.replace(/#B48C4A/gi, color); // variante dans index.html
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

  // Mettre à jour config.json avec le nom, couleurs et données Stripe
  _updateSlugConfig(token, repo, slug, name, color, color2, customerId, email);

  // Mettre à jour la Sheet : remplacer le placeholder customerId par le vrai slug
  // pour que les futurs webhooks (invoice.paid etc.) trouvent le bon restoId
  if (customerId) {
    _updateSheetRestoId(customerId, slug);
  }

  // Envoyer l'email avec les accès au tableau de bord
  if (email) {
    _sendProvisionEmail(email, name, slug, password);
  }

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
function _updateSlugConfig(token, repo, slug, name, color, color2, customerId, email) {
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

  // Calculer trialEndDate = aujourd'hui + 30 jours si pas déjà défini
  var trialEnd = existing.trialEndDate || "";
  if (!trialEnd) {
    var d = new Date();
    d.setDate(d.getDate() + 30);
    trialEnd = d.toISOString().slice(0, 10); // "YYYY-MM-DD"
  }

  // Merger : préserver les données billing, mettre à jour name/color
  var updated = {
    name:                 name,
    color:                color,
    color2:               color2,
    brevoListId:          existing.brevoListId          || "",
    brevoGasUrl:          existing.brevoGasUrl          || "",
    plan:                 existing.plan                 || "terrain",
    subscriptionStatus:   existing.subscriptionStatus   || "trialing",
    setupPaid:            existing.setupPaid            || false,
    trialEndDate:         trialEnd,
    billingEmail:         existing.billingEmail         || email || "",
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

/**
 * _updateSheetRestoId(customerId, slug)
 * Met à jour la colonne restoId (col 1) dans la Sheet de facturation
 * pour remplacer le placeholder customerId par le vrai slug du restaurant.
 * Appelé après provisionnement pour que les futurs webhooks trouvent le bon slug.
 */
function _updateSheetRestoId(customerId, slug) {
  if (!customerId || !slug) return;
  try {
    var sheetId = PropertiesService.getScriptProperties().getProperty("BILLING_SHEET_ID");
    if (!sheetId) return;
    var sheet = SpreadsheetApp.openById(sheetId).getActiveSheet();
    var data  = sheet.getDataRange().getValues();
    // Colonne 6 = stripeCustomerId, colonne 1 = restoId (index 0-based)
    for (var i = 1; i < data.length; i++) {
      if (data[i][6] === customerId) {
        sheet.getRange(i + 1, 2).setValue(slug); // colonne B = restoId
        Logger.log("_updateSheetRestoId: " + customerId + " → " + slug + " (ligne " + (i+1) + ")");
      }
    }
  } catch(e) {
    Logger.log("_updateSheetRestoId error: " + e.message);
  }
}

/**
 * _sendProvisionEmail(email, name, slug, password)
 * Envoyé après la création du restaurant.
 * Contient l'URL de connexion, l'identifiant et le mot de passe.
 */
function _sendProvisionEmail(email, name, slug, password) {
  if (!email || !slug) return;
  var siteUrl  = PropertiesService.getScriptProperties().getProperty("FIDELAVIS_SITE_URL") || "https://app.cartefidelavis.com";
  var loginUrl = siteUrl + "/" + slug + "/admin/login.html";
  var subject  = "✅ Votre espace " + name + " est prêt — vos accès";
  var body = [
    "Bonjour,",
    "",
    "Votre espace restaurant Fidelavis est en ligne !",
    "",
    "─────────────────────────────",
    "VOS ACCÈS ADMINISTRATEUR",
    "─────────────────────────────",
    "",
    "🔗 Lien de connexion :",
    loginUrl,
    "",
    "👤 Identifiant : admin",
    "🔑 Mot de passe : " + (password || "(celui que vous avez choisi)"),
    "",
    "─────────────────────────────",
    "LIEN NFC / QR CODE CLIENT",
    "─────────────────────────────",
    "",
    "Lien à programmer sur votre tag NFC ou QR code :",
    siteUrl + "/" + slug + "/indexnfc.html",
    "",
    "─────────────────────────────",
    "",
    "Conservez cet email précieusement.",
    "Pour toute question : support@fidelavis.com",
    "",
    "L'équipe Fidelavis"
  ].join("\n");

  try {
    _sendEmail(email, subject, body);
    Logger.log("_sendProvisionEmail envoyé à " + email + " pour " + slug);
  } catch(err) {
    Logger.log("_sendProvisionEmail error: " + err.message);
  }
}

/* =====================================================
   createSetupSession(body)
   Mode "setup" : collecte la carte sans aucun prélèvement.
   Après le retour, _finalizeSetup() crée l'abonnement via
   l'API Subscriptions (qui accepte add_invoice_items).
   ===================================================== */
function createSetupSession(body) {
  var secretKey = PropertiesService.getScriptProperties().getProperty("STRIPE_SECRET_KEY");
  var siteUrl   = PropertiesService.getScriptProperties().getProperty("FIDELAVIS_SITE_URL") || "https://app.cartefidelavis.com";

  if (!secretKey) return { error: "STRIPE_SECRET_KEY non configurée" };

  var email      = body.email      || "";
  var successUrl = body.successUrl || siteUrl;
  var cancelUrl  = body.cancelUrl  || siteUrl;
  var metadata   = body.metadata   || {};

  var params = [
    "mode=setup",
    "payment_method_types[0]=card",
    "success_url=" + encodeURIComponent(successUrl),
    "cancel_url="  + encodeURIComponent(cancelUrl),
    email ? ("customer_email=" + encodeURIComponent(email)) : ""
  ].filter(Boolean);

  Object.keys(metadata).forEach(function(k) {
    params.push("metadata[" + k + "]=" + encodeURIComponent(String(metadata[k])));
  });

  var response = UrlFetchApp.fetch(STRIPE_API + "/checkout/sessions", {
    method:             "post",
    headers:            { Authorization: "Bearer " + secretKey },
    contentType:        "application/x-www-form-urlencoded",
    payload:            params.join("&"),
    muteHttpExceptions: true
  });

  var data = JSON.parse(response.getContentText());
  if (data.error) return { error: data.error.message || "Erreur Stripe" };
  return { url: data.url, sessionId: data.id };
}

/* =====================================================
   _finalizeSetup(body)
   Appelé après retour du Checkout mode=setup.
   1. Récupère le SetupIntent → payment_method
   2. Crée/récupère le Customer Stripe
   3. Crée l'abonnement via l'API Subscriptions avec :
      - trial_end = l'échéance d'origine si un essai court déjà,
        sinon trial_period_days=30
      Plus de frais d'installation : add_invoice_items reste possible
      mais le front n'envoie plus de setupPriceId.
   ===================================================== */
function _finalizeSetup(body) {
  var secretKey    = PropertiesService.getScriptProperties().getProperty("STRIPE_SECRET_KEY");
  if (!secretKey)  return { error: "STRIPE_SECRET_KEY non configurée" };

  var setupIntentId = body.setupIntentId || "";
  var sessionId     = body.sessionId     || "";
  var planId        = body.planId        || "terrain";
  var priceId       = body.priceId       || "";
  var setupPriceId  = body.setupPriceId  || "";
  var trialEndDate  = body.trialEndDate  || "";   // "YYYY-MM-DD", essai en cours
  var email         = body.email         || "";

  if (!setupIntentId && !sessionId) return { error: "setupIntentId ou sessionId manquant" };
  if (!priceId)                     return { error: "priceId manquant" };

  try {
    // 0. Si on n'a que sessionId, récupérer le setupIntentId depuis la session
    if (!setupIntentId && sessionId) {
      var sessRes = UrlFetchApp.fetch(STRIPE_API + "/checkout/sessions/" + sessionId, {
        headers:            { Authorization: "Bearer " + secretKey },
        muteHttpExceptions: true
      });
      var sess = JSON.parse(sessRes.getContentText());
      if (sess.error) return { error: "Session introuvable : " + sess.error.message };
      setupIntentId = sess.setup_intent || "";
      if (!setupIntentId) return { error: "Aucun setup_intent dans la session " + sessionId };
      // On peut aussi récupérer le customer depuis la session si présent
      if (!email && sess.customer_email) email = sess.customer_email;
    }

    // 1. Récupérer le SetupIntent
    var siRes = UrlFetchApp.fetch(STRIPE_API + "/setup_intents/" + setupIntentId, {
      headers:            { Authorization: "Bearer " + secretKey },
      muteHttpExceptions: true
    });
    var si = JSON.parse(siRes.getContentText());
    if (si.error) return { error: si.error.message };

    var paymentMethodId = si.payment_method || "";
    var customerId      = si.customer       || "";
    if (!paymentMethodId) return { error: "Moyen de paiement introuvable sur le SetupIntent" };

    // 2. Créer le Customer s'il n'existe pas encore
    if (!customerId) {
      var cuParams = [
        "payment_method=" + encodeURIComponent(paymentMethodId),
        "invoice_settings[default_payment_method]=" + encodeURIComponent(paymentMethodId),
        email ? ("email=" + encodeURIComponent(email)) : ""
      ].filter(Boolean).join("&");

      var cuRes = UrlFetchApp.fetch(STRIPE_API + "/customers", {
        method:             "post",
        headers:            { Authorization: "Bearer " + secretKey },
        contentType:        "application/x-www-form-urlencoded",
        payload:            cuParams,
        muteHttpExceptions: true
      });
      var cu = JSON.parse(cuRes.getContentText());
      if (cu.error) return { error: cu.error.message };
      customerId = cu.id;
    }

    // 3. Créer l'abonnement avec trial + frais installation sur 1ère facture
    // Un essai est peut-être DÉJÀ en cours : celui ouvert par le formulaire
    // d'activation, dont la date vit dans config.json. Repartir sur
    // trial_period_days=30 offrirait 30 jours de plus à celui qui s'abonne au
    // 3e jour — il ne paierait qu'au 33e. On respecte donc l'échéance
    // d'origine quand elle existe, et elle seule.
    var trialParam = "trial_period_days=30";
    if (trialEndDate) {
      var fin = new Date(trialEndDate + "T23:59:59");
      var sec = Math.floor(fin.getTime() / 1000);
      // Stripe refuse un trial_end dans le passé ou à moins de 48 h : dans ce
      // cas l'essai est fini ou presque, on facture au prochain cycle.
      if (sec > Math.floor(Date.now() / 1000) + 172800) {
        trialParam = "trial_end=" + sec;
      } else {
        trialParam = "trial_end=now";
      }
    }

    var subParams = [
      "customer="                 + encodeURIComponent(customerId),
      "default_payment_method="  + encodeURIComponent(paymentMethodId),
      "items[0][price]="         + encodeURIComponent(priceId),
      "items[0][quantity]=1",
      trialParam,
      "payment_settings[payment_method_types][0]=card",
      "payment_settings[save_default_payment_method]=on_subscription",
      "metadata[planId]="  + encodeURIComponent(planId),
      "metadata[source]=fidelavis-web"
    ];

    // Conservé pour compatibilité : le front n'envoie plus de setupPriceId
    // depuis la suppression des frais d'installation.
    if (setupPriceId) {
      subParams.push("add_invoice_items[0][price]="    + encodeURIComponent(setupPriceId));
      subParams.push("add_invoice_items[0][quantity]=1");
    }

    var subRes = UrlFetchApp.fetch(STRIPE_API + "/subscriptions", {
      method:             "post",
      headers:            { Authorization: "Bearer " + secretKey },
      contentType:        "application/x-www-form-urlencoded",
      payload:            subParams.join("&"),
      muteHttpExceptions: true
    });
    var sub = JSON.parse(subRes.getContentText());
    if (sub.error) return { error: sub.error.message };

    Logger.log("_finalizeSetup OK — customer=" + customerId + " sub=" + sub.id + " status=" + sub.status);
    return {
      ok:             true,
      customerId:     customerId,
      subscriptionId: sub.id,
      status:         sub.status,   // "trialing"
      trialEnd:       sub.trial_end // Unix timestamp
    };

  } catch(e) {
    Logger.log("_finalizeSetup error: " + e.message);
    return { error: e.message };
  }
}

/* =====================================================
   createCheckoutSession(body)
   Crée une session Checkout Stripe avec :
   - abonnement mensuel unique : 79 € (plan « terrain »)
   ===================================================== */
function createCheckoutSession(body) {
  var secretKey    = PropertiesService.getScriptProperties().getProperty("STRIPE_SECRET_KEY");
  var siteUrl      = PropertiesService.getScriptProperties().getProperty("FIDELAVIS_SITE_URL") || "https://app.cartefidelavis.com";

  if (!secretKey) return { error: "STRIPE_SECRET_KEY non configurée" };

  var planId       = body.planId       || "terrain";
  var priceId      = body.priceId      || "";
  var setupPriceId = body.setupPriceId || "";
  var email        = body.email        || "";
  var successUrl   = body.successUrl   || (siteUrl + "/fidelavis-admin/merci-abonnement.html?session_id={CHECKOUT_SESSION_ID}");
  var cancelUrl    = body.cancelUrl    || (siteUrl + "/fidelavis-admin/");
  var metadata     = body.metadata     || {};

  if (!priceId) return { error: "priceId manquant" };

  // Construire les line_items
  // Modèle : 0 € aujourd'hui — 30 jours d'essai gratuit, sans frais d'installation
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
    "metadata[planId]="    + encodeURIComponent(planId),
    "metadata[source]=fidelavis-web",
    // Frais d'installation supprimés de l'offre. Le paramètre reste lu pour
    // compatibilité : add_invoice_items n'existe PAS sur Checkout
    // Sessions (uniquement sur l'API Subscriptions). On stocke setupPriceId en
    // metadata, et on ajoute l'invoice item via le webhook
    // customer.subscription.trial_will_end (ou facturation manuelle).
    setupPriceId ? ("metadata[setupPriceId]=" + encodeURIComponent(setupPriceId)) : "",
    "subscription_data[metadata][setupPriceId]=" + encodeURIComponent(setupPriceId || ""),
    "subscription_data[metadata][planId]="       + encodeURIComponent(planId),
    "allow_promotion_codes=true",
    "billing_address_collection=auto",
    "subscription_data[trial_period_days]=30",
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
