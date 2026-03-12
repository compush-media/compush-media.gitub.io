'use strict';
/**
 * Fidelavis – routes/responses.js
 * Génération et publication des réponses IA
 *
 * POST /api/responses/generate/:reviewId  Générer une réponse IA
 * PUT  /api/responses/:id/edit            Modifier une réponse
 * POST /api/responses/:id/approve         Approuver une réponse
 * POST /api/responses/:id/publish         Publier une réponse
 * POST /api/responses/publish-direct/:reviewId  Générer + publier en une fois
 */

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db, logAction } = require('../database');
const authMiddleware    = require('../middleware/auth');
const { generateResponse } = require('../services/aiService');
const { getValidAccessToken } = require('../services/tokenService');
const { publishReply }  = require('../services/publishService');
const logger = require('../utils/logger');

router.use(authMiddleware);

// ============================================================
// POST /api/responses/generate/:reviewId
// ============================================================
router.post('/generate/:reviewId', async (req, res, next) => {
  try {
    const review = db.prepare(`
      SELECT r.*, ga.id AS ga_id
      FROM reviews r
      JOIN locations l ON l.id = r.location_id
      JOIN google_accounts ga ON ga.id = l.account_id
      WHERE r.id = ? AND r.merchant_id = ?
    `).get(req.params.reviewId, req.merchant.id);

    if (!review) return res.status(404).json({ error: 'Avis introuvable' });

    const settings = db.prepare(
      'SELECT * FROM merchant_settings WHERE merchant_id = ?'
    ).get(req.merchant.id);

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

    db.prepare(`
      INSERT INTO ai_responses (
        id, review_id, merchant_id, response_text,
        model_used, prompt_tokens, output_tokens, generation_ms, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `).run(
      aiResponseId,
      review.id,
      req.merchant.id,
      aiResult.responseText,
      aiResult.modelUsed,
      aiResult.promptTokens,
      aiResult.outputTokens,
      aiResult.generationMs
    );

    // Mettre à jour les tags
    db.prepare('UPDATE reviews SET tags = ?, is_new = 0 WHERE id = ?')
      .run(JSON.stringify(aiResult.tags), review.id);

    logAction({
      merchantId: req.merchant.id,
      action:     'response.generated',
      entityType: 'review',
      entityId:   review.id,
      details:    { aiResponseId, model: aiResult.modelUsed }
    });

    res.json({
      aiResponseId,
      responseText:  aiResult.responseText,
      modelUsed:     aiResult.modelUsed,
      generationMs:  aiResult.generationMs,
      tags:          aiResult.tags
    });

  } catch (err) { next(err); }
});

// ============================================================
// PUT /api/responses/:id/edit  →  Modifier la réponse IA
// ============================================================
router.put('/:id/edit', (req, res, next) => {
  try {
    const { editedText } = req.body;
    if (!editedText?.trim()) return res.status(422).json({ error: 'Texte vide' });

    const aiResp = db.prepare(
      'SELECT id FROM ai_responses WHERE id = ? AND merchant_id = ?'
    ).get(req.params.id, req.merchant.id);

    if (!aiResp) return res.status(404).json({ error: 'Réponse introuvable' });

    db.prepare(`
      UPDATE ai_responses SET edited_text = ?, status = 'draft' WHERE id = ?
    `).run(editedText.trim(), req.params.id);

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/responses/:id/approve  →  Approuver (sans publier)
// ============================================================
router.post('/:id/approve', (req, res, next) => {
  try {
    const aiResp = db.prepare(
      'SELECT id FROM ai_responses WHERE id = ? AND merchant_id = ?'
    ).get(req.params.id, req.merchant.id);

    if (!aiResp) return res.status(404).json({ error: 'Réponse introuvable' });

    db.prepare(`
      UPDATE ai_responses SET status = 'approved', approved_at = datetime('now')
      WHERE id = ?
    `).run(req.params.id);

    logAction({
      merchantId: req.merchant.id,
      action:     'response.approved',
      entityId:   req.params.id
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/responses/:id/publish  →  Publier sur Google
// ============================================================
router.post('/:id/publish', async (req, res, next) => {
  try {
    const aiResp = db.prepare(`
      SELECT ar.*, r.google_review_id, r.id AS review_id,
             ga.id AS ga_id
      FROM ai_responses ar
      JOIN reviews r ON r.id = ar.review_id
      JOIN locations l ON l.id = r.location_id
      JOIN google_accounts ga ON ga.id = l.account_id
      WHERE ar.id = ? AND ar.merchant_id = ?
    `).get(req.params.id, req.merchant.id);

    if (!aiResp) return res.status(404).json({ error: 'Réponse introuvable' });

    if (['published', 'rejected'].includes(aiResp.status)) {
      return res.status(409).json({ error: `Réponse déjà ${aiResp.status}` });
    }

    // Utiliser le texte modifié si disponible, sinon le texte original
    const replyText = (aiResp.edited_text || aiResp.response_text).trim();
    if (!replyText) return res.status(422).json({ error: 'Texte de réponse vide' });

    const accessToken = await getValidAccessToken(aiResp.ga_id);

    const result = await publishReply({
      reviewId:       aiResp.review_id,
      aiResponseId:   aiResp.id,
      merchantId:     req.merchant.id,
      replyText,
      accessToken,
      googleReviewId: aiResp.google_review_id,
      publishedBy:    'manual'
    });

    res.json({ success: true, publishedReplyId: result.publishedReplyId });

  } catch (err) {
    if (err.message === 'TOKEN_EXPIRED') {
      return res.status(401).json({ error: 'Session Google expirée, veuillez reconnecter votre compte' });
    }
    next(err);
  }
});

// ============================================================
// POST /api/responses/publish-direct/:reviewId
// Générer + publier en une seule action
// ============================================================
router.post('/publish-direct/:reviewId', async (req, res, next) => {
  try {
    const review = db.prepare(`
      SELECT r.*, ga.id AS ga_id
      FROM reviews r
      JOIN locations l ON l.id = r.location_id
      JOIN google_accounts ga ON ga.id = l.account_id
      WHERE r.id = ? AND r.merchant_id = ?
    `).get(req.params.reviewId, req.merchant.id);

    if (!review) return res.status(404).json({ error: 'Avis introuvable' });

    const settings = db.prepare(
      'SELECT * FROM merchant_settings WHERE merchant_id = ?'
    ).get(req.merchant.id);

    // Générer
    const aiResult = await generateResponse(
      { id: review.id, rating: review.rating, comment: review.comment, reviewerName: review.reviewer_name },
      settings
    );

    const aiResponseId = uuidv4();
    db.prepare(`
      INSERT INTO ai_responses (
        id, review_id, merchant_id, response_text,
        model_used, prompt_tokens, output_tokens, generation_ms, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')
    `).run(
      aiResponseId, review.id, req.merchant.id,
      aiResult.responseText, aiResult.modelUsed,
      aiResult.promptTokens, aiResult.outputTokens, aiResult.generationMs
    );

    // Publier
    const accessToken = await getValidAccessToken(review.ga_id);

    const result = await publishReply({
      reviewId:       review.id,
      aiResponseId,
      merchantId:     req.merchant.id,
      replyText:      aiResult.responseText,
      accessToken,
      googleReviewId: review.google_review_id,
      publishedBy:    'manual'
    });

    res.json({
      success:         true,
      responseText:    aiResult.responseText,
      aiResponseId,
      publishedReplyId: result.publishedReplyId
    });

  } catch (err) { next(err); }
});

// ============================================================
// POST /api/responses/:id/reject  →  Rejeter une réponse IA
// ============================================================
router.post('/:id/reject', (req, res, next) => {
  try {
    db.prepare(`
      UPDATE ai_responses SET status = 'rejected' WHERE id = ? AND merchant_id = ?
    `).run(req.params.id, req.merchant.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
