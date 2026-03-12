'use strict';
/**
 * Fidelavis – middleware/errorHandler.js
 * Gestionnaire d'erreurs centralisé
 * Aucune fuite d'info sensible en production
 */

const logger = require('../utils/logger');

module.exports = function errorHandler(err, req, res, next) {
  const isProd  = process.env.NODE_ENV === 'production';
  const status  = err.status || err.statusCode || 500;
  const message = err.message || 'Erreur interne du serveur';

  // Toujours logger l'erreur complète côté serveur
  logger.error('[errorHandler]', {
    status,
    message,
    stack:  isProd ? undefined : err.stack,
    path:   req.path,
    method: req.method,
    ip:     req.ip
  });

  // Réponse client : jamais de stack trace en production
  res.status(status).json({
    error:   status >= 500 && isProd ? 'Erreur interne du serveur' : message,
    ...(status < 500 && err.details ? { details: err.details } : {})
  });
};
