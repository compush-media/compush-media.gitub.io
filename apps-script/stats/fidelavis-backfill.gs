/**
 * ============================================================
 *  Fidelavis — Back-fill GAS → Supabase  v1.0
 *  Google Apps Script — exécution manuelle une fois
 * ============================================================
 *
 *  UTILISATION :
 *  1. Ouvrir le projet GAS associé à la Sheet events
 *  2. Coller ce fichier (ou ajouter un nouveau fichier .gs)
 *  3. Sélectionner la fonction "backfillEventsToSupabase"
 *  4. Cliquer ▶ Exécuter
 *  5. Vérifier les logs (Affichage > Journaux)
 *
 *  SÉCURITÉ :
 *  - Utilise la clé publishable Supabase (lecture seule côté auth)
 *  - RLS events : INSERT autorisé pour anon
 *  - Lignes demo ignorées
 *  - Relancer le script est safe : les doublons sont ignorés
 *    (contrainte unique sur created_at + restaurant_slug + event_type + device_id)
 *
 *  ⚠️  Avant de lancer : s'assurer que la migration
 *      phase5d_backfill_unique_constraint est appliquée sur Supabase
 * ============================================================
 */

var SUPA_URL  = "https://rtdiaeskmyjjwohirhzj.supabase.co";
var SUPA_KEY  = "sb_publishable_V9jcAKPdqxhupYWxoejARQ_D_AmOpcZ";
var BATCH_SIZE = 200;

// Mapping event_type (même logique que fidelavis-stats.gs)
var EVENT_KEYS = {
  scan:              "scan",
  signup:            "signup",
  inscription:       "signup",
  form_submit:       "signup",
  install_confirmed: "install_confirmed",
  install:           "install_confirmed",
  install_attempt:   "install_attempt",
  install_cta_click: "install_attempt",
  coupon_validate:   "coupon_validate",
  coupon_validated:  "coupon_validate",
  coupon_view:       "coupon_view",
  review_click:      "review",
  review_open:       "review",
  review_page_view:  "review",
  review_qr_view:    "review",
};

function toSlug(name) {
  return (name || "").toString().trim().toLowerCase().replace(/\s+/g, '-');
}

// ─── Point d'entrée principal ────────────────────────────────
function backfillEventsToSupabase() {
  Logger.log("=== Fidelavis Back-fill GAS → Supabase ===");

  var sheet = getSheet();
  var data  = sheet.getDataRange().getValues();

  Logger.log("Lignes dans la Sheet (header inclus) : " + data.length);

  var rows     = [];
  var skipped  = 0;
  var invalids = 0;

  for (var i = 1; i < data.length; i++) {
    var row   = data[i];
    var ts    = row[0]; // timestamp
    var resto = toSlug(row[1]);
    var event = (row[2] || "").toString().trim().toLowerCase();
    var jour  = (row[3] || "").toString().slice(0, 10);
    var mois  = parseInt(row[4]) || null;
    var annee = parseInt(row[5]) || null;
    var user  = (row[6] || "").toString().trim();
    var devId = (row[7] || "").toString().trim() || null;
    var sessId= (row[8] || "").toString().trim() || null;
    var demo  = row[9];
    var src   = (row[10] || "").toString().trim() || null;

    // Skip demo
    if (demo === true || demo === "true" || demo === "1") {
      skipped++;
      continue;
    }

    // Skip sans resto ou event
    if (!resto || !event) {
      invalids++;
      continue;
    }

    // Normaliser event
    var eventType = EVENT_KEYS[event] || event;

    // Normaliser timestamp
    var createdAt;
    try {
      var d = new Date(ts);
      if (isNaN(d.getTime())) throw new Error("invalid");
      createdAt = d.toISOString();
    } catch (_) {
      createdAt = new Date().toISOString();
    }

    // Normaliser jour
    if (!jour || jour.length < 10) {
      try { jour = new Date(ts).toISOString().slice(0, 10); } catch (_) { jour = null; }
    }

    // Normaliser mois/annee depuis jour si absents
    if (!mois || !annee) {
      try {
        var dt = new Date(ts);
        if (!mois)  mois  = dt.getMonth() + 1;
        if (!annee) annee = dt.getFullYear();
      } catch (_) {}
    }

    rows.push({
      restaurant_slug: resto,
      event_type:      eventType,
      device_id:       devId,
      session_id:      sessId,
      src:             src,
      demo:            false,
      jour:            jour || null,
      mois:            mois || null,
      annee:           annee || null,
      created_at:      createdAt
    });
  }

  Logger.log("Lignes valides à importer : " + rows.length);
  Logger.log("Ignorées (demo) : "           + skipped);
  Logger.log("Ignorées (invalides) : "      + invalids);

  if (rows.length === 0) {
    Logger.log("Rien à importer.");
    return;
  }

  // ── Envoi par batches ────────────────────────────────────────
  var total     = 0;
  var errors    = 0;
  var nbBatches = Math.ceil(rows.length / BATCH_SIZE);

  for (var b = 0; b < nbBatches; b++) {
    var batch = rows.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);

    try {
      var response = UrlFetchApp.fetch(SUPA_URL + "/rest/v1/events", {
        method:  "POST",
        headers: {
          "apikey":        SUPA_KEY,
          "Authorization": "Bearer " + SUPA_KEY,
          "Content-Type":  "application/json",
          // ignore-duplicates : relancer le script est safe
          "Prefer":        "return=minimal,resolution=ignore-duplicates"
        },
        payload:              JSON.stringify(batch),
        muteHttpExceptions:   true
      });

      var code = response.getResponseCode();

      if (code === 200 || code === 201 || code === 204) {
        total += batch.length;
        Logger.log("Batch " + (b + 1) + "/" + nbBatches + " : " + batch.length + " lignes OK (HTTP " + code + ")");
      } else {
        errors += batch.length;
        Logger.log("Batch " + (b + 1) + "/" + nbBatches + " ERREUR HTTP " + code + " : " + response.getContentText().slice(0, 300));
      }

    } catch (e) {
      errors += batch.length;
      Logger.log("Batch " + (b + 1) + "/" + nbBatches + " EXCEPTION : " + e.message);
    }

    // Pause 200ms entre batches pour ne pas saturer l'API
    Utilities.sleep(200);
  }

  Logger.log("=== Back-fill terminé ===");
  Logger.log("Lignes envoyées avec succès : " + total);
  Logger.log("Lignes en erreur :            " + errors);
}

// ─── Helper : ouvre la feuille "events" ──────────────────────
function getSheet() {
  var sheetId = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
  if (!sheetId) {
    throw new Error(
      'Propriété SHEET_ID manquante. ' +
      'Va dans Paramètres du projet (⚙️) → Propriétés du script → ' +
      'Ajouter : clé=SHEET_ID, valeur=ID de ta Google Sheet events ' +
      '(partie de l\'URL entre /d/ et /edit).'
    );
  }
  var ss = SpreadsheetApp.openById(sheetId);
  if (!ss) throw new Error('Impossible d\'ouvrir la Sheet ID=' + sheetId);
  var sheet = ss.getSheetByName("events");
  if (!sheet) throw new Error('Feuille "events" introuvable dans la Sheet ID=' + sheetId + '. Vérifie le nom exact de l\'onglet.');
  return sheet;
}

// ─── Test : affiche un aperçu des 5 premières lignes mappées ─
function previewMapping() {
  var sheet = getSheet();
  var data  = sheet.getDataRange().getValues();
  Logger.log("=== Aperçu des 5 premières lignes ===");
  for (var i = 1; i <= Math.min(5, data.length - 1); i++) {
    var row = data[i];
    Logger.log(JSON.stringify({
      restaurant_slug: toSlug(row[1]),
      event_type:      EVENT_KEYS[(row[2]||"").toLowerCase()] || row[2],
      device_id:       row[7] || null,
      src:             row[10] || null,
      created_at:      new Date(row[0]).toISOString()
    }));
  }
}
