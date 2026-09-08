'use strict';
/**
 * AfriPass MVP data store.
 *
 * This is a zero-dependency JSON-file "database" so the whole app runs with
 * nothing but `node server.js` — no npm install, no external DB required.
 *
 * IMPORTANT: this is a demo/MVP persistence layer, matching the spec's own
 * note that SQLite is fine for a first MVP and Postgres is the production
 * target. Swap `readDB`/`writeDB` below for a real database client (e.g.
 * `pg`) when you're ready to move past the MVP — the rest of the app only
 * talks to the functions exported from this file, so that's the one place
 * you need to change.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Both dirs can be redirected under a single mounted volume via
// STORAGE_DIR — handy on platforms that only give you one persistent disk
// per service (Render, Fly.io volumes, etc). Falls back to two folders
// next to the app when unset, which is what local/dev runs use.
const STORAGE_ROOT = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.join(__dirname, '..');

const DATA_DIR = process.env.STORAGE_DIR ? path.join(STORAGE_ROOT, 'data') : path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOADS_DIR = process.env.STORAGE_DIR
  ? path.join(STORAGE_ROOT, 'uploads')
  : path.join(__dirname, '..', 'uploads');

const EMPTY_DB = {
  users: [],
  businesses: [],
  documents: [],
  references: [],
  reviews: [],
  verificationRequests: [],
  sessions: {},
  admins: [],
  apiKeys: [],
};

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function readDB() {
  ensureDirs();
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(EMPTY_DB, null, 2));
  }
  const raw = fs.readFileSync(DB_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('DB file corrupt, reinitializing. Backup saved as db.json.bak');
    fs.writeFileSync(DB_FILE + '.bak', raw);
    fs.writeFileSync(DB_FILE, JSON.stringify(EMPTY_DB, null, 2));
    return JSON.parse(JSON.stringify(EMPTY_DB));
  }
}

// Very small in-process write queue so concurrent requests don't clobber
// each other's writes to the JSON file.
let writeChain = Promise.resolve();
function writeDB(db) {
  writeChain = writeChain.then(
    () =>
      new Promise((resolve, reject) => {
        fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), (err) => {
          if (err) reject(err);
          else resolve();
        });
      })
  );
  return writeChain;
}

function id(prefix) {
  const rand = crypto.randomBytes(6).toString('hex');
  return prefix ? `${prefix}_${rand}` : rand;
}

function countryCode(country) {
  if (!country) return 'XX';
  const map = {
    ghana: 'GH', nigeria: 'NG', kenya: 'KE', rwanda: 'RW', 'south africa': 'ZA',
    uganda: 'UG', tanzania: 'TZ', 'ivory coast': 'CI', "cote d'ivoire": 'CI',
    senegal: 'SN', ethiopia: 'ET', egypt: 'EG', morocco: 'MA', zambia: 'ZM',
  };
  const key = country.trim().toLowerCase();
  if (map[key]) return map[key];
  return country.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase().padEnd(2, 'X');
}

function generatePassportId(country, db) {
  const cc = countryCode(country);
  let candidate;
  do {
    const hex = crypto.randomBytes(4).toString('hex').toUpperCase();
    candidate = `AFR-${cc}-${hex}`;
  } while (db.businesses.some((b) => b.passportId === candidate));
  return candidate;
}

// ---- Trust score -----------------------------------------------------
// Mirrors the spec's explainable breakdown:
//   Business verification   35
//   Verified documents      25
//   Verified references     20
//   Verified transactions/reviews 20
// A reference is requested BY a business (fromBusinessId) and confirmed by
// the counterparty (toBusinessId). The trust credit belongs to the business
// that requested it — confirming a reference for someone else doesn't earn
// the confirmer anything.
function confirmedReferencesFor(business, db) {
  return db.references.filter((r) => r.fromBusinessId === business.id && r.status === 'confirmed');
}

function computeTrustScore(business, db) {
  const breakdown = {
    businessVerification: 0,
    documents: 0,
    references: 0,
    reviews: 0,
  };

  if (business.status === 'verified' || business.status === 'business_verified') {
    breakdown.businessVerification = 35;
  }

  const docs = db.documents.filter((d) => d.businessId === business.id);
  const approvedDocs = docs.filter((d) => d.status === 'approved');
  if (docs.length > 0) {
    breakdown.documents = Math.min(25, approvedDocs.length * 8);
  }

  const refs = confirmedReferencesFor(business, db);
  breakdown.references = Math.min(20, refs.length * 5);

  const reviews = db.reviews.filter((r) => r.businessId === business.id);
  const verifiedReviews = reviews.filter((r) => r.verifiedTransaction);
  breakdown.reviews = Math.min(20, verifiedReviews.length * 4 + Math.max(0, reviews.length - verifiedReviews.length) * 1);

  const total =
    breakdown.businessVerification + breakdown.documents + breakdown.references + breakdown.reviews;

  return { total: Math.min(100, total), breakdown };
}

function computeVerificationLevel(business, db) {
  const docs = db.documents.filter((d) => d.businessId === business.id);
  const approvedDocs = docs.filter((d) => d.status === 'approved');
  const refs = confirmedReferencesFor(business, db);
  const reviews = db.reviews.filter((r) => r.businessId === business.id);

  if (business.status !== 'verified' && business.status !== 'business_verified') return 0;
  if (!business.representativeVerified) return 1;
  if (approvedDocs.length === 0) return 2;
  if (refs.length === 0 && reviews.length === 0) return 3;
  return 4;
}

function publicBusinessView(business, db) {
  const score = computeTrustScore(business, db);
  const level = computeVerificationLevel(business, db);
  const refs = confirmedReferencesFor(business, db);
  const reviews = db.reviews
    .filter((r) => r.businessId === business.id)
    .map((r) => ({
      id: r.id,
      authorName: r.authorName,
      rating: r.rating,
      comment: r.comment,
      verifiedTransaction: !!r.verifiedTransaction,
      createdAt: r.createdAt,
    }));
  const docs = db.documents.filter((d) => d.businessId === business.id);

  return {
    passportId: business.passportId,
    name: business.name,
    country: business.country,
    region: business.region,
    city: business.city,
    industry: business.industry,
    businessType: business.businessType,
    status: business.status,
    verificationLevel: level,
    representativeVerified: !!business.representativeVerified,
    trustScore: score.total,
    trustScoreBreakdown: score.breakdown,
    documentsVerified: docs.some((d) => d.status === 'approved'),
    documentTypesVerified: docs.filter((d) => d.status === 'approved').map((d) => d.type),
    verifiedReferenceCount: refs.length,
    reviews,
    verifiedAt: business.verifiedAt || null,
  };
}

function searchBusinesses(db, { q, country, industry } = {}) {
  return db.businesses
    .filter((b) => b.discoverable !== false)
    .filter((b) => !q || b.name.toLowerCase().includes(String(q).toLowerCase()))
    .filter((b) => !country || b.country.toLowerCase() === String(country).toLowerCase())
    .filter((b) => !industry || b.industry.toLowerCase() === String(industry).toLowerCase())
    .map((b) => {
      const score = computeTrustScore(b, db);
      return {
        passportId: b.passportId,
        name: b.name,
        country: b.country,
        city: b.city,
        industry: b.industry,
        status: b.status,
        trustScore: score.total,
      };
    })
    .sort((a, b) => b.trustScore - a.trustScore);
}

module.exports = {
  DATA_DIR,
  UPLOADS_DIR,
  readDB,
  writeDB,
  id,
  generatePassportId,
  computeTrustScore,
  computeVerificationLevel,
  confirmedReferencesFor,
  publicBusinessView,
  searchBusinesses,
};
