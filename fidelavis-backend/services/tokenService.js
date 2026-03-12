'use strict';
/**
 * Fidelavis – services/tokenService.js
 * Chiffrement / déchiffrement AES-256 des tokens OAuth
 * + Refresh automatique du access_token Google
 */

const CryptoJS = require('crypto-js');
const axios    = require('axios');
const { db }   = require('../database');
const logger   = require('../utils/logger');
require('dotenv').config();

const ENC_KEY = process.env.ENCRYPTION_KEY;
if (!ENC_KEY || ENC_KEY.length < 32) {
  console.error('[tokenService] ENCRYPTION_KEY manquante ou trop courte (min 32 chars) dans .env');
}

// ============================================================
// Chiffrement / déchiffrement
// ============================================================

function encrypt(plainText) {
  if (!plainText) return null;
  return CryptoJS.AES.encrypt(plainText, ENC_KEY).toString();
}

function decrypt(cipherText) {
  if (!cipherText) return null;
  try {
    const bytes = CryptoJS.AES.decrypt(cipherText, ENC_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (e) {
    logger.error('[tokenService] Erreur déchiffrement token', { error: e.message });
    return null;
  }
}

// ============================================================
// Récupération d'un access token valide (avec refresh si nécessaire)
// ============================================================

async function getValidAccessToken(googleAccountId) {
  const account = db.prepare(
    'SELECT * FROM google_accounts WHERE id = ?'
  ).get(googleAccountId);

  if (!account) throw new Error('Compte Google introuvable : ' + googleAccountId);

  const expiryDate = account.token_expiry ? new Date(account.token_expiry) : null;
  const now        = new Date();
  const BUFFER_MS  = 5 * 60 * 1000; // Rafraîchit 5 min avant l'expiration

  // Token encore valide
  if (expiryDate && (expiryDate.getTime() - now.getTime()) > BUFFER_MS) {
    return decrypt(account.access_token);
  }

  // Rafraîchissement nécessaire
  logger.info('[tokenService] Rafraîchissement du token pour account', { googleAccountId });

  const refreshToken = decrypt(account.refresh_token);
  if (!refreshToken) throw new Error('Refresh token manquant ou corrompu');

  try {
    const resp = await axios.post('https://oauth2.googleapis.com/token', {
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token'
    });

    const { access_token, expires_in } = resp.data;
    const newExpiry = new Date(Date.now() + expires_in * 1000).toISOString();

    db.prepare(`
      UPDATE google_accounts
      SET access_token = ?, token_expiry = ?, last_refresh_at = datetime('now')
      WHERE id = ?
    `).run(encrypt(access_token), newExpiry, googleAccountId);

    logger.info('[tokenService] Token rafraîchi', { googleAccountId, expiresAt: newExpiry });
    return access_token;

  } catch (err) {
    const msg = err.response?.data?.error_description || err.message;
    logger.error('[tokenService] Échec refresh token', { googleAccountId, error: msg });
    throw new Error('Impossible de rafraîchir le token Google : ' + msg);
  }
}

module.exports = { encrypt, decrypt, getValidAccessToken };
