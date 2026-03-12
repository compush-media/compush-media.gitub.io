'use strict';
/**
 * Fidelavis – services/cronService.js
 * Scheduler pour la synchronisation automatique des avis
 * Toutes les X minutes (configurable via CRON_SYNC_INTERVAL)
 */

const cron   = require('node-cron');
const { db } = require('../database');
const { syncLocationReviews } = require('./syncService');
const logger = require('../utils/logger');
require('dotenv').config();

const CRON_INTERVAL = process.env.CRON_SYNC_INTERVAL || '*/30 * * * *';

let cronJob = null;

function startCron() {
  if (cronJob) {
    logger.warn('[cronService] Cron déjà actif, ignoré');
    return;
  }

  logger.info('[cronService] Démarrage du scheduler de sync', { interval: CRON_INTERVAL });

  cronJob = cron.schedule(CRON_INTERVAL, async () => {
    logger.info('[cronService] Lancement sync automatique');

    // Récupérer tous les établissements configurés (au moins un compte Google lié)
    const locations = db.prepare(`
      SELECT l.id, l.location_name, l.merchant_id
      FROM locations l
      JOIN google_accounts ga ON ga.id = l.account_id
      ORDER BY l.synced_at ASC NULLS FIRST
      LIMIT 50
    `).all();

    if (locations.length === 0) {
      logger.info('[cronService] Aucun établissement à synchroniser');
      return;
    }

    logger.info('[cronService] Établissements à sync', { count: locations.length });

    for (const loc of locations) {
      try {
        const result = await syncLocationReviews(loc.id);
        logger.info('[cronService] Sync OK', {
          location: loc.location_name,
          total:    result.total,
          new:      result.reviewsNew
        });
      } catch (err) {
        logger.error('[cronService] Échec sync', {
          location: loc.location_name,
          error:    err.message
        });
      }

      // Petite pause entre chaque établissement pour éviter les rate limits
      await new Promise(r => setTimeout(r, 2000));
    }

    logger.info('[cronService] Sync automatique terminée');
  });
}

function stopCron() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    logger.info('[cronService] Scheduler arrêté');
  }
}

module.exports = { startCron, stopCron };
