'use strict';
/**
 * Fidelavis – routes/settings.js
 * Paramètres commerçant : IA, auto-réponse, ton, signature
 *
 * GET  /api/settings            Récupérer les paramètres
 * PUT  /api/settings            Mettre à jour les paramètres
 * GET  /api/settings/logs       Historique des actions
 * GET  /api/settings/sync-jobs  Historique des synchronisations
 */

const express = require('express');
const router  = express.Router();
const { body, validationResult } = require('express-validator');
const { db, logAction } = require('../database');
const authMiddleware    = require('../middleware/auth');

router.use(authMiddleware);

// ============================================================
// GET /api/settings
// ============================================================
router.get('/', (req, res, next) => {
  try {
    const settings = db.prepare(
      'SELECT * FROM merchant_settings WHERE merchant_id = ?'
    ).get(req.merchant.id);

    res.json({ settings: settings || {} });
  } catch (err) { next(err); }
});

// ============================================================
// PUT /api/settings  →  Mettre à jour tous les paramètres
// ============================================================
router.put('/', [
  body('restaurant_name').optional().trim().isLength({ max: 100 }),
  body('owner_name').optional().trim().isLength({ max: 100 }),
  body('response_tone').optional().isIn(['warm', 'professional', 'formal']),
  body('signature').optional().trim().isLength({ max: 200 }),
  body('return_phrase').optional().trim().isLength({ max: 300 }),
  body('contact_phrase').optional().trim().isLength({ max: 300 }),
  body('auto_reply_enabled').optional().isBoolean(),
  body('auto_reply_rule_5').optional().isIn(['auto', 'validate', 'disabled']),
  body('auto_reply_rule_4').optional().isIn(['auto', 'validate', 'disabled']),
  body('auto_reply_rule_3').optional().isIn(['auto', 'validate', 'disabled']),
  body('auto_reply_rule_2').optional().isIn(['auto', 'validate', 'disabled']),
  body('auto_reply_rule_1').optional().isIn(['auto', 'validate', 'disabled'])
], (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ error: 'Données invalides', details: errors.array() });
    }

    const allowed = [
      'restaurant_name', 'owner_name', 'response_tone', 'signature',
      'return_phrase', 'contact_phrase', 'auto_reply_enabled',
      'auto_reply_rule_5', 'auto_reply_rule_4', 'auto_reply_rule_3',
      'auto_reply_rule_2', 'auto_reply_rule_1'
    ];

    const fields  = {};
    const updates = [];
    const values  = [];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        fields[key] = req.body[key];
        updates.push(`${key} = ?`);
        // Convertir booléen
        values.push(typeof req.body[key] === 'boolean' ? (req.body[key] ? 1 : 0) : req.body[key]);
      }
    }

    if (updates.length === 0) {
      return res.status(422).json({ error: 'Aucun champ valide fourni' });
    }

    updates.push("updated_at = datetime('now')");

    db.prepare(`
      INSERT INTO merchant_settings (merchant_id) VALUES (?)
      ON CONFLICT(merchant_id) DO UPDATE SET ${updates.join(', ')}
    `).run(req.merchant.id, ...values);

    logAction({
      merchantId: req.merchant.id,
      action:     'settings.updated',
      details:    { fields: Object.keys(fields) }
    });

    const updated = db.prepare(
      'SELECT * FROM merchant_settings WHERE merchant_id = ?'
    ).get(req.merchant.id);

    res.json({ success: true, settings: updated });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/settings/logs  →  Journal des actions
// ============================================================
router.get('/logs', (req, res, next) => {
  try {
    const { page = 1, limit = 30, action } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * Math.min(100, parseInt(limit) || 30);
    const lim    = Math.min(100, parseInt(limit) || 30);

    const conditions = ['merchant_id = ?'];
    const params     = [req.merchant.id];

    if (action) { conditions.push('action = ?'); params.push(action); }

    const total = db.prepare(
      `SELECT COUNT(*) AS n FROM action_logs WHERE ${conditions.join(' AND ')}`
    ).get(...params);

    const logs = db.prepare(`
      SELECT id, action, entity_type, entity_id, details, created_at
      FROM action_logs
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, lim, offset).map(l => ({
      ...l,
      details: (() => { try { return JSON.parse(l.details); } catch { return {}; } })()
    }));

    res.json({ logs, total: total?.n || 0 });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/settings/sync-jobs  →  Historique sync
// ============================================================
router.get('/sync-jobs', (req, res, next) => {
  try {
    const jobs = db.prepare(`
      SELECT sj.id, sj.status, sj.reviews_found, sj.reviews_new,
             sj.error_message, sj.started_at, sj.finished_at,
             l.location_name
      FROM sync_jobs sj
      LEFT JOIN locations l ON l.id = sj.location_id
      WHERE sj.merchant_id = ?
      ORDER BY sj.started_at DESC
      LIMIT 20
    `).all(req.merchant.id);

    res.json({ jobs });
  } catch (err) { next(err); }
});

module.exports = router;
