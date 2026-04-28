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

// ============================================================
//  doGet — Ping + liste des fiches (pour trouver l'ID de localisation)
//  Ouvrir l'URL du script dans le navigateur pour voir vos IDs
// ============================================================
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'ping';

  // Ping simple
  if (action === 'ping') {
    return buildResponse({
      status:    'ok',
      service:   'Fidelavis Reply Proxy',
      version:   '1.1',
      timestamp: new Date().toISOString(),
      tip:       'Ajoutez ?action=locations à l\'URL pour voir vos IDs de localisation.'
    });
  }

  // Liste des comptes et localisations (pour récupérer l'ID de localisation)
  if (action === 'locations') {
    try {
      var token = ScriptApp.getOAuthToken();

      // Récupère les comptes — v1 Account Management API
      var accountsResp = UrlFetchApp.fetch(
        'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
        { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
      );
      var accountsCode = accountsResp.getResponseCode();
      var accountsText = accountsResp.getContentText();

      // Si erreur HTTP, tente l'ancienne API v4
      if (accountsCode !== 200) {
        var v4Resp = UrlFetchApp.fetch(
          'https://mybusiness.googleapis.com/v4/accounts',
          { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
        );
        return buildResponse({
          debug: true,
          v1_code: accountsCode,
          v1_response: accountsText,
          v4_code: v4Resp.getResponseCode(),
          v4_response: v4Resp.getContentText()
        });
      }

      var accountsData = JSON.parse(accountsText);
      var accounts = accountsData.accounts || [];

      if (accounts.length === 0) {
        return buildResponse({
          error: 'Aucun compte GBP trouvé pour ce compte Google.',
          debug_raw: accountsText,
          tip: 'Allez sur business.google.com avec ce compte pour vérifier votre fiche, puis relancez.'
        });
      }

      var result = [];
      for (var i = 0; i < accounts.length; i++) {
        var account = accounts[i];

        // Récupère les fiches de ce compte
        var locsResp = UrlFetchApp.fetch(
          'https://mybusinessinformation.googleapis.com/v1/' + account.name + '/locations?readMask=name,title',
          { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
        );
        var locsData = JSON.parse(locsResp.getContentText());
        var locations = locsData.locations || [];

        for (var j = 0; j < locations.length; j++) {
          var loc = locations[j];
          result.push({
            location_id:   loc.name,           // ← COPIEZ CETTE VALEUR dans Fidelavis
            nom_fiche:     loc.title || loc.name,
            compte:        account.name,
            nom_compte:    account.accountName || account.name
          });
        }
      }

      return buildResponse({
        ok:        true,
        fiches:    result,
        message:   'Copiez la valeur "location_id" dans Fidelavis → Paramètres → Fiches Google → ⚙️ Saisir l\'ID manuellement.'
      });

    } catch (err) {
      return buildResponse({ error: err.toString() });
    }
  }

  return buildResponse({ error: 'Action inconnue. Utilisez ?action=ping ou ?action=locations' });
}

// Helper — retourne une réponse JSON
function buildResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}
