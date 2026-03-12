'use strict';
/**
 * Fidelavis – database.js
 * Initialisation SQLite avec better-sqlite3
 * Schéma complet : commerçants, établissements, tokens, avis, réponses, logs
 */

const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './data/fidelavis.db';

// S'assurer que le dossier existe
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH, { verbose: null });

// Performances et intégrité
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

// ============================================================
// SCHÉMA
// ============================================================
db.exec(`

-- --------------------------------------------------------
-- merchants : comptes commerçants Fidelavis
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS merchants (
  id            TEXT PRIMARY KEY,          -- UUID
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- --------------------------------------------------------
-- merchant_settings : paramètres IA et auto-réponse
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS merchant_settings (
  merchant_id         TEXT PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE,
  restaurant_name     TEXT,
  owner_name          TEXT,
  response_tone       TEXT NOT NULL DEFAULT 'warm',     -- warm | professional | formal
  signature           TEXT,                              -- "L'équipe du Bistrot Marcel"
  return_phrase       TEXT,                              -- "Au plaisir de vous revoir bientôt !"
  contact_phrase      TEXT,                              -- "N'hésitez pas à nous contacter au..."
  auto_reply_enabled  INTEGER NOT NULL DEFAULT 0,        -- 0|1
  auto_reply_rule_5   TEXT NOT NULL DEFAULT 'auto',      -- auto|validate|disabled
  auto_reply_rule_4   TEXT NOT NULL DEFAULT 'auto',
  auto_reply_rule_3   TEXT NOT NULL DEFAULT 'validate',
  auto_reply_rule_2   TEXT NOT NULL DEFAULT 'disabled',  -- validation obligatoire
  auto_reply_rule_1   TEXT NOT NULL DEFAULT 'disabled',
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --------------------------------------------------------
-- google_accounts : comptes Google My Business connectés
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS google_accounts (
  id            TEXT PRIMARY KEY,
  merchant_id   TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  google_account_id  TEXT NOT NULL,          -- "accounts/12345"
  account_name  TEXT,                        -- nom lisible
  access_token  TEXT NOT NULL,               -- chiffré AES
  refresh_token TEXT NOT NULL,               -- chiffré AES
  token_expiry  TEXT,                        -- ISO datetime
  scopes        TEXT,
  connected_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_refresh_at TEXT,
  UNIQUE(merchant_id, google_account_id)
);

-- --------------------------------------------------------
-- locations : établissements Google connectés
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS locations (
  id            TEXT PRIMARY KEY,
  merchant_id   TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  account_id    TEXT NOT NULL REFERENCES google_accounts(id) ON DELETE CASCADE,
  google_location_id TEXT NOT NULL,          -- "accounts/.../locations/..."
  location_name TEXT NOT NULL,
  address       TEXT,
  phone         TEXT,
  website       TEXT,
  is_primary    INTEGER NOT NULL DEFAULT 0,  -- fiche principale sélectionnée
  synced_at     TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(merchant_id, google_location_id)
);

-- --------------------------------------------------------
-- reviews : avis Google importés
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS reviews (
  id                TEXT PRIMARY KEY,
  merchant_id       TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  location_id       TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  google_review_id  TEXT NOT NULL UNIQUE,    -- "accounts/.../reviews/..."
  reviewer_name     TEXT NOT NULL,
  reviewer_photo    TEXT,
  rating            INTEGER NOT NULL,        -- 1-5
  comment           TEXT,                    -- peut être NULL (avis sans texte)
  published_at      TEXT NOT NULL,
  updated_at_google TEXT,
  reply_text        TEXT,                    -- réponse déjà publiée sur Google
  reply_updated_at  TEXT,
  status            TEXT NOT NULL DEFAULT 'pending', -- pending|replied|ignored
  tags              TEXT DEFAULT '[]',       -- JSON array: ["positif","urgent",...]
  is_new            INTEGER NOT NULL DEFAULT 1,
  imported_at       TEXT NOT NULL DEFAULT (datetime('now')),
  last_sync_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --------------------------------------------------------
-- ai_responses : réponses générées par l'IA
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_responses (
  id             TEXT PRIMARY KEY,
  review_id      TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  merchant_id    TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  response_text  TEXT NOT NULL,
  model_used     TEXT NOT NULL,              -- claude-3-5-sonnet-20241022 | gpt-4o...
  prompt_tokens  INTEGER,
  output_tokens  INTEGER,
  generation_ms  INTEGER,
  status         TEXT NOT NULL DEFAULT 'draft', -- draft|approved|rejected|published
  edited_text    TEXT,                       -- texte modifié par le commerçant
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at    TEXT,
  published_at   TEXT
);

-- --------------------------------------------------------
-- published_replies : réponses effectivement publiées
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS published_replies (
  id              TEXT PRIMARY KEY,
  review_id       TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  ai_response_id  TEXT REFERENCES ai_responses(id),
  merchant_id     TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  reply_text      TEXT NOT NULL,
  published_by    TEXT NOT NULL DEFAULT 'manual', -- manual|auto
  google_response TEXT,                      -- réponse brute de l'API Google
  published_at    TEXT NOT NULL DEFAULT (datetime('now')),
  error_message   TEXT                       -- si échec
);

-- --------------------------------------------------------
-- action_logs : journal de toutes les actions
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS action_logs (
  id           TEXT PRIMARY KEY,
  merchant_id  TEXT REFERENCES merchants(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,                -- ex: review.synced, response.published
  entity_type  TEXT,                         -- review | response | location | account
  entity_id    TEXT,
  details      TEXT DEFAULT '{}',            -- JSON
  ip_address   TEXT,
  user_agent   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --------------------------------------------------------
-- sync_jobs : historique des synchronisations
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_jobs (
  id            TEXT PRIMARY KEY,
  merchant_id   TEXT REFERENCES merchants(id) ON DELETE CASCADE,
  location_id   TEXT REFERENCES locations(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'running', -- running|success|error
  reviews_found INTEGER DEFAULT 0,
  reviews_new   INTEGER DEFAULT 0,
  error_message TEXT,
  started_at    TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT
);

-- ============================================================
-- INDEX PERFORMANCES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_reviews_merchant   ON reviews(merchant_id);
CREATE INDEX IF NOT EXISTS idx_reviews_location   ON reviews(location_id);
CREATE INDEX IF NOT EXISTS idx_reviews_status     ON reviews(status);
CREATE INDEX IF NOT EXISTS idx_reviews_rating     ON reviews(rating);
CREATE INDEX IF NOT EXISTS idx_reviews_is_new     ON reviews(is_new);
CREATE INDEX IF NOT EXISTS idx_ai_responses_rev   ON ai_responses(review_id);
CREATE INDEX IF NOT EXISTS idx_action_logs_merch  ON action_logs(merchant_id);
CREATE INDEX IF NOT EXISTS idx_action_logs_action ON action_logs(action);

`);

// ============================================================
// HELPERS COMMUNS
// ============================================================

const uuidv4 = () => require('crypto').randomUUID();

/**
 * Insère un log d'action dans la table action_logs
 */
function logAction({ merchantId, action, entityType, entityId, details = {}, ip, userAgent } = {}) {
  try {
    db.prepare(`
      INSERT INTO action_logs (id, merchant_id, action, entity_type, entity_id, details, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      merchantId || null,
      action,
      entityType || null,
      entityId   || null,
      JSON.stringify(details),
      ip         || null,
      userAgent  || null
    );
  } catch (e) {
    // log non bloquant
    console.error('[logAction]', e.message);
  }
}

module.exports = { db, logAction };

// Exécution directe : node database.js → affiche le schéma appliqué
if (require.main === module) {
  console.log('[Fidelavis DB] Schéma initialisé :', DB_PATH);
  console.log('[Tables]', db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name).join(', '));
}
