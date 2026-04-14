/**
 * Fidelavis — stripeWebhook.gs
 * Google Apps Script — réception des webhooks Stripe
 *                    + synchronisation automatique de config.json sur GitHub
 *
 * Gère :
 *   checkout.session.completed    → client créé, config initialisée
 *   invoice.paid                  → statut = active, facture ajoutée
 *   invoice.payment_failed        → statut = past_due
 *   customer.subscription.deleted → statut = canceled
 *   customer.subscription.updated → statut + nextBillingDate mis à jour
 *
 * PROPRIÉTÉS REQUISES (Extensions > Propriétés du script) :
 *   STRIPE_SECRET_KEY       sk_live_xxx
 *   STRIPE_WEBHOOK_SECRET   whsec_xxx
 *   BILLING_SHEET_ID        ID de la Google Sheet "fidelavis-billing"
 *   ADMIN_EMAIL             email pour notifications
 *   GITHUB_TOKEN            Personal Access Token (scope: contents write)
 *   GITHUB_REPO             compush-media/compush-media.gitub.io  (valeur par défaut)
 *
 * GOOGLE SHEET "fidelavis-billing" — colonnes :
 * timestamp | restoId | email | plan | subscriptionStatus | setupPaid |
 * stripeCustomerId | stripeSubscriptionId | nextBillingDate | event | raw
 */

var STRIPE_API = "https://api.stripe.com/v1";

/* =====================================================
   doPost — réception webhook Stripe
   ===================================================== */
function doPost(e) {
  var output = ContentService.createTextOutput("ok");

  try {
    var body  = JSON.parse(e.postData.contents);
    var event = body.type || "";

    if (event === "checkout.session.completed") {
      _handleCheckoutCompleted(body.data.object);

    } else if (event === "invoice.paid") {
      _handleInvoicePaid(body.data.object);

    } else if (event === "invoice.payment_failed") {
      _handleInvoicePaymentFailed(body.data.object);

    } else if (event === "customer.subscription.deleted") {
      _handleSubscriptionDeleted(body.data.object);

    } else if (event === "customer.subscription.updated") {
      _handleSubscriptionUpdated(body.data.object);
    }

    _logEvent(event, body.data ? body.data.object : {}, body);

  } catch(err) {
    Logger.log("Webhook error: " + err.message);
  }

  return output;
}

/* =====================================================
   doGet — synchronisation manuelle + diagnostic
   Usage :
     ?action=syncBilling&restoId=le-coreen&customerId=cus_xxx
       → force la sync Sheet → config.json pour ce restaurant
     ?action=ping
       → retourne {"ok":true} pour tester le déploiement
   ===================================================== */
function doGet(e) {
  var params = e ? (e.parameter || {}) : {};
  var action = params.action || "";

  if (action === "syncBilling") {
    var restoId    = params.restoId    || "";
    var customerId = params.customerId || "";

    if (!restoId || !customerId) {
      return _jsonResponse({ error: "restoId et customerId requis" });
    }

    var result = _syncBillingFromSheet(restoId, customerId);
    return _jsonResponse(result);
  }

  return _jsonResponse({ ok: true, service: "Fidelavis Stripe Webhook" });
}

/* =====================================================
   checkout.session.completed
   → Client inscrit pour l'essai gratuit (0€ aujourd'hui)
   ===================================================== */
function _handleCheckoutCompleted(session) {
  var email          = session.customer_email || (session.customer_details && session.customer_details.email) || "";
  var customerId     = session.customer || "";
  var subscriptionId = session.subscription || "";
  var planId         = (session.metadata && session.metadata.planId) || "essentiel";
  var setupPriceId   = (session.metadata && session.metadata.setupPriceId) || "";

  // Slug inconnu à ce stade — on utilise customerId comme clé provisoire.
  // Le vrai slug sera enregistré dans la Sheet lors du provisionnement (setup.html).
  var restoId = customerId;

  // Récupérer les détails de l'abonnement (trial_end, status)
  var subDetails   = _fetchSubscription(subscriptionId);
  var trialEnd     = subDetails ? _tsToDate(subDetails.trial_end)          : _dateInDays(14);
  var nextBilling  = subDetails ? _tsToDate(subDetails.current_period_end) : _dateInDays(14);
  var subStatus    = (subDetails && subDetails.status) || "trialing";

  // Créer l'InvoiceItem pour les frais d'installation (199€)
  // → sera facturé automatiquement avec le 1er prélèvement à la fin du trial
  if (setupPriceId && customerId) {
    _createSetupInvoiceItem(customerId, setupPriceId);
  }

  var clientData = {
    restoId:              restoId,
    plan:                 planId,
    subscriptionStatus:   subStatus,
    setupPaid:            false,
    trialEndDate:         trialEnd,
    billingEmail:         email,
    stripeCustomerId:     customerId,
    stripeSubscriptionId: subscriptionId,
    nextBillingDate:      nextBilling,
    invoices:             [],
    createdAt:            new Date().toISOString()
  };

  _saveBillingRecord(clientData, "checkout.session.completed");
  _sendOnboardingEmail(email, planId, "", trialEnd);
  _notifyAdmin("Nouveau client Fidelavis (essai gratuit)", [
    "Email : " + email,
    "Plan : " + planId,
    "Statut : " + subStatus,
    "Fin d'essai : " + trialEnd,
    "CustomerId : " + customerId,
    "SubscriptionId : " + subscriptionId,
    "",
    "→ Le restaurant sera créé via setup.html après paiement."
  ].join("\n"));

  // PAS de _updateGithubConfig ici : le slug réel est inconnu.
  // La mise à jour de config.json se fait lors du provisionnement (_updateSlugConfig).

  Logger.log("checkout.session.completed — customerId: " + customerId + " plan: " + planId + " status: " + subStatus);
}

/* =====================================================
   invoice.paid → statut = active, facture ajoutée
   ===================================================== */
function _handleInvoicePaid(invoice) {
  var customerId     = invoice.customer || "";
  var subscriptionId = invoice.subscription || "";
  var amountPaid     = invoice.amount_paid || 0;

  // Ignorer les factures à 0€ (déclenchées au démarrage du trial par Stripe)
  // Elles ne représentent pas un vrai paiement
  if (amountPaid === 0) {
    Logger.log("invoice.paid (0€) ignorée — client en trial : " + customerId);
    return;
  }

  var invoiceData = {
    id:          invoice.id || "",
    date:        _tsToDate(invoice.created),
    amount:      amountPaid,
    status:      "paid",
    description: invoice.description || "Abonnement Fidelavis",
    pdf:         invoice.invoice_pdf  || ""
  };

  // Récupérer la prochaine date de facturation depuis l'abonnement
  var nextBilling = "";
  if (subscriptionId) {
    var sub = _fetchSubscription(subscriptionId);
    if (sub) nextBilling = _tsToDate(sub.current_period_end);
  }

  _updateBillingStatus(customerId, subscriptionId, "active", invoiceData, nextBilling);

  // Sync GitHub
  var restoId = _findRestoIdByCustomer(customerId);
  if (restoId) {
    _updateGithubConfig(restoId, {
      subscriptionStatus: "active",
      setupPaid:          true,        // 1er vrai prélèvement = installation + 1er mois payés
      trialEndDate:       "",          // trial terminé
      nextBillingDate:    nextBilling || undefined,
      invoices:           [invoiceData]
    });
  }

  Logger.log("invoice.paid (" + (amountPaid / 100) + "€) — customer: " + customerId);
}

/* =====================================================
   invoice.payment_failed → statut = past_due
   ===================================================== */
function _handleInvoicePaymentFailed(invoice) {
  var customerId     = invoice.customer || "";
  var subscriptionId = invoice.subscription || "";
  var email          = invoice.customer_email || "";

  _updateBillingStatus(customerId, subscriptionId, "past_due", null, "");

  // Sync GitHub
  var restoId = _findRestoIdByCustomer(customerId);
  if (restoId) {
    _updateGithubConfig(restoId, { subscriptionStatus: "past_due" });
  }

  _notifyAdmin("Paiement échoué — Fidelavis", [
    "Client : " + customerId,
    "Email : " + email,
    "Abonnement : " + subscriptionId,
    "Montant : " + ((invoice.amount_due || 0) / 100) + " €"
  ].join("\n"));

  Logger.log("invoice.payment_failed — customer: " + customerId);
}

/* =====================================================
   customer.subscription.deleted → statut = canceled
   ===================================================== */
function _handleSubscriptionDeleted(subscription) {
  var customerId     = subscription.customer || "";
  var subscriptionId = subscription.id || "";

  _updateBillingStatus(customerId, subscriptionId, "canceled", null, "");

  // Sync GitHub
  var restoId = _findRestoIdByCustomer(customerId);
  if (restoId) {
    _updateGithubConfig(restoId, { subscriptionStatus: "canceled" });
  }

  _notifyAdmin("Résiliation abonnement — Fidelavis", [
    "Client : " + customerId,
    "Abonnement : " + subscriptionId,
    "Date résiliation : " + _tsToDate(subscription.canceled_at || subscription.ended_at)
  ].join("\n"));

  Logger.log("subscription.deleted — customer: " + customerId);
}

/* =====================================================
   customer.subscription.updated
   ===================================================== */
function _handleSubscriptionUpdated(subscription) {
  var customerId     = subscription.customer || "";
  var subscriptionId = subscription.id || "";
  var status         = subscription.status || "active";
  var nextBilling    = _tsToDate(subscription.current_period_end);

  _updateBillingStatus(customerId, subscriptionId, status, null, nextBilling);

  // Sync GitHub
  var restoId = _findRestoIdByCustomer(customerId);
  if (restoId) {
    _updateGithubConfig(restoId, {
      subscriptionStatus: status,
      nextBillingDate:    nextBilling
    });
  }

  Logger.log("subscription.updated — customer: " + customerId + " status: " + status);
}

/* =====================================================
   _syncBillingFromSheet(restoId, customerId)
   Sync manuelle : lit la Sheet, met à jour config.json
   Appelée via doGet?action=syncBilling
   ===================================================== */
function _syncBillingFromSheet(restoId, customerId) {
  try {
    var sheet  = _getSheet();
    var data   = sheet.getDataRange().getValues();
    var record = null;

    for (var i = data.length - 1; i >= 1; i--) {
      if (data[i][6] === customerId) {
        record = data[i];
        break;
      }
    }

    if (!record) {
      return { error: "customerId non trouvé dans la Sheet : " + customerId };
    }

    // Reconstruire les données billing depuis la ligne Sheet
    var raw = {};
    try { raw = JSON.parse(record[10] || "{}"); } catch(e) {}

    var fields = {
      plan:                 record[3]  || raw.plan || "essentiel",
      subscriptionStatus:   record[4]  || "incomplete",
      setupPaid:            record[5] === "oui" || raw.setupPaid === true,
      billingEmail:         record[2]  || "",
      stripeCustomerId:     customerId,
      stripeSubscriptionId: record[7]  || "",
      nextBillingDate:      record[8]  || raw.nextBillingDate || "",
      invoices:             raw.invoices || []
    };

    // Mettre à jour le restoId dans la Sheet si différent
    if (record[1] !== restoId) {
      // Trouver la ligne et mettre à jour
      for (var j = data.length - 1; j >= 1; j--) {
        if (data[j][6] === customerId) {
          sheet.getRange(j + 1, 2).setValue(restoId);
          break;
        }
      }
    }

    _updateGithubConfig(restoId, fields);

    Logger.log("_syncBillingFromSheet: OK — restoId: " + restoId);
    return { ok: true, restoId: restoId, status: fields.subscriptionStatus };

  } catch(err) {
    Logger.log("_syncBillingFromSheet error: " + err.message);
    return { error: err.message };
  }
}

/* =====================================================
   Fonctions Sheet
   ===================================================== */

function _getSheet() {
  var sheetId = PropertiesService.getScriptProperties().getProperty("BILLING_SHEET_ID");
  if (!sheetId) throw new Error("BILLING_SHEET_ID non configuré");
  return SpreadsheetApp.openById(sheetId).getSheetByName("billing") ||
         SpreadsheetApp.openById(sheetId).getActiveSheet();
}

function _saveBillingRecord(data, event) {
  try {
    var sheet = _getSheet();
    sheet.appendRow([
      new Date().toISOString(),
      data.restoId             || "",
      data.billingEmail        || "",
      data.plan                || "",
      data.subscriptionStatus  || "",
      data.setupPaid ? "oui" : "non",
      data.stripeCustomerId    || "",
      data.stripeSubscriptionId || "",
      data.nextBillingDate     || "",
      event                    || "",
      JSON.stringify(data)
    ]);
  } catch(err) {
    Logger.log("_saveBillingRecord error: " + err.message);
  }
}

function _updateBillingStatus(customerId, subscriptionId, status, invoice, nextBilling) {
  try {
    var sheet   = _getSheet();
    var data    = sheet.getDataRange().getValues();
    var updated = false;

    for (var i = data.length - 1; i >= 1; i--) {
      if (data[i][6] === customerId) {
        sheet.getRange(i + 1, 5).setValue(status);

        if (nextBilling) {
          sheet.getRange(i + 1, 9).setValue(nextBilling);
        }

        if (invoice) {
          var raw = {};
          try { raw = JSON.parse(data[i][10] || "{}"); } catch(e) {}
          if (!raw.invoices) raw.invoices = [];
          raw.invoices.unshift(invoice);
          raw.invoices           = raw.invoices.slice(0, 24);
          raw.subscriptionStatus = status;
          if (nextBilling) raw.nextBillingDate = nextBilling;
          sheet.getRange(i + 1, 11).setValue(JSON.stringify(raw));
        }

        sheet.appendRow([
          new Date().toISOString(), "", "", "", status, "",
          customerId, subscriptionId, nextBilling || "", "status_update", ""
        ]);

        updated = true;
        break;
      }
    }

    if (!updated) {
      Logger.log("_updateBillingStatus: customerId non trouvé : " + customerId);
    }
  } catch(err) {
    Logger.log("_updateBillingStatus error: " + err.message);
  }
}

function _logEvent(eventType, obj, rawBody) {
  try {
    var sheet = _getSheet();
    sheet.appendRow([
      new Date().toISOString(),
      obj.metadata ? (obj.metadata.restoId || "") : "",
      obj.customer_email || (obj.customer_details && obj.customer_details.email) || "",
      obj.metadata ? (obj.metadata.planId || "") : "",
      "", "", obj.customer || "", obj.subscription || "",
      "", eventType, JSON.stringify(rawBody).substring(0, 1000)
    ]);
  } catch(err) {
    Logger.log("_logEvent error: " + err.message);
  }
}

/* =====================================================
   GitHub API — mise à jour automatique de config.json
   ===================================================== */

/**
 * _findRestoIdByCustomer(customerId)
 * Cherche le restoId dans la Sheet à partir du stripeCustomerId.
 */
function _findRestoIdByCustomer(customerId) {
  if (!customerId) return null;
  try {
    var sheet = _getSheet();
    var data  = sheet.getDataRange().getValues();
    // Chercher d'abord un vrai slug (restoId ne commence pas par "cus_")
    for (var i = data.length - 1; i >= 1; i--) {
      if (data[i][6] === customerId && data[i][1] && !String(data[i][1]).startsWith("cus_")) {
        return data[i][1]; // vrai slug trouvé
      }
    }
    // Le slug n'a pas encore été mis à jour dans la Sheet → provisionnement pas encore fait
  } catch(e) {
    Logger.log("_findRestoIdByCustomer error: " + e.message);
  }
  return null;
}

/**
 * _updateGithubConfig(restoId, fields)
 * Met à jour /<restoId>/config.json sur GitHub via l'API REST.
 *
 * fields.invoices (array) : les nouvelles factures sont PREPENDÉES
 * au tableau existant (max 24 entrées conservées).
 *
 * Les champs undefined/null sont ignorés.
 */
function _updateGithubConfig(restoId, fields) {
  if (!restoId || !fields) return;

  var token  = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  var repo   = PropertiesService.getScriptProperties().getProperty("GITHUB_REPO")
               || "compush-media/compush-media.gitub.io";
  var branch = "main";
  var path   = restoId + "/config.json";
  var apiUrl = "https://api.github.com/repos/" + repo + "/contents/" + path;

  if (!token) {
    Logger.log("_updateGithubConfig: GITHUB_TOKEN non configuré — sync ignorée");
    return;
  }

  try {
    // 1. GET — lire le fichier courant (pour récupérer SHA + contenu)
    var getRes = UrlFetchApp.fetch(apiUrl + "?ref=" + branch, {
      headers: {
        Authorization: "token " + token,
        Accept:        "application/vnd.github.v3+json"
      },
      muteHttpExceptions: true
    });

    var getCode = getRes.getResponseCode();

    var sha     = null;
    var current = null;

    if (getCode === 404) {
      // Nouveau client — créer le config.json depuis le template
      Logger.log("_updateGithubConfig: 404 pour « " + restoId + " » — création automatique du config.json");
      current = _defaultConfig(restoId);

    } else if (getCode !== 200) {
      Logger.log("_updateGithubConfig: GET échoué (" + getCode + ") pour " + restoId);
      return;

    } else {
      var fileData = JSON.parse(getRes.getContentText());
      sha          = fileData.sha;

      // Décoder le contenu base64 → JSON
      var rawB64   = (fileData.content || "").replace(/\n/g, "");
      var rawBytes = Utilities.base64Decode(rawB64);
      current      = JSON.parse(Utilities.newBlob(rawBytes).getDataAsString());
    }

    // 2. Fusionner les champs
    var updated = _shallowMerge(current, fields);

    // 3. PUT — créer ou réécrire le fichier
    var newContent = Utilities.base64Encode(
      Utilities.newBlob(JSON.stringify(updated, null, 2) + "\n").getBytes()
    );

    var putPayload = {
      message: sha
        ? "billing: update " + restoId + " — " + (fields.subscriptionStatus || "sync")
        : "billing: provision " + restoId + " — nouveau client",
      content: newContent,
      branch:  branch
    };
    if (sha) putPayload.sha = sha;   // obligatoire pour PUT (update), absent pour CREATE

    var putRes = UrlFetchApp.fetch(apiUrl, {
      method:  "put",
      headers: {
        Authorization: "token " + token,
        Accept:        "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      payload: JSON.stringify(putPayload),
      muteHttpExceptions: true
    });

    var putCode = putRes.getResponseCode();
    if (putCode === 200 || putCode === 201) {
      Logger.log("_updateGithubConfig: " + (putCode === 201 ? "CRÉÉ" : "OK") + " — " + restoId + " [" + (fields.subscriptionStatus || "") + "]");
    } else {
      Logger.log("_updateGithubConfig: PUT échoué (" + putCode + ") — " + putRes.getContentText().substring(0, 300));
    }

  } catch(err) {
    Logger.log("_updateGithubConfig error: " + err.message);
  }
}

/**
 * _defaultConfig(restoId)
 * Retourne un config.json vide (template) pour un nouveau client.
 */
function _defaultConfig(restoId) {
  return {
    name:                 restoId,
    color:                "#B8924F",
    color2:               "#9E7A3E",
    plan:                 "essentiel",
    subscriptionStatus:   "trialing",
    setupPaid:            false,
    trialEndDate:         "",
    billingEmail:         "",
    stripeCustomerId:     "",
    stripeSubscriptionId: "",
    nextBillingDate:      "",
    invoices:             []
  };
}

/**
 * _shallowMerge(base, patch)
 * Fusionne patch dans base.
 * Cas spécial invoices : prepend + déduplique sur id + limite à 24.
 */
function _shallowMerge(base, patch) {
  var result = {};
  // Copie base
  Object.keys(base).forEach(function(k) { result[k] = base[k]; });

  Object.keys(patch).forEach(function(k) {
    var v = patch[k];
    if (v === undefined || v === null) return;   // ignorer les valeurs nulles

    if (k === "invoices" && Array.isArray(v) && v.length > 0) {
      var existing = Array.isArray(result.invoices) ? result.invoices : [];
      // Déduplique par id avant de fusionner
      var existingIds = existing.map(function(inv) { return inv.id; });
      var newInvoices = v.filter(function(inv) { return inv.id && existingIds.indexOf(inv.id) === -1; });
      result.invoices = newInvoices.concat(existing).slice(0, 24);
    } else {
      result[k] = v;
    }
  });

  return result;
}

/* =====================================================
   Fonctions Stripe API
   ===================================================== */

function _fetchSubscription(subscriptionId) {
  if (!subscriptionId) return null;
  try {
    var secretKey = PropertiesService.getScriptProperties().getProperty("STRIPE_SECRET_KEY");
    var res = UrlFetchApp.fetch(STRIPE_API + "/subscriptions/" + subscriptionId, {
      headers: { Authorization: "Bearer " + secretKey },
      muteHttpExceptions: true
    });
    var data = JSON.parse(res.getContentText());
    return data.error ? null : data;
  } catch(e) { return null; }
}

/* =====================================================
   Emails & Notifications
   ===================================================== */

function _sendOnboardingEmail(email, planId, restoId, trialEndDate) {
  if (!email) return;

  var planName = planId === "pro" ? "Pro" : "Essentiel";
  var subject  = "Votre essai gratuit Fidelavis commence ! 🎉";
  var body = [
    "Bonjour,",
    "",
    "Votre essai gratuit Fidelavis " + planName + " est maintenant actif.",
    "",
    "✅ Aucun paiement aujourd'hui.",
    "📅 Votre essai se termine le : " + (trialEndDate || "dans 14 jours"),
    "",
    "Après l'essai, vous serez facturé :",
    "  - 199€ d'installation (une seule fois)",
    "  - " + (planId === "pro" ? "149€" : "97€") + "/mois pour le plan " + planName,
    "",
    "Votre identifiant restaurant : " + restoId,
    "Notre équipe va configurer votre espace dans les 24h.",
    "",
    "Pour annuler avant la fin d'essai, répondez à cet email.",
    "",
    "L'équipe Fidelavis"
  ].join("\n");

  try {
    GmailApp.sendEmail(email, subject, body);
  } catch(err) {
    Logger.log("_sendOnboardingEmail error: " + err.message);
  }
}

/* =====================================================
   _createSetupInvoiceItem(customerId, setupPriceId)
   Crée un InvoiceItem (frais d'installation 199€) sur le client.
   Cet item sera automatiquement inclus dans la prochaine facture
   générée par Stripe (= 1er prélèvement à la fin du trial).
   ===================================================== */
function _createSetupInvoiceItem(customerId, setupPriceId) {
  if (!customerId || !setupPriceId) return;
  try {
    var secretKey = PropertiesService.getScriptProperties().getProperty("STRIPE_SECRET_KEY");
    var res = UrlFetchApp.fetch(STRIPE_API + "/invoiceitems", {
      method:             "post",
      headers:            { Authorization: "Bearer " + secretKey },
      contentType:        "application/x-www-form-urlencoded",
      payload:            "customer=" + encodeURIComponent(customerId) +
                          "&price="    + encodeURIComponent(setupPriceId),
      muteHttpExceptions: true
    });
    var data = JSON.parse(res.getContentText());
    if (data.error) {
      Logger.log("_createSetupInvoiceItem error: " + data.error.message);
    } else {
      Logger.log("_createSetupInvoiceItem OK: " + data.id + " — customer: " + customerId);
    }
  } catch(e) {
    Logger.log("_createSetupInvoiceItem exception: " + e.message);
  }
}

function _notifyAdmin(subject, body) {
  var adminEmail = PropertiesService.getScriptProperties().getProperty("ADMIN_EMAIL");
  if (!adminEmail) return;
  try {
    GmailApp.sendEmail(adminEmail, "[Fidelavis] " + subject, body);
  } catch(err) {
    Logger.log("_notifyAdmin error: " + err.message);
  }
}

/* =====================================================
   Utilitaires
   ===================================================== */

function _dateInDays(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

function _generateRestoId(email, customerId) {
  var base = email
    ? email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 12)
    : "resto";

  var suffix = customerId
    ? customerId.replace("cus_", "").substring(0, 6).toLowerCase()
    : String(Date.now()).slice(-4);

  return base + suffix;
}

function _tsToDate(timestamp) {
  if (!timestamp) return "";
  try {
    return new Date(parseInt(timestamp) * 1000).toISOString().slice(0, 10);
  } catch(e) { return ""; }
}

function _jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
