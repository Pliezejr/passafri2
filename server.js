'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const store = require('./lib/store');
const auth = require('./lib/auth');
const { rateLimit } = require('./lib/rateLimit');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB per document, generous for a demo

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

function send(res, status, body, headers = {}) {
  const isBuffer = Buffer.isBuffer(body);
  const payload = isBuffer ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    // Baseline hardening headers — cheap, and there's no reason not to
    // send them on every response.
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...headers,
  });
  res.end(payload);
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES + 1024 * 1024) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

async function requireAuth(req) {
  const cookies = auth.parseCookies(req);
  const session = await auth.getSession(cookies.session);
  if (!session) {
    const err = new Error('Not authenticated');
    err.status = 401;
    throw err;
  }
  return session;
}

async function requireBusiness(req) {
  const session = await requireAuth(req);
  if (session.role !== 'business') {
    const err = new Error('Business account required');
    err.status = 403;
    throw err;
  }
  const db = await store.readDB();
  const business = db.businesses.find((b) => b.userId === session.userId);
  if (!business) {
    const err = new Error('Business profile not found');
    err.status = 404;
    throw err;
  }
  return { session, db, business };
}

async function requireAdmin(req) {
  const session = await requireAuth(req);
  if (session.role !== 'admin') {
    const err = new Error('Admin account required');
    err.status = 403;
    throw err;
  }
  return session;
}

function validate(fields, body) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '');
  if (missing.length) {
    const err = new Error(`Missing required field(s): ${missing.join(', ')}`);
    err.status = 400;
    throw err;
  }
}

// ---------------------------------------------------------------------
// Route table. Each entry: [method, regex, paramNames, handler]
// ---------------------------------------------------------------------

const routes = [];
function route(method, pattern, handler) {
  const paramNames = [];
  const regexStr =
    '^' +
    pattern.replace(/:[a-zA-Z]+/g, (m) => {
      paramNames.push(m.slice(1));
      return '([^/]+)';
    }) +
    '$';
  routes.push({ method, regex: new RegExp(regexStr), paramNames, handler });
}

// ---- Health check (for load balancers / uptime monitors / container orchestrators) --

route('GET', '/api/health', async (req, res) => {
  send(res, 200, { status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});

// ---- Auth --------------------------------------------------------------

// Auth endpoints get their own rate limits — brute-force protection on
// login, and abuse protection on account creation.
const loginLimiter = rateLimit('login', { windowMs: 10 * 60 * 1000, max: 10 });
const registerLimiter = rateLimit('register', { windowMs: 60 * 60 * 1000, max: 8 });

route('POST', '/api/register', async (req, res, params, body) => {
  const limit = registerLimiter(req);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSeconds));
    return send(res, 429, { error: 'Too many registration attempts. Please try again later.' });
  }
  validate(['email', 'password', 'businessName', 'country'], body);
  const db = await store.readDB();
  const email = String(body.email).trim().toLowerCase();
  if (db.users.some((u) => u.email === email)) {
    return send(res, 409, { error: 'An account with that email already exists.' });
  }
  if (String(body.password).length < 8) {
    return send(res, 400, { error: 'Password must be at least 8 characters.' });
  }

  const { salt, hash } = auth.hashPassword(body.password);
  const userId = store.id('usr');
  db.users.push({ id: userId, email, salt, hash, createdAt: new Date().toISOString() });

  const businessId = store.id('biz');
  const passportId = store.generatePassportId(body.country, db);
  db.businesses.push({
    id: businessId,
    userId,
    passportId,
    name: body.businessName,
    country: body.country,
    region: body.region || '',
    city: body.city || '',
    industry: body.industry || '',
    businessType: body.businessType || '',
    phone: body.phone || '',
    website: body.website || '',
    address: body.address || '',
    description: body.description || '',
    status: 'unverified', // unverified | business_verified | verified | under_review | rejected | suspended
    representativeVerified: false,
    discoverable: true,
    createdAt: new Date().toISOString(),
    verifiedAt: null,
  });

  await store.writeDB(db);
  const token = await auth.createSession(userId, 'business');
  auth.setSessionCookie(res, token, auth.isSecureRequest(req));
  send(res, 201, { passportId, businessId });
});

route('POST', '/api/login', async (req, res, params, body) => {
  const limit = loginLimiter(req);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSeconds));
    return send(res, 429, { error: 'Too many login attempts. Please try again later.' });
  }
  validate(['email', 'password'], body);
  const db = await store.readDB();
  const email = String(body.email).trim().toLowerCase();
  const user = db.users.find((u) => u.email === email);
  if (!user || !auth.verifyPassword(body.password, user.salt, user.hash)) {
    return send(res, 401, { error: 'Invalid email or password.' });
  }
  const token = await auth.createSession(user.id, 'business');
  auth.setSessionCookie(res, token, auth.isSecureRequest(req));
  const business = db.businesses.find((b) => b.userId === user.id);
  send(res, 200, { ok: true, passportId: business ? business.passportId : null });
});

route('POST', '/api/admin/login', async (req, res, params, body) => {
  const limit = loginLimiter(req);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfterSeconds));
    return send(res, 429, { error: 'Too many login attempts. Please try again later.' });
  }
  validate(['email', 'password'], body);
  const db = await store.readDB();
  const email = String(body.email).trim().toLowerCase();
  const admin = db.admins.find((a) => a.email === email);
  if (!admin || !auth.verifyPassword(body.password, admin.salt, admin.hash)) {
    return send(res, 401, { error: 'Invalid email or password.' });
  }
  const token = await auth.createSession(admin.id, 'admin');
  auth.setSessionCookie(res, token, auth.isSecureRequest(req));
  send(res, 200, { ok: true });
});

route('POST', '/api/logout', async (req, res) => {
  const cookies = auth.parseCookies(req);
  if (cookies.session) await auth.destroySession(cookies.session);
  auth.clearSessionCookie(res, auth.isSecureRequest(req));
  send(res, 200, { ok: true });
});

route('GET', '/api/me', async (req, res) => {
  const cookies = auth.parseCookies(req);
  const session = await auth.getSession(cookies.session);
  if (!session) return send(res, 200, { authenticated: false });
  const db = await store.readDB();
  if (session.role === 'business') {
    const business = db.businesses.find((b) => b.userId === session.userId);
    return send(res, 200, {
      authenticated: true,
      role: 'business',
      passportId: business ? business.passportId : null,
      businessName: business ? business.name : null,
    });
  }
  send(res, 200, { authenticated: true, role: 'admin' });
});

// ---- Business: profile ---------------------------------------------------

route('GET', '/api/my-business', async (req, res) => {
  const { db, business } = await requireBusiness(req);
  const score = store.computeTrustScore(business, db);
  const level = store.computeVerificationLevel(business, db);
  send(res, 200, { ...business, trustScore: score.total, trustScoreBreakdown: score.breakdown, verificationLevel: level });
});

route('PATCH', '/api/business', async (req, res, params, body) => {
  const { db, business } = await requireBusiness(req);
  const editable = ['region', 'city', 'industry', 'businessType', 'phone', 'website', 'address', 'description', 'discoverable'];
  editable.forEach((f) => {
    if (body[f] !== undefined) business[f] = body[f];
  });
  await store.writeDB(db);
  send(res, 200, { ok: true });
});

// ---- Business: documents --------------------------------------------------

const DOC_TYPES = new Set([
  'registration_certificate',
  'incorporation_certificate',
  'business_profile',
  'license',
  'tax_document',
  'other',
]);

route('POST', '/api/business/documents', async (req, res, params, body) => {
  const { db, business } = await requireBusiness(req);
  validate(['type', 'filename', 'base64'], body);
  if (!DOC_TYPES.has(body.type)) {
    return send(res, 400, { error: `type must be one of: ${[...DOC_TYPES].join(', ')}` });
  }
  const buffer = Buffer.from(body.base64, 'base64');
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return send(res, 413, { error: 'File exceeds 8MB limit.' });
  }
  const docId = store.id('doc');
  const safeName = body.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  const storedName = `${docId}_${safeName}`;
  fs.writeFileSync(path.join(store.UPLOADS_DIR, storedName), buffer);

  db.documents.push({
    id: docId,
    businessId: business.id,
    type: body.type,
    filename: safeName,
    storedName,
    status: 'pending', // pending | approved | rejected
    uploadedAt: new Date().toISOString(),
    reviewedAt: null,
    reviewNote: '',
  });
  await store.writeDB(db);
  send(res, 201, { id: docId, status: 'pending' });
});

route('GET', '/api/business/documents', async (req, res) => {
  const { db, business } = await requireBusiness(req);
  const docs = db.documents
    .filter((d) => d.businessId === business.id)
    .map(({ storedName, ...rest }) => rest); // never leak internal filenames to the client
  send(res, 200, docs);
});

// Admin-only raw file view (never exposed on the public passport page).
route('GET', '/api/admin/documents/:id/file', async (req, res, params) => {
  await requireAdmin(req);
  const db = await store.readDB();
  const doc = db.documents.find((d) => d.id === params.id);
  if (!doc) return send(res, 404, { error: 'Document not found' });
  sendFile(res, path.join(store.UPLOADS_DIR, doc.storedName));
});

// ---- Business: references --------------------------------------------------

route('POST', '/api/business/references', async (req, res, params, body) => {
  const { db, business } = await requireBusiness(req);
  validate(['toPassportId', 'relationship', 'comment'], body);
  const target = db.businesses.find((b) => b.passportId === body.toPassportId);
  if (!target) return send(res, 404, { error: 'No business found with that AfriPass ID.' });
  if (target.id === business.id) return send(res, 400, { error: 'You cannot request a reference from yourself.' });

  const refId = store.id('ref');
  db.references.push({
    id: refId,
    fromBusinessId: business.id,
    toBusinessId: target.id,
    toPassportId: target.passportId,
    relationship: body.relationship,
    comment: body.comment,
    status: 'pending', // pending | confirmed | declined
    duration: null,
    createdAt: new Date().toISOString(),
    respondedAt: null,
  });
  await store.writeDB(db);
  send(res, 201, { id: refId, status: 'pending' });
});

route('GET', '/api/business/references', async (req, res) => {
  const { db, business } = await requireBusiness(req);
  const nameOf = (bizId) => {
    const b = db.businesses.find((x) => x.id === bizId);
    return b ? b.name : 'Unknown business';
  };
  const sent = db.references
    .filter((r) => r.fromBusinessId === business.id)
    .map((r) => ({ ...r, counterpartyName: nameOf(r.toBusinessId) }));
  const received = db.references
    .filter((r) => r.toBusinessId === business.id)
    .map((r) => ({ ...r, counterpartyName: nameOf(r.fromBusinessId) }));
  send(res, 200, { sent, received });
});

route('POST', '/api/business/references/:id/respond', async (req, res, params, body) => {
  const { db, business } = await requireBusiness(req);
  validate(['confirm'], body);
  const ref = db.references.find((r) => r.id === params.id && r.toBusinessId === business.id);
  if (!ref) return send(res, 404, { error: 'Reference request not found.' });
  if (ref.status !== 'pending') return send(res, 409, { error: 'This request has already been answered.' });

  ref.status = body.confirm ? 'confirmed' : 'declined';
  ref.duration = body.duration || null;
  if (body.relationship) ref.relationship = body.relationship;
  ref.respondedAt = new Date().toISOString();
  await store.writeDB(db);
  send(res, 200, { ok: true, status: ref.status });
});

// ---- Reviews --------------------------------------------------------------

route('POST', '/api/business/:passportId/reviews', async (req, res, params, body) => {
  validate(['authorName', 'rating', 'comment'], body);
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return send(res, 400, { error: 'rating must be an integer from 1 to 5.' });
  }
  const db = await store.readDB();
  const business = db.businesses.find((b) => b.passportId === params.passportId);
  if (!business) return send(res, 404, { error: 'Business not found.' });

  // A review is only flagged "verified transaction" if the reviewer is
  // logged in as a business with a confirmed reference to this business.
  let verifiedTransaction = false;
  const cookies = auth.parseCookies(req);
  const session = await auth.getSession(cookies.session);
  if (session && session.role === 'business') {
    const reviewer = db.businesses.find((b) => b.userId === session.userId);
    if (reviewer) {
      verifiedTransaction = db.references.some(
        (r) =>
          r.status === 'confirmed' &&
          ((r.fromBusinessId === reviewer.id && r.toBusinessId === business.id) ||
            (r.toBusinessId === reviewer.id && r.fromBusinessId === business.id))
      );
    }
  }

  const reviewId = store.id('rev');
  db.reviews.push({
    id: reviewId,
    businessId: business.id,
    authorName: body.authorName,
    rating,
    comment: body.comment,
    verifiedTransaction,
    createdAt: new Date().toISOString(),
  });
  await store.writeDB(db);
  send(res, 201, { id: reviewId, verifiedTransaction });
});

// ---- Verification requests (enterprise onboarding) -------------------------

route('POST', '/api/verification-requests', async (req, res, params, body) => {
  validate(['passportId', 'requesterName', 'purpose'], body);
  const db = await store.readDB();
  const business = db.businesses.find((b) => b.passportId === body.passportId);
  if (!business) return send(res, 404, { error: 'Business not found.' });

  const reqId = store.id('vr');
  db.verificationRequests.push({
    id: reqId,
    businessId: business.id,
    passportId: business.passportId,
    requesterName: body.requesterName,
    purpose: body.purpose,
    checks: Array.isArray(body.checks) ? body.checks : [],
    status: 'pending', // pending | authorized | declined
    createdAt: new Date().toISOString(),
    respondedAt: null,
  });
  await store.writeDB(db);
  send(res, 201, { id: reqId, status: 'pending' });
});

route('GET', '/api/business/verification-requests', async (req, res) => {
  const { db, business } = await requireBusiness(req);
  const list = db.verificationRequests.filter((r) => r.businessId === business.id);
  send(res, 200, list);
});

route('POST', '/api/business/verification-requests/:id/respond', async (req, res, params, body) => {
  const { db, business } = await requireBusiness(req);
  validate(['authorize'], body);
  const vr = db.verificationRequests.find((r) => r.id === params.id && r.businessId === business.id);
  if (!vr) return send(res, 404, { error: 'Verification request not found.' });
  if (vr.status !== 'pending') return send(res, 409, { error: 'Already responded to.' });
  vr.status = body.authorize ? 'authorized' : 'declined';
  vr.respondedAt = new Date().toISOString();
  await store.writeDB(db);
  send(res, 200, { ok: true, status: vr.status });
});

// ---- Public ----------------------------------------------------------------

route('GET', '/api/public/business/:passportId', async (req, res, params) => {
  const db = await store.readDB();
  const business = db.businesses.find((b) => b.passportId === params.passportId);
  if (!business) return send(res, 404, { error: 'No business found with that AfriPass ID.' });
  send(res, 200, store.publicBusinessView(business, db));
});

route('GET', '/api/search', async (req, res, params, body, query) => {
  const db = await store.readDB();
  const results = store.searchBusinesses(db, {
    q: query.get('q'),
    country: query.get('country'),
    industry: query.get('industry'),
  });
  send(res, 200, results);
});

// ---- Enterprise API (API-key protected) ------------------------------------

route('GET', '/api/v1/verify/:passportId', async (req, res, params) => {
  const providedKey = req.headers['x-api-key'];
  const db = await store.readDB();
  const keyRecord = db.apiKeys.find((k) => k.key === providedKey && k.active);
  if (!keyRecord) {
    return send(res, 401, { error: 'Missing or invalid X-API-Key header.' });
  }
  const business = db.businesses.find((b) => b.passportId === params.passportId);
  if (!business) return send(res, 404, { error: 'Business not found.' });
  const score = store.computeTrustScore(business, db);
  const level = store.computeVerificationLevel(business, db);
  const docs = db.documents.filter((d) => d.businessId === business.id);
  send(res, 200, {
    passport_id: business.passportId,
    business_name: business.name,
    country: business.country,
    verification_status: business.status,
    verification_level: level,
    documents_verified: docs.some((d) => d.status === 'approved'),
    representative_verified: !!business.representativeVerified,
    trust_score: score.total,
  });
});

// ---- Admin ------------------------------------------------------------------

route('GET', '/api/admin/stats', async (req, res) => {
  await requireAdmin(req);
  const db = await store.readDB();
  const byStatus = (s) => db.businesses.filter((b) => b.status === s).length;
  send(res, 200, {
    businesses: {
      registered: db.businesses.length,
      verified: byStatus('verified') + byStatus('business_verified'),
      pending: byStatus('unverified'),
      underReview: byStatus('under_review'),
      rejected: byStatus('rejected'),
    },
    verification: {
      documents: db.documents.length,
      references: db.references.length,
      requests: db.verificationRequests.length,
    },
  });
});

route('GET', '/api/admin/queue', async (req, res) => {
  await requireAdmin(req);
  const db = await store.readDB();
  const pending = db.businesses.filter((b) => b.status === 'unverified' || b.status === 'under_review');
  const queue = pending.map((b) => ({
    id: b.id,
    passportId: b.passportId,
    name: b.name,
    status: b.status,
    documents: db.documents.filter((d) => d.businessId === b.id).length,
    documentsPending: db.documents.filter((d) => d.businessId === b.id && d.status === 'pending').length,
    references: store.confirmedReferencesFor(b, db).length,
    createdAt: b.createdAt,
  }));
  send(res, 200, queue);
});

route('GET', '/api/admin/business/:id', async (req, res, params) => {
  await requireAdmin(req);
  const db = await store.readDB();
  const business = db.businesses.find((b) => b.id === params.id);
  if (!business) return send(res, 404, { error: 'Not found' });
  const docs = db.documents.filter((d) => d.businessId === business.id).map(({ storedName, ...rest }) => rest);
  // References this business requested about itself (what counts toward its
  // trust score) plus ones it was asked to confirm for others, for context.
  const referencesRequested = db.references.filter((r) => r.fromBusinessId === business.id);
  const referencesToConfirm = db.references.filter((r) => r.toBusinessId === business.id);
  const score = store.computeTrustScore(business, db);
  send(res, 200, {
    ...business,
    documents: docs,
    references: referencesRequested,
    referencesToConfirm,
    trustScore: score.total,
  });
});

const BUSINESS_STATUSES = new Set(['unverified', 'business_verified', 'under_review', 'verified', 'rejected', 'suspended']);

route('PATCH', '/api/admin/business/:id', async (req, res, params, body) => {
  await requireAdmin(req);
  const db = await store.readDB();
  const business = db.businesses.find((b) => b.id === params.id);
  if (!business) return send(res, 404, { error: 'Not found' });

  if (body.status) {
    if (!BUSINESS_STATUSES.has(body.status)) {
      return send(res, 400, { error: `status must be one of: ${[...BUSINESS_STATUSES].join(', ')}` });
    }
    business.status = body.status;
    if (body.status === 'verified' || body.status === 'business_verified') {
      business.verifiedAt = new Date().toISOString();
    }
  }
  if (body.representativeVerified !== undefined) {
    business.representativeVerified = !!body.representativeVerified;
  }
  await store.writeDB(db);
  send(res, 200, { ok: true, status: business.status });
});

route('PATCH', '/api/admin/document/:id', async (req, res, params, body) => {
  await requireAdmin(req);
  validate(['status'], body);
  if (!['approved', 'rejected', 'pending'].includes(body.status)) {
    return send(res, 400, { error: 'status must be approved, rejected or pending.' });
  }
  const db = await store.readDB();
  const doc = db.documents.find((d) => d.id === params.id);
  if (!doc) return send(res, 404, { error: 'Not found' });
  doc.status = body.status;
  doc.reviewedAt = new Date().toISOString();
  doc.reviewNote = body.note || '';
  await store.writeDB(db);
  send(res, 200, { ok: true, status: doc.status });
});

// ---------------------------------------------------------------------
// Router dispatch
// ---------------------------------------------------------------------

async function handleApi(req, res, pathname, query) {
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const match = r.regex.exec(pathname);
    if (!match) continue;
    const params = {};
    r.paramNames.forEach((name, i) => (params[name] = decodeURIComponent(match[i + 1])));
    try {
      let body = {};
      if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') {
        body = await readJsonBody(req);
      }
      await r.handler(req, res, params, body, query);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      send(res, status, { error: err.message || 'Internal server error' });
    }
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsed.pathname;

  if (pathname.startsWith('/api/')) {
    const handled = await handleApi(req, res, pathname, parsed.searchParams);
    if (!handled) send(res, 404, { error: 'No such API route.' });
    return;
  }

  // Simple static + "SPA-ish" page routing for the demo frontend.
  if (pathname.startsWith('/verify/')) {
    return sendFile(res, path.join(PUBLIC_DIR, 'verify.html'));
  }

  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  // prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(400);
    return res.end('Bad request');
  }
  if (!fs.existsSync(filePath)) {
    // allow /dashboard, /admin, /login, /register without .html
    const withHtml = filePath + '.html';
    if (fs.existsSync(withHtml)) filePath = withHtml;
    else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
  }
  sendFile(res, filePath);
});

// ---------------------------------------------------------------------
// First-run seed: default admin account + a demo enterprise API key.
// ---------------------------------------------------------------------

async function seed() {
  const db = await store.readDB();
  let changed = false;

  if (db.admins.length === 0) {
    const email = (process.env.ADMIN_EMAIL || 'admin@afripass.local').trim().toLowerCase();
    // Prefer an operator-supplied password. Otherwise generate a strong
    // random one — printed once, never stored in plaintext, never a
    // hardcoded default that could ship to production unnoticed.
    const usingGenerated = !process.env.ADMIN_PASSWORD;
    const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
    const { salt, hash } = auth.hashPassword(password);
    db.admins.push({
      id: store.id('adm'),
      email,
      salt,
      hash,
      createdAt: new Date().toISOString(),
    });
    changed = true;
    console.log('----------------------------------------------------------');
    console.log('Seeded admin account:');
    console.log(`  email:    ${email}`);
    if (usingGenerated) {
      console.log(`  password: ${password}`);
      console.log('  (auto-generated because ADMIN_PASSWORD was not set — save it now, it is only printed this once)');
    } else {
      console.log('  password: <from ADMIN_PASSWORD env var>');
    }
    console.log('----------------------------------------------------------');
  }

  if (db.apiKeys.length === 0) {
    const key = process.env.DEMO_API_KEY || crypto.randomBytes(24).toString('hex');
    db.apiKeys.push({ id: store.id('key'), key, label: 'Demo enterprise key', active: true, createdAt: new Date().toISOString() });
    changed = true;
    console.log('Seeded enterprise API key (send as header X-API-Key):');
    console.log(`  ${key}`);
    console.log('----------------------------------------------------------');
  }

  if (changed) await store.writeDB(db);
}

function shutdown(signal) {
  console.log(`\nReceived ${signal}, shutting down...`);
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
  // Force-exit if connections don't drain in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

seed()
  .then(() => {
    server.listen(PORT, HOST, () => {
      console.log(`AfriPass MVP running at http://${HOST}:${PORT}`);
      if (process.env.NODE_ENV !== 'production') {
        console.log('NODE_ENV is not "production" — session cookies will not require HTTPS.');
      }
    });
  })
  .catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
