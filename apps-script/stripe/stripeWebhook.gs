/**
 * Fidelavis — stripeWebhook.gs
 * Google Apps Script — réception des webhooks Stripe
 *
 * Gère :
 *   checkout.session.completed    → client créé, config initialisée
 *   invoice.paid                  → statut = active
 *   invoice.payment_failed        → statut = past_due
 *   customer.subscription.deleted → statut = canceled
 *
 * DÉPLOIEMENT :
 * 1. Aller sur https://script.google.com → Nouveau projet
 * 2. Coller ce code
 * 3. Extensions > Propriétés du script > Ajouter :
 *    - STRIPE_SECRET_KEY       : sk_live_xxx
 *    - STRIPE_WEBHOOK_SECRET   : whsec_xxx (depuis le dashboard Stripe)
 *    - BILLING_SHEET_ID        : ID de la Google Sheet "fidelavis-billing"
 *    - ADMIN_EMAIL             : votre email pour les notifications
 *    - BREVO_GAS_URL           : URL du GAS Brevo (pour emails onboarding)
 * 4. Déployer > Nouveau déploiement > Application Web
 *    - Exécuter en tant que : Moi
 *    - Accès : Tout le monde (anonyme)
 * 5. Copier l'URL et la configurer comme webhook dans le dashboard Stripe
 *    (Developers > Webhooks > Add endpoint)
 *
 * GOOGLE SHEET "fidelavis-billing" :
 * Créer une Sheet avec les colonnes (ligne 1) :
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

    // Dispatch selon le type d'événement
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

    // Toujours logger l'événement dans la Sheet
    _logEvent(event, body.data ? body.data.object : {}, body);

  } catch(err) {
    Logger.log("Webhook error: " + err.message);
  }

  return output;
}

/* =====================================================
   checkout.session.completed
   → Nouveau client qui vient de payer
   ===================================================== */
function _handleCheckoutCompleted(session) {
  var email          = session.customer_email || session.customer_details?.email || "";
  var customerId     = session.customer || "";
  var subscriptionId = session.subscription || "";
  var planId         = session.metadata?.planId || "essentiel";

  // Générer un restoId (slug) unique
  var restoId = _generateRestoId(email, customerId);

  // Récupérer les détails de l'abonnement
  var subDetails = _fetchSubscription(subscriptionId);
  var nextBilling = subDetails ? _tsToDate(subDetails.current_period_end) : "";

  // Données client complètes
  var clientData = {
    restoId:              restoId,
    plan:                 planId,
    subscriptionStatus:   "active",
    setupPaid:            true,
    billingEmail:         email,
    stripeCustomerId:     customerId,
    stripeSubscriptionId: subscriptionId,
    nextBillingDate:      nextBilling,
    invoices:             [],
    createdAt:            new Date().toISOString()
  };

  // 1. Enregistrer dans la Google Sheet
  _saveBillingRecord(clientData, "checkout.session.completed");

  // 2. Envoyer email de confirmation + onboarding
  _sendOnboardingEmail(email, planId, restoId);

  // 3. Notifier l'admin
  _notifyAdmin("Nouveau client Fidelavis", [
    "Email : " + email,
    "Plan : " + planId,
    "RestoId : " + restoId,
    "CustomerId : " + customerId,
    "SubscriptionId : " + subscriptionId
  ].join("\n"));

  Logger.log("checkout.session.completed — restoId: " + restoId + " plan: " + planId);
}

/* =====================================================
   invoice.paid → statut = active
   ===================================================== */
function _handleInvoicePaid(invoice) {
  var customerId     = invoice.customer || "";
  var subscriptionId = invoice.subscription || "";

  // Enregistrer la facture dans la Sheet
  var invoiceData = {
    id:          invoice.id,
    date:        _tsToDate(invoice.created),
    amount:      invoice.amount_paid,    // en centimes
    status:      "paid",
    description: invoice.description || "Abonnement Fidelavis",
    pdf:         invoice.invoice_pdf || ""
  };

  _updateBillingStatus(customerId, subscriptionId, "active", invoiceData);
  Logger.log("invoice.paid — customer: " + customerId);
}

/* =====================================================
   invoice.payment_failed → statut = past_due
   ===================================================== */
function _handleInvoicePaymentFailed(invoice) {
  var customerId     = invoice.customer || "";
  var subscriptionId = invoice.subscription || "";
  var email          = invoice.customer_email || "";

  _updateBillingStatus(customerId, subscriptionId, "past_due", null);

  // Notifier l'admin
  _notifyAdmin("Paiement échoué — Fidelavis", [
    "Client : " + customerId,
    "Email : " + email,
    "Abonnement : " + subscriptionId,
    "Montant : " + (invoice.amount_due / 100) + " €"
  ].join("\n"));

  Logger.log("invoice.payment_failed — customer: " + customerId);
}

/* =====================================================
   customer.subscription.deleted → statut = canceled
   ===================================================== */
function _handleSubscriptionDeleted(subscription) {
  var customerId     = subscription.customer || "";
  var subscriptionId = subscription.id || "";

  _updateBillingStatus(customerId, subscriptionId, "canceled", null);

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
  Logger.log("subscription.updated — customer: " + customerId + " status: " + status);
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
    var sheet  = _getSheet();
    var data   = sheet.getDataRange().getValues();
    var updated = false;

    // Chercher la ligne avec ce customerId (colonne G = index 6)
    for (var i = data.length - 1; i >= 1; i--) {
      if (data[i][6] === customerId) {
        // Mettre à jour le statut (colonne E = index 4)
        sheet.getRange(i + 1, 5).setValue(status);

        if (nextBilling) {
          sheet.getRange(i + 1, 9).setValue(nextBilling);
        }

        // Ajouter la facture dans la colonne raw (colonne K = index 10)
        if (invoice) {
          var raw = {};
          try { raw = JSON.parse(data[i][10] || "{}"); } catch(e) {}
          if (!raw.invoices) raw.invoices = [];
          raw.invoices.unshift(invoice);
          // Garder les 24 dernières factures
          raw.invoices = raw.invoices.slice(0, 24);
          raw.subscriptionStatus = status;
          if (nextBilling) raw.nextBillingDate = nextBilling;
          sheet.getRange(i + 1, 11).setValue(JSON.stringify(raw));
        }

        // Logguer l'événement de mise à jour
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
      obj.customer_email || obj.customer_details?.email || "",
      obj.metadata ? (obj.metadata.planId || "") : "",
      "", "", obj.customer || "", obj.subscription || "",
      "", eventType, JSON.stringify(rawBody).substring(0, 1000)
    ]);
  } catch(err) {
    Logger.log("_logEvent error: " + err.message);
  }
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

function _sendOnboardingEmail(email, planId, restoId) {
  if (!email) return;

  var planName = planId === "pro" ? "Pro" : "Essentiel";
  var subject  = "Bienvenue sur Fidelavis ! 🎉 Votre compte est actif";
  var body = [
    "Bonjour,",
    "",
    "Votre abonnement Fidelavis " + planName + " est maintenant actif.",
    "",
    "Votre identifiant restaurant : " + restoId,
    "",
    "Notre équipe va configurer votre espace dans les 24h.",
    "Vous recevrez un email avec les accès à votre tableau de bord.",
    "",
    "Des questions ? Répondez à cet email.",
    "",
    "L'équipe Fidelavis"
  ].join("\n");

  try {
    GmailApp.sendEmail(email, subject, body);
  } catch(err) {
    Logger.log("_sendOnboardingEmail error: " + err.message);
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

function _generateRestoId(email, customerId) {
  // Génère un slug à partir de l'email ou du customerId
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
