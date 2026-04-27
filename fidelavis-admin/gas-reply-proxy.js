// ============================================================
//  FIDELAVIS — GAS Reply Proxy
//  Script Google Apps Script pour publier les réponses
//  aux avis Google SANS approbation API
//
//  Installation :
//  1. Aller sur https://script.google.com
//  2. Créer un nouveau projet → coller ce code
//  3. Déployer → Nouveau déploiement → Application Web
//     - Exécuter en tant que : Moi
//     - Personnes ayant accès : Tout le monde
//  4. Copier l'URL → Fidelavis → Paramètres → Clés API → GAS Proxy
// ============================================================

function doPost(e) {
  try {
    // Lecture du paramètre "data" (JSON encodé en form-urlencoded)
    var raw  = (e && e.parameter && e.parameter.data) ? e.parameter.data : '{}';
    var body = JSON.parse(raw);

    var locationPath = body.locationPath; // ex: "accounts/123456789/locations/987654321"
    var reviewId     = body.reviewId;     // ex: "AbcDeFgHiJkLmN..."
    var comment      = body.comment;      // texte de la réponse

    if (!locationPath || !reviewId || !comment) {
      return buildResponse({ error: 'Paramètres manquants : locationPath, reviewId, comment requis.' });
    }

    // Token OAuth du compte Google connecté au script (le propriétaire de la fiche)
    var token = ScriptApp.getOAuthToken();

    // Endpoint Google My Business API v4
    var url = 'https://mybusiness.googleapis.com/v4/' + locationPath + '/reviews/' + reviewId + '/reply';

    var options = {
      method:             'put',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type':  'application/json'
      },
      payload:             JSON.stringify({ comment: comment }),
      muteHttpExceptions:  true
    };

    var resp = UrlFetchApp.fetch(url, options);
    var code = resp.getResponseCode();

    if (code >= 200 && code < 300) {
      return buildResponse({ ok: true, message: 'Réponse publiée avec succès.' });
    }

    // Erreur Google — on renvoie le message
    var errText = resp.getContentText();
    var errMsg  = 'Erreur Google (' + code + ')';
    try {
      var errData = JSON.parse(errText);
      if (errData.error && errData.error.message) {
        errMsg = errData.error.message;
      }
    } catch (parseErr) {}

    return buildResponse({ error: errMsg, code: code });

  } catch (err) {
    return buildResponse({ error: err.toString() });
  }
}

// Ping de vérification (depuis le navigateur ou le dashboard)
function doGet() {
  return buildResponse({
    status:    'ok',
    service:   'Fidelavis Reply Proxy',
    version:   '1.0',
    timestamp: new Date().toISOString()
  });
}

// Helper — retourne une réponse JSON
function buildResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
