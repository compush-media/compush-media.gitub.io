/**
 * ============================================================
 *  Fidelavis — Stats & Events Logger  v2.1
 *  Google Apps Script
 * ============================================================
 *
 *  INSTALLATION :
 *  1. Créer un nouveau projet sur script.google.com
 *  2. Coller ce code
 *  3. Dans Extensions > Propriétés du script, ajouter :
 *       SHEET_ID  →  l'ID de votre Google Sheet de logs
 *  4. Créer une Google Sheet feuille "events" colonnes :
 *       A=timestamp  B=resto  C=event  D=jour  E=mois
 *       F=annee  G=user  H=deviceId  I=sessionId  J=demo  K=src
 *  5. Déployer > Nouveau déploiement > Application Web
 *       Exécuter en tant que : Moi  /  Accès : Tout le monde
 *  6. Copier l'URL → assets/core.js + <slug>/admin/espace-admin.html
 * ============================================================
 */

var SHEET_NAME = "events";

// ─── Normalise un identifiant restaurant en slug ─────────────
//     "Casa Loca" → "casa-loca"  |  "casa loca" → "casa-loca"
function toSlug(name) {
  return (name || "").toString().trim().toLowerCase().replace(/\s+/g, '-');
}

// ─── Aliases événements → nom canonique ──────────────────────
var EVENT_KEYS = {
  // Scans
  scan:              "scan",

  // Inscriptions
  signup:            "signup",
  inscription:       "signup",
  form_submit:       "signup",

  // Installations PWA
  install_confirmed: "install_confirmed",
  install:           "install_confirmed",  // alias core.js v2
  install_attempt:   "install_attempt",
  install_cta_click: "install_attempt",

  // Coupons
  coupon_validate:   "coupon_validate",
  coupon_validated:  "coupon_validate",
  coupon_view:       "coupon_view",

  // Avis Google (tous les variants → "review")
  review_click:      "review",
  review_open:       "review",
  review_page_view:  "review",
  review_qr_view:    "review",
};

// ─── doPost : enregistre un événement ────────────────────────
function doPost(e) {
  try {
    var raw = e.parameter && e.parameter.data
      ? e.parameter.data
      : (e.postData ? e.postData.contents : null);

    if (!raw) return ok({ saved: false, reason: "no data" });

    var d;
    try { d = JSON.parse(raw); } catch (_) { d = {}; }

    var resto  = toSlug(d.resto);           // normalise à l'écriture
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
    if (demo === true || demo === "true" || demo === "1") {
      return ok({ saved: false, reason: "demo" });
    }

    var sheet = getSheet();
    sheet.appendRow([
      new Date().toISOString(),
      resto, event, jour, mois, annee,
      user, device, sess, demo, src
    ]);

    return ok({ saved: true });
  } catch (err) {
    return ok({ saved: false, error: err.message });
  }
}

// ─── doGet : stats + daily pour les dashboards ───────────────
function doGet(e) {
  var p = e.parameter || {};

  if (p.action === "track" && p.data) {
    return doPost({ parameter: { data: p.data }, postData: null });
  }

  if (p.resto) {
    var resto = toSlug(p.resto);            // normalise à la lecture
    var days  = parseInt(p.days) || 30;
    try {
      var result = computeAll(resto, days);
      return ok({
        ok:     true,
        stats:  result.stats,
        daily:  result.daily,
        recent: result.recent,
        resto:  resto,
        days:   days
      });
    } catch (err) {
      return ok({ ok: false, error: err.message });
    }
  }

  return ok({ ok: true, status: "Fidelavis Stats API", version: "2.1" });
}

// ─── computeAll : stats + daily + recent ─────────────────────
function computeAll(resto, days) {
  var sheet  = getSheet();
  var data   = sheet.getDataRange().getValues();
  var cutoff = new Date(Date.now() - days * 86400000);

  var stats = {
    scan:              0,
    signup:            0,
    install_confirmed: 0,
    install_attempt:   0,
    coupon_validate:   0,
    coupon_view:       0,
    review:            0
  };

  // daily: { "2026-04-01": { scan, signup, install, coupon, review, total } }
  var dailyMap = {};
  var recentRows = [];

  for (var i = 1; i < data.length; i++) {
    var row      = data[i];
    var ts       = row[0];
    var rowResto = toSlug(row[1]);          // normalise historique
    var rawEvent = (row[2] || "").toString().trim().toLowerCase();
    var jour     = (row[3] || "").toString().slice(0, 10);

    if (rowResto !== resto) continue;

    var rowDate;
    try { rowDate = new Date(ts); } catch (_) { continue; }
    if (isNaN(rowDate.getTime()) || rowDate < cutoff) continue;

    var ev = EVENT_KEYS[rawEvent] || rawEvent;

    // Compteurs globaux
    if (stats.hasOwnProperty(ev)) stats[ev]++;

    // Compteurs journaliers
    var day = jour || rowDate.toISOString().slice(0, 10);
    if (!dailyMap[day]) {
      dailyMap[day] = { day: day, scan: 0, signup: 0, install: 0, coupon: 0, review: 0, total: 0 };
    }
    dailyMap[day].total++;
    if (ev === "scan")              dailyMap[day].scan++;
    if (ev === "signup")            dailyMap[day].signup++;
    if (ev === "install_confirmed") dailyMap[day].install++;
    if (ev === "coupon_validate")   dailyMap[day].coupon++;
    if (ev === "review")            dailyMap[day].review++;

    // Activité récente (les 20 derniers)
    if (recentRows.length < 20) {
      recentRows.push({ ts: ts, event: ev, user: (row[6] || ""), src: (row[10] || "") });
    }
  }

  var daily = Object.values(dailyMap).sort(function(a, b) {
    return a.day < b.day ? -1 : 1;
  });

  return { stats: stats, daily: daily, recent: recentRows };
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

function ok(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
