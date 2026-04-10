/**
 * Fidelavis — pennylaneSync.gs
 * Google Apps Script — Synchronisation Pennylane (facturation électronique)
 *
 * Génère automatiquement :
 *   - Facture d'installation (199 €, one-time)
 *   - Facture d'abonnement mensuel (97 € ou 149 €)
 *
 * DÉPLOIEMENT :
 * 1. Aller sur https://script.google.com → Nouveau projet
 * 2. Coller ce code
 * 3. Extensions > Propriétés du script > Ajouter :
 *    - PENNYLANE_API_KEY    : votre clé API Pennylane
 *    - BILLING_SHEET_ID     : même Sheet que stripeWebhook.gs
 * 4. Optionnel : créer un déclencheur quotidien sur syncPendingInvoices()
 *
 * API Pennylane : https://pennylane.readme.io/reference/
 */

var PENNYLANE_API = "https://app.pennylane.com/api/external/v1";

/* =====================================================
   createSetupInvoice(clientData)
   Crée la facture d'installation 199 € dans Pennylane
   ===================================================== */
function createSetupInvoice(clientData) {
  var apiKey = _getApiKey();
  if (!apiKey) return { error: "PENNYLANE_API_KEY non configurée" };

  var customer = _getOrCreateCustomer(clientData, apiKey);
  if (!customer || customer.error) return customer || { error: "Création client échouée" };

  var today = _today();

  var invoice = {
    date:               today,
    deadline:           today,
    currency:           "EUR",
    label:              "Installation Fidelavis — " + (clientData.plan === "pro" ? "Plan Pro" : "Plan Essentiel"),
    customer_id:        customer.id,
    line_items: [{
      label:      "Frais d'installation Fidelavis",
      quantity:   1,
      unit_price: 199.00,
      vat_rate:   "FR_20"
    }]
  };

  return _createInvoice(invoice, apiKey);
}

/* =====================================================
   createSubscriptionInvoice(clientData, month, year)
   Crée la facture mensuelle dans Pennylane
   ===================================================== */
function createSubscriptionInvoice(clientData, month, year) {
  var apiKey = _getApiKey();
  if (!apiKey) return { error: "PENNYLANE_API_KEY non configurée" };

  var plan  = clientData.plan || "essentiel";
  var price = plan === "pro" ? 149.00 : 97.00;
  var now   = new Date();
  month = month || (now.getMonth() + 1);
  year  = year  || now.getFullYear();

  var months = ["Janvier","Février","Mars","Avril","Mai","Juin",
                "Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
  var monthLabel = months[month - 1] || "Mois";

  var customer = _getOrCreateCustomer(clientData, apiKey);
  if (!customer || customer.error) return customer || { error: "Création client échouée" };

  var invoiceDate = year + "-" + String(month).padStart(2, "0") + "-01";

  var invoice = {
    date:         invoiceDate,
    deadline:     invoiceDate,
    currency:     "EUR",
    label:        "Abonnement Fidelavis " + (plan === "pro" ? "Pro" : "Essentiel") + " — " + monthLabel + " " + year,
    customer_id:  customer.id,
    line_items: [{
      label:      "Abonnement Fidelavis " + (plan === "pro" ? "Pro" : "Essentiel"),
      quantity:   1,
      unit_price: price,
      vat_rate:   "FR_20"
    }]
  };

  return _createInvoice(invoice, apiKey);
}

/* =====================================================
   syncPendingInvoices()
   Déclencheur automatique : vérifie la Sheet billing
   et crée les factures Pennylane manquantes.
   À lancer via un déclencheur quotidien.
   ===================================================== */
function syncPendingInvoices() {
  var apiKey = _getApiKey();
  if (!apiKey) { Logger.log("PENNYLANE_API_KEY manquante"); return; }

  var sheetId = PropertiesService.getScriptProperties().getProperty("BILLING_SHEET_ID");
  if (!sheetId) { Logger.log("BILLING_SHEET_ID manquant"); return; }

  var sheet = SpreadsheetApp.openById(sheetId).getSheetByName("billing");
  if (!sheet) { Logger.log("Feuille 'billing' introuvable"); return; }

  var data = sheet.getDataRange().getValues();
  var now  = new Date();

  for (var i = 1; i < data.length; i++) {
    var row    = data[i];
    var event  = row[9] || "";
    var raw    = {};
    try { raw = JSON.parse(row[10] || "{}"); } catch(e) {}

    // Ne traiter que les checkout.session.completed non encore facturés
    if (event !== "checkout.session.completed") continue;
    if (raw.pennylane_setup_invoice_id) continue; // déjà créé

    var clientData = {
      restoId:     row[1],
      billingEmail: row[2],
      plan:        row[3],
      billingName: raw.billingName || row[2]
    };

    // Créer facture installation
    var result = createSetupInvoice(clientData);
    if (result && result.id) {
      raw.pennylane_setup_invoice_id = result.id;
      sheet.getRange(i + 1, 11).setValue(JSON.stringify(raw));
      Logger.log("Facture installation créée : " + result.id + " pour " + clientData.billingEmail);
    } else {
      Logger.log("Erreur facture installation : " + JSON.stringify(result));
    }
  }
}

/* =====================================================
   Fonctions internes Pennylane API
   ===================================================== */

function _getOrCreateCustomer(clientData, apiKey) {
  var email = clientData.billingEmail || "";
  if (!email) return { error: "Email client manquant" };

  // Chercher si le client existe déjà
  var search = _apiGet("/customers?term=" + encodeURIComponent(email), apiKey);
  if (search && search.customers && search.customers.length > 0) {
    return search.customers[0];
  }

  // Créer le client
  var nameParts = (clientData.billingName || email).split(" ");
  return _apiPost("/customers", {
    customer: {
      customer_type: "company",
      name:          clientData.billingName || email,
      emails:        [email],
      billing_address: {
        country_alpha2: "FR"
      }
    }
  }, apiKey);
}

function _createInvoice(invoiceData, apiKey) {
  var result = _apiPost("/customer_invoices", { customer_invoice: invoiceData }, apiKey);
  if (result && result.id) {
    Logger.log("Facture Pennylane créée : " + result.id);
  }
  return result;
}

function _apiGet(path, apiKey) {
  try {
    var res = UrlFetchApp.fetch(PENNYLANE_API + path, {
      method:  "get",
      headers: {
        Authorization:  "Bearer " + apiKey,
        Accept:         "application/json"
      },
      muteHttpExceptions: true
    });
    return JSON.parse(res.getContentText());
  } catch(e) { Logger.log("Pennylane GET error: " + e.message); return null; }
}

function _apiPost(path, payload, apiKey) {
  try {
    var res = UrlFetchApp.fetch(PENNYLANE_API + path, {
      method:      "post",
      headers: {
        Authorization:  "Bearer " + apiKey,
        Accept:         "application/json",
        "Content-Type": "application/json"
      },
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true
    });
    return JSON.parse(res.getContentText());
  } catch(e) { Logger.log("Pennylane POST error: " + e.message); return null; }
}

function _getApiKey() {
  return PropertiesService.getScriptProperties().getProperty("PENNYLANE_API_KEY") || "";
}

function _today() {
  return new Date().toISOString().slice(0, 10);
}
