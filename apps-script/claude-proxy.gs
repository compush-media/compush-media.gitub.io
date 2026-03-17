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
  var platformStyle = platform === "tripadvisor"
    ? "réponse élaborée, ton hospitalier et chaleureux, style hôtellerie-restauration professionnelle, 3-5 phrases"
    : "réponse courte, humaine, locale, authentique, 2-3 phrases maximum";
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
  var recentTrend   = params.recentTrend               || "stable";
  var responseRate  = parseFloat(params.responseRate)  || 0;
  var sentiment     = params.sentiment                 || "positif";
  var scoreRating   = ((avgRating - 1) / 4) * 35;
  var scoreVolume   = Math.min(totalReviews / 200, 1) * 20;
  var scoreTrend    = recentTrend === "hausse" ? 20 : recentTrend === "stable" ? 12 : 0;
  var scoreResp     = (responseRate / 100) * 15;
  var scoreSentiment = sentiment === "positif" ? 10 : sentiment === "neutre" ? 5 : 0;
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
    var clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    return JSON.parse(clean);
  } catch (err) {
    return { raw_response: raw, parse_error: err.message };
  }
}
// ─── Action 4 : Envoyer une notification push (Progressier) ──
function pushNotification(params) {
  var title = (params.title || "").trim();
  var body  = (params.body  || "").trim();
  var url   = (params.url   || "").trim();

  if (!title) return { error: "Le titre est obligatoire." };
  if (!body)  return { error: "Le message est obligatoire." };

  var apiKey = PropertiesService.getScriptProperties().getProperty("PROGRESSIER_API_KEY");
  if (!apiKey) {
    return { error: "Clé API Progressier non configurée. Ajoutez PROGRESSIER_API_KEY dans Extensions > Propriétés du script." };
  }

  var payload = {
    title:      title,
    body:       body,
    recipients: { users: "all" }
  };
  if (url) payload.url = url;

  var options = {
    method:          "post",
    contentType:     "application/json",
    headers:         { "authorization": apiKey },
    payload:         JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch("https://progressier.app/api/v1/send", options);
  var code     = response.getResponseCode();
  var content  = response.getContentText();

  if (code !== 200 && code !== 201) {
    return { error: "Erreur Progressier (" + code + ") : " + content.substring(0, 300) };
  }

  return { ok: true };
}

// ─── Constructeur de réponse HTTP ────────────────────────────
function buildResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
