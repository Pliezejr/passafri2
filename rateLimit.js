'use strict';
/**
 * Minimal fixed-window rate limiter, in-process only.
 *
 * This is fine for a single instance behind a normal reverse proxy. If you
 * scale to multiple instances behind a load balancer, replace this with a
 * shared store (e.g. Redis) — an in-memory limiter doesn't coordinate across
 * processes, so each instance would allow its own quota.
 */

const buckets = new Map();

// Sweep old entries periodically so this doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref();

function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Returns { allowed, remaining, retryAfterSeconds }.
 * `key` should combine the route name and IP so limits are per-endpoint.
 */
function check(key, { windowMs, max }) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  const allowed = bucket.count <= max;
  return {
    allowed,
    remaining: Math.max(0, max - bucket.count),
    retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
  };
}

function rateLimit(name, { windowMs, max }) {
  return (req) => check(`${name}:${clientIp(req)}`, { windowMs, max });
}

module.exports = { rateLimit, clientIp };
