// ============================================================
//  FIDELAVIS — GAS Reply Proxy  v2.0
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
//
//  Cette version utilise mybusinessreviews.googleapis.com (pas besoin de l'account ID)
//  et mybusiness.googleapis.com/v4/ en fallback.
// ============================================================

function doPost(e) {
  try {
    // Lecture du paramètre "data" (JSON encodé en form-urlencoded)
    var raw  = (e && e.parameter && e.parameter.data) ? e.parameter.data : '{}';
    var body = JSON.parse(raw);

    var locationPath = body.locationPath; // ex: "accounts/123/locations/456" OU "locations/456" OU juste "456"
    var reviewId     = body.reviewId;     // ex: "AbcDeFgHiJkLmN..."
    var comment      = body.comment;      // texte de la réponse

    if (!locationPath || !reviewId || !comment) {
      return buildResponse({ error: 'Paramètres manquants : locationPath, reviewId, comment requis.' });
    }

    // Extraire l'ID de localisation numérique (fonctionne pour tous les formats)
    // "accounts/123/locations/9563940357552092280" → "9563940357552092280"
    // "locations/9563940357552092280" → "9563940357552092280"
    // "9563940357552092280" → "9563940357552092280"
    var locationId = locationPath;
    if (locationPath.indexOf('/locations/') !== -1) {
      locationId = locationPath.split('/locations/').pop();
    } else if (locationPath.indexOf('locations/') === 0) {
      locationId = locationPath.split('locations/').pop();
    }

    // Token OAuth du compte Google connecté au script (le propriétaire de la fiche)
    var token = ScriptApp.getOAuthToken();

    var options = {
      method:             'put',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type':  'application/json'
      },
      payload:             JSON.stringify({ comment: comment }),
      muteHttpExceptions:  true
    };

    // ── Tentative 1 : nouvelle API (pas besoin d'account ID) ──────────────────
    var url1 = 'https://mybusinessreviews.googleapis.com/v1/locations/' + locationId + '/reviews/' + reviewId + '/reply';
    var resp1 = UrlFetchApp.fetch(url1, options);
    var code1 = resp1.getResponseCode();

    if (code1 >= 200 && code1 < 300) {
      return buildResponse({ ok: true, message: 'Réponse publiée (API v1).', api: 'mybusinessreviews/v1' });
    }

    // ── Tentative 2 : ancienne API v4 (nécessite accounts/X/locations/Y) ──────
    var url2 = 'https://mybusiness.googleapis.com/v4/' + locationPath + '/reviews/' + reviewId + '/reply';
    var resp2 = UrlFetchApp.fetch(url2, options);
    var code2 = resp2.getResponseCode();

    if (code2 >= 200 && code2 < 300) {
      return buildResponse({ ok: true, message: 'Réponse publiée (API v4).', api: 'mybusiness/v4' });
    }

    // ── Les deux ont échoué ────────────────────────────────────────────────────
    var err1 = resp1.getContentText();
    var err2 = resp2.getContentText();

    var errMsg = 'Erreur Google (' + code1 + ')';
    try {
      var errData = JSON.parse(err1);
      if (errData.error && errData.error.message) { errMsg = errData.error.message; }
    } catch (x) {}

    return buildResponse({
      error:     errMsg,
      api1_code: code1, api1_response: err1.substring(0, 500),
      api2_code: code2, api2_response: err2.substring(0, 500)
    });

  } catch (err) {
    return buildResponse({ error: err.toString() });
  }
}

// ============================================================
//  doGet — Ping, test des APIs et liste des fiches
// ============================================================
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : 'ping';

  // ── Ping simple ──────────────────────────────────────────────────────────────
  if (action === 'ping') {
    return buildResponse({
      status:    'ok',
      service:   'Fidelavis Reply Proxy',
      version:   '2.0',
      timestamp: new Date().toISOString(),
      tips: [
        '?action=test_reviews&location_id=9563940357552092280  → tester l\'API avec votre ID',
        '?action=locations                                      → lister vos fiches (si API activée)'
      ]
    });
  }

  // ── Test de l'API reviews avec un location_id connu ──────────────────────────
  if (action === 'test_reviews') {
    var locationId = (e && e.parameter && e.parameter.location_id) ? e.parameter.location_id : '';
    if (!locationId) {
      return buildResponse({ error: 'Ajoutez &location_id=VOTRE_ID_NUMERIQUE à l\'URL. Ex: &location_id=9563940357552092280' });
    }

    try {
      var token = ScriptApp.getOAuthToken();

      // Test nouvelle API (mybusinessreviews)
      var resp1 = UrlFetchApp.fetch(
        'https://mybusinessreviews.googleapis.com/v1/locations/' + locationId + '/reviews?pageSize=1',
        { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
      );
      var code1 = resp1.getResponseCode();
      var text1 = resp1.getContentText();

      // Test ancienne API v4 (juste les comptes)
      var resp2 = UrlFetchApp.fetch(
        'https://mybusiness.googleapis.com/v4/accounts',
        { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
      );
      var code2 = resp2.getResponseCode();

      var result = {
        location_id_teste: locationId,
        mybusinessreviews_v1: {
          code: code1,
          ok:   (code1 >= 200 && code1 < 300),
          data: (code1 >= 200 && code1 < 300) ? JSON.parse(text1) : text1.substring(0, 300)
        },
        mybusiness_v4_accounts: {
          code: code2,
          ok:   (code2 >= 200 && code2 < 300)
        }
      };

      if (code1 >= 200 && code1 < 300) {
        result.success = true;
        result.message = '✅ API mybusinessreviews OK ! Entrez "locations/' + locationId + '" dans Fidelavis.';
        result.location_path_a_entrer = 'locations/' + locationId;
      } else {
        result.success = false;
        result.message = '❌ API indisponible. Voir les codes d\'erreur ci-dessus.';
      }

      return buildResponse(result);

    } catch (err) {
      return buildResponse({ error: err.toString() });
    }
  }

  // ── Liste des comptes et localisations ───────────────────────────────────────
  if (action === 'locations') {
    try {
      var token = ScriptApp.getOAuthToken();

      var accountsResp = UrlFetchApp.fetch(
        'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
        { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
      );
      var accountsCode = accountsResp.getResponseCode();
      var accountsText = accountsResp.getContentText();

      if (accountsCode !== 200) {
        return buildResponse({
          error:    'API Account Management non disponible (code ' + accountsCode + ').',
          conseil:  'Utilisez ?action=test_reviews&location_id=VOTRE_ID à la place.',
          raw:      accountsText.substring(0, 500)
        });
      }

      var accountsData = JSON.parse(accountsText);
      var accounts = accountsData.accounts || [];

      if (accounts.length === 0) {
        return buildResponse({
          error: 'Aucun compte GBP trouvé.',
          tip:   'Allez sur business.google.com avec ce compte pour vérifier votre fiche.'
        });
      }

      var result = [];
      for (var i = 0; i < accounts.length; i++) {
        var account = accounts[i];
        var locsResp = UrlFetchApp.fetch(
          'https://mybusinessinformation.googleapis.com/v1/' + account.name + '/locations?readMask=name,title',
          { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
        );
        var locsData = JSON.parse(locsResp.getContentText());
        var locations = locsData.locations || [];

        for (var j = 0; j < locations.length; j++) {
          var loc = locations[j];
          result.push({
            location_id:   loc.name,
            nom_fiche:     loc.title || loc.name,
            compte:        account.name
          });
        }
      }

      return buildResponse({
        ok:     true,
        fiches: result,
        tip:    'Copiez la valeur "location_id" dans Fidelavis → Paramètres → ⚙️ ID manuel.'
      });

    } catch (err) {
      return buildResponse({ error: err.toString() });
    }
  }

  return buildResponse({ error: 'Action inconnue. Utilisez ?action=ping, ?action=test_reviews&location_id=XXX ou ?action=locations' });
}

// Helper — retourne une réponse JSON
function buildResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}
