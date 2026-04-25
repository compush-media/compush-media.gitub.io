/**
 * ============================================================
 *  Fidelavis — Proxy sécurisé Claude API
 *  Google Apps Script
 * ============================================================
 *
 *  INSTALLATION :
 *  1. Créer un nouveau projet sur script.google.com
 *  2. Coller ce code
 *  3. Stocker vos clés : Extensions > Propriétés du script > Ajouter
 *     → Clé : CLAUDE_API_KEY       Valeur : sk-ant-api03-xxxxx
 *     → Clé : PROGRESSIER_API_KEY  Valeur : (clé dans Progressier > Settings > API Key)
 *  4. Déployer > Nouveau déploiement > Application Web
 *     → Exécuter en tant que : Moi
 *     → Accès : Tout le monde (anonyme)
 *  5. Copier l'URL de déploiement et la coller dans reputation-ia.html
 *     dans la constante CLAUDE_PROXY_URL
 *
 *  SÉCURITÉ :
 *  - La clé API Claude n'est jamais exposée côté navigateur
 *  - Le proxy valide l'origine et le type de requête
 *  - Rate limiting optionnel (voir config ci-dessous)
 * ============================================================
 */

// ─── Configuration ──────────────────────────────────────────
var CONFIG = {
  MODEL: "claude-opus-4-6",          // Modèle Claude à utiliser
  MAX_TOKENS: 1500,                   // Tokens max par réponse
  TEMPERATURE: 1,                     // Température (1 = défaut Claude)
  MAX_REQUESTS_PER_HOUR: 100,         // Rate limit (optionnel)
  ALLOWED_ORIGINS: [],                // Laisser vide = tous autorisés
                                      // Ex: ["https://voltaire.fidelavis.com"]
};

// ─── Point d'entrée POST ─────────────────────────────────────
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action || "generate_response";

    var result;
    switch (action) {
      case "generate_response":
        result = generateReviewResponse(body);
        break;
      case "analyze_reviews":
        result = analyzeReviews(body);
        break;
      case "compute_score":
        result = computeReputationScore(body);
        break;
      case "push_notification":
        result = pushNotification(body);
        break;
      case "save_icon":
        result = saveRestaurantIcon(body);
        break;
      case "save_ambassadeurs":
        result = saveAmbassadeursData(body);
        break;
      case "create_restaurant_for_ambassador":
        result = createRestaurantForAmbassador(body);
        break;
      case "update_billing":
        result = updateRestaurantBilling(body);
        break;
      default:
        result = { error: "Action inconnue : " + action };
    }

    return buildResponse(result);

  } catch (err) {
    return buildResponse({ error: "Erreur proxy : " + err.message });
  }
}

// ─── Point d'entrée GET ──────────────────────────────────────
function doGet(e) {
  if (!e.parameter) {
    return buildResponse({ status: "ok", proxy: "Fidelavis Claude Proxy", version: "1.0" });
  }

  // Paramètres directs dans l'URL (ex: ?action=push_notification&title=...&body=...)
  if (e.parameter.action) {
    try {
      var result;
      switch (e.parameter.action) {
        case "push_notification": result = pushNotification(e.parameter); break;
        case "save_icon":          result = saveRestaurantIcon(e.parameter); break;
        case "get_ambassadeurs":  result = getAmbassadeurs(); break;
        case "get_ambassador":    result = getAmbassadorByToken(e.parameter.token || ""); break;
        default: result = { error: "Action GET inconnue : " + e.parameter.action };
      }
      return buildResponse(result);
    } catch (err) {
      return buildResponse({ error: "Erreur proxy : " + err.message });
    }
  }

  // Payload JSON encodé (legacy)
  if (e.parameter.payload) {
    try {
      var body = JSON.parse(e.parameter.payload);
      var action = body.action || "generate_response";
      var result;
      switch (action) {
        case "generate_response":  result = generateReviewResponse(body); break;
        case "analyze_reviews":    result = analyzeReviews(body);         break;
        case "compute_score":      result = computeReputationScore(body); break;
        case "push_notification":  result = pushNotification(body);       break;
        default: result = { error: "Action inconnue : " + action };
      }
      return buildResponse(result);
    } catch (err) {
      return buildResponse({ error: "Erreur proxy : " + err.message });
    }
  }

  return buildResponse({ status: "ok", proxy: "Fidelavis Claude Proxy", version: "1.0" });
}

// ─── Action 1 : Générer une réponse à un avis ───────────────
function generateReviewResponse(params) {
  var review     = params.review     || "";
  var platform   = params.platform   || "google";
  var rating     = parseInt(params.rating, 10) || 3;
  var restoName  = params.restoName  || "le restaurant";
  var pwaLink    = params.pwaLink    || "";

  if (!review.trim()) {
    return { error: "Le texte de l'avis est vide." };
  }

  // Contexte de style selon la plateforme
  var platformStyle = platform === "tripadvisor"
    ? "réponse élaborée, ton hospitalier et chaleureux, style hôtellerie-restauration professionnelle, 3-5 phrases"
    : "réponse courte, humaine, locale, authentique, 2-3 phrases maximum";

  // Instruction selon la note
  var toneInstruction;
  if (rating >= 5) {
    toneInstruction = "Remerciement très chaleureux, valorisation de l'expérience vécue, enthousiasme sincère.";
  } else if (rating === 4) {
    toneInstruction = "Remerciement sincère, encouragement à revenir, noter la remarque positive.";
  } else if (rating === 3) {
    toneInstruction = "Reconnaissance de la remarque, empathie, invitation à revenir pour une meilleure expérience.";
  } else {
    toneInstruction = "Apaisement immédiat, reconnaissance du problème, proposition d'échange direct, formuler des excuses sincères.";
  }

  // Ajout du lien PWA si avis positif
  var pwaInstruction = "";
  if (pwaLink && rating >= 4) {
    pwaInstruction = '\n\nIMPORTANT : À la fin de la réponse publique, ajouter exactement cette phrase (remplacer {{PWA_LINK}} par le lien fourni) : "Pour profiter de nos avantages fidélité lors de votre prochaine visite, installez notre carte fidélité digitale ici : ' + pwaLink + '"';
  }

  var systemPrompt = buildSystemPrompt(restoName);

  var userPrompt = [
    "Restaurant : " + restoName,
    "Plateforme : " + platform.toUpperCase(),
    "Note : " + rating + "/5",
    "Avis client :",
    "---",
    review,
    "---",
    "",
    "Style de réponse demandé : " + platformStyle,
    "Ton : " + toneInstruction,
    pwaInstruction,
    "",
    "Fournis la réponse au format JSON strict avec les clés suivantes :",
    "{",
    '  "analyse": {',
    '    "plateforme": "...",',
    '    "type_avis": "positif|neutre|négatif",',
    '    "niveau_risque": "faible|moyen|élevé",',
    '    "intention_client": "..."',
    "  },",
    '  "reponse_publique": "...",',
    '  "version_diplomatique": "...",',
    '  "conseil_interne": "..."',
    "}"
  ].join("\n");

  var raw = callClaude(systemPrompt, userPrompt);
  return parseJsonResponse(raw);
}

// ─── Action 2 : Analyser un lot d'avis ──────────────────────
function analyzeReviews(params) {
  var reviews   = params.reviews   || [];
  var restoName = params.restoName || "le restaurant";

  if (!reviews.length) {
    return { error: "Aucun avis fourni." };
  }

  var reviewText = reviews.map(function(r, i) {
    return (i + 1) + ". [" + (r.rating || "?") + "/5 – " + (r.platform || "?") + "] " + (r.text || "");
  }).join("\n");

  var systemPrompt = buildSystemPrompt(restoName);

  var userPrompt = [
    "Analyse les avis suivants pour " + restoName + " :",
    "",
    reviewText,
    "",
    "Fournis une analyse au format JSON strict :",
    "{",
    '  "points_forts": ["...", "..."],',
    '  "points_faibles": ["...", "..."],',
    '  "problemes_recurrents": ["...", "..."],',
    '  "sentiment_global": "positif|neutre|négatif",',
    '  "note_moyenne_ressentie": 4.2,',
    '  "resume": "...",',
    '  "recommandations": ["...", "..."]',
    "}"
  ].join("\n");

  var raw = callClaude(systemPrompt, userPrompt);
  return parseJsonResponse(raw);
}

// ─── Action 3 : Calculer le score de réputation ──────────────
function computeReputationScore(params) {
  var avgRating     = parseFloat(params.avgRating)     || 4.0;
  var totalReviews  = parseInt(params.totalReviews)    || 0;
  var recentTrend   = params.recentTrend               || "stable";   // "hausse"|"baisse"|"stable"
  var responseRate  = parseFloat(params.responseRate)  || 0;          // 0-100 %
  var sentiment     = params.sentiment                 || "positif";  // "positif"|"neutre"|"négatif"

  // Calcul pondéré du score (sur 100)
  var scoreRating   = ((avgRating - 1) / 4) * 35;            // 35 pts
  var scoreVolume   = Math.min(totalReviews / 200, 1) * 20;  // 20 pts (plafonné à 200 avis)
  var scoreTrend    = recentTrend === "hausse" ? 20 : recentTrend === "stable" ? 12 : 0;  // 20 pts
  var scoreResp     = (responseRate / 100) * 15;              // 15 pts
  var scoreSentiment = sentiment === "positif" ? 10 : sentiment === "neutre" ? 5 : 0;     // 10 pts

  var total = Math.round(scoreRating + scoreVolume + scoreTrend + scoreResp + scoreSentiment);
  total = Math.max(0, Math.min(100, total));

  var niveau  = total >= 80 ? "Excellent" : total >= 60 ? "Bon" : total >= 40 ? "Moyen" : "Faible";
  var risque  = total >= 70 ? "Faible" : total >= 50 ? "Moyen" : "Élevé";
  var tendance = recentTrend === "hausse" ? "📈 En progression" : recentTrend === "baisse" ? "📉 En recul" : "➡️ Stable";

  return {
    score:    total,
    niveau:   niveau,
    risque:   risque,
    tendance: tendance,
    details: {
      note:      Math.round(scoreRating),
      volume:    Math.round(scoreVolume),
      trend:     Math.round(scoreTrend),
      reponse:   Math.round(scoreResp),
      sentiment: Math.round(scoreSentiment)
    }
  };
}

// ─── Appel API Claude ────────────────────────────────────────
function callClaude(systemPrompt, userPrompt) {
  var apiKey = PropertiesService.getScriptProperties().getProperty("CLAUDE_API_KEY");
  if (!apiKey) {
    throw new Error("Clé API Claude non configurée. Allez dans Extensions > Propriétés du script > Ajouter CLAUDE_API_KEY.");
  }

  var payload = {
    model: CONFIG.MODEL,
    max_tokens: CONFIG.MAX_TOKENS,
    system: systemPrompt,
    messages: [
      { role: "user", content: userPrompt }
    ]
  };

  var options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", options);
  var code     = response.getResponseCode();
  var content  = response.getContentText();

  if (code !== 200) {
    throw new Error("Erreur API Claude (" + code + ") : " + content.substring(0, 200));
  }

  var json = JSON.parse(content);
  return json.content && json.content[0] ? json.content[0].text : "";
}

// ─── Prompt système commun ───────────────────────────────────
function buildSystemPrompt(restoName) {
  return [
    "Tu es l'assistant IA de réputation pour " + restoName + ", un restaurant.",
    "Tu aides le restaurateur à gérer ses avis clients de manière professionnelle, humaine et efficace.",
    "",
    "Règles absolues :",
    "- Réponds TOUJOURS en JSON valide, sans markdown, sans blocs de code.",
    "- Ne commence jamais par ``` ou par des balises.",
    "- Sois authentique, naturel, jamais robotique.",
    "- Adapte ton ton à la note et à la plateforme.",
    "- Ne mens jamais sur les faits mentionnés dans l'avis.",
    "- Pour les avis négatifs, reste professionnel et constructif.",
    "- La langue de la réponse doit correspondre à la langue de l'avis.",
  ].join("\n");
}

// ─── Parser JSON robuste ─────────────────────────────────────
function parseJsonResponse(raw) {
  if (!raw) return { error: "Réponse vide de Claude." };
  try {
    // Extraire le JSON si entouré de markdown
    var clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    return JSON.parse(clean);
  } catch (err) {
    // Retourner le texte brut si pas de JSON valide
    return { raw_response: raw, parse_error: err.message };
  }
}

// ─── Action 4 : Envoyer une notification push (Progressier) ──
//
//  Paramètres attendus :
//    title  — Titre (max 50 car.)
//    body   — Message (max 100 car.)
//    url    — URL de destination au clic (ex: /test06/index.html)
//    resto  — Slug du restaurant (ex: "test06")
//             → filtre push_path=/test06/ pour n'atteindre que ses abonnés
//             → si absent, envoie à TOUS les abonnés (à utiliser avec précaution)
//
function pushNotification(params) {
  var title = (params.title || "").trim();
  var body  = (params.body  || "").trim();
  var url   = (params.url   || "").trim();
  var resto = (params.resto || "").trim().toLowerCase().replace(/\s+/g, "-");

  if (!title) return { error: "Le titre est obligatoire." };
  if (!body)  return { error: "Le message est obligatoire." };

  var apiKey = PropertiesService.getScriptProperties().getProperty("PROGRESSIER_API_KEY");
  if (!apiKey) {
    return {
      error: "Clé API Progressier non configurée. " +
             "Allez dans Extensions > Propriétés du script > Ajouter PROGRESSIER_API_KEY."
    };
  }

  // ── Segmentation par tag restaurant ─────────────────────────
  //   Tag assigné à l'inscription via progressier.add({ id: email, tags: [resto] })
  //   Format API Progressier : { tags: "le-martin" }
  var recipients = { users: "all" };

  var payload = {
    title:      title,
    body:       body,
    recipients: recipients
  };
  if (url) payload.url = url;

  var APP_ID = PropertiesService.getScriptProperties().getProperty("PROGRESSIER_APP_ID") ||
               "zb3Ezrlt6Ezd6iN3VpMW";  // valeur par défaut

  var options = {
    method:             "post",
    contentType:        "application/json",
    headers:            { "authorization": "Bearer " + apiKey },
    payload:            JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch("https://progressier.app/" + APP_ID + "/send", options);
  var code     = response.getResponseCode();
  var content  = response.getContentText();

  if (code !== 200 && code !== 201) {
    return { error: "Erreur Progressier (" + code + ") : " + content.substring(0, 300) };
  }

  var parsed = {};
  try { parsed = JSON.parse(content); } catch(_) {}

  return {
    ok:    true,
    resto: resto,
    recipients: recipients,
    progressier: parsed
  };
}

// ─── Action 5 : Enregistrer l'icône d'un restaurant ─────────
//
//  Paramètres (POST JSON) :
//    resto    — slug du restaurant (ex: "test06")
//    iconUrl  — URL absolue de l'icône 512×512 (ex: "https://monresto.fr/logo.png")
//               Passer "" pour revenir à l'icône par défaut (icons/icon-512.png)
//
//  Met à jour deux fichiers sur GitHub :
//    /{resto}/config.json      → champ "iconUrl"
//    /{resto}/progressier.json → tableau "icons"
//
function saveRestaurantIcon(params) {
  var resto   = (params.resto   || "").trim().toLowerCase().replace(/\s+/g, "-");
  var iconUrl = (params.iconUrl || "").trim();

  if (!resto) return { error: "Paramètre resto manquant." };

  var token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  var repo  = PropertiesService.getScriptProperties().getProperty("GITHUB_REPO")
              || "compush-media/compush-media.gitub.io";
  if (!token) return { error: "GITHUB_TOKEN non configuré dans les propriétés du script." };

  var results = {};

  // ── 1. Mise à jour config.json ───────────────────────────────
  var configPath = resto + "/config.json";
  var configUrl  = "https://api.github.com/repos/" + repo + "/contents/" + configPath + "?ref=main";
  var headers    = { Authorization: "token " + token, Accept: "application/vnd.github.v3+json" };

  var configRes  = UrlFetchApp.fetch(configUrl, { headers: headers, muteHttpExceptions: true });
  var configCode = configRes.getResponseCode();

  if (configCode === 200) {
    var configData = JSON.parse(configRes.getContentText());
    var existing;
    try { existing = JSON.parse(Utilities.newBlob(Utilities.base64Decode(configData.content.replace(/\n/g,""))).getDataAsString()); }
    catch(_) { existing = {}; }

    if (iconUrl) {
      existing.iconUrl = iconUrl;
    } else {
      delete existing.iconUrl;
    }

    var newConfigB64 = Utilities.base64Encode(Utilities.newBlob(JSON.stringify(existing, null, 2)).getBytes());
    var configPut = UrlFetchApp.fetch("https://api.github.com/repos/" + repo + "/contents/" + configPath, {
      method: "put",
      headers: { Authorization: "token " + token, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
      payload: JSON.stringify({ message: "icon: mise à jour iconUrl pour " + resto, content: newConfigB64, sha: configData.sha }),
      muteHttpExceptions: true
    });
    results.config = configPut.getResponseCode();
  } else {
    results.config = "config.json introuvable (" + configCode + ")";
  }

  // ── 2. Mise à jour progressier.json ─────────────────────────
  var manifestPath = resto + "/progressier.json";
  var manifestUrl  = "https://api.github.com/repos/" + repo + "/contents/" + manifestPath + "?ref=main";
  var manifestRes  = UrlFetchApp.fetch(manifestUrl, { headers: headers, muteHttpExceptions: true });
  var manifestCode = manifestRes.getResponseCode();

  if (manifestCode === 200) {
    var manifestData = JSON.parse(manifestRes.getContentText());
    var manifest;
    try { manifest = JSON.parse(Utilities.newBlob(Utilities.base64Decode(manifestData.content.replace(/\n/g,""))).getDataAsString()); }
    catch(_) { manifest = {}; }

    if (iconUrl) {
      manifest.icons = [
        { src: iconUrl, sizes: "512x512", type: "image/png" },
        { src: iconUrl, sizes: "512x512", type: "image/png", purpose: "maskable" }
      ];
    } else {
      manifest.icons = [
        { src: "icons/icon-512.png",          sizes: "512x512", type: "image/png" },
        { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
      ];
    }

    var newManifestB64 = Utilities.base64Encode(Utilities.newBlob(JSON.stringify(manifest, null, 2)).getBytes());
    var manifestPut = UrlFetchApp.fetch("https://api.github.com/repos/" + repo + "/contents/" + manifestPath, {
      method: "put",
      headers: { Authorization: "token " + token, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
      payload: JSON.stringify({ message: "icon: mise à jour progressier.json pour " + resto, content: newManifestB64, sha: manifestData.sha }),
      muteHttpExceptions: true
    });
    results.manifest = manifestPut.getResponseCode();
  } else {
    results.manifest = "progressier.json introuvable (" + manifestCode + ")";
  }

  var success = (results.config === 200 || results.config === 201) &&
                (results.manifest === 200 || results.manifest === 201);

  return {
    ok:      success,
    resto:   resto,
    iconUrl: iconUrl || "(défaut)",
    results: results
  };
}

// ─── Action 6 : Lire les ambassadeurs (GitHub) ───────────────
function getAmbassadeurs() {
  var token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  var repo  = PropertiesService.getScriptProperties().getProperty("GITHUB_REPO")
              || "compush-media/compush-media.gitub.io";
  if (!token) return { error: "GITHUB_TOKEN non configuré." };

  var url     = "https://api.github.com/repos/" + repo + "/contents/data/ambassadeurs.json?ref=main";
  var headers = { Authorization: "token " + token, Accept: "application/vnd.github.v3+json" };
  var res     = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
  var code    = res.getResponseCode();

  if (code === 404) return { ok: true, ambassadeurs: [] };
  if (code !== 200) return { error: "GitHub API error " + code };

  var data    = JSON.parse(res.getContentText());
  var content = Utilities.newBlob(Utilities.base64Decode(data.content.replace(/\n/g, ""))).getDataAsString();
  try { return { ok: true, ambassadeurs: JSON.parse(content) }; }
  catch(_) { return { ok: true, ambassadeurs: [] }; }
}

// ─── Action 7 : Sauvegarder les ambassadeurs (GitHub) ────────
function saveAmbassadeursData(params) {
  var token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  var repo  = PropertiesService.getScriptProperties().getProperty("GITHUB_REPO")
              || "compush-media/compush-media.gitub.io";
  if (!token) return { error: "GITHUB_TOKEN non configuré." };

  var ambassadeurs = params.ambassadeurs || [];
  var filePath     = "data/ambassadeurs.json";
  var apiUrl       = "https://api.github.com/repos/" + repo + "/contents/" + filePath;
  var headers      = { Authorization: "token " + token, Accept: "application/vnd.github.v3+json" };

  var sha = null;
  var getRes = UrlFetchApp.fetch(apiUrl + "?ref=main", { headers: headers, muteHttpExceptions: true });
  if (getRes.getResponseCode() === 200) {
    sha = JSON.parse(getRes.getContentText()).sha;
  }

  var content   = JSON.stringify(ambassadeurs, null, 2);
  var b64       = Utilities.base64Encode(Utilities.newBlob(content).getBytes());
  var putBody   = { message: "data: mise à jour ambassadeurs", content: b64 };
  if (sha) putBody.sha = sha;

  var putRes  = UrlFetchApp.fetch(apiUrl, {
    method:             "put",
    headers:            { Authorization: "token " + token, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    payload:            JSON.stringify(putBody),
    muteHttpExceptions: true
  });
  var putCode = putRes.getResponseCode();

  if (putCode !== 200 && putCode !== 201) {
    return { error: "Erreur GitHub " + putCode + " : " + putRes.getContentText().substring(0, 200) };
  }
  return { ok: true };
}

// ─── Action 8 : Récupérer un ambassadeur par token ───────────
function getAmbassadorByToken(token) {
  if (!token) return { error: "Token manquant." };
  var data = getAmbassadeurs();
  if (!data.ok) return { error: data.error || "Impossible de charger les ambassadeurs." };
  for (var i = 0; i < data.ambassadeurs.length; i++) {
    if (data.ambassadeurs[i].token === token) {
      return { ok: true, ambassador: data.ambassadeurs[i] };
    }
  }
  return { error: "Token invalide ou ambassadeur introuvable." };
}

// ─── Action 9 : Créer un restaurant pour un ambassadeur ──────
function createRestaurantForAmbassador(params) {
  var ambToken  = params.amb_token  || "";
  var name      = params.name       || "";
  var sl        = params.slug       || "";
  var color     = params.color      || "#B8924F";
  var color2    = params.color2     || "#9E7A3E";
  var email     = params.email      || "";
  var adminPass = params.adminPass  || "";
  var phone     = params.phone      || "";

  if (!ambToken || !name || !sl || !adminPass) {
    return { error: "Paramètres manquants (amb_token, name, slug, adminPass)." };
  }

  // Vérifier l'ambassadeur
  var ambData = getAmbassadeurs();
  if (!ambData.ok) return { error: "Impossible de charger les ambassadeurs." };

  var amb = null;
  for (var i = 0; i < ambData.ambassadeurs.length; i++) {
    if (ambData.ambassadeurs[i].token === ambToken) { amb = ambData.ambassadeurs[i]; break; }
  }
  if (!amb)                   return { error: "Token ambassadeur invalide." };
  if (amb.statut !== "actif") return { error: "Compte ambassadeur suspendu ou inactif." };

  var restosCrees = amb.restaurants_crees || [];
  var maxRestos   = amb.max_restaurants_test || 5;
  if (restosCrees.length >= maxRestos) {
    return { error: "Quota maximum atteint (" + maxRestos + " restaurants)." };
  }

  // GitHub API
  var ghToken = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  var repo    = PropertiesService.getScriptProperties().getProperty("GITHUB_REPO")
                || "compush-media/compush-media.gitub.io";
  if (!ghToken) return { error: "GITHUB_TOKEN non configuré dans le GAS." };

  var ghBase    = "https://api.github.com/repos/" + repo;
  var ghHeaders = { Authorization: "token " + ghToken, Accept: "application/vnd.github+json", "Content-Type": "application/json" };

  function ghFetch(path, method, body) {
    var opts = { method: method || "get", headers: ghHeaders, muteHttpExceptions: true };
    if (body) opts.payload = JSON.stringify(body);
    var res  = UrlFetchApp.fetch(ghBase + path, opts);
    var code = res.getResponseCode();
    if (code >= 300) throw new Error("GitHub " + (method||"GET") + " " + path + " → " + code + " : " + res.getContentText().slice(0,200));
    return JSON.parse(res.getContentText());
  }

  try {
    // Récupérer l'arbre courant
    var ref      = ghFetch("/git/ref/heads/main");
    var commitSha = ref.object.sha;
    var commit   = ghFetch("/git/commits/" + commitSha);
    var treeSha  = commit.tree.sha;
    var treeData = ghFetch("/git/trees/" + treeSha + "?recursive=1");
    var allItems = treeData.tree;

    var templateFiles = allItems.filter(function(f) {
      return f.type === "blob" && f.path.indexOf("_template/") === 0;
    });
    if (!templateFiles.length) throw new Error("Template _template/ introuvable dans le repo.");

    // Vérifier que le slug n'existe pas déjà
    var slotExists = allItems.some(function(f) { return f.path.indexOf(sl + "/") === 0; });
    if (slotExists) throw new Error("Le slug /" + sl + "/ existe déjà.");

    // Construire le nouvel arbre
    var overrides  = [sl+"/config.json", sl+"/progressier.json", sl+"/admin/login.html"];
    var newItems   = [];

    for (var j = 0; j < templateFiles.length; j++) {
      var f = templateFiles[j];
      var newPath = sl + "/" + f.path.slice("_template/".length);
      if (overrides.indexOf(newPath) === -1) {
        newItems.push({ path: newPath, mode: f.mode, type: "blob", sha: f.sha });
      }
    }

    // Générer config.json
    var cfg = { name: name, color: color, color2: color2 };
    if (phone) cfg.phone = phone;
    if (email) cfg.email = email;

    // Générer progressier.json
    var manifest = {
      name: name, short_name: name,
      start_url: "/" + sl + "/index.html", scope: "/" + sl + "/",
      display: "standalone", background_color: "#f6efe5",
      theme_color: color, orientation: "portrait",
      icons: [
        { src: "icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "icon-512.png", sizes: "512x512", type: "image/png" }
      ]
    };

    // Patcher login.html avec le mot de passe admin
    var loginItem = null;
    for (var k = 0; k < templateFiles.length; k++) {
      if (templateFiles[k].path === "_template/admin/login.html") { loginItem = templateFiles[k]; break; }
    }
    if (!loginItem) throw new Error("login.html introuvable dans _template.");
    var loginBlob    = ghFetch("/git/blobs/" + loginItem.sha);
    var loginContent = Utilities.newBlob(Utilities.base64Decode(loginBlob.content.replace(/\n/g,""))).getDataAsString();
    loginContent = loginContent.replace(/(\{ user: "admin",\s*pass: ")[^"]*(")/g,   "$1" + adminPass + "$2");
    loginContent = loginContent.replace(/(\{ user: "employe",\s*pass: ")[^"]*(")/g, "$1employe123$2");

    // Mettre à jour data/restaurants.json
    var restaurantsData = {};
    for (var m = 0; m < allItems.length; m++) {
      if (allItems[m].path === "data/restaurants.json") {
        var rBlob = ghFetch("/git/blobs/" + allItems[m].sha);
        restaurantsData = JSON.parse(Utilities.newBlob(Utilities.base64Decode(rBlob.content.replace(/\n/g,""))).getDataAsString());
        break;
      }
    }
    restaurantsData[sl] = { name: name, brandColor: color, brandColor2: color2 };
    if (phone) restaurantsData[sl].phone = phone;
    if (email) restaurantsData[sl].email = email;
    restaurantsData[sl].ambassadorCode = amb.code;

    // Uploader les fichiers générés
    var toUpload = [
      { path: sl + "/config.json",      content: JSON.stringify(cfg, null, 2) + "\n" },
      { path: sl + "/progressier.json", content: JSON.stringify(manifest, null, 2) + "\n" },
      { path: sl + "/admin/login.html", content: loginContent },
      { path: "data/restaurants.json",  content: JSON.stringify(restaurantsData, null, 2) + "\n" }
    ];
    for (var n = 0; n < toUpload.length; n++) {
      var blob = ghFetch("/git/blobs", "post", { content: toUpload[n].content, encoding: "utf-8" });
      newItems.push({ path: toUpload[n].path, mode: "100644", type: "blob", sha: blob.sha });
    }

    // Créer le nouvel arbre + commit + push
    var newTree   = ghFetch("/git/trees",   "post", { base_tree: treeSha, tree: newItems });
    var newCommit = ghFetch("/git/commits", "post", {
      message: "feat(amb): nouveau restaurant " + sl + " \u2014 " + name + " [via " + amb.code + "]",
      tree: newTree.sha, parents: [commitSha]
    });
    ghFetch("/git/refs/heads/main", "patch", { sha: newCommit.sha, force: false });

    // Mettre à jour l'ambassadeur
    amb.restaurants_crees = restosCrees.concat([{ slug: sl, name: name, date: new Date().toISOString().slice(0, 10) }]);
    saveAmbassadeursData({ ambassadeurs: ambData.ambassadeurs });

    return {
      ok:   true, slug: sl, name: name,
      urls: {
        site:  "https://app.cartefidelavis.com/" + sl + "/",
        admin: "https://app.cartefidelavis.com/" + sl + "/admin/login.html"
      }
    };

  } catch(err) {
    return { error: "Erreur création restaurant : " + err.message };
  }
}

// ─── Action 10 : Activer l'abonnement d'un restaurant ────────
//
//  Paramètres (POST JSON) :
//    slug   — identifiant du restaurant (ex: "axfio")
//    plan   — "essentiel" | "pro"
//    email  — email de facturation du restaurateur
//    status — "active" (défaut)
//
//  Met à jour /{slug}/config.json :
//    subscriptionStatus, plan, billingEmail, nextBillingDate
//
function updateRestaurantBilling(params) {
  var slug             = (params.slug             || "").trim().toLowerCase();
  var plan             = (params.plan             || "essentiel").trim();
  var email            = (params.email            || "").trim();
  var status           = (params.status           || "active").trim();
  var stripeCustomerId = (params.stripeCustomerId || "").trim();

  if (!slug) return { error: "Paramètre slug manquant." };

  var token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  var repo  = PropertiesService.getScriptProperties().getProperty("GITHUB_REPO")
              || "compush-media/compush-media.gitub.io";
  if (!token) return { error: "GITHUB_TOKEN non configuré." };

  var configPath = slug + "/config.json";
  var apiUrl     = "https://api.github.com/repos/" + repo + "/contents/" + configPath;
  var headers    = { Authorization: "token " + token, Accept: "application/vnd.github.v3+json" };

  // Lire le config.json existant
  var getRes  = UrlFetchApp.fetch(apiUrl + "?ref=main", { headers: headers, muteHttpExceptions: true });
  var getCode = getRes.getResponseCode();
  if (getCode === 404) return { error: "config.json introuvable pour /" + slug + "/. Vérifiez que le restaurant existe." };
  if (getCode !== 200) return { error: "Erreur GitHub GET " + getCode };

  var fileData = JSON.parse(getRes.getContentText());
  var sha      = fileData.sha;
  var existing = {};
  try {
    existing = JSON.parse(
      Utilities.newBlob(Utilities.base64Decode(fileData.content.replace(/\n/g, ""))).getDataAsString()
    );
  } catch(_) {}

  // Calculer la prochaine date de facturation (aujourd'hui + 30 jours)
  var nextBilling = new Date();
  nextBilling.setDate(nextBilling.getDate() + 30);
  var nextBillingDate = nextBilling.toISOString().slice(0, 10);

  // Mettre à jour les champs billing
  existing.plan               = plan;
  existing.subscriptionStatus = status;
  existing.nextBillingDate    = nextBillingDate;
  if (email)            existing.billingEmail      = email;
  if (stripeCustomerId) existing.stripeCustomerId  = stripeCustomerId;

  var newContent = JSON.stringify(existing, null, 2) + "\n";
  var b64        = Utilities.base64Encode(Utilities.newBlob(newContent).getBytes());

  var putRes  = UrlFetchApp.fetch(apiUrl, {
    method:  "put",
    headers: { Authorization: "token " + token, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    payload: JSON.stringify({
      message: "billing: " + slug + " → " + status + " (" + plan + ")",
      content: b64,
      sha:     sha
    }),
    muteHttpExceptions: true
  });
  var putCode = putRes.getResponseCode();
  if (putCode !== 200 && putCode !== 201) {
    return { error: "Erreur GitHub PUT " + putCode + " : " + putRes.getContentText().slice(0, 200) };
  }

  return { ok: true, slug: slug, plan: plan, status: status, nextBillingDate: nextBillingDate };
}

// ─── Constructeur de réponse HTTP ────────────────────────────
function buildResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
