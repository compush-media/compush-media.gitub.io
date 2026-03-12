'use strict';
/**
 * Fidelavis – routes/reviews.js
 * Gestion des avis Google importés
 *
 * GET  /api/reviews              Liste paginée des avis
 * GET  /api/reviews/stats        Statistiques dashboard
 * GET  /api/reviews/:id          Détail d'un avis
 * POST /api/reviews/sync         Déclencher une sync manuelle
 * POST /api/reviews/:id/ignore   Ignorer un avis
 * POST /api/reviews/:id/mark-read Marquer comme lu (is_new = 0)
 */

const express = require('express');
const router  = express.Router();
const { db, logAction } = require('../database');
const authMiddleware    = require('../middleware/auth');
const { syncAllLocations, syncLocationReviews } = require('../services/syncService');
const logger = require('../utils/logger');

// Toutes les routes nécessitent d'être connecté
router.use(authMiddleware);

// ============================================================
// GET /api/reviews  →  Liste paginée des avis
// ============================================================
router.get('/', (req, res, next) => {
  try {
    const {
      page     = 1,
      limit    = 20,
      status,        // pending|replied|ignored
      rating,        // 1-5
      location_id,
      tag,           // filtre par tag
      search,        // recherche texte
      sort     = 'published_at',
      order    = 'desc'
    } = req.query;

    const offset = (Math.max(1, parseInt(page)) - 1) * Math.min(50, parseInt(limit) || 20);
    const lim    = Math.min(50, parseInt(limit) || 20);

    // Construction dynamique de la requête
    const conditions = ['r.merchant_id = ?'];
    const params     = [req.merchant.id];

    if (status)      { conditions.push('r.status = ?');      params.push(status); }
    if (rating)      { conditions.push('r.rating = ?');      params.push(parseInt(rating)); }
    if (location_id) { conditions.push('r.location_id = ?'); params.push(location_id); }
    if (tag)         { conditions.push("json_each.value = ?"); }
    if (search)      {
      conditions.push("(r.reviewer_name LIKE ? OR r.comment LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }

    const allowedSorts  = ['published_at', 'rating', 'imported_at'];
    const allowedOrders = ['asc', 'desc'];
    const safeSort  = allowedSorts.includes(sort)   ? sort   : 'published_at';
    const safeOrder = allowedOrders.includes(order) ? order  : 'desc';

    // Join avec json_each pour le filtre par tag
    const fromClause = tag
      ? `FROM reviews r, json_each(r.tags)`
      : `FROM reviews r`;

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    if (tag) params.push(tag);

    const countRow = db.prepare(
      `SELECT COUNT(DISTINCT r.id) AS total ${fromClause} ${whereClause}`
    ).get(...params);

    const reviews = db.prepare(`
      SELECT
        r.id, r.google_review_id, r.reviewer_name, r.reviewer_photo,
        r.rating, r.comment, r.published_at, r.status, r.tags, r.is_new,
        r.reply_text, r.reply_updated_at, r.last_sync_at,
        l.location_name,
        (SELECT response_text FROM ai_responses WHERE review_id = r.id ORDER BY created_at DESC LIMIT 1) AS ai_draft
      ${fromClause}
      LEFT JOIN locations l ON l.id = r.location_id
      ${whereClause}
      GROUP BY r.id
      ORDER BY r.${safeSort} ${safeOrder.toUpperCase()}
      LIMIT ? OFFSET ?
    `).all(...params, lim, offset);

    // Parser les tags JSON
    const reviewsParsed = reviews.map(r => ({
      ...r,
      tags: (() => { try { return JSON.parse(r.tags || '[]'); } catch { return []; } })()
    }));

    res.json({
      reviews: reviewsParsed,
      pagination: {
        page:    parseInt(page),
        limit:   lim,
        total:   countRow?.total || 0,
        pages:   Math.ceil((countRow?.total || 0) / lim)
      }
    });

  } catch (err) { next(err); }
});

// ============================================================
// GET /api/reviews/stats  →  Dashboard stats
// ============================================================
router.get('/stats', (req, res, next) => {
  try {
    const mid = req.merchant.id;

    const total = db.prepare(
      'SELECT COUNT(*) AS n FROM reviews WHERE merchant_id = ?'
    ).get(mid);

    const pending = db.prepare(
      "SELECT COUNT(*) AS n FROM reviews WHERE merchant_id = ? AND status = 'pending'"
    ).get(mid);

    const replied = db.prepare(
      "SELECT COUNT(*) AS n FROM reviews WHERE merchant_id = ? AND status = 'replied'"
    ).get(mid);

    const newReviews = db.prepare(
      'SELECT COUNT(*) AS n FROM reviews WHERE merchant_id = ? AND is_new = 1'
    ).get(mid);

    const avgRating = db.prepare(
      'SELECT ROUND(AVG(rating), 1) AS avg FROM reviews WHERE merchant_id = ?'
    ).get(mid);

    const byRating = db.prepare(`
      SELECT rating, COUNT(*) AS count
      FROM reviews WHERE merchant_id = ?
      GROUP BY rating ORDER BY rating DESC
    `).all(mid);

    const recent = db.prepare(`
      SELECT id, reviewer_name, rating, comment, published_at, status, tags
      FROM reviews WHERE merchant_id = ?
      ORDER BY published_at DESC LIMIT 5
    `).all(mid).map(r => ({
      ...r,
      tags: (() => { try { return JSON.parse(r.tags || '[]'); } catch { return []; } })()
    }));

    const lastSync = db.prepare(`
      SELECT finished_at, status FROM sync_jobs
      WHERE merchant_id = ? AND status = 'success'
      ORDER BY finished_at DESC LIMIT 1
    `).get(mid);

    const location = db.prepare(`
      SELECT location_name, address, synced_at, is_primary
      FROM locations WHERE merchant_id = ? AND is_primary = 1 LIMIT 1
    `).get(mid) || db.prepare(
      'SELECT location_name, address, synced_at FROM locations WHERE merchant_id = ? LIMIT 1'
    ).get(mid);

    const googleConnected = !!db.prepare(
      'SELECT id FROM google_accounts WHERE merchant_id = ? LIMIT 1'
    ).get(mid);

    const autoReplySettings = db.prepare(
      'SELECT auto_reply_enabled FROM merchant_settings WHERE merchant_id = ?'
    ).get(mid);

    res.json({
      googleConnected,
      autoReplyEnabled: !!autoReplySettings?.auto_reply_enabled,
      location: location || null,
      lastSync:  lastSync?.finished_at || null,
      stats: {
        total:      total?.n      || 0,
        pending:    pending?.n    || 0,
        replied:    replied?.n    || 0,
        newReviews: newReviews?.n || 0,
        avgRating:  avgRating?.avg || null,
        byRating
      },
      recentReviews: recent
    });

  } catch (err) { next(err); }
});

// ============================================================
// GET /api/reviews/:id  →  Détail d'un avis avec réponse IA
// ============================================================
router.get('/:id', (req, res, next) => {
  try {
    const review = db.prepare(`
      SELECT r.*, l.location_name, l.google_location_id, ga.id AS ga_id
      FROM reviews r
      JOIN locations l ON l.id = r.location_id
      JOIN google_accounts ga ON ga.id = l.account_id
      WHERE r.id = ? AND r.merchant_id = ?
    `).get(req.params.id, req.merchant.id);

    if (!review) return res.status(404).json({ error: 'Avis introuvable' });

    const aiResponses = db.prepare(`
      SELECT id, response_text, edited_text, status, model_used,
             generation_ms, created_at, approved_at, published_at
      FROM ai_responses
      WHERE review_id = ?
      ORDER BY created_at DESC
    `).all(req.params.id);

    review.tags = (() => { try { return JSON.parse(review.tags || '[]'); } catch { return []; } })();

    res.json({ review, aiResponses });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/reviews/sync  →  Sync manuelle
// ============================================================
router.post('/sync', async (req, res, next) => {
  try {
    const { locationId } = req.body;

    if (locationId) {
      // Sync d'un seul établissement
      const loc = db.prepare(
        'SELECT id FROM locations WHERE id = ? AND merchant_id = ?'
      ).get(locationId, req.merchant.id);
      if (!loc) return res.status(404).json({ error: 'Établissement introuvable' });

      const result = await syncLocationReviews(locationId);
      return res.json({ success: true, result });
    }

    // Sync de tous les établissements
    const results = await syncAllLocations(req.merchant.id);
    res.json({ success: true, results });

  } catch (err) { next(err); }
});

// ============================================================
// POST /api/reviews/:id/ignore
// ============================================================
router.post('/:id/ignore', (req, res, next) => {
  try {
    const review = db.prepare(
      'SELECT id FROM reviews WHERE id = ? AND merchant_id = ?'
    ).get(req.params.id, req.merchant.id);
    if (!review) return res.status(404).json({ error: 'Avis introuvable' });

    db.prepare("UPDATE reviews SET status = 'ignored', is_new = 0 WHERE id = ?").run(req.params.id);

    logAction({
      merchantId: req.merchant.id,
      action:     'review.ignored',
      entityType: 'review',
      entityId:   req.params.id
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/reviews/:id/mark-read
// ============================================================
router.post('/:id/mark-read', (req, res, next) => {
  try {
    db.prepare(
      'UPDATE reviews SET is_new = 0 WHERE id = ? AND merchant_id = ?'
    ).run(req.params.id, req.merchant.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
