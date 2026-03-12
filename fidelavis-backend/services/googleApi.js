'use strict';
/**
 * Fidelavis – services/googleApi.js
 * Wrapper Google Business Profile API v4
 * – Lister comptes et établissements
 * – Récupérer les avis
 * – Publier une réponse à un avis
 */

const axios  = require('axios');
const logger = require('../utils/logger');

// Bases URLs Google APIs
const GBP_BASE = 'https://mybusiness.googleapis.com/v4';
const ACC_BASE = 'https://mybusinessaccountmanagement.googleapis.com/v1';

// Helper : client axios avec token Bearer
function apiClient(accessToken) {
  return axios.create({
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    timeout: 15_000
  });
}

// Helper : gestion d'erreurs lisible
function handleGoogleError(err, context) {
  const status  = err.response?.status;
  const message = err.response?.data?.error?.message || err.message;
  const code    = err.response?.data?.error?.code;

  logger.error(`[googleApi] ${context}`, { status, code, message });

  if (status === 401) throw new Error('TOKEN_EXPIRED');
  if (status === 403) throw new Error('PERMISSION_DENIED');
  if (status === 429) throw new Error('QUOTA_EXCEEDED');
  if (status === 404) throw new Error('NOT_FOUND');
  throw new Error(`GOOGLE_API_ERROR: ${message}`);
}

// ============================================================
// Lister les comptes Google My Business
// ============================================================
async function listAccounts(accessToken) {
  try {
    const client = apiClient(accessToken);
    const resp = await client.get(`${ACC_BASE}/accounts`);
    return (resp.data.accounts || []).map(acc => ({
      name:        acc.name,          // "accounts/12345"
      accountName: acc.accountName,
      type:        acc.type,
      state:       acc.state?.status
    }));
  } catch (err) {
    handleGoogleError(err, 'listAccounts');
  }
}

// ============================================================
// Lister les établissements d'un compte
// ============================================================
async function listLocations(accessToken, accountName) {
  try {
    const client = apiClient(accessToken);
    // Champs demandés pour minimiser les données transférées
    const resp = await client.get(`${GBP_BASE}/${accountName}/locations`, {
      params: {
        readMask: 'name,title,storefrontAddress,websiteUri,phoneNumbers,metadata'
      }
    });

    return (resp.data.locations || []).map(loc => ({
      name:    loc.name,    // "accounts/.../locations/..."
      title:   loc.title,
      address: formatAddress(loc.storefrontAddress),
      phone:   loc.phoneNumbers?.primaryPhone || null,
      website: loc.websiteUri || null
    }));
  } catch (err) {
    handleGoogleError(err, `listLocations(${accountName})`);
  }
}

function formatAddress(addr) {
  if (!addr) return null;
  const parts = [
    ...(addr.addressLines || []),
    addr.locality,
    addr.postalCode,
    addr.regionCode
  ].filter(Boolean);
  return parts.join(', ');
}

// ============================================================
// Récupérer les avis d'un établissement
// (paginé, retourne tous les avis)
// ============================================================
async function listReviews(accessToken, locationName, { pageSize = 50, pageToken = null } = {}) {
  try {
    const client = apiClient(accessToken);
    const params = { pageSize };
    if (pageToken) params.pageToken = pageToken;

    const resp = await client.get(`${GBP_BASE}/${locationName}/reviews`, { params });

    const reviews = (resp.data.reviews || []).map(normalizeReview);
    return {
      reviews,
      nextPageToken:   resp.data.nextPageToken || null,
      totalReviewCount: resp.data.totalReviewCount || reviews.length
    };
  } catch (err) {
    handleGoogleError(err, `listReviews(${locationName})`);
  }
}

/**
 * Récupère TOUS les avis (gère la pagination automatiquement)
 */
async function listAllReviews(accessToken, locationName) {
  let allReviews = [];
  let nextPageToken = null;

  do {
    const result = await listReviews(accessToken, locationName, {
      pageSize: 50,
      pageToken: nextPageToken
    });
    allReviews    = allReviews.concat(result.reviews);
    nextPageToken = result.nextPageToken;
  } while (nextPageToken);

  logger.info('[googleApi] listAllReviews', {
    locationName,
    count: allReviews.length
  });

  return allReviews;
}

function normalizeReview(raw) {
  // Conversion de la note texte → entier
  const STAR_MAP = {
    ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5
  };
  return {
    googleReviewId: raw.name,         // "accounts/.../locations/.../reviews/..."
    reviewerName:   raw.reviewer?.displayName || 'Anonyme',
    reviewerPhoto:  raw.reviewer?.profilePhotoUrl || null,
    rating:         STAR_MAP[raw.starRating] || 0,
    comment:        raw.comment || null,
    publishedAt:    raw.createTime,
    updatedAt:      raw.updateTime || null,
    replyText:      raw.reviewReply?.comment || null,
    replyUpdatedAt: raw.reviewReply?.updateTime || null
  };
}

// ============================================================
// Publier une réponse à un avis
// ============================================================
async function replyToReview(accessToken, reviewName, replyText) {
  // reviewName = "accounts/.../locations/.../reviews/..."
  try {
    const client = apiClient(accessToken);
    const resp = await client.put(`${GBP_BASE}/${reviewName}/reply`, {
      comment: replyText
    });
    logger.info('[googleApi] Réponse publiée', { reviewName });
    return resp.data;
  } catch (err) {
    handleGoogleError(err, `replyToReview(${reviewName})`);
  }
}

// ============================================================
// Supprimer une réponse (optionnel)
// ============================================================
async function deleteReply(accessToken, reviewName) {
  try {
    const client = apiClient(accessToken);
    await client.delete(`${GBP_BASE}/${reviewName}/reply`);
    logger.info('[googleApi] Réponse supprimée', { reviewName });
    return true;
  } catch (err) {
    handleGoogleError(err, `deleteReply(${reviewName})`);
  }
}

module.exports = {
  listAccounts,
  listLocations,
  listReviews,
  listAllReviews,
  replyToReview,
  deleteReply
};
