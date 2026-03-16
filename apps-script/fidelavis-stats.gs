/**
 * ============================================================
 *  Fidelavis — Stats & Events Logger
 *  Google Apps Script
 * ============================================================
 *
 *  INSTALLATION :
 *  1. Créer un nouveau projet sur script.google.com
 *  2. Coller ce code
 *  3. Dans Extensions > Propriétés du script, ajouter :
 *       SHEET_ID  →  l'ID de votre Google Sheet de logs
 *       (ex : https://docs.google.com/spreadsheets/d/SHEET_ID/edit)
 *  4. Créer une Google Sheet avec une feuille nommée "events"
 *     et ces colonnes en ligne 1 :
 *       A=timestamp  B=resto  C=event  D=jour  E=mois
 *       F=annee  G=user  H=deviceId  I=sessionId  J=demo  K=src
 *  5. Déployer > Nouveau déploiement > Application Web
 *       Exécuter en tant que : Moi
 *       Accès : Tout le monde (anonyme)
 *  6. Copier l'URL et remplacer SCRIPT_URL dans :
 *       assets/core.js
 *       resto1/admin/espace-admin.html
 *       resto2/admin/espace-admin.html
 *       voltaire/admin/espace-admin.html
 *       resto1/admin/state.html
 *       resto2/admin/state.html
 *       voltaire/admin/state.html
 * ============================================================
 */

// ─── Configuration ──────────────────────────────────────────
var SHEET_NAME = "events";

// ─── Noms d'événements reconnus ─────────────────────────────
var EVENT_KEYS = {
  scan:              "scan",
  signup:            "signup",
  inscription:       "signup",    // alias legacy
  install_confirmed: "install_confirmed",
  coupon_validate:   "coupon_validate",
  coupon_validated:  "coupon_validate", // alias
};

// ─── doPost : enregistre un événement ───────────────────────
function doPost(e) {
  try {
    // core.js envoie en application/x-www-form-urlencoded
    // avec un champ "data" contenant le JSON de l'événement
    var raw = e.parameter && e.parameter.data
      ? e.parameter.data
      : (e.postData ? e.postData.contents : null);

    if (!raw) return ok({ saved: false, reason: "no data" });

    var d;
    try { d = JSON.parse(raw); } catch (_) { d = {}; }

    var resto  = (d.resto  || "").toString().trim().toLowerCase();
    var event  = (d.event  || "").toString().trim().toLowerCase();
    var jour   = d.jour   || new Date().toISOString().slice(0, 10);
    var mois   = d.mois   || (new Date().getMonth() + 1);
    var annee  = d.annee  || new Date().getFullYear();
    var user   = d.user   || "";
    var device = d.deviceId  || "";
    var sess   = d.sessionId || "";
    var demo   = d.demo   || "";
    var src    = d.src    || "";

    if (!resto || !event) return ok({ saved: false, reason: "missing resto/event" });

    // Ignorer les événements de démo
    if (demo === true || demo === "true" || demo === "1") {
      return ok({ saved: false, reason: "demo" });
    }

    var sheet = getSheet();
    sheet.appendRow([
      new Date().toISOString(), // A: timestamp
      resto,                    // B: resto
      event,                    // C: event
      jour,                     // D: jour
      mois,                     // E: mois
      annee,                    // F: annee
      user,                     // G: user
      device,                   // H: deviceId
      sess,                     // I: sessionId
      demo,                     // J: demo
      src                       // K: src
    ]);

    return ok({ saved: true });

  } catch (err) {
    return ok({ saved: false, error: err.message });
  }
}

// ─── doGet : renvoie les stats ou reçoit via GET ─────────────
function doGet(e) {
  var p = e.parameter || {};

  // ── Écriture via GET (fallback si POST bloqué) ────────────
  if (p.action === "track" && p.data) {
    return doPost({ parameter: { data: p.data }, postData: null });
  }

  // ── Lecture des stats ─────────────────────────────────────
  if (p.resto) {
    var resto = p.resto.toString().trim().toLowerCase();
    var days  = parseInt(p.days) || 30;
    try {
      var stats = computeStats(resto, days);
      return ok({ ok: true, stats: stats, resto: resto, days: days });
    } catch (err) {
      return ok({ ok: false, error: err.message });
    }
  }

  // ── Healthcheck ───────────────────────────────────────────
  return ok({ ok: true, status: "Fidelavis Stats API", version: "1.0" });
}

// ─── computeStats : agrège les données ──────────────────────
function computeStats(resto, days) {
  var sheet  = getSheet();
  var data   = sheet.getDataRange().getValues();
  var cutoff = new Date(Date.now() - days * 86400000);

  var counts = {
    scan:              0,
    signup:            0,
    install_confirmed: 0,
    coupon_validate:   0
  };

  // Ligne 0 = en-têtes, on commence à 1
  for (var i = 1; i < data.length; i++) {
    var row     = data[i];
    var ts      = row[0]; // timestamp ISO
    var rowResto = (row[1] || "").toString().trim().toLowerCase();
    var rawEvent = (row[2] || "").toString().trim().toLowerCase();

    if (rowResto !== resto) continue;

    var rowDate;
    try { rowDate = new Date(ts); } catch (_) { continue; }
    if (isNaN(rowDate.getTime()) || rowDate < cutoff) continue;

    var normalizedEvent = EVENT_KEYS[rawEvent] || rawEvent;
    if (counts.hasOwnProperty(normalizedEvent)) {
      counts[normalizedEvent]++;
    }
  }

  return counts;
}

// ─── Helpers ─────────────────────────────────────────────────
function getSheet() {
  var sheetId = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
  var ss = sheetId
    ? SpreadsheetApp.openById(sheetId)
    : SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Feuille "' + SHEET_NAME + '" introuvable.');
  return sheet;
}

function ok(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
