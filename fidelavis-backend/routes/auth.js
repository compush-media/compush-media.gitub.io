'use strict';
/**
 * Fidelavis – routes/auth.js
 * Authentification commerçant (JWT) + OAuth Google Business Profile
 *
 * POST /api/auth/register       Création de compte
 * POST /api/auth/login          Connexion
 * GET  /api/auth/google         Initier OAuth Google
 * GET  /api/auth/google/callback Callback OAuth Google
 * GET  /api/auth/google/accounts Lister les comptes Google connectés
 * POST /api/auth/google/disconnect Déconnecter un compte Google
 * GET  /api/auth/me             Profil du commerçant connecté
 */

const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const axios    = require('axios');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');

const router    = express.Router();
const { db, logAction } = require('../database');
const { encrypt, decrypt } = require('../services/tokenService');
const { listAccounts, listLocations } = require('../services/googleApi');
const authMiddleware = require('../middleware/auth');
const logger    = require('../utils/logger');
require('dotenv').config();

const JWT_SECRET     = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// États OAuth temporaires (en mémoire, TTL court)
const oauthStates = new Map();

function makeJWT(merchantId) {
  return jwt.sign({ merchantId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// ============================================================
// POST /api/auth/register
// ============================================================
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Mot de passe minimum 8 caractères'),
  body('name').trim().isLength({ min: 2 }).withMessage('Nom obligatoire')
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ error: 'Données invalides', details: errors.array() });
    }

    const { email, password, name } = req.body;

    // Vérifier unicité email
    const existing = db.prepare('SELECT id FROM merchants WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ error: 'Un compte existe déjà avec cet email' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const merchantId   = uuidv4();

    db.transaction(() => {
      db.prepare(`
        INSERT INTO merchants (id, email, password_hash, name)
        VALUES (?, ?, ?, ?)
      `).run(merchantId, email, passwordHash, name);

      // Paramètres IA par défaut
      db.prepare(`
        INSERT INTO merchant_settings (merchant_id, restaurant_name)
        VALUES (?, ?)
      `).run(merchantId, name);
    })();

    logAction({
      merchantId,
      action: 'merchant.registered',
      ip:     req.ip
    });

    const token = makeJWT(merchantId);
    res.status(201).json({ token, merchant: { id: merchantId, email, name } });

  } catch (err) { next(err); }
});

// ============================================================
// POST /api/auth/login
// ============================================================
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ error: 'Données invalides' });
    }

    const { email, password } = req.body;

    const merchant = db.prepare('SELECT * FROM merchants WHERE email = ?').get(email);
    if (!merchant) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    const valid = await bcrypt.compare(password, merchant.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }

    db.prepare(`
      UPDATE merchants SET last_login_at = datetime('now') WHERE id = ?
    `).run(merchant.id);

    logAction({ merchantId: merchant.id, action: 'merchant.login', ip: req.ip });

    const token = makeJWT(merchant.id);
    res.json({
      token,
      merchant: { id: merchant.id, email: merchant.email, name: merchant.name }
    });

  } catch (err) { next(err); }
});

// ============================================================
// GET /api/auth/me
// ============================================================
router.get('/me', authMiddleware, (req, res) => {
  const settings = db.prepare(
    'SELECT * FROM merchant_settings WHERE merchant_id = ?'
  ).get(req.merchant.id);

  const googleAccounts = db.prepare(`
    SELECT id, google_account_id, account_name, connected_at, last_refresh_at
    FROM google_accounts WHERE merchant_id = ?
  `).all(req.merchant.id);

  const locations = db.prepare(`
    SELECT id, location_name, address, is_primary, synced_at
    FROM locations WHERE merchant_id = ?
  `).all(req.merchant.id);

  res.json({
    merchant:  req.merchant,
    settings,
    googleAccounts,
    locations
  });
});

// ============================================================
// GET /api/auth/google  →  Initier OAuth Google
// ============================================================
router.get('/google', authMiddleware, (req, res) => {
  const state = uuidv4();
  // Stocker l'état avec le merchantId (expire dans 10 minutes)
  oauthStates.set(state, {
    merchantId: req.merchant.id,
    expiresAt:  Date.now() + 10 * 60 * 1000
  });

  // Nettoyer les vieux états
  for (const [k, v] of oauthStates.entries()) {
    if (v.expiresAt < Date.now()) oauthStates.delete(k);
  }

  const SCOPES = [
    'https://www.googleapis.com/auth/business.manage',
    'openid',
    'email',
    'profile'
  ].join(' ');

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id',     process.env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri',  process.env.GOOGLE_REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope',         SCOPES);
  authUrl.searchParams.set('state',         state);
  authUrl.searchParams.set('access_type',   'offline');   // pour avoir le refresh_token
  authUrl.searchParams.set('prompt',        'consent');   // force le refresh_token à chaque fois

  logger.info('[auth] Initiation OAuth Google', { merchantId: req.merchant.id });

  res.json({ authUrl: authUrl.toString() });
});

// ============================================================
// GET /api/auth/google/callback  →  Échange code → tokens
// ============================================================
router.get('/google/callback', async (req, res, next) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      logger.warn('[auth] OAuth refusé par l\'utilisateur', { error: oauthError });
      return res.redirect(`${process.env.FRONTEND_URL}/fidelavis-admin/connect.html?error=oauth_denied`);
    }

    // Valider le state
    const stateData = oauthStates.get(state);
    if (!stateData || stateData.expiresAt < Date.now()) {
      return res.redirect(`${process.env.FRONTEND_URL}/fidelavis-admin/connect.html?error=invalid_state`);
    }
    oauthStates.delete(state);

    const { merchantId } = stateData;

    // Échange code → tokens
    const tokenResp = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  process.env.GOOGLE_REDIRECT_URI,
      grant_type:    'authorization_code'
    });

    const { access_token, refresh_token, expires_in } = tokenResp.data;
    const tokenExpiry = new Date(Date.now() + expires_in * 1000).toISOString();

    // Récupérer les infos du compte Google
    const accountsData = await listAccounts(access_token);

    if (!accountsData || accountsData.length === 0) {
      return res.redirect(`${process.env.FRONTEND_URL}/fidelavis-admin/connect.html?error=no_gbp_account`);
    }

    const primaryAccount = accountsData[0];
    const googleAccountId = uuidv4();

    // Sauvegarder le compte Google
    db.prepare(`
      INSERT INTO google_accounts (
        id, merchant_id, google_account_id, account_name,
        access_token, refresh_token, token_expiry, scopes, connected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(merchant_id, google_account_id) DO UPDATE SET
        access_token  = excluded.access_token,
        refresh_token = excluded.refresh_token,
        token_expiry  = excluded.token_expiry,
        last_refresh_at = datetime('now')
    `).run(
      googleAccountId,
      merchantId,
      primaryAccount.name,
      primaryAccount.accountName,
      encrypt(access_token),
      encrypt(refresh_token),
      tokenExpiry,
      'business.manage'
    );

    // Récupérer les établissements et les pré-importer
    const locations = await listLocations(access_token, primaryAccount.name);

    db.transaction(() => {
      for (const loc of locations) {
        const locId = uuidv4();
        db.prepare(`
          INSERT INTO locations (
            id, merchant_id, account_id, google_location_id,
            location_name, address, phone, website
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(merchant_id, google_location_id) DO UPDATE SET
            location_name = excluded.location_name,
            address       = excluded.address
        `).run(
          locId, merchantId, googleAccountId,
          loc.name, loc.title,
          loc.address, loc.phone, loc.website
        );
      }
    })();

    logAction({
      merchantId,
      action:     'google.connected',
      entityType: 'google_account',
      entityId:   googleAccountId,
      details:    { accountName: primaryAccount.accountName, locationsCount: locations.length }
    });

    logger.info('[auth] Compte Google connecté', {
      merchantId,
      accountName:     primaryAccount.accountName,
      locationsCount:  locations.length
    });

    // Rediriger vers le front avec succès
    res.redirect(`${process.env.FRONTEND_URL}/fidelavis-admin/?connected=1&locations=${locations.length}`);

  } catch (err) {
    logger.error('[auth] Erreur callback OAuth', { error: err.message });
    res.redirect(`${process.env.FRONTEND_URL}/fidelavis-admin/connect.html?error=callback_error`);
  }
});

// ============================================================
// GET /api/auth/google/locations  →  Lister les fiches connectées
// ============================================================
router.get('/google/locations', authMiddleware, (req, res) => {
  const locations = db.prepare(`
    SELECT l.*, ga.account_name
    FROM locations l
    JOIN google_accounts ga ON ga.id = l.account_id
    WHERE l.merchant_id = ?
    ORDER BY l.is_primary DESC, l.location_name
  `).all(req.merchant.id);

  res.json({ locations });
});

// ============================================================
// POST /api/auth/google/locations/:id/select
// ============================================================
router.post('/google/locations/:id/select', authMiddleware, (req, res) => {
  const { id } = req.params;

  // Vérifier appartenance
  const loc = db.prepare(
    'SELECT id FROM locations WHERE id = ? AND merchant_id = ?'
  ).get(id, req.merchant.id);

  if (!loc) return res.status(404).json({ error: 'Établissement introuvable' });

  db.transaction(() => {
    db.prepare('UPDATE locations SET is_primary = 0 WHERE merchant_id = ?').run(req.merchant.id);
    db.prepare('UPDATE locations SET is_primary = 1 WHERE id = ?').run(id);
  })();

  res.json({ success: true });
});

// ============================================================
// POST /api/auth/google/disconnect
// ============================================================
router.post('/google/disconnect', authMiddleware, (req, res, next) => {
  try {
    const { googleAccountId } = req.body;

    const account = db.prepare(
      'SELECT id FROM google_accounts WHERE id = ? AND merchant_id = ?'
    ).get(googleAccountId, req.merchant.id);

    if (!account) return res.status(404).json({ error: 'Compte Google introuvable' });

    db.prepare('DELETE FROM google_accounts WHERE id = ?').run(googleAccountId);

    logAction({
      merchantId: req.merchant.id,
      action:     'google.disconnected',
      entityId:   googleAccountId
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
