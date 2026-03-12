'use strict';
/**
 * Fidelavis – services/publishService.js
 * Publication des réponses sur Google Business Profile
 * + Journalisation + mise à jour du statut en base
 */

const { v4: uuidv4 }     = require('uuid');
const { db, logAction }  = require('../database');
const { replyToReview }  = require('./googleApi');
const logger             = require('../utils/logger');

// ============================================================
// Publier une réponse sur Google et mettre à jour la BDD
// ============================================================
async function publishReply({ reviewId, aiResponseId, merchantId, replyText, accessToken, googleReviewId, publishedBy = 'manual' }) {
  logger.info('[publishService] Publication réponse', { reviewId, publishedBy });

  let googleResponse = null;
  let errorMessage   = null;
  let success        = false;

  try {
    // Publier sur Google
    googleResponse = await replyToReview(accessToken, googleReviewId, replyText);
    success = true;

  } catch (err) {
    errorMessage = err.message;
    logger.error('[publishService] Erreur publication Google', {
      reviewId,
      error: err.message
    });
  }

  const publishedReplyId = uuidv4();

  // Enregistrer la tentative dans published_replies (même si erreur)
  db.prepare(`
    INSERT INTO published_replies (
      id, review_id, ai_response_id, merchant_id,
      reply_text, published_by, google_response, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    publishedReplyId,
    reviewId,
    aiResponseId || null,
    merchantId,
    replyText,
    publishedBy,
    googleResponse ? JSON.stringify(googleResponse) : null,
    errorMessage
  );

  if (success) {
    // Mettre à jour le statut du review
    db.prepare(`
      UPDATE reviews
      SET status = 'replied', reply_text = ?, reply_updated_at = datetime('now')
      WHERE id = ?
    `).run(replyText, reviewId);

    // Mettre à jour le statut de la réponse IA
    if (aiResponseId) {
      db.prepare(`
        UPDATE ai_responses
        SET status = 'published', published_at = datetime('now')
        WHERE id = ?
      `).run(aiResponseId);
    }

    logAction({
      merchantId,
      action:     'response.published',
      entityType: 'review',
      entityId:   reviewId,
      details:    { publishedBy, publishedReplyId }
    });

    logger.info('[publishService] Réponse publiée avec succès', { reviewId, publishedBy });
  } else {
    logAction({
      merchantId,
      action:     'response.publish_failed',
      entityType: 'review',
      entityId:   reviewId,
      details:    { error: errorMessage, publishedBy }
    });
  }

  if (!success) {
    throw new Error(errorMessage || 'Erreur inconnue lors de la publication');
  }

  return { publishedReplyId, googleResponse };
}

module.exports = { publishReply };
