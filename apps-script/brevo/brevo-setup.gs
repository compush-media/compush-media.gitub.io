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

function setupRestaurant(body) {
  var name  = (body.restaurantName  || 'Restaurant').trim();
  var email = (body.restaurantEmail || '').trim();
  var id    = (body.restaurantId    || '').trim();

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

  var formUrl = 'https://app.cartefidelavis.com/' + (id || 'restaurant') + '/inscription.html';

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
    '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>' +
    '<body style="font-family:\'Helvetica Neue\',Arial,sans-serif;max-width:600px;' +
    'margin:0 auto;padding:32px 24px;background:#f7f0e8;color:#1d1d1d;">' +
    '<div style="background:#fff;border-radius:16px;padding:32px;box-shadow:0 4px 24px rgba(0,0,0,.07);">' +
    '<div style="text-align:center;margin-bottom:24px;">' +
    '<span style="display:inline-block;background:linear-gradient(135deg,#B8924F,#9E7A3E);' +
    'color:#fff;font-weight:900;font-size:13px;padding:5px 14px;border-radius:999px;">' +
    'Fidelavis × ' + restaurantName + '</span></div>' +
    '<h1 style="font-size:22px;font-weight:900;margin:0 0 12px;color:#1d1d1d;">' +
    content.headline + '</h1>' +
    '<p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 20px;">' +
    content.body + '</p>' +
    '<div style="border-top:1px solid rgba(0,0,0,.08);margin-top:28px;padding-top:16px;' +
    'font-size:12px;color:#888;text-align:center;">' +
    '© ' + restaurantName + ' · Programme de fidélité Fidelavis<br>' +
    'Vous recevez cet email car vous êtes membre du programme de fidélité.<br>' +
    '<a href="{{unsubscribeUrl}}" style="color:#B8924F;">Se désabonner</a></div>' +
    '</div></body></html>';

  var result = brevoFetch('POST', '/smtp/templates', {
    templateName: label,
    subject:      content.subject,
    htmlContent:  htmlContent,
    sender:       { name: sender.name, email: senderEmail },
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
  return { success: true };
}
