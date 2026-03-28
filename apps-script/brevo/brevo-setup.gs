/**
 * ============================================================
 *  Fidelavis — Brevo Integration
 *  Google Apps Script
 * ============================================================
 *
 *  INSTALLATION :
 *  1. Créer un nouveau projet sur script.google.com
 *  2. Coller ce code
 *  3. Dans Extensions > Propriétés du script, ajouter :
 *       BREVO_API_KEY  →  votre clé API Brevo (xkeysib-...)
 *  4. Déployer > Nouveau déploiement > Application Web
 *       Exécuter en tant que : Moi
 *       Accès : Tout le monde (anonyme)
 *  5. Copier l'URL de déploiement et la coller dans :
 *       - fidelavis-admin/new-restaurant.html (champ "URL Brevo GAS")
 *       - ou dans config.json de chaque restaurant (brevoGasUrl)
 *
 *  DEUX ACTIONS DISPONIBLES :
 *  ─ action=setup      → appelé depuis new-restaurant.html lors de la création
 *                         d'un restaurant (body JSON : restaurantName, restaurantEmail, restaurantId)
 *                         Crée : liste contacts + 12 templates email + workflow automation
 *                         Retourne : { success, listId, formUrl, workflowId }
 *
 *  ─ action=subscribe  → appelé depuis inscription.html lors d'une inscription client
 *                         (sendBeacon URLSearchParams : data = JSON { email, firstName, listId, resto })
 *                         Crée/met à jour le contact Brevo et l'ajoute à la liste
 *                         Retourne : { success }
 *
 *  SÉCURITÉ :
 *  - La clé API Brevo n'est jamais exposée côté navigateur
 *  - CORS géré via Content-Type: text/plain (pas de preflight OPTIONS)
 * ============================================================
 */

var BREVO_BASE = 'https://api.brevo.com/v3';
var SENDER_EMAIL = 'contact@fidelavis.com';
var GAS_BASE_URL = 'https://script.google.com/macros/s/'; // sera surchargé par getGasUrl()

function getGasUrl() {
  try {
    var url = ScriptApp.getService().getUrl();
    return url || PropertiesService.getScriptProperties().getProperty('GAS_URL') || '';
  } catch(e) {
    return PropertiesService.getScriptProperties().getProperty('GAS_URL') || '';
  }
}

// ─── Point d'entrée GET ──────────────────────────────────────
function doGet(e) {
  return HtmlService.createHtmlOutput('<p>Fidelavis API</p>');
}

// ─── Point d'entrée POST ─────────────────────────────────────
function doPost(e) {
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    var body = parseBody(e);
    var action = body.action || 'subscribe';
    Logger.log('[Brevo] action=' + action);

    if (action === 'setup') {
      output.setContent(JSON.stringify(setupRestaurant(body)));
    } else if (action === 'subscribe') {
      output.setContent(JSON.stringify(subscribeContact(body)));
    } else if (action === 'unsubscribe') {
      var uEmail  = (body.email  || '').trim();
      var uListId = parseInt(body.listId, 10);
      if (!uEmail || !uListId) throw new Error('email et listId requis');
      brevoFetch('POST', '/contacts/lists/' + uListId + '/contacts/remove', { emails: [uEmail] });
      Logger.log('[Unsub] ' + uEmail + ' retiré de la liste #' + uListId);
      output.setContent(JSON.stringify({ success: true }));
    } else if (action === 'deleteRestaurant') {
      output.setContent(JSON.stringify(deleteRestaurant(body)));
    } else if (action === 'passwordReset') {
      output.setContent(JSON.stringify(sendPasswordResetEmail(body)));
    } else if (action === 'requestPasswordReset') {
      output.setContent(JSON.stringify(handleRequestPasswordReset(body)));
    } else if (action === 'confirmPasswordReset') {
      output.setContent(JSON.stringify(handleConfirmPasswordReset(body)));
    } else {
      output.setContent(JSON.stringify({ success: false, error: 'Action inconnue : ' + action }));
    }
  } catch(err) {
    Logger.log('[Brevo] ERROR: ' + err.message);
    output.setContent(JSON.stringify({ success: false, error: err.message }));
  }

  return output;
}

// Supporte deux formats d'entrée :
// 1. Content-Type: text/plain  → body JSON brut dans e.postData.contents
// 2. Content-Type: application/x-www-form-urlencoded (sendBeacon) → e.parameter.data
function parseBody(e) {
  try {
    return JSON.parse(e.postData.contents);
  } catch(_) {
    try {
      return JSON.parse(e.parameter.data);
    } catch(__) {
      throw new Error('Corps de requête invalide');
    }
  }
}

// ─── Clé API Brevo ───────────────────────────────────────────
function getBrevoKey() {
  var key = PropertiesService.getScriptProperties().getProperty('BREVO_API_KEY');
  if (!key) throw new Error('BREVO_API_KEY non configurée dans les propriétés du script');
  return key;
}

// ─── Appel générique vers l'API Brevo ────────────────────────
function brevoFetch(method, path, body) {
  var options = {
    method: method,
    headers: {
      'api-key':      getBrevoKey(),
      'Content-Type': 'application/json',
      'Accept':       'application/json'
    },
    muteHttpExceptions: true
  };
  if (body) options.payload = JSON.stringify(body);

  var response = UrlFetchApp.fetch(BREVO_BASE + path, options);
  var code = response.getResponseCode();
  var text = response.getContentText();

  Logger.log('[Brevo] ' + method + ' ' + path + ' → HTTP ' + code);

  if (code >= 400) {
    throw new Error('Brevo API ' + code + ': ' + text.slice(0, 200));
  }

  if (!text || text === 'null') return {};
  try { return JSON.parse(text); } catch(_) { return { raw: text }; }
}

// ═══════════════════════════════════════════════════════════════
//  ACTION : SETUP (appelé une fois par restaurant)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
//  ACTION : DELETE RESTAURANT
// ═══════════════════════════════════════════════════════════════
function deleteRestaurant(body) {
  var id = (body.restaurantId || '').trim();
  if (!id) throw new Error('restaurantId requis');

  Logger.log('[Delete] ═══ Suppression restaurant : ' + id + ' ═══');
  var props = PropertiesService.getScriptProperties();
  var errors = [];

  // 1. Supprimer les templates Brevo
  var templates = JSON.parse(props.getProperty('TEMPLATES_' + id) || '[]');
  templates.forEach(function(tid) {
    if (!tid) return;
    try {
      brevoFetch('DELETE', '/smtp/templates/' + tid);
      Logger.log('[Delete] Template #' + tid + ' supprimé');
    } catch(e) {
      Logger.log('[Delete] Template #' + tid + ' — ' + e.message);
    }
  });

  // 2. Supprimer la liste Brevo
  var listId = parseInt(props.getProperty('LIST_ID_' + id), 10);
  if (listId) {
    try {
      brevoFetch('DELETE', '/contacts/lists/' + listId);
      Logger.log('[Delete] Liste Brevo #' + listId + ' supprimée');
    } catch(e) {
      errors.push('Liste Brevo : ' + e.message);
      Logger.log('[Delete] Liste #' + listId + ' — ' + e.message);
    }
  }

  // 3. Supprimer l'onglet Google Sheet
  try {
    var ss = getSheet();
    var sheet = ss.getSheetByName(id);
    if (sheet) {
      ss.deleteSheet(sheet);
      Logger.log('[Delete] Onglet Sheet "' + id + '" supprimé');
    }
  } catch(e) {
    Logger.log('[Delete] Sheet — ' + e.message);
  }

  // 4. Supprimer les propriétés du script
  props.deleteProperty('TEMPLATES_'   + id);
  props.deleteProperty('SENDER_NAME_' + id);
  props.deleteProperty('SENDER_EMAIL_'+ id);
  props.deleteProperty('LIST_ID_'     + id);
  Logger.log('[Delete] Propriétés supprimées pour ' + id);

  Logger.log('[Delete] ═══ Suppression terminée : ' + id + ' ═══');
  return { success: true, errors: errors };
}

function setupRestaurant(body) {
  var name      = (body.restaurantName  || 'Restaurant').trim();
  var email     = (body.restaurantEmail || '').trim();
  var id        = (body.restaurantId    || '').trim();
  var adminPass = (body.adminPass       || '').trim();
  var empPass   = (body.empPass         || '').trim();

  Logger.log('[Brevo] ═══ Setup : ' + name + ' (' + id + ') ═══');

  // 0. Récupérer l'expéditeur vérifié du compte (évite "Sender is invalid")
  var sender = getVerifiedSender(name, email);
  Logger.log('[Brevo] Expéditeur utilisé : ' + sender.email);

  // 1. Créer la liste contacts
  var listId = createContactList(name);

  // 2. Créer le template d'email de bienvenue (J+0)
  var welcomeId = createTemplate(name, sender, 0, {
    subject: 'Bienvenue chez ' + name + ' ! 🎁',
    headline: 'Votre -10% est activé !',
    body:     'Merci d\'avoir rejoint le programme de fidélité Fidelavis de ' + name +
              '. Votre réduction de bienvenue est désormais disponible lors de votre prochaine visite.'
  });

  // 3. Créer les 11 templates mensuels (J+30 à J+330)
  var monthlyData = [
    { m:1,  subject:'Un mois déjà !',        headline:'Votre offre du mois',       body:'Déjà un mois que vous faites partie de notre communauté ! Retrouvez notre offre exclusive ce mois-ci.' },
    { m:2,  subject:'Votre fidélité payante', headline:'Merci pour votre fidélité', body:'2 mois de bons moments ensemble. Un cadeau vous attend ce mois-ci chez ' + name + '.' },
    { m:3,  subject:'3 mois gourmands',       headline:'3 mois ensemble',           body:'3 mois de délices partagés ! Revenez profiter de nos nouvelles créations.' },
    { m:4,  subject:'Nouvelles saveurs',      headline:'Découvrez nos nouveautés',  body:'Notre chef a concocté de nouvelles créations rien que pour vous. Venez les découvrir !' },
    { m:5,  subject:'Votre récompense',       headline:'Offre exclusive 5 mois',    body:'5 mois de fidélité méritent une récompense ! Voici votre offre exclusive du mois.' },
    { m:6,  subject:'6 mois — Merci !',       headline:'Déjà 6 mois ensemble',      body:'Un semestre de fidélité, ça se fête ! Nous vous offrons une surprise ce mois-ci.' },
    { m:7,  subject:'Rentrée gourmande',      headline:'La rentrée chez ' + name,   body:'La rentrée est là et nos cuisiniers vous réservent de belles surprises. À table !' },
    { m:8,  subject:'Cadeau d\'automne',      headline:'L\'automne chez ' + name,   body:'Les saveurs automnales inspirent notre cuisine. Venez découvrir notre menu de saison.' },
    { m:9,  subject:'9 mois — Bravo !',       headline:'9 mois de fidélité',        body:'Quelle belle aventure gustative ! Votre fidélité nous touche. Voici votre cadeau du mois.' },
    { m:10, subject:'Bientôt les fêtes !',    headline:'Préparez les fêtes',        body:'Les fêtes approchent ! Réservez dès maintenant pour nos menus de fin d\'année.' },
    { m:11, subject:'Un an ensemble bientôt', headline:'Merci pour cette année',    body:'Presque un an ensemble — quelle aventure ! Nous vous réservons une belle surprise pour marquer l\'occasion.' }
  ];
  var monthlyIds = monthlyData.map(function(d) {
    return createTemplate(name, sender, d.m, {
      subject:  '[' + name + '] ' + d.subject,
      headline: d.headline,
      body:     d.body
    });
  });

  // 4. Tenter la création du workflow automation
  var workflowId = createAutomationWorkflow(name, listId, welcomeId, monthlyIds);

  // 5. Stocker les 12 IDs de templates + expéditeur dans les propriétés du script
  //    → utilisé par subscribeContact et sendDailyCampaign
  if (id) {
    var props = PropertiesService.getScriptProperties();
    var allTemplateIds = [welcomeId].concat(monthlyIds);
    props.setProperty('TEMPLATES_'    + id, JSON.stringify(allTemplateIds));
    props.setProperty('SENDER_NAME_'  + id, sender.name);
    props.setProperty('SENDER_EMAIL_' + id, sender.email);
    props.setProperty('LIST_ID_'      + id, String(listId));
    if (email) props.setProperty('ADMIN_EMAIL_' + id, email);
    Logger.log('[Brevo] Propriétés stockées pour ' + id + ' : ' + allTemplateIds.length + ' templates');
  }

  // 6. Créer l'onglet dans la Google Sheet centrale
  if (id) {
    try {
      createRestaurantSheet(id, name);
    } catch(err) {
      Logger.log('[Sheet] Onglet non créé : ' + err.message);
    }
  }

  var formUrl = 'https://app.cartefidelavis.com/' + (id || 'restaurant') + '/inscription.html';

  // 7. Envoyer l'email avec les identifiants au gestionnaire du restaurant
  var passwordEmailSent = false;
  if (email && adminPass) {
    try {
      sendPasswordResetEmail({
        recipientEmail: email,
        recipientName:  name,
        restaurantId:   id,
        restaurantName: name,
        adminPass:      adminPass,
        empPass:        empPass
      });
      passwordEmailSent = true;
      Logger.log('[Brevo] Email identifiants envoyé à ' + email);
    } catch(err) {
      Logger.log('[Brevo] Erreur envoi email identifiants : ' + err.message);
    }
  } else {
    Logger.log('[Brevo] Email identifiants non envoyé (email ou adminPass manquant)');
  }

  Logger.log('[Brevo] ═══ Setup terminé : listId=' + listId + ' workflowId=' + workflowId + ' ═══');

  return {
    success:    true,
    listId:     listId,
    formUrl:    formUrl,
    workflowId: workflowId,
    welcomeTemplateId:  welcomeId,
    monthlyTemplateIds: monthlyIds
  };
}

// ── Récupérer un expéditeur vérifié dans le compte Brevo ────
// Si restaurantEmail est fourni et vérifié → on l'utilise
// Sinon → on prend le premier expéditeur vérifié du compte
function getVerifiedSender(restaurantName, restaurantEmail) {
  try {
    var senders = brevoFetch('GET', '/senders');
    var list = senders.senders || [];
    // Chercher d'abord l'email du restaurateur s'il est vérifié
    if (restaurantEmail) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].email === restaurantEmail && list[i].active) {
          return { name: restaurantName, email: list[i].email };
        }
      }
    }
    // Sinon prendre le premier expéditeur actif du compte
    for (var j = 0; j < list.length; j++) {
      if (list[j].active) {
        Logger.log('[Brevo] Expéditeur par défaut du compte : ' + list[j].email);
        return { name: restaurantName, email: list[j].email };
      }
    }
  } catch(err) {
    Logger.log('[Brevo] Impossible de récupérer les expéditeurs : ' + err.message);
  }
  // Dernier recours : utiliser l'email fourni tel quel (plantera si non vérifié)
  return { name: restaurantName, email: restaurantEmail || 'noreply@fidelavis.com' };
}

// ── Créer la liste contacts ──────────────────────────────────
function createContactList(restaurantName) {
  Logger.log('[Brevo] Création liste : Clients - ' + restaurantName);
  var result = brevoFetch('POST', '/contacts/lists', {
    name:     'Clients - ' + restaurantName,
    folderId: 1
  });
  Logger.log('[Brevo] Liste créée : id=' + result.id);
  return result.id;
}

// ── Créer un template email ──────────────────────────────────
// sender = { name, email } (objet retourné par getVerifiedSender)
function createTemplate(restaurantName, sender, monthIndex, content) {
  var senderEmail = sender.email;
  var label = monthIndex === 0
    ? '[' + restaurantName + '] Bienvenue'
    : '[' + restaurantName + '] Mois ' + monthIndex;

  var htmlContent =
    '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + content.subject + '</title></head>' +
    '<body style="font-family:\'Helvetica Neue\',Arial,sans-serif;max-width:600px;' +
    'margin:0 auto;padding:24px 16px;background:#f7f0e8;color:#1d1d1d;">' +

    // En-tête
    '<div style="text-align:center;padding:16px 0 8px;">' +
    '<span style="display:inline-block;background:linear-gradient(135deg,#B8924F,#9E7A3E);' +
    'color:#fff;font-weight:900;font-size:12px;letter-spacing:.5px;padding:5px 16px;border-radius:999px;">' +
    'Fidelavis × ' + restaurantName + '</span>' +
    '</div>' +

    // Carte principale
    '<div style="background:#fff;border-radius:16px;padding:32px 28px;margin-top:16px;' +
    'box-shadow:0 4px 24px rgba(0,0,0,.07);">' +

    '<p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 16px;">' +
    'Bonjour <strong>{{params.PRENOM}}</strong>,</p>' +

    '<h1 style="font-size:22px;font-weight:900;margin:0 0 16px;color:#1d1d1d;line-height:1.3;">' +
    content.headline + '</h1>' +

    '<p style="font-size:15px;line-height:1.7;color:#444;margin:0 0 16px;">' +
    content.body + '</p>' +

    '<p style="font-size:15px;line-height:1.7;color:#444;margin:0 0 24px;">' +
    'Nous sommes ravis de vous compter parmi les membres fidèles de ' + restaurantName +
    '. Votre fidélité est notre plus belle récompense et nous mettons tout en œuvre ' +
    'pour vous offrir une expérience exceptionnelle à chaque visite.</p>' +

    '<p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 8px;">' +
    'À très bientôt chez ' + restaurantName + ' !</p>' +

    '<p style="font-size:14px;color:#888;margin:0 0 24px;">L\'équipe ' + restaurantName + '</p>' +

    // Séparateur
    '<hr style="border:none;border-top:1px solid #eee;margin:24px 0;">' +

    // Pied de page légal & désabonnement
    '<div style="font-size:11px;color:#aaa;text-align:center;line-height:1.8;">' +
    '<p style="margin:0 0 6px;">Vous recevez cet email car vous êtes inscrit au programme de fidélité ' +
    '<strong>' + restaurantName + '</strong> via Fidelavis.<br>' +
    'Adresse enregistrée&nbsp;: {{contact.EMAIL}}</p>' +
    '<p style="margin:0;">' +
    '<a href="{{params.UNSUBSCRIBE_URL}}" style="color:#B8924F;text-decoration:underline;font-weight:600;">' +
    'Me désabonner de cette liste</a>' +
    '&nbsp;&nbsp;|&nbsp;&nbsp;' +
    '© ' + new Date().getFullYear() + ' ' + restaurantName + ' · Fidelavis' +
    '</p>' +
    '</div>' +

    '</div>' + // fin carte
    '</body></html>';

  var textContent =
    content.subject + '\r\n' +
    '='.repeat(content.subject.length) + '\r\n\r\n' +
    'Bonjour ' + '{{params.PRENOM}}' + ',\r\n\r\n' +
    content.headline + '\r\n\r\n' +
    content.body + '\r\n\r\n' +
    'Nous sommes ravis de vous compter parmi les membres fidèles de ' + restaurantName + '. ' +
    'Votre fidélité est notre plus belle récompense et nous mettons tout en œuvre ' +
    'pour vous offrir une expérience exceptionnelle à chaque visite.\r\n\r\n' +
    'À très bientôt chez ' + restaurantName + ' !\r\n' +
    'L\'équipe ' + restaurantName + '\r\n\r\n' +
    '---\r\n' +
    'Vous recevez cet email car vous êtes inscrit au programme de fidélité ' + restaurantName + ' via Fidelavis.\r\n' +
    'Adresse enregistrée : {{contact.EMAIL}}\r\n' +
    'Se désabonner : {{params.UNSUBSCRIBE_URL}}\r\n' +
    '© ' + new Date().getFullYear() + ' ' + restaurantName + ' · Fidelavis';

  var result = brevoFetch('POST', '/smtp/templates', {
    templateName: label,
    subject:      content.subject,
    htmlContent:  htmlContent,
    textContent:  textContent,
    sender:       { name: sender.name, email: SENDER_EMAIL },
    replyTo:      'noreply@fidelavis.com',
    isActive:     true
  });
  Logger.log('[Brevo] Template créé : ' + label + ' id=' + result.id);
  return result.id;
}

// ── Créer le workflow automation ─────────────────────────────
function createAutomationWorkflow(restaurantName, listId, welcomeId, monthlyIds) {
  Logger.log('[Brevo] Création workflow automation pour ' + restaurantName);

  var steps = [
    { type: 'sendTransactionalEmail', templateId: welcomeId,    delay: { value: 0,   unit: 'days' } }
  ];
  monthlyIds.forEach(function(tid, i) {
    steps.push({ type: 'sendTransactionalEmail', templateId: tid, delay: { value: (i + 1) * 30, unit: 'days' } });
  });

  try {
    var result = brevoFetch('POST', '/automation/workflows', {
      name:    'Fidelavis — ' + restaurantName + ' (12 mois)',
      status:  'draft',
      trigger: { type: 'listEntry', listId: listId },
      steps:   steps
    });
    Logger.log('[Brevo] Workflow créé : id=' + result.id);
    return result.id;
  } catch(err) {
    // L'API automation n'est pas disponible sur tous les plans Brevo.
    // Le restaurateur devra créer le workflow manuellement dans le dashboard Brevo.
    Logger.log('[Brevo] Workflow non créé (plan ou API indisponible) : ' + err.message);
    Logger.log('[Brevo] → Créer manuellement dans Brevo > Automations avec les templates générés');
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  ACTION : SUBSCRIBE (appelé à chaque inscription client)
// ═══════════════════════════════════════════════════════════════

function subscribeContact(body) {
  var email     = (body.email     || '').trim();
  var firstName = (body.firstName || '').trim();
  var lastName  = (body.lastName  || '').trim();
  var listId    = parseInt(body.listId, 10);
  var resto     = (body.resto     || '').trim();

  if (!email)  throw new Error('email requis');
  if (!listId) throw new Error('listId requis');

  Logger.log('[Brevo] Inscription : ' + email + ' → liste #' + listId);

  var contactData = {
    email:         email,
    listIds:       [listId],
    updateEnabled: true,
    attributes:    {}
  };
  if (firstName) contactData.attributes.PRENOM = firstName;
  if (lastName)  contactData.attributes.NOM    = lastName;
  if (resto)     contactData.attributes.RESTO  = resto;

  brevoFetch('POST', '/contacts', contactData);
  Logger.log('[Brevo] Contact inscrit : ' + email);

  // ── Envoi automatique de l'email de bienvenue (J+0) ───────
  if (resto) {
    var props       = PropertiesService.getScriptProperties();
    var templates   = JSON.parse(props.getProperty('TEMPLATES_'   + resto) || '[]');
    var senderName  = props.getProperty('SENDER_NAME_'  + resto) || '';
    var senderEmail = props.getProperty('SENDER_EMAIL_' + resto) || '';
    var templateId  = templates[0] || 0;

    if (templateId && senderEmail) {
      try {
        var gasUrl       = getGasUrl();
        var unsubUrl     = 'https://app.cartefidelavis.com/desinscription.html?email=' + encodeURIComponent(email) + '&listId=' + listId + '&gas=' + encodeURIComponent(gasUrl);
        brevoFetch('POST', '/smtp/email', {
          to:         [{ email: email, name: firstName || email }],
          templateId: templateId,
          sender:     { name: senderName, email: SENDER_EMAIL },
          replyTo:    { email: 'noreply@fidelavis.com', name: 'Ne pas répondre' },
          params:     { PRENOM: firstName, NOM: lastName, RESTO: resto, UNSUBSCRIBE_URL: unsubUrl },
          tags:       ['fidelavis', 'bienvenue']
        });
        Logger.log('[Brevo] Email de bienvenue envoyé à ' + email + ' (template #' + templateId + ')');
      } catch(err) {
        Logger.log('[Brevo] Erreur envoi email bienvenue : ' + err.message);
      }
    }

    // ── Enregistrer l'inscrit dans la Google Sheet ──────────
    try {
      addSubscriberToSheet(resto, email, firstName, lastName);
    } catch(err) {
      Logger.log('[Sheet] Impossible d\'enregistrer l\'inscrit : ' + err.message);
    }
  }

  return { success: true };
}

// ═══════════════════════════════════════════════════════════════
//  GOOGLE SHEET — base de données des inscrits par restaurant
// ═══════════════════════════════════════════════════════════════
//
//  Dans Script Properties, ajouter :
//    SHEET_ID  →  l'ID de votre Google Sheet centrale
//                 (visible dans l'URL : .../spreadsheets/d/SHEET_ID/...)
//
//  Structure de la Sheet :
//    Un onglet par restaurant (nom = restaurantId)
//    Colonnes : email | prenom | nom | date_inscription | emails_envoyés
// ───────────────────────────────────────────────────────────────

function getSheet() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('SHEET_ID non configuré dans les propriétés du script');
  return SpreadsheetApp.openById(id);
}

// Créer l'onglet du restaurant (appelé au setup)
function createRestaurantSheet(restoId, restoName) {
  var ss = getSheet();
  var existing = ss.getSheetByName(restoId);
  if (existing) {
    Logger.log('[Sheet] Onglet "' + restoId + '" existe déjà');
    return existing;
  }
  var sheet = ss.insertSheet(restoId);
  sheet.appendRow(['email', 'prenom', 'nom', 'date_inscription', 'emails_envoyes']);
  sheet.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#B8924F').setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  Logger.log('[Sheet] Onglet créé pour ' + restoName + ' (' + restoId + ')');
  return sheet;
}

// Ajouter un inscrit dans l'onglet de son restaurant (appelé au subscribe)
function addSubscriberToSheet(restoId, email, firstName, lastName) {
  var ss    = getSheet();
  var sheet = ss.getSheetByName(restoId);
  if (!sheet) {
    Logger.log('[Sheet] Onglet "' + restoId + '" introuvable — inscrit non enregistré');
    return;
  }
  // Vérifier si l'email existe déjà (évite les doublons)
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === email) {
      Logger.log('[Sheet] Inscrit déjà présent : ' + email);
      return;
    }
  }
  sheet.appendRow([email, firstName || '', lastName || '', new Date(), 0]);
  Logger.log('[Sheet] Inscrit ajouté : ' + email + ' → ' + restoId);
}

// ═══════════════════════════════════════════════════════════════
//  TRIGGER QUOTIDIEN — campagne drip 12 mois tous restaurants
// ═══════════════════════════════════════════════════════════════

// À appeler UNE FOIS manuellement pour activer le trigger quotidien.
// Ensuite GAS exécutera sendDailyCampaign() chaque jour automatiquement.
function setupDailyTrigger() {
  // Supprimer les triggers existants pour éviter les doublons
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendDailyCampaign') {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('sendDailyCampaign')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();
  Logger.log('[Trigger] Trigger quotidien activé → sendDailyCampaign() à 9h');
}

// Parcourt TOUS les restaurants et envoie les emails du jour
function sendDailyCampaign() {
  Logger.log('[Drip] ═══ sendDailyCampaign démarré ═══');
  var ss    = getSheet();
  var props = PropertiesService.getScriptProperties();
  var today = new Date();
  var sheets = ss.getSheets();
  var DELAYS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]; // jours

  sheets.forEach(function(sheet) {
    var restoId = sheet.getName();
    if (restoId === 'Accueil' || restoId === 'Sheet1') return; // ignorer les onglets système

    var templates   = JSON.parse(props.getProperty('TEMPLATES_'   + restoId) || '[]');
    var senderName  = props.getProperty('SENDER_NAME_'  + restoId) || '';
    var senderEmail = props.getProperty('SENDER_EMAIL_' + restoId) || '';

    if (!templates.length || !senderEmail) {
      Logger.log('[Drip] Config manquante pour "' + restoId + '" — ignoré');
      return;
    }

    var data  = sheet.getDataRange().getValues();
    var header = data[0]; // ['email','prenom','nom','date_inscription','emails_envoyes']

    for (var i = 1; i < data.length; i++) {
      var row           = data[i];
      var email         = row[0];
      var firstName     = row[1] || '';
      var lastName      = row[2] || '';
      var signupDate    = new Date(row[3]);
      var emailsSent    = parseInt(row[4], 10) || 0;

      if (!email || isNaN(signupDate.getTime())) continue;
      if (emailsSent >= templates.length) continue; // tous les emails envoyés

      var daysSince = Math.floor((today - signupDate) / (1000 * 60 * 60 * 24));
      var nextIndex = emailsSent; // index du prochain template à envoyer (0=bienvenue déjà envoyé)
      // Le template 0 (bienvenue) est envoyé directement au subscribe → on part de l'index 1
      if (nextIndex === 0) nextIndex = 1;

      var dueDay = DELAYS[nextIndex];
      if (dueDay === undefined) continue;

      if (daysSince >= dueDay) {
        try {
          var gasUrl      = getGasUrl();
          var listIdDrip  = parseInt(props.getProperty('LIST_ID_' + restoId), 10) || 0;
          var unsubUrlDrip = 'https://app.cartefidelavis.com/desinscription.html?email=' + encodeURIComponent(email) + '&listId=' + listIdDrip + '&gas=' + encodeURIComponent(gasUrl);
          brevoFetch('POST', '/smtp/email', {
            to:         [{ email: email, name: firstName || email }],
            templateId: templates[nextIndex],
            sender:     { name: senderName, email: SENDER_EMAIL },
            replyTo:    { email: 'noreply@fidelavis.com', name: 'Ne pas répondre' },
            params:     { PRENOM: firstName, NOM: lastName, RESTO: restoId, UNSUBSCRIBE_URL: unsubUrlDrip },
            tags:       ['fidelavis', 'drip']
          });
          // Mettre à jour le compteur emails_envoyes (colonne 5, index 4)
          sheet.getRange(i + 1, 5).setValue(nextIndex + 1);
          Logger.log('[Drip] Email envoyé → ' + email + ' (' + restoId + ') template #' + nextIndex + ' J+' + dueDay);
        } catch(err) {
          Logger.log('[Drip] Erreur envoi → ' + email + ' : ' + err.message);
        }
      }
    }
  });

  Logger.log('[Drip] ═══ sendDailyCampaign terminé ═══');
}

// ═══════════════════════════════════════════════════════════════
//  ACTION : PASSWORD RESET — envoi email avec nouveaux identifiants
// ═══════════════════════════════════════════════════════════════
//
//  Paramètres attendus (JSON POST) :
//    recipientEmail  — adresse email du destinataire (obligatoire)
//    recipientName   — nom affiché (optionnel)
//    restaurantId    — slug du restaurant (pour récupérer l'expéditeur)
//    restaurantName  — nom du restaurant (affiché dans l'email)
//    adminPass       — nouveau mot de passe admin (obligatoire)
//    empPass         — nouveau mot de passe employé (optionnel)
//
function sendPasswordResetEmail(body) {
  var recipientEmail = (body.recipientEmail || '').trim();
  var recipientName  = (body.recipientName  || '').trim();
  var restoId        = (body.restaurantId   || '').trim();
  var restoName      = (body.restaurantName || restoId || 'Restaurant').trim();
  var adminPass      = (body.adminPass      || '').trim();
  var empPass        = (body.empPass        || '').trim();

  if (!recipientEmail) throw new Error('recipientEmail requis');
  if (!adminPass)      throw new Error('adminPass requis');

  Logger.log('[PwdReset] Envoi à ' + recipientEmail + ' pour ' + restoId);

  // Récupérer l'expéditeur configuré pour ce restaurant (ou expéditeur par défaut)
  var props       = PropertiesService.getScriptProperties();
  var senderName  = props.getProperty('SENDER_NAME_'  + restoId) || restoName;
  var senderEmail = props.getProperty('SENDER_EMAIL_' + restoId) || SENDER_EMAIL;

  var empRow = empPass
    ? '<tr><td style="padding:8px 12px;border-bottom:1px solid #f0e8d8;color:#888;font-size:13px;">Employé</td>' +
      '<td style="padding:8px 12px;border-bottom:1px solid #f0e8d8;font-size:13px;">' +
      '<code style="background:#f5f1eb;padding:2px 8px;border-radius:5px;font-family:monospace;color:#1d1d1d;">employe</code></td>' +
      '<td style="padding:8px 12px;border-bottom:1px solid #f0e8d8;font-size:13px;">' +
      '<code style="background:#f5f1eb;padding:2px 8px;border-radius:5px;font-family:monospace;color:#1d1d1d;">' + empPass + '</code></td></tr>'
    : '';

  var htmlContent =
    '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Réinitialisation du mot de passe — ' + restoName + '</title></head>' +
    '<body style="font-family:\'Helvetica Neue\',Arial,sans-serif;max-width:600px;' +
    'margin:0 auto;padding:24px 16px;background:#f7f0e8;color:#1d1d1d;">' +

    '<div style="text-align:center;padding:16px 0 8px;">' +
    '<span style="display:inline-block;background:linear-gradient(135deg,#B8924F,#9E7A3E);' +
    'color:#fff;font-weight:900;font-size:12px;letter-spacing:.5px;padding:5px 16px;border-radius:999px;">' +
    'Fidelavis × ' + restoName + '</span>' +
    '</div>' +

    '<div style="background:#fff;border-radius:16px;padding:32px 28px;margin-top:16px;' +
    'box-shadow:0 4px 24px rgba(0,0,0,.07);">' +

    '<p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 8px;">' +
    'Bonjour' + (recipientName ? ' <strong>' + recipientName + '</strong>' : '') + ',</p>' +

    '<h1 style="font-size:20px;font-weight:900;margin:0 0 16px;color:#1d1d1d;line-height:1.3;">' +
    '🔑 Votre mot de passe a été réinitialisé</h1>' +

    '<p style="font-size:14px;line-height:1.6;color:#666;margin:0 0 20px;">' +
    'Les identifiants de connexion à votre espace admin <strong>' + restoName + '</strong> ont été mis à jour. ' +
    'Voici vos nouveaux accès&nbsp;:</p>' +

    '<table style="width:100%;border-collapse:collapse;border:1px solid #f0e8d8;border-radius:10px;overflow:hidden;margin-bottom:24px;">' +
    '<thead>' +
    '<tr style="background:#f5f1eb;">' +
    '<th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#888;font-weight:700;">Rôle</th>' +
    '<th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#888;font-weight:700;">Identifiant</th>' +
    '<th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#888;font-weight:700;">Mot de passe</th>' +
    '</tr>' +
    '</thead>' +
    '<tbody>' +
    '<tr>' +
    '<td style="padding:8px 12px;border-bottom:1px solid #f0e8d8;color:#888;font-size:13px;">Admin</td>' +
    '<td style="padding:8px 12px;border-bottom:1px solid #f0e8d8;font-size:13px;">' +
    '<code style="background:#f5f1eb;padding:2px 8px;border-radius:5px;font-family:monospace;color:#1d1d1d;">admin</code></td>' +
    '<td style="padding:8px 12px;border-bottom:1px solid #f0e8d8;font-size:13px;">' +
    '<code style="background:#f5f1eb;padding:2px 8px;border-radius:5px;font-family:monospace;color:#1d1d1d;">' + adminPass + '</code></td>' +
    '</tr>' +
    empRow +
    '</tbody>' +
    '</table>' +

    '<p style="font-size:13px;color:#999;margin:0 0 24px;">⚠️ Conservez ces identifiants en lieu sûr. ' +
    'Ne les partagez pas par email ou messagerie.</p>' +

    '<hr style="border:none;border-top:1px solid #eee;margin:24px 0;">' +

    '<div style="font-size:11px;color:#aaa;text-align:center;line-height:1.8;">' +
    '<p style="margin:0;">Cet email a été envoyé automatiquement par Fidelavis.<br>' +
    'Si vous n\'êtes pas à l\'origine de cette réinitialisation, contactez votre administrateur Fidelavis.</p>' +
    '<p style="margin:6px 0 0;">© ' + new Date().getFullYear() + ' ' + restoName + ' · Fidelavis</p>' +
    '</div>' +

    '</div>' +
    '</body></html>';

  var textContent =
    'Réinitialisation du mot de passe — ' + restoName + '\r\n' +
    '='.repeat(40) + '\r\n\r\n' +
    'Bonjour' + (recipientName ? ' ' + recipientName : '') + ',\r\n\r\n' +
    'Vos identifiants de connexion ont été mis à jour.\r\n\r\n' +
    'Admin    : admin / ' + adminPass + '\r\n' +
    (empPass ? 'Employé  : employe / ' + empPass + '\r\n' : '') +
    '\r\nConservez ces identifiants en lieu sûr.\r\n\r\n' +
    '---\r\nCet email a été envoyé automatiquement par Fidelavis.\r\n' +
    '© ' + new Date().getFullYear() + ' ' + restoName + ' · Fidelavis';

  brevoFetch('POST', '/smtp/email', {
    to:          [{ email: recipientEmail, name: recipientName || recipientEmail }],
    sender:      { name: senderName, email: SENDER_EMAIL },
    replyTo:     { email: 'noreply@fidelavis.com', name: 'Ne pas répondre' },
    subject:     '🔑 Nouveau mot de passe — ' + restoName,
    htmlContent: htmlContent,
    textContent: textContent,
    tags:        ['fidelavis', 'password-reset']
  });

  Logger.log('[PwdReset] Email envoyé à ' + recipientEmail);
  return { success: true };
}

// ═══════════════════════════════════════════════════════════════
//  ACTION : REQUEST PASSWORD RESET (self-service)
//  Le restaurateur demande un lien de réinitialisation.
//
//  Paramètres attendus (JSON POST) :
//    restaurantId  — slug du restaurant (ex: "resto01")
//    email         — email saisi par le restaurateur
//
//  Script Properties requises :
//    ADMIN_EMAIL_{restaurantId}  — email admin configuré pour ce restaurant
//    (facultatif) GITHUB_TOKEN   — utilisé lors de la confirmation
//
//  Retourne toujours { success: true } pour éviter l'énumération d'emails.
// ═══════════════════════════════════════════════════════════════
function handleRequestPasswordReset(body) {
  var restoId = (body.restaurantId || '').trim();
  var email   = (body.email        || '').trim().toLowerCase();

  if (!restoId) {
    Logger.log('[ReqReset] restaurantId manquant');
    return { success: true }; // réponse neutre
  }

  var props      = PropertiesService.getScriptProperties();
  var adminEmail = (props.getProperty('ADMIN_EMAIL_' + restoId) || '').trim().toLowerCase();

  // Si l'email n'est pas configuré ou ne correspond pas, on retourne quand même success
  if (!adminEmail || (email && email !== adminEmail)) {
    Logger.log('[ReqReset] Email non configuré ou non correspondant pour : ' + restoId);
    return { success: true };
  }

  // Générer un token unique
  var token  = Utilities.getUuid().replace(/-/g, '');
  var expiry = new Date().getTime() + 3600000; // 1 heure

  props.setProperty('RESET_TOKEN_' + token, JSON.stringify({
    restaurantId: restoId,
    expiry: expiry
  }));

  // Construire le lien de réinitialisation
  var resetUrl = 'https://app.cartefidelavis.com/fidelavis-admin/reset-password-confirm.html'
    + '?token=' + token + '&resto=' + restoId;

  // Envoyer l'email
  try {
    sendResetLinkEmail(adminEmail, restoId, resetUrl);
  } catch(e) {
    Logger.log('[ReqReset] Erreur envoi email : ' + e.message);
    // On retourne quand même success côté client
  }

  Logger.log('[ReqReset] Token créé pour ' + restoId + ', email envoyé à ' + adminEmail);
  return { success: true };
}

// ═══════════════════════════════════════════════════════════════
//  ACTION : CONFIRM PASSWORD RESET (self-service)
//  Le restaurateur valide le token et choisit un nouveau mot de passe.
//
//  Paramètres attendus (JSON POST) :
//    token         — token reçu par email
//    restaurantId  — slug du restaurant
//    newAdminPass  — nouveau mot de passe admin
//    newEmpPass    — nouveau mot de passe employé (optionnel)
//
//  Script Properties requises :
//    GITHUB_TOKEN  — token GitHub avec droit d'écriture sur le repo
// ═══════════════════════════════════════════════════════════════
function handleConfirmPasswordReset(body) {
  var token        = (body.token        || '').trim();
  var restoId      = (body.restaurantId || '').trim();
  var newAdminPass = (body.newAdminPass || '').trim();
  var newEmpPass   = (body.newEmpPass   || '').trim();

  if (!token || !restoId || !newAdminPass) {
    return { success: false, error: 'Données manquantes' };
  }

  var props     = PropertiesService.getScriptProperties();
  var tokenJson = props.getProperty('RESET_TOKEN_' + token);

  if (!tokenJson) {
    return { success: false, error: 'Lien invalide ou déjà utilisé' };
  }

  var tokenData;
  try {
    tokenData = JSON.parse(tokenJson);
  } catch(e) {
    return { success: false, error: 'Token corrompu' };
  }

  if (tokenData.restaurantId !== restoId) {
    return { success: false, error: 'Lien invalide' };
  }

  if (new Date().getTime() > tokenData.expiry) {
    props.deleteProperty('RESET_TOKEN_' + token);
    return { success: false, error: 'Lien expiré. Veuillez refaire une demande.' };
  }

  var githubToken = props.getProperty('GITHUB_TOKEN');
  if (!githubToken) {
    return { success: false, error: 'GITHUB_TOKEN non configuré — contactez le support.' };
  }

  try {
    updateLoginFileOnGitHub(restoId, newAdminPass, newEmpPass || null, githubToken);
  } catch(e) {
    Logger.log('[ConfirmReset] Erreur GitHub : ' + e.message);
    return { success: false, error: 'Erreur lors de la mise à jour : ' + e.message };
  }

  // Invalider le token
  props.deleteProperty('RESET_TOKEN_' + token);

  // Envoyer l'email avec les nouveaux identifiants
  var adminEmail = props.getProperty('ADMIN_EMAIL_' + restoId);
  var restoName  = props.getProperty('SENDER_NAME_'  + restoId) || restoId;
  if (adminEmail) {
    try {
      sendPasswordResetEmail({
        recipientEmail: adminEmail,
        recipientName:  restoName,
        restaurantId:   restoId,
        restaurantName: restoName,
        adminPass:      newAdminPass,
        empPass:        newEmpPass || ''
      });
    } catch(e) {
      Logger.log('[ConfirmReset] Erreur envoi email : ' + e.message);
      // Le mot de passe est déjà mis à jour — on retourne quand même success
    }
  }

  Logger.log('[ConfirmReset] Mot de passe mis à jour pour ' + restoId);
  return { success: true };
}

// ─── Mise à jour de login.html sur GitHub ────────────────────────────────────
function updateLoginFileOnGitHub(restoId, newAdminPass, newEmpPass, githubToken) {
  var repo     = 'compush-media/compush-media.gitub.io';
  var filePath = restoId + '/admin/login.html';
  var apiUrl   = 'https://api.github.com/repos/' + repo + '/contents/' + filePath;

  var headers = {
    'Authorization':        'Bearer ' + githubToken,
    'Accept':               'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  // Lire le fichier actuel
  var getResp = UrlFetchApp.fetch(apiUrl, { headers: headers, muteHttpExceptions: true });
  if (getResp.getResponseCode() !== 200) {
    throw new Error('Fichier introuvable sur GitHub : ' + filePath + ' (HTTP ' + getResp.getResponseCode() + ')');
  }

  var fileData = JSON.parse(getResp.getContentText());
  var content  = Utilities.newBlob(Utilities.base64Decode(fileData.content.replace(/\s/g, ''))).getDataAsString();
  var sha      = fileData.sha;

  // Remplacer le mot de passe admin
  content = content.replace(
    /(\{ user: "admin",\s*pass: ")[^"]*(")/,
    '$1' + newAdminPass + '$2'
  );

  // Remplacer le mot de passe employé si fourni
  if (newEmpPass) {
    content = content.replace(
      /(\{ user: "employe",\s*pass: ")[^"]*(")/,
      '$1' + newEmpPass + '$2'
    );
  }

  // Encoder en base64
  var encodedContent = Utilities.base64Encode(Utilities.newBlob(content, 'UTF-8').getBytes());

  // Committer sur GitHub
  var putPayload = JSON.stringify({
    message: 'fix: réinitialisation mot de passe self-service — ' + restoId,
    content: encodedContent,
    sha:     sha,
    branch:  'main'
  });

  var putResp = UrlFetchApp.fetch(apiUrl, {
    method:             'PUT',
    headers:            Object.assign({}, headers, { 'Content-Type': 'application/json' }),
    payload:            putPayload,
    muteHttpExceptions: true
  });

  if (putResp.getResponseCode() !== 200 && putResp.getResponseCode() !== 201) {
    throw new Error('Commit GitHub échoué (HTTP ' + putResp.getResponseCode() + ') : ' + putResp.getContentText());
  }

  Logger.log('[GitHub] login.html mis à jour pour ' + restoId);
}

// ─── Envoi de l'email avec le lien de réinitialisation ──────────────────────
function sendResetLinkEmail(recipientEmail, restoId, resetUrl) {
  var props     = PropertiesService.getScriptProperties();
  var restoName = props.getProperty('SENDER_NAME_' + restoId) || restoId;

  var htmlContent =
    '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="font-family:\'Helvetica Neue\',Arial,sans-serif;max-width:600px;' +
    'margin:0 auto;padding:24px 16px;background:#f7f0e8;color:#1d1d1d;">' +

    '<div style="text-align:center;padding:16px 0 8px;">' +
    '<span style="display:inline-block;background:linear-gradient(135deg,#B8924F,#9E7A3E);' +
    'color:#fff;font-weight:900;font-size:12px;letter-spacing:.5px;padding:5px 16px;border-radius:999px;">' +
    'Fidelavis × ' + restoName + '</span>' +
    '</div>' +

    '<div style="background:#fff;border-radius:16px;padding:32px 28px;margin-top:16px;' +
    'box-shadow:0 4px 24px rgba(0,0,0,.07);">' +

    '<h1 style="font-size:20px;font-weight:900;margin:0 0 16px;color:#1d1d1d;line-height:1.3;">' +
    'Réinitialisation de votre mot de passe</h1>' +

    '<p style="font-size:14px;line-height:1.6;color:#666;margin:0 0 24px;">' +
    'Vous avez demandé la réinitialisation du mot de passe administrateur pour ' +
    '<strong>' + restoName + '</strong>.<br><br>' +
    'Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe. ' +
    'Ce lien est valable <strong>1 heure</strong>.</p>' +

    '<div style="text-align:center;margin:28px 0;">' +
    '<a href="' + resetUrl + '" style="display:inline-block;background:linear-gradient(135deg,#B8924F,#9E7A3E);' +
    'color:#fff;font-weight:800;font-size:15px;padding:14px 32px;border-radius:10px;text-decoration:none;">' +
    'Réinitialiser mon mot de passe</a>' +
    '</div>' +

    '<p style="font-size:13px;color:#999;margin:0 0 8px;">Si vous n\'avez pas fait cette demande, ignorez cet email — votre mot de passe reste inchangé.</p>' +

    '<hr style="border:none;border-top:1px solid #eee;margin:24px 0;">' +

    '<div style="font-size:11px;color:#aaa;text-align:center;line-height:1.8;">' +
    '<p style="margin:0;">Cet email a été envoyé automatiquement par Fidelavis.<br>' +
    'Ne répondez pas à cet email.</p>' +
    '<p style="margin:6px 0 0;">© ' + new Date().getFullYear() + ' ' + restoName + ' · Fidelavis</p>' +
    '</div>' +
    '</div>' +
    '</body></html>';

  var textContent =
    'Réinitialisation de votre mot de passe — ' + restoName + '\r\n' +
    '='.repeat(40) + '\r\n\r\n' +
    'Cliquez sur ce lien pour réinitialiser votre mot de passe (valable 1 heure) :\r\n' +
    resetUrl + '\r\n\r\n' +
    'Si vous n\'avez pas fait cette demande, ignorez cet email.\r\n\r\n' +
    '---\r\nCet email a été envoyé automatiquement par Fidelavis.\r\n' +
    '© ' + new Date().getFullYear() + ' ' + restoName + ' · Fidelavis';

  brevoFetch('POST', '/smtp/email', {
    to:          [{ email: recipientEmail }],
    sender:      { name: 'Fidelavis', email: SENDER_EMAIL },
    replyTo:     { email: 'noreply@fidelavis.com', name: 'Ne pas répondre' },
    subject:     'Réinitialisation de votre mot de passe — ' + restoName,
    htmlContent: htmlContent,
    textContent: textContent,
    tags:        ['fidelavis', 'password-reset-request']
  });

  Logger.log('[ReqReset] Lien envoyé à ' + recipientEmail);
}
