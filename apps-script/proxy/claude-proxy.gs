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

    // Calculer trialEndDate = aujourd'hui + 14 jours
    var trialEndD = new Date();
    trialEndD.setDate(trialEndD.getDate() + 14);
    var trialEndStr = trialEndD.toISOString().slice(0, 10);

    // Générer config.json avec champs billing (essai 14j)
    var cfg = {
      name:   name,
      color:  color,
      color2: color2,
      // Billing — essai gratuit 14 jours
      plan:                 "essentiel",
      subscriptionStatus:   "trialing",
      trialEndDate:         trialEndStr,
      setupPaid:            false,
      billingEmail:         email || "",
      stripeCustomerId:     "",
      stripeSubscriptionId: "",
      nextBillingDate:      "",
      invoices:             []
    };
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

    // ─── Envoi des emails de bienvenue ────────────────────────────
    var siteUrl = "https://app.cartefidelavis.com";
    var loginUrl = siteUrl + "/" + sl + "/admin/login.html";
    var nfcUrl   = siteUrl + "/" + sl + "/indexnfc.html";

    // 1. Email au RESTAURATEUR avec ses identifiants
    if (email) {
      try {
        _sendRestaurateurWelcomeEmail(email, name, sl, adminPass, loginUrl, nfcUrl);
        Logger.log("Email bienvenue restaurateur envoyé à " + email);
      } catch(emErr) {
        Logger.log("Erreur email restaurateur : " + emErr.message);
      }
    }

    // 2. Email à l'AMBASSADEUR de confirmation
    if (amb.email) {
      try {
        _sendAmbassadeurConfirmationEmail(amb.email, amb.prenom || amb.code, name, sl, loginUrl);
        Logger.log("Email confirmation ambassadeur envoyé à " + amb.email);
      } catch(emErr2) {
        Logger.log("Erreur email ambassadeur : " + emErr2.message);
      }
    }

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
  var slug                 = (params.slug                 || "").trim().toLowerCase();
  var plan                 = (params.plan                 || "essentiel").trim();
  var email                = (params.email                || "").trim();
  var status               = (params.status               || "active").trim();
  var stripeCustomerId     = (params.stripeCustomerId     || "").trim();
  var stripeSubscriptionId = (params.stripeSubscriptionId || "").trim();
  var trialEndDate         = (params.trialEndDate         || "").trim();

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
  if (email)                existing.billingEmail         = email;
  if (stripeCustomerId)     existing.stripeCustomerId     = stripeCustomerId;
  if (stripeSubscriptionId) existing.stripeSubscriptionId = stripeSubscriptionId;
  if (trialEndDate)         existing.trialEndDate         = trialEndDate;

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

// ─── Action 11 : Rappels automatiques fin d'essai ────────────
//
//  Fonction à déclencher quotidiennement via un trigger GAS.
//  Scanne tous les restaurants → envoie un email de rappel selon
//  le nombre de jours restants avant la fin de l'essai gratuit.
//
//  Calendrier des rappels :
//    J-7 → "Plus qu'une semaine"
//    J-3 → "Plus que 3 jours"
//    J-1 → "Demain : fin de l'essai"
//    J-0 → "Dernière chance"
//    J+1 → "Votre essai est terminé"
//
//  Pour configurer le trigger :
//    Apps Script → Déclencheurs → + Ajouter un déclencheur
//    Fonction : _sendTrialReminders
//    Source : Time-driven (Horaire)
//    Fréquence : Daily timer (Tous les jours)
//    Heure : ~9h-10h
//
function _sendTrialReminders() {
  var token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  var repo  = PropertiesService.getScriptProperties().getProperty("GITHUB_REPO")
              || "compush-media/compush-media.gitub.io";
  if (!token) {
    Logger.log("_sendTrialReminders: GITHUB_TOKEN manquant");
    return;
  }

  // 1. Lire data/restaurants.json
  var listUrl = "https://api.github.com/repos/" + repo + "/contents/data/restaurants.json?ref=main";
  var headers = { Authorization: "token " + token, Accept: "application/vnd.github.v3+json" };
  var listRes = UrlFetchApp.fetch(listUrl, { headers: headers, muteHttpExceptions: true });
  if (listRes.getResponseCode() !== 200) {
    Logger.log("_sendTrialReminders: Impossible de lire restaurants.json (" + listRes.getResponseCode() + ")");
    return;
  }
  var listData;
  try {
    var rawJson = Utilities.newBlob(Utilities.base64Decode(JSON.parse(listRes.getContentText()).content.replace(/\n/g, ""))).getDataAsString();
    listData = JSON.parse(rawJson);
  } catch(e) {
    Logger.log("_sendTrialReminders: Parse error " + e.message);
    return;
  }

  var slugs = Object.keys(listData);
  var today = new Date();
  // Normaliser à minuit pour calcul de jours stable
  today.setHours(0, 0, 0, 0);

  var sent = 0;
  var skipped = 0;

  for (var i = 0; i < slugs.length; i++) {
    var slug = slugs[i];
    try {
      // 2. Lire /{slug}/config.json
      var cfgUrl = "https://api.github.com/repos/" + repo + "/contents/" + slug + "/config.json?ref=main";
      var cfgRes = UrlFetchApp.fetch(cfgUrl, { headers: headers, muteHttpExceptions: true });
      if (cfgRes.getResponseCode() !== 200) { skipped++; continue; }

      var cfgFile = JSON.parse(cfgRes.getContentText());
      var cfgSha  = cfgFile.sha;
      var cfg;
      try {
        cfg = JSON.parse(Utilities.newBlob(Utilities.base64Decode(cfgFile.content.replace(/\n/g, ""))).getDataAsString());
      } catch(e) { skipped++; continue; }

      // 3. Filtrer : seulement les essais en cours avec email + date
      if (cfg.subscriptionStatus !== "trialing") { skipped++; continue; }
      if (!cfg.trialEndDate)                     { skipped++; continue; }
      if (!cfg.billingEmail && !cfg.email)       { skipped++; continue; }

      // 4. Calculer le nombre de jours restants
      var trialEnd = new Date(cfg.trialEndDate);
      trialEnd.setHours(0, 0, 0, 0);
      var daysLeft = Math.round((trialEnd - today) / 86400000);

      // 5. Déterminer quel rappel envoyer (un seul par jour de référence)
      var reminderKey = null;
      if      (daysLeft === 7)  reminderKey = "j-7";
      else if (daysLeft === 3)  reminderKey = "j-3";
      else if (daysLeft === 1)  reminderKey = "j-1";
      else if (daysLeft === 0)  reminderKey = "j-0";
      else if (daysLeft === -1) reminderKey = "j+1";

      if (!reminderKey) { skipped++; continue; }

      // 6. Vérifier qu'il n'a pas déjà été envoyé
      var remindersSent = cfg.remindersSent || [];
      if (remindersSent.indexOf(reminderKey) !== -1) { skipped++; continue; }

      // 7. Envoyer l'email
      var to     = cfg.billingEmail || cfg.email;
      var name   = cfg.name || slug;
      _sendReminderEmail(to, name, slug, reminderKey, daysLeft);

      // 8. Marquer comme envoyé dans config.json
      remindersSent.push(reminderKey);
      cfg.remindersSent = remindersSent;
      _saveConfigJson(token, repo, slug, cfg, cfgSha, "billing: rappel " + reminderKey + " envoyé");

      sent++;
      Logger.log("_sendTrialReminders: " + slug + " → " + to + " (" + reminderKey + ", J" + (daysLeft >= 0 ? "-" + daysLeft : "+" + (-daysLeft)) + ")");
    } catch(err) {
      Logger.log("_sendTrialReminders error pour " + slug + " : " + err.message);
    }
  }

  Logger.log("_sendTrialReminders terminé : " + sent + " envoyés, " + skipped + " ignorés sur " + slugs.length + " restaurants.");
  return { ok: true, sent: sent, skipped: skipped, total: slugs.length };
}

/**
 * _sendReminderEmail(to, restoName, slug, reminderKey, daysLeft)
 * Envoie un email HTML de rappel selon le code (j-7, j-3, j-1, j-0, j+1).
 */
function _sendReminderEmail(to, restoName, slug, reminderKey, daysLeft) {
  var siteUrl    = "https://app.cartefidelavis.com";
  var billingUrl = siteUrl + "/" + slug + "/admin/billing.html";
  var loginUrl   = siteUrl + "/" + slug + "/admin/login.html";

  var subject, intro, urgency, cta, headerColor, headerEmoji;

  switch (reminderKey) {
    case "j-7":
      subject     = "🎁 Plus qu'une semaine d'essai gratuit chez Fidelavis";
      headerEmoji = "🎁";
      headerColor = "#1976d2";
      intro       = "Il vous reste encore <strong>7 jours</strong> pour profiter gratuitement de Fidelavis chez <strong>" + restoName + "</strong>.";
      urgency     = "Pour continuer après l'essai, choisissez votre formule dès maintenant — votre carte ne sera prélevée qu'à la fin de l'essai.";
      cta         = "Choisir mon abonnement";
      break;
    case "j-3":
      subject     = "⏰ Plus que 3 jours d'essai gratuit chez " + restoName;
      headerEmoji = "⏰";
      headerColor = "#d97706";
      intro       = "Votre essai gratuit de Fidelavis se termine <strong>dans 3 jours</strong>.";
      urgency     = "Pour ne pas perdre l'accès à votre tableau de bord, votre carte fidélité NFC et vos avis Google, configurez votre abonnement avant la fin de l'essai.";
      cta         = "S'abonner maintenant";
      break;
    case "j-1":
      subject     = "📅 Demain : fin de votre essai Fidelavis";
      headerEmoji = "📅";
      headerColor = "#d97706";
      intro       = "Votre essai gratuit de Fidelavis pour <strong>" + restoName + "</strong> se termine <strong>DEMAIN</strong>.";
      urgency     = "Pour continuer à utiliser Fidelavis sans interruption, abonnez-vous dès aujourd'hui. Aucun prélèvement avant la fin de l'essai — vous restez gratuit jusqu'au bout.";
      cta         = "S'abonner avant demain";
      break;
    case "j-0":
      subject     = "🚨 Dernière chance — votre essai Fidelavis expire aujourd'hui";
      headerEmoji = "🚨";
      headerColor = "#dc2626";
      intro       = "Votre essai gratuit de Fidelavis pour <strong>" + restoName + "</strong> se termine <strong>AUJOURD'HUI</strong>.";
      urgency     = "Sans abonnement, votre accès sera bloqué dès demain. Choisissez votre formule en quelques clics.";
      cta         = "S'abonner maintenant";
      break;
    case "j+1":
      subject     = "Votre essai Fidelavis est terminé — réactivez votre compte";
      headerEmoji = "🔓";
      headerColor = "#6b7280";
      intro       = "Votre essai gratuit de Fidelavis pour <strong>" + restoName + "</strong> s'est terminé hier.";
      urgency     = "Votre tableau de bord affiche maintenant un message d'invitation à l'abonnement. Choisissez votre formule pour réactiver l'accès complet.";
      cta         = "Réactiver mon compte";
      break;
  }

  // Version HTML (avec liens cliquables)
  var html = [
    '<!DOCTYPE html>',
    '<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    '<body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1c1c2e">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:24px 12px">',
    '<tr><td align="center">',

      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;box-shadow:0 2px 16px rgba(0,0,0,.08);overflow:hidden">',

        // Header
        '<tr><td style="background:' + headerColor + ';padding:28px 24px;text-align:center;color:#ffffff">',
          '<div style="font-size:36px;line-height:1;margin-bottom:8px">' + headerEmoji + '</div>',
          '<div style="font-size:20px;font-weight:800;line-height:1.3">Fidelavis</div>',
        '</td></tr>',

        // Body
        '<tr><td style="padding:32px 28px 8px">',
          '<p style="font-size:15px;color:#1c1c2e;margin:0 0 16px">Bonjour,</p>',
          '<p style="font-size:15px;color:#1c1c2e;margin:0 0 16px;line-height:1.6">' + intro + '</p>',
          '<p style="font-size:14px;color:#4b5563;margin:0 0 24px;line-height:1.6">' + urgency + '</p>',

          // CTA Button
          '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 28px"><tr>',
            '<td style="background:#b6152b;border-radius:10px">',
              '<a href="' + billingUrl + '" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700">👉 ' + cta + '</a>',
            '</td>',
          '</tr></table>',

        '</td></tr>',

        // OFFRE TERRAIN EXCLUSIVE
        '<tr><td style="padding:0 28px 28px">',
          '<div style="border:2px solid #b6152b;border-radius:14px;overflow:hidden">',

            // Header rouge
            '<div style="background:#b6152b;color:#fff;padding:24px 22px">',
              '<div style="display:inline-block;background:rgba(255,255,255,0.2);color:#fff;padding:5px 14px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.05em;margin-bottom:14px">OFFRE TERRAIN EXCLUSIVE</div>',
              '<div style="font-size:42px;font-weight:900;line-height:1;margin-bottom:6px">129€<span style="font-size:14px;font-weight:400;opacity:.9"> /mois</span></div>',
              '<div style="font-size:13px;color:rgba(255,255,255,.85);font-style:italic">Résiliable à tout moment — sans engagement</div>',
            '</div>',

            // Body
            '<div style="padding:22px 22px 4px;background:#fff">',
              '<div style="font-size:11px;font-weight:700;color:#9ca3af;letter-spacing:.08em;margin-bottom:14px">CE QUI EST INCLUS</div>',

              '<table cellpadding="0" cellspacing="0" style="width:100%;font-size:13.5px;color:#1c1c2e;line-height:1.5">',

                '<tr>',
                  '<td style="padding:5px 0;vertical-align:top;width:26px">',
                    '<div style="width:18px;height:18px;background:#b6152b;border-radius:50%;color:#fff;text-align:center;font-size:11px;font-weight:700;line-height:18px">✓</div>',
                  '</td>',
                  '<td style="padding:5px 6px 5px 8px">10 cartes NFC prêtes à poser sur vos tables</td>',
                '</tr>',

                '<tr>',
                  '<td style="padding:5px 0;vertical-align:top">',
                    '<div style="width:18px;height:18px;background:#b6152b;border-radius:50%;color:#fff;text-align:center;font-size:11px;font-weight:700;line-height:18px">✓</div>',
                  '</td>',
                  '<td style="padding:5px 6px 5px 8px">Notifications push illimitées</td>',
                '</tr>',

                '<tr>',
                  '<td style="padding:5px 0;vertical-align:top">',
                    '<div style="width:18px;height:18px;background:#b6152b;border-radius:50%;color:#fff;text-align:center;font-size:11px;font-weight:700;line-height:18px">✓</div>',
                  '</td>',
                  '<td style="padding:5px 6px 5px 8px">Offres &amp; coupons fidélité</td>',
                '</tr>',

                '<tr>',
                  '<td style="padding:5px 0;vertical-align:top">',
                    '<div style="width:18px;height:18px;background:#b6152b;border-radius:50%;color:#fff;text-align:center;font-size:11px;font-weight:700;line-height:18px">✓</div>',
                  '</td>',
                  '<td style="padding:5px 6px 5px 8px">Collecte automatique des emails clients</td>',
                '</tr>',

                '<tr>',
                  '<td style="padding:5px 0;vertical-align:top">',
                    '<div style="width:18px;height:18px;background:#b6152b;border-radius:50%;color:#fff;text-align:center;font-size:11px;font-weight:700;line-height:18px">✓</div>',
                  '</td>',
                  '<td style="padding:5px 6px 5px 8px">Obtenez plus d\'avis Google naturellement ⭐</td>',
                '</tr>',

                '<tr>',
                  '<td style="padding:5px 0;vertical-align:top">',
                    '<div style="width:18px;height:18px;background:#b6152b;border-radius:50%;color:#fff;text-align:center;font-size:11px;font-weight:700;line-height:18px">✓</div>',
                  '</td>',
                  '<td style="padding:5px 6px 5px 8px">Tableau de bord simple (clients, scans, retours)</td>',
                '</tr>',

              '</table>',

              '<hr style="margin:20px 0;border:0;border-top:1px solid #e5e7eb">',

              '<div style="font-size:11px;font-weight:700;color:#9ca3af;letter-spacing:.08em;margin-bottom:14px">OFFRE TERRAIN — AUJOURD\'HUI UNIQUEMENT</div>',

              // Mise en place offerte
              '<table cellpadding="0" cellspacing="0" style="width:100%;margin-bottom:14px">',
                '<tr>',
                  '<td style="vertical-align:top;width:42px">',
                    '<div style="width:36px;height:36px;background:#fde2e4;border-radius:8px;color:#b6152b;text-align:center;font-size:18px;line-height:36px">🎁</div>',
                  '</td>',
                  '<td style="padding-left:12px;vertical-align:middle">',
                    '<div style="font-weight:700;font-size:14px">Mise en place <span style="color:#9ca3af;font-weight:400;text-decoration:line-through">199€</span> <span style="color:#b6152b">→ offerte</span></div>',
                    '<div style="font-size:12.5px;color:#6b7280;margin-top:2px">Installation complète sur place, faite pour vous</div>',
                  '</td>',
                '</tr>',
              '</table>',

              // 14 jours essai gratuit
              '<table cellpadding="0" cellspacing="0" style="width:100%">',
                '<tr>',
                  '<td style="vertical-align:top;width:42px">',
                    '<div style="width:36px;height:36px;background:#fde2e4;border-radius:8px;color:#b6152b;text-align:center;font-size:18px;line-height:36px">⏰</div>',
                  '</td>',
                  '<td style="padding-left:12px;vertical-align:middle">',
                    '<div style="font-weight:700;font-size:14px">14 jours d\'essai gratuit</div>',
                    '<div style="font-size:12.5px;color:#6b7280;margin-top:2px">Sans carte bancaire — activation immédiate</div>',
                  '</td>',
                '</tr>',
              '</table>',

            '</div>',

            // Quote en bas
            '<div style="background:#fef3c7;border-left:4px solid #d97706;padding:14px 18px;font-size:13px;color:#1c1c2e;line-height:1.5;font-style:italic">',
              '1 à 2 clients qui reviennent par mois suffisent à rentabiliser Fidelavis.',
            '</div>',

          '</div>',
        '</td></tr>',

        // Footer
        '<tr><td style="padding:20px 28px 28px;border-top:1px solid #e5e7eb;background:#fafafa">',
          '<div style="font-size:13px;color:#6b7280;line-height:1.7">',
            'Connexion à votre espace : <a href="' + loginUrl + '" style="color:#1976d2;text-decoration:none">' + loginUrl + '</a><br>',
            'Une question ? <a href="mailto:support@fidelavis.com" style="color:#b6152b;font-weight:600;text-decoration:none">support@fidelavis.com</a>',
          '</div>',
          '<div style="font-size:12px;color:#9ca3af;margin-top:14px">L\'équipe Fidelavis</div>',
        '</td></tr>',

      '</table>',

    '</td></tr></table>',
    '</body></html>'
  ].join("");

  // Version texte brut (fallback pour clients qui n'affichent pas l'HTML)
  var text = [
    "Bonjour,",
    "",
    intro.replace(/<\/?strong>/g, "*"),
    "",
    urgency,
    "",
    "👉 " + cta + " : " + billingUrl,
    "",
    "─────────────────────────────",
    "OFFRE TERRAIN EXCLUSIVE",
    "─────────────────────────────",
    "",
    "💎 129 €/mois",
    "   Résiliable à tout moment — sans engagement",
    "",
    "CE QUI EST INCLUS :",
    "   ✓ 10 cartes NFC prêtes à poser sur vos tables",
    "   ✓ Notifications push illimitées",
    "   ✓ Offres & coupons fidélité",
    "   ✓ Collecte automatique des emails clients",
    "   ✓ Obtenez plus d'avis Google naturellement ⭐",
    "   ✓ Tableau de bord simple (clients, scans, retours)",
    "",
    "🎁 Mise en place 199€ → OFFERTE",
    "   Installation complète sur place, faite pour vous",
    "",
    "⏰ 14 jours d'essai gratuit",
    "   Sans carte bancaire — activation immédiate",
    "",
    "« 1 à 2 clients qui reviennent par mois suffisent à rentabiliser Fidelavis. »",
    "",
    "─────────────────────────────",
    "",
    "Connexion à votre espace : " + loginUrl,
    "Une question ? support@fidelavis.com",
    "",
    "L'équipe Fidelavis"
  ].join("\n");

  _sendEmailFromProxy(to, subject, html, text);
}

/**
 * _sendRestaurateurWelcomeEmail(to, restoName, slug, adminPass, loginUrl, nfcUrl)
 * Email envoyé au restaurateur lors de la création de son espace par l'ambassadeur.
 * Contient ses identifiants de connexion + lien NFC à programmer.
 */
function _sendRestaurateurWelcomeEmail(to, restoName, slug, adminPass, loginUrl, nfcUrl) {
  var subject = "✅ Votre espace " + restoName + " est prêt — vos accès Fidelavis";

  var html = [
    '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    '<body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1c1c2e">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:24px 12px">',
    '<tr><td align="center">',
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;box-shadow:0 2px 16px rgba(0,0,0,.08);overflow:hidden">',

        // Header rouge
        '<tr><td style="background:#b6152b;padding:30px 24px;text-align:center;color:#ffffff">',
          '<div style="font-size:42px;line-height:1;margin-bottom:10px">🎉</div>',
          '<div style="font-size:22px;font-weight:900;line-height:1.3">Bienvenue chez Fidelavis !</div>',
          '<div style="font-size:14px;color:rgba(255,255,255,.85);margin-top:6px">' + restoName + '</div>',
        '</td></tr>',

        // Body intro
        '<tr><td style="padding:32px 28px 8px">',
          '<p style="font-size:15px;line-height:1.6;margin:0 0 12px">Bonjour,</p>',
          '<p style="font-size:15px;line-height:1.6;margin:0 0 12px">Votre espace restaurant <strong>' + restoName + '</strong> est en ligne ! 🚀</p>',
          '<p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 20px">Vous bénéficiez de <strong>14 jours d\'essai gratuit</strong> pour tester toutes les fonctionnalités. Aucun paiement aujourd\'hui.</p>',
        '</td></tr>',

        // Accès admin
        '<tr><td style="padding:0 28px 8px">',
          '<div style="background:#fef3c7;border-radius:12px;padding:20px;border-left:4px solid #d97706">',
            '<div style="font-size:11px;font-weight:800;color:#92400e;letter-spacing:.08em;margin-bottom:10px">🔑 VOS ACCÈS ADMINISTRATEUR</div>',
            '<table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;line-height:1.7">',
              '<tr><td style="color:#6b7280;width:120px">Lien :</td><td><a href="' + loginUrl + '" style="color:#b6152b;font-weight:700;text-decoration:none;word-break:break-all">' + loginUrl + '</a></td></tr>',
              '<tr><td style="color:#6b7280">Identifiant :</td><td><code style="background:#fff;padding:3px 8px;border-radius:4px;font-size:13px">admin</code></td></tr>',
              '<tr><td style="color:#6b7280">Mot de passe :</td><td><code style="background:#fff;padding:3px 8px;border-radius:4px;font-size:13px">' + adminPass + '</code></td></tr>',
            '</table>',
          '</div>',
        '</td></tr>',

        // CTA bouton
        '<tr><td style="padding:20px 28px 8px;text-align:center">',
          '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto"><tr>',
            '<td style="background:#b6152b;border-radius:10px">',
              '<a href="' + loginUrl + '" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700">→ Accéder à mon espace</a>',
            '</td>',
          '</tr></table>',
        '</td></tr>',

        // NFC info
        '<tr><td style="padding:24px 28px 8px">',
          '<div style="border-top:1px solid #e5e7eb;padding-top:20px">',
            '<div style="font-size:11px;font-weight:800;color:#6b7280;letter-spacing:.08em;margin-bottom:10px">📡 LIEN NFC / QR CODE CLIENT</div>',
            '<p style="font-size:13.5px;line-height:1.6;color:#4b5563;margin:0 0 8px">Lien à programmer sur vos cartes NFC ou QR codes posés sur les tables :</p>',
            '<a href="' + nfcUrl + '" style="display:block;background:#f4f6f9;padding:10px 14px;border-radius:8px;color:#1c1c2e;font-size:13px;text-decoration:none;word-break:break-all;font-family:monospace">' + nfcUrl + '</a>',
          '</div>',
        '</td></tr>',

        // Trial info
        '<tr><td style="padding:20px 28px">',
          '<div style="background:#dbeafe;border-radius:10px;padding:14px 18px">',
            '<div style="font-size:13.5px;color:#1e3a8a;line-height:1.5">',
              '🎁 <strong>Essai gratuit 14 jours</strong> — Vous recevrez un rappel 7 jours avant la fin pour activer votre abonnement (129€/mois, mise en place offerte).',
            '</div>',
          '</div>',
        '</td></tr>',

        // Footer
        '<tr><td style="padding:20px 28px 28px;border-top:1px solid #e5e7eb;background:#fafafa">',
          '<div style="font-size:13px;color:#6b7280;line-height:1.7">',
            'Une question ? <a href="mailto:support@fidelavis.com" style="color:#b6152b;font-weight:600;text-decoration:none">support@fidelavis.com</a><br>',
            'Conservez précieusement cet email avec vos accès.',
          '</div>',
          '<div style="font-size:12px;color:#9ca3af;margin-top:14px">L\'équipe Fidelavis</div>',
        '</td></tr>',

      '</table>',
    '</td></tr></table>',
    '</body></html>'
  ].join("");

  var text = [
    "Bonjour,",
    "",
    "Votre espace restaurant " + restoName + " est en ligne !",
    "",
    "Vous bénéficiez de 14 jours d'essai gratuit pour tester toutes les fonctionnalités.",
    "",
    "─────────────────────────────",
    "VOS ACCÈS ADMINISTRATEUR",
    "─────────────────────────────",
    "",
    "🔗 Lien : " + loginUrl,
    "👤 Identifiant : admin",
    "🔑 Mot de passe : " + adminPass,
    "",
    "─────────────────────────────",
    "LIEN NFC / QR CODE CLIENT",
    "─────────────────────────────",
    "",
    "Lien à programmer sur vos cartes NFC ou QR codes :",
    nfcUrl,
    "",
    "─────────────────────────────",
    "",
    "🎁 Essai gratuit 14 jours — Rappel 7 jours avant la fin pour activer votre abonnement (129€/mois, mise en place offerte).",
    "",
    "Une question ? support@fidelavis.com",
    "Conservez précieusement cet email avec vos accès.",
    "",
    "L'équipe Fidelavis"
  ].join("\n");

  _sendEmailFromProxy(to, subject, html, text);
}

/**
 * _sendAmbassadeurConfirmationEmail(to, ambName, restoName, slug, loginUrl)
 * Email de confirmation envoyé à l'ambassadeur après création d'un restaurant.
 */
function _sendAmbassadeurConfirmationEmail(to, ambName, restoName, slug, loginUrl) {
  var subject = "✅ Restaurant " + restoName + " créé avec succès";
  var siteUrl = "https://app.cartefidelavis.com";
  var publicUrl = siteUrl + "/" + slug + "/";

  var html = [
    '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    '<body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1c1c2e">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:24px 12px">',
    '<tr><td align="center">',
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;box-shadow:0 2px 16px rgba(0,0,0,.08);overflow:hidden">',

        // Header vert
        '<tr><td style="background:#16a34a;padding:28px 24px;text-align:center;color:#ffffff">',
          '<div style="font-size:40px;line-height:1;margin-bottom:8px">✅</div>',
          '<div style="font-size:20px;font-weight:900">Restaurant créé !</div>',
        '</td></tr>',

        // Body
        '<tr><td style="padding:30px 28px 20px">',
          '<p style="font-size:15px;line-height:1.6;margin:0 0 14px">Bonjour ' + ambName + ',</p>',
          '<p style="font-size:15px;line-height:1.6;margin:0 0 14px">Le restaurant <strong>' + restoName + '</strong> vient d\'être créé avec succès dans votre espace ambassadeur. 🎉</p>',
          '<p style="font-size:14px;line-height:1.6;color:#4b5563;margin:0 0 20px">Le restaurateur a reçu ses identifiants par email à l\'instant et bénéficie de <strong>14 jours d\'essai gratuit</strong>.</p>',
        '</td></tr>',

        // Détails resto
        '<tr><td style="padding:0 28px 8px">',
          '<div style="background:#f0fdf4;border-radius:12px;padding:18px;border-left:4px solid #16a34a">',
            '<div style="font-size:11px;font-weight:800;color:#15803d;letter-spacing:.08em;margin-bottom:10px">🏪 DÉTAILS DU RESTAURANT</div>',
            '<table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;line-height:1.7">',
              '<tr><td style="color:#6b7280;width:100px">Nom :</td><td style="font-weight:600">' + restoName + '</td></tr>',
              '<tr><td style="color:#6b7280">Slug :</td><td><code style="background:#fff;padding:2px 6px;border-radius:4px">' + slug + '</code></td></tr>',
              '<tr><td style="color:#6b7280">Site :</td><td><a href="' + publicUrl + '" style="color:#16a34a;font-weight:600;text-decoration:none">' + publicUrl + '</a></td></tr>',
              '<tr><td style="color:#6b7280">Admin :</td><td><a href="' + loginUrl + '" style="color:#b6152b;font-weight:600;text-decoration:none;word-break:break-all">' + loginUrl + '</a></td></tr>',
            '</table>',
          '</div>',
        '</td></tr>',

        // CTA
        '<tr><td style="padding:24px 28px 8px;text-align:center">',
          '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto"><tr>',
            '<td style="background:#b6152b;border-radius:10px">',
              '<a href="' + siteUrl + '/admin/super-admin.html" style="display:inline-block;padding:13px 28px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700">Voir mes restaurants →</a>',
            '</td>',
          '</tr></table>',
        '</td></tr>',

        // Suite
        '<tr><td style="padding:24px 28px 8px">',
          '<div style="border-top:1px solid #e5e7eb;padding-top:18px">',
            '<div style="font-size:13.5px;line-height:1.7;color:#4b5563">',
              '<strong style="color:#1c1c2e">📅 Et ensuite ?</strong><br>',
              'Le restaurateur recevra automatiquement des rappels par email avant la fin de l\'essai (J-7, J-3, J-1) pour activer son abonnement à <strong>129€/mois</strong> avec mise en place offerte.',
            '</div>',
          '</div>',
        '</td></tr>',

        // Footer
        '<tr><td style="padding:20px 28px 28px;border-top:1px solid #e5e7eb;background:#fafafa">',
          '<div style="font-size:13px;color:#6b7280;line-height:1.7">',
            'Une question ? <a href="mailto:support@fidelavis.com" style="color:#b6152b;font-weight:600;text-decoration:none">support@fidelavis.com</a>',
          '</div>',
          '<div style="font-size:12px;color:#9ca3af;margin-top:14px">L\'équipe Fidelavis</div>',
        '</td></tr>',

      '</table>',
    '</td></tr></table>',
    '</body></html>'
  ].join("");

  var text = [
    "Bonjour " + ambName + ",",
    "",
    "Le restaurant " + restoName + " vient d'être créé avec succès dans votre espace ambassadeur.",
    "",
    "Le restaurateur a reçu ses identifiants par email à l'instant.",
    "Il bénéficie de 14 jours d'essai gratuit.",
    "",
    "─────────────────────────────",
    "DÉTAILS DU RESTAURANT",
    "─────────────────────────────",
    "",
    "Nom : " + restoName,
    "Slug : " + slug,
    "Site public : " + publicUrl,
    "Admin : " + loginUrl,
    "",
    "─────────────────────────────",
    "",
    "📅 ET ENSUITE ?",
    "Le restaurateur recevra automatiquement des rappels par email",
    "avant la fin de l'essai (J-7, J-3, J-1) pour activer son",
    "abonnement à 129€/mois avec mise en place offerte.",
    "",
    "Voir mes restaurants : " + siteUrl + "/admin/super-admin.html",
    "",
    "Une question ? support@fidelavis.com",
    "",
    "L'équipe Fidelavis"
  ].join("\n");

  _sendEmailFromProxy(to, subject, html, text);
}

/**
 * _sendEmailFromProxy(to, subject, html, text)
 * Envoie un email HTML via Brevo (sender = support@fidelavis.com).
 * Fallback MailApp si Brevo échoue.
 */
function _sendEmailFromProxy(to, subject, html, text) {
  if (!to) return;
  var apiKey = PropertiesService.getScriptProperties().getProperty("BREVO_API_KEY");

  if (apiKey) {
    try {
      var res = UrlFetchApp.fetch("https://api.brevo.com/v3/smtp/email", {
        method:             "post",
        headers:            { "api-key": apiKey, "Content-Type": "application/json" },
        payload:            JSON.stringify({
          sender:      { name: "Fidelavis", email: "support@fidelavis.com" },
          to:          [{ email: to }],
          subject:     subject,
          htmlContent: html,
          textContent: text || subject
        }),
        muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      if (code >= 200 && code < 300) {
        Logger.log("_sendEmailFromProxy Brevo OK → " + to + " (HTTP " + code + ")");
        return;
      }
      Logger.log("_sendEmailFromProxy Brevo failed (HTTP " + code + ") : " + res.getContentText().slice(0, 300));
    } catch(e) {
      Logger.log("_sendEmailFromProxy Brevo exception : " + e.message);
    }
  } else {
    Logger.log("_sendEmailFromProxy : BREVO_API_KEY manquant — fallback MailApp");
  }

  // Fallback : MailApp (envoie depuis l'email Google du compte GAS)
  // Note : impossible de forcer le From, mais on met replyTo support@fidelavis.com
  try {
    MailApp.sendEmail({
      to:       to,
      subject:  subject,
      htmlBody: html,
      body:     text || subject,
      name:     "Fidelavis",
      replyTo:  "support@fidelavis.com"
    });
    Logger.log("_sendEmailFromProxy MailApp OK → " + to);
  } catch(e) {
    Logger.log("_sendEmailFromProxy MailApp error : " + e.message);
  }
}

/**
 * _saveConfigJson(token, repo, slug, cfg, sha, message)
 * Réécrit /{slug}/config.json sur GitHub avec le nouveau contenu.
 */
function _saveConfigJson(token, repo, slug, cfg, sha, message) {
  var apiUrl  = "https://api.github.com/repos/" + repo + "/contents/" + slug + "/config.json";
  var b64     = Utilities.base64Encode(Utilities.newBlob(JSON.stringify(cfg, null, 2) + "\n").getBytes());
  var payload = { message: message, content: b64, branch: "main" };
  if (sha) payload.sha = sha;

  UrlFetchApp.fetch(apiUrl, {
    method:             "put",
    headers:            { Authorization: "token " + token, Accept: "application/vnd.github.v3+json", "Content-Type": "application/json" },
    payload:            JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

// ─── Constructeur de réponse HTTP ────────────────────────────
function buildResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
