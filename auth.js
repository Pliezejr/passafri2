'use strict';

const crypto = require('crypto');
const { readDB, writeDB, id } = require('./store');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  // timing-safe compare
  const a = Buffer.from(check, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function createSession(userId, role) {
  const db = await readDB();
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = { userId, role, expiresAt: Date.now() + SESSION_TTL_MS };
  await writeDB(db);
  return token;
}

async function destroySession(token) {
  const db = await readDB();
  delete db.sessions[token];
  await writeDB(db);
}

async function getSession(token) {
  if (!token) return null;
  const db = await readDB();
  const session = db.sessions[token];
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    delete db.sessions[token];
    await writeDB(db);
    return null;
  }
  return session;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function setSessionCookie(res, token, secure) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  const secureAttr = secure ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `session=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${secureAttr}`
  );
}

function clearSessionCookie(res, secure) {
  const secureAttr = secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secureAttr}`);
}

// True if the request reached us over TLS directly, or arrived via a
// reverse proxy that terminated TLS and is explicitly trusted to tell us so.
function isSecureRequest(req) {
  if (req.socket.encrypted) return true;
  if (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https') return true;
  return false;
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  getSession,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  isSecureRequest,
};
