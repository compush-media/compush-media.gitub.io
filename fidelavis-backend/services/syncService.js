'use strict';
/**
 * Fidelavis – services/syncService.js
 * Synchronisation des avis Google → base de données Fidelavis
 * Gère la détection de nouveaux avis, les mises à jour, le mode auto-réponse
 */

const { v4: uuidv4 }            = require('uuid');
const { db, logAction }         = require('../database');
const { getValidAccessToken }   = require('./tokenService');
const { listAllReviews }        = require('./googleApi');
const { generateResponse, classifyReview, getAutoReplyAction } = require('./aiService');
const publishService            = require('./publishService');
const logger                    = require('../utils/logger');

// ============================================================
// Synchroniser les avis d'un établissement
// ============================================================
async function syncLocationReviews(locationId) {
  const location = db.prepare(`
    SELECT l.*, ga.id AS ga_id, ga.merchant_id
    FROM locations l
    JOIN google_accounts ga ON ga.id = l.account_id
    WHERE l.id = ?
  `).get(locationId);

  if (!location) throw new Error('Établissement introuvable : ' + locationId);

  // Créer un job de sync
  const jobId = uuidv4();
  db.prepare(`
    INSERT INTO sync_jobs (id, merchant_id, location_id, status)
    VALUES (?, ?, ?, 'running')
  `).run(jobId, location.merchant_id, locationId);

  let reviewsNew = 0;

  try {
    // Récupérer le token valide (auto-refresh si nécessaire)
    const accessToken = await getValidAccessToken(location.ga_id);

    // Récupérer tous les avis Google
    const googleReviews = await listAllReviews(accessToken, location.google_location_id);
    const total         = googleReviews.length;

    logger.info('[syncService] Avis Google récupérés', {
      locationId,
      locationName: location.location_name,
      count: total
    });

    // Paramètres IA du commerçant
    const settings = db.prepare(
      'SELECT * FROM merchant_settings WHERE merchant_id = ?'
    ).get(location.merchant_id);

    // Traiter chaque avis
    const upsertReview = db.prepare(`
      INSERT INTO reviews (
        id, merchant_id, location_id, google_review_id,
        reviewer_name, reviewer_photo, rating, comment,
        published_at, updated_at_google,
        reply_text, reply_updated_at, status, tags, is_new
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(google_review_id) DO UPDATE SET
        rating         = excluded.rating,
        comment        = excluded.comment,
        updated_at_google = excluded.updated_at_google,
        reply_text     = excluded.reply_text,
        reply_updated_at = excluded.reply_updated_at,
        last_sync_at   = datetime('now'),
        status = CASE
          WHEN excluded.reply_text IS NOT NULL THEN 'replied'
          ELSE reviews.status
        END
    `);

    const processAll = db.transaction(async (reviews) => {
      for (const r of reviews) {
        const existing = db.prepare(
          'SELECT id, is_new FROM reviews WHERE google_review_id = ?'
        ).get(r.googleReviewId);

        const isNew    = !existing ? 1 : 0;
        const tags     = classifyReview(r);
        const status   = r.replyText ? 'replied' : (existing?.status || 'pending');
        const reviewId = existing?.id || uuidv4();

        upsertReview.run(
          reviewId,
          location.merchant_id,
          locationId,
          r.googleReviewId,
          r.reviewerName,
          r.reviewerPhoto,
          r.rating,
          r.comment,
          r.publishedAt,
          r.updatedAt,
          r.replyText,
          r.replyUpdatedAt,
          status,
          JSON.stringify(tags),
          isNew
        );

        if (isNew) {
          reviewsNew++;
          logAction({
            merchantId: location.merchant_id,
            action:     'review.new',
            entityType: 'review',
            entityId:   reviewId,
            details:    { rating: r.rating, hasComment: !!r.comment }
          });
        }
      }
    });

    // Exécuter le transaction (synchrone pour better-sqlite3)
    // Note: on gère l'async du traitement IA séparément
    db.transaction(() => {
      for (const r of googleReviews) {
        const existing = db.prepare(
          'SELECT id, status FROM reviews WHERE google_review_id = ?'
        ).get(r.googleReviewId);

        const isNew    = !existing ? 1 : 0;
        const tags     = classifyReview(r);
        const status   = r.replyText ? 'replied' : (existing?.status || 'pending');
        const reviewId = existing?.id || uuidv4();

        upsertReview.run(
          reviewId,
          location.merchant_id,
          locationId,
          r.googleReviewId,
          r.reviewerName,
          r.reviewerPhoto,
          r.rating,
          r.comment,
          r.publishedAt,
          r.updatedAt,
          r.replyText,
          r.replyUpdatedAt,
          status,
          JSON.stringify(tags),
          isNew
        );

        if (isNew) reviewsNew++;
      }
    })();

    // Mettre à jour la date de sync de l'établissement
    db.prepare(`
      UPDATE locations SET synced_at = datetime('now') WHERE id = ?
    `).run(locationId);

    // Mettre à jour le job
    db.prepare(`
      UPDATE sync_jobs
      SET status = 'success', reviews_found = ?, reviews_new = ?, finished_at = datetime('now')
      WHERE id = ?
    `).run(total, reviewsNew, jobId);

    logAction({
      merchantId: location.merchant_id,
      action:     'sync.completed',
      entityType: 'location',
      entityId:   locationId,
      details:    { total, reviewsNew }
    });

    // Traitement IA asynchrone pour les nouveaux avis (ne bloque pas la sync)
    if (reviewsNew > 0 && settings) {
      processNewReviewsIA(location.merchant_id, locationId, settings).catch(err => {
        logger.error('[syncService] Erreur traitement IA post-sync', { error: err.message });
      });
    }

    return { total, reviewsNew, jobId };

  } catch (err) {
    logger.error('[syncService] Erreur sync', { locationId, error: err.message });

    db.prepare(`
      UPDATE sync_jobs
      SET status = 'error', error_message = ?, finished_at = datetime('now')
      WHERE id = ?
    `).run(err.message, jobId);

    throw err;
  }
}

// ============================================================
// Traiter les nouveaux avis avec l'IA + auto-réponse
// ============================================================
async function processNewReviewsIA(merchantId, locationId, settings) {
  const newReviews = db.prepare(`
    SELECT r.*, l.google_location_id, ga.id AS ga_id
    FROM reviews r
    JOIN locations l ON l.id = r.location_id
    JOIN google_accounts ga ON ga.id = l.account_id
    WHERE r.merchant_id = ?
      AND r.location_id = ?
      AND r.status = 'pending'
      AND r.is_new = 1
    ORDER BY r.published_at DESC
    LIMIT 20
  `).all(merchantId, locationId);

  if (newReviews.length === 0) return;

  logger.info('[syncService] Traitement IA de nouveaux avis', {
    merchantId,
    count: newReviews.length
  });

  for (const review of newReviews) {
    try {
      // Générer la réponse IA
      const aiResult = await generateResponse(
        {
          id:           review.id,
          rating:       review.rating,
          comment:      review.comment,
          reviewerName: review.reviewer_name
        },
        settings
      );

      const aiResponseId = uuidv4();

      // Sauvegarder la réponse IA
      db.prepare(`
        INSERT INTO ai_responses (
          id, review_id, merchant_id, response_text,
          model_used, prompt_tokens, output_tokens, generation_ms, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')
      `).run(
        aiResponseId,
        review.id,
        merchantId,
        aiResult.responseText,
        aiResult.modelUsed,
        aiResult.promptTokens,
        aiResult.outputTokens,
        aiResult.generationMs
      );

      // Mettre à jour les tags du review
      db.prepare(`
        UPDATE reviews SET tags = ?, is_new = 0 WHERE id = ?
      `).run(JSON.stringify(aiResult.tags), review.id);

      // Vérifier la règle d'auto-réponse
      const action = getAutoReplyAction(review.rating, settings);

      if (action === 'auto') {
        // Publication automatique
        logger.info('[syncService] Auto-réponse déclenchée', { reviewId: review.id });

        try {
          const accessToken = await getValidAccessToken(review.ga_id);
          await publishService.publishReply({
            reviewId:      review.id,
            aiResponseId,
            merchantId,
            replyText:     aiResult.responseText,
            accessToken,
            googleReviewId: review.google_review_id,
            publishedBy:   'auto'
          });
        } catch (pubErr) {
          logger.error('[syncService] Échec auto-réponse', {
            reviewId: review.id,
            error:    pubErr.message
          });
        }
      }

    } catch (err) {
      logger.error('[syncService] Erreur IA pour avis', {
        reviewId: review.id,
        error:    err.message
      });
    }
  }
}

// ============================================================
// Synchroniser TOUS les établissements actifs d'un commerçant
// ============================================================
async function syncAllLocations(merchantId) {
  const locations = db.prepare(`
    SELECT l.id FROM locations l
    JOIN google_accounts ga ON ga.id = l.account_id
    WHERE l.merchant_id = ?
  `).all(merchantId);

  const results = [];
  for (const loc of locations) {
    try {
      const r = await syncLocationReviews(loc.id);
      results.push({ locationId: loc.id, ...r });
    } catch (err) {
      results.push({ locationId: loc.id, error: err.message });
    }
  }
  return results;
}

module.exports = { syncLocationReviews, syncAllLocations, processNewReviewsIA };
