'use strict';
/**
 * Fidelavis – server.js
 * Point d'entrée principal de l'application Express
 */

require('dotenv').config();

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const morgan       = require('morgan');
const rateLimit    = require('express-rate-limit');
const path         = require('path');

const logger       = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');

const authRoutes      = require('./routes/auth');
const reviewRoutes    = require('./routes/reviews');
const responseRoutes  = require('./routes/responses');
const settingsRoutes  = require('./routes/settings');

const { startCron } = require('./services/cronService');

// ============================================================
// Vérifications des variables d'environnement obligatoires
// ============================================================
const REQUIRED_ENV = [
  'JWT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI', 'ENCRYPTION_KEY', 'ANTHROPIC_API_KEY'
];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length > 0) {
  logger.error('Variables d\'environnement manquantes', { missing: missingEnv });
  process.exit(1);
}

// ============================================================
// App Express
// ============================================================
const app  = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// ── Sécurité
app.use(helmet({
  contentSecurityPolicy: false  // le front peut l'avoir sa propre CSP
}));

// ── CORS – autoriser uniquement le domaine front
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5500',  // dev live-server
  'http://localhost:3001',  // dev front
  'http://127.0.0.1:5500'
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origine non autorisée : ${origin}`));
  },
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ── Parsers
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── Logs HTTP
app.use(morgan(isProd ? 'combined' : 'dev', {
  stream: { write: msg => logger.http(msg.trim()) }
}));

// ── Rate limiting global
app.use('/api', rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_MAX)        || 100,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Trop de requêtes, veuillez patienter' }
}));

// Rate limit plus strict pour l'auth
app.use('/api/auth/login',    rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Trop de tentatives de connexion' } }));
app.use('/api/auth/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 5,  message: { error: 'Trop de créations de compte' } }));

// ── Routes
app.use('/api/auth',      authRoutes);
app.use('/api/reviews',   reviewRoutes);
app.use('/api/responses', responseRoutes);
app.use('/api/settings',  settingsRoutes);

// ── Health check
app.get('/api/health', (req, res) => {
  res.json({
    status:    'ok',
    service:   'fidelavis-api',
    version:   '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// ── 404 pour les routes inconnues
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint non trouvé' });
});

// ── Gestionnaire d'erreurs global (doit être le dernier)
app.use(errorHandler);

// ============================================================
// Démarrage
// ============================================================
app.listen(PORT, () => {
  logger.info(`Fidelavis API démarrée`, {
    port: PORT,
    env:  process.env.NODE_ENV || 'development',
    url:  `http://localhost:${PORT}`
  });

  // Lancer le cron de synchronisation
  if (isProd || process.env.ENABLE_CRON === 'true') {
    startCron();
  }
});

// Gestion des erreurs non rattrapées
process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', { reason: String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', { error: err.message });
  process.exit(1);
});

module.exports = app;
