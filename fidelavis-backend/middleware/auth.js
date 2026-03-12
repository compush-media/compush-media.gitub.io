'use strict';
/**
 * Fidelavis – middleware/auth.js
 * Vérification JWT pour les routes protégées
 */

const jwt    = require('jsonwebtoken');
const { db } = require('../database');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

module.exports = function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant ou invalide' });
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, JWT_SECRET);

    // Vérifier que le commerçant existe toujours
    const merchant = db.prepare(
      'SELECT id, email, name FROM merchants WHERE id = ?'
    ).get(payload.merchantId);

    if (!merchant) {
      return res.status(401).json({ error: 'Compte introuvable' });
    }

    req.merchant = merchant;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expirée, veuillez vous reconnecter' });
    }
    return res.status(401).json({ error: 'Token invalide' });
  }
};
