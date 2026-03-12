'use strict';
/**
 * Fidelavis – utils/logger.js
 * Logger Winston – fichiers + console, sans fuite d'infos sensibles
 */

const { createLogger, format, transports } = require('winston');
const path = require('path');
const fs   = require('fs');
require('dotenv').config();

const LOG_DIR   = process.env.LOG_DIR   || './logs';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// Masque les champs sensibles dans les logs
const SENSITIVE_KEYS = ['password', 'access_token', 'refresh_token', 'token', 'secret', 'key', 'authorization'];
function maskSensitive(obj) {
  if (typeof obj !== 'object' || obj === null) return obj;
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k,
      SENSITIVE_KEYS.some(s => k.toLowerCase().includes(s)) ? '***' : maskSensitive(v)
    ])
  );
}

const logger = createLogger({
  level: LOG_LEVEL,
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    format.json()
  ),
  transports: [
    new transports.File({ filename: path.join(LOG_DIR, 'error.log'),   level: 'error', maxsize: 5_000_000, maxFiles: 5 }),
    new transports.File({ filename: path.join(LOG_DIR, 'combined.log'),              maxsize: 10_000_000, maxFiles: 5 }),
  ],
  exceptionHandlers: [
    new transports.File({ filename: path.join(LOG_DIR, 'exceptions.log') })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.Console({
    format: format.combine(
      format.colorize(),
      format.printf(({ level, message, timestamp, ...meta }) => {
        const extra = Object.keys(meta).length ? JSON.stringify(maskSensitive(meta), null, 2) : '';
        return `${timestamp} [${level}] ${message} ${extra}`;
      })
    )
  }));
}

module.exports = logger;
