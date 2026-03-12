'use strict';
/**
 * Fidelavis – services/aiService.js
 * Moteur de génération de réponses IA (Claude / Anthropic)
 * Prompts adaptés au type d'avis, ton personnalisable, règles métier
 */

const Anthropic = require('@anthropic-ai/sdk');
const logger    = require('../utils/logger');
require('dotenv').config();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AI_MODEL = 'claude-sonnet-4-5';

// ============================================================
// Classifier un avis (tag automatique)
// ============================================================
function classifyReview(review) {
  const tags = [];
  const { rating, comment } = review;

  if (rating >= 4)                              tags.push('positif');
  if (rating <= 2)                              tags.push('negatif');
  if (rating === 3)                             tags.push('mitige');
  if (!comment || comment.trim().length < 10)   tags.push('sans-commentaire');
  if (rating <= 2 && comment && comment.length > 100) tags.push('urgent');

  // Détection d'agressivité basique
  const agressiveKeywords = ['scandaleux', 'honteux', 'nul', 'arnaque', 'voleur', 'dégueulasse', 'horrible'];
  if (comment && agressiveKeywords.some(k => comment.toLowerCase().includes(k))) {
    tags.push('agressif');
  }

  return tags;
}

// ============================================================
// Construire le prompt système selon le profil du commerçant
// ============================================================
function buildSystemPrompt(settings) {
  const restaurantName = settings?.restaurant_name || 'notre établissement';
  const ownerName      = settings?.owner_name      || null;
  const tone           = settings?.response_tone   || 'warm';
  const signature      = settings?.signature       || (ownerName ? `${ownerName} et toute l'équipe` : "L'équipe");
  const returnPhrase   = settings?.return_phrase   || 'Au plaisir de vous revoir très prochainement !';
  const contactPhrase  = settings?.contact_phrase  || 'N\'hésitez pas à nous contacter directement pour que nous puissions échanger.';

  const toneDesc = {
    warm:         'chaleureux, humain, proche du client, authentique et sincère',
    professional: 'professionnel, courtois, posé, sans familiarité excessive',
    formal:       'formel, respectueux, sobre, institutionnel'
  }[tone] || 'chaleureux et professionnel';

  return `Tu es le/la responsable de "${restaurantName}", un commerce local qui prend soin de sa réputation en ligne.

Ta mission est de rédiger des réponses aux avis Google de façon ${toneDesc}.

RÈGLES ABSOLUES :
- Réponds toujours en français.
- Sois sincère, humain(e), jamais robotique.
- Ne copie jamais deux réponses identiques.
- N'invente aucun fait non mentionné dans l'avis.
- Ne sois jamais agressif(ve) ou défensif(ve), même face à un avis injuste.
- Reste concis(e) : 3 à 6 phrases maximum sauf si l'avis est long et complexe.
- N'utilise pas de formules creuses comme "chère cliente" ou "cher client" si le nom est inconnu.

ÉLÉMENTS DISPONIBLES :
- Nom de l'établissement : ${restaurantName}
${ownerName ? `- Nom du gérant : ${ownerName}` : ''}
- Signature de clôture : « ${signature} »
- Phrase d'invitation à revenir : « ${returnPhrase} »
- Phrase de contact (problème) : « ${contactPhrase} »

FORMAT DE RÉPONSE :
- Commence directement par la réponse (pas de préambule comme "Voici la réponse:")
- Termine TOUJOURS par la signature : "${signature}"
- Pour les avis positifs : remercie, cite un élément spécifique si mentionné, invite à revenir.
- Pour les avis négatifs : reconnais le problème sans te justifier excessivement, propose une solution ou un contact.
- Pour les avis sans commentaire (note seule) : réponse courte et chaleureuse.
- Pour les avis très agressifs : reste calme, professionnel(le), montre de l'empathie.`;
}

// ============================================================
// Construire le prompt utilisateur selon le type d'avis
// ============================================================
function buildUserPrompt(review) {
  const { rating, comment, reviewerName, tags } = review;
  const stars = '⭐'.repeat(rating);
  const reviewer = reviewerName && reviewerName !== 'Anonyme' ? reviewerName : null;

  let context = '';
  if (tags.includes('sans-commentaire')) {
    context = `Cet avis est une note seule sans commentaire écrit (${stars}).`;
  } else if (tags.includes('agressif')) {
    context = `Cet avis est agressif ou très négatif. Il faut rester professionnel(le) et calme.`;
  } else if (tags.includes('negatif')) {
    context = `Cet avis est négatif. Il faut reconnaître le problème et proposer un contact.`;
  } else if (tags.includes('mitige')) {
    context = `Cet avis est mitigé : il y a des aspects positifs et négatifs.`;
  } else {
    context = `Cet avis est positif.`;
  }

  return `${context}

Note donnée : ${rating}/5 (${stars})
${reviewer ? `Auteur : ${reviewer}` : 'Auteur : anonyme'}
${comment ? `Commentaire : "${comment}"` : '(aucun commentaire écrit)'}

Rédige maintenant la réponse adaptée à cet avis.`;
}

// ============================================================
// Générer une réponse IA pour un avis
// ============================================================
async function generateResponse(review, merchantSettings) {
  const tags = classifyReview(review);
  const reviewWithTags = { ...review, tags };

  const systemPrompt = buildSystemPrompt(merchantSettings);
  const userPrompt   = buildUserPrompt(reviewWithTags);

  const startTime = Date.now();

  try {
    logger.info('[aiService] Génération réponse', {
      reviewId: review.id || review.googleReviewId,
      rating: review.rating,
      tags
    });

    const message = await client.messages.create({
      model:      AI_MODEL,
      max_tokens: 600,
      temperature: 0.85,  // légère variabilité pour éviter les répétitions
      system:     systemPrompt,
      messages: [
        { role: 'user', content: userPrompt }
      ]
    });

    const responseText = message.content[0]?.text?.trim() || '';
    const genMs        = Date.now() - startTime;

    logger.info('[aiService] Réponse générée', {
      tokens: message.usage,
      ms:     genMs,
      rating: review.rating
    });

    return {
      responseText,
      modelUsed:     AI_MODEL,
      promptTokens:  message.usage?.input_tokens  || 0,
      outputTokens:  message.usage?.output_tokens || 0,
      generationMs:  genMs,
      tags
    };

  } catch (err) {
    const msg = err.message || 'Erreur IA inconnue';
    logger.error('[aiService] Erreur génération', { error: msg });
    throw new Error('IA_GENERATION_ERROR: ' + msg);
  }
}

// ============================================================
// Déterminer l'action auto-réponse selon les règles du commerçant
// ============================================================
function getAutoReplyAction(rating, settings) {
  if (!settings?.auto_reply_enabled) return 'manual';

  const ruleMap = {
    5: settings.auto_reply_rule_5 || 'auto',
    4: settings.auto_reply_rule_4 || 'auto',
    3: settings.auto_reply_rule_3 || 'validate',
    2: settings.auto_reply_rule_2 || 'disabled',
    1: settings.auto_reply_rule_1 || 'disabled'
  };

  return ruleMap[rating] || 'manual';
  // 'auto'     → publication automatique immédiate
  // 'validate' → IA génère, le commerçant valide avant publication
  // 'disabled' → pas de traitement automatique
  // 'manual'   → mode manuel pur
}

module.exports = {
  generateResponse,
  classifyReview,
  getAutoReplyAction,
  buildSystemPrompt,
  buildUserPrompt
};
