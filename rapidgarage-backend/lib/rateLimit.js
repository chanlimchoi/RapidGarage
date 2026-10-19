// Request limits that protect the app from abusive clients and floods.
//
//   * limiter(): fixed-window counters per client IP (IPv6 grouped by /64, so
//     rotating addresses inside one allocation doesn't help). Over the limit:
//     429 with Retry-After and RateLimit-* headers.
//   * loginGuard: failed logins per (email, IP) and per email, so passwords
//     can't be guessed quickly from one machine or many.
//   * shedLoad(): answers 503 at once when too many requests are already in
//     flight in this process, instead of queueing until the DB pool drowns.
//   * sameOriginWrites(): state-changing requests that carry an Origin header
//     must come from the app's own origin (CSRF defense on top of SameSite).
//
// Counters live in this process's memory: with several instances each one
// enforces its own limits. Volumetric attacks have to be absorbed before they
// reach the app (CDN / proxy); see DEPLOY.md.
const net = require('net');
const { sendError } = require('./http');
const runtime = require('./runtime');

function intEnv(name, dflt) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : dflt;
}

// On by default, except under NODE_ENV=test (the suite makes thousands of
// requests from 127.0.0.1); RATE_LIMIT=on|off overrides either way.
function enabled() {
  const raw = process.env.RATE_LIMIT;
  if (raw !== undefined && String(raw).trim() !== '') return runtime.isOn(raw);
  return process.env.NODE_ENV !== 'test';
}

// "2001:db8:1:2:a:b:c:d" -> "2001:db8:1:2::/64"; IPv4 (also v4-mapped) as is.
function clientKey(ip) {
  let a = String(ip || 'unknown');
  if (a.startsWith('::ffff:') && net.isIPv4(a.slice(7))) a = a.slice(7);
  if (!net.isIPv6(a)) return a;
  const [head, tail] = a.split('::');
  const left = head ? head.split(':') : [];
  const right = tail !== undefined && tail ? tail.split(':') : [];
  const full = tail === undefined ? left : left.concat(new Array(8 - left.length - right.length).fill('0'), right);
  return full.slice(0, 4).map((h) => h.toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

// Counters live in lib/counters.js: per process by default, or shared by every
// instance with RATE_LIMIT_STORE=db.
const counters = require('./counters');
function resetAll() { inflight.count = 0; return counters.reset(); }

function tooMany(res, resetAt, now, message) {
  res.set('Retry-After', String(Math.max(1, Math.ceil((resetAt - now) / 1000))));
  return sendError(res, 429, 'rate_limited', message || 'Too many requests. Please slow down and try again shortly.');
}

// options: { name, windowMs, max: () => number, key?: (req) => string|null,
//            skip?: (req) => boolean, message? }
function limiter(options) {
  const windowMs = options.windowMs;
  return function rateLimit(req, res, next) {
    if (!enabled() || (options.skip && options.skip(req))) return next();
    const key = options.key ? options.key(req) : clientKey(req.ip);
    if (key === null || key === undefined) return next();
    const now = Date.now();
    const max = options.max();
    return counters.hit('rl|' + options.name + '|' + key, windowMs, now).then((entry) => {
      res.set('RateLimit-Limit', String(max));
      res.set('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
      res.set('RateLimit-Reset', String(Math.ceil((entry.resetAt - now) / 1000)));
      if (entry.count > max) return tooMany(res, entry.resetAt, now, options.message);
      return next();
    }, next);
  };
}

// ---- the app's limits ------------------------------------------------------
const MINUTE = 60000;
const isRead = (req) => req.method === 'GET' || req.method === 'HEAD';

// Every API request. Generous: a page plus its polling is a few requests a
// minute; this only stops scripts.
const apiLimiter = limiter({
  name: 'api', windowMs: MINUTE, max: () => intEnv('RATE_LIMIT_API_PER_MINUTE', 300),
});

// Writes (POST/PUT/DELETE) on top of that.
const writeLimiter = limiter({
  name: 'write', windowMs: MINUTE, max: () => intEnv('RATE_LIMIT_WRITES_PER_MINUTE', 60), skip: isRead,
});

// Login, signup and password reset requests per IP.
const authLimiter = limiter({
  name: 'auth', windowMs: 15 * MINUTE, max: () => intEnv('RATE_LIMIT_AUTH_PER_15_MINUTES', 30), skip: isRead,
  message: 'Too many sign-in attempts from this network. Please wait a few minutes and try again.',
});

// ---- failed logins -----------------------------------------------------------
// Only failures count; a successful login clears the (email, IP) counter.
// The per-email cap is higher so a stranger can't lock someone out cheaply,
// but it still stops a distributed attack on one account.
const LOGIN_WINDOW = 15 * MINUTE;
const perPairMax = () => intEnv('LOGIN_MAX_FAILURES', 5);
const perEmailMax = () => intEnv('LOGIN_MAX_FAILURES_PER_EMAIL', 50);
const LOCKED = 'Too many failed attempts. Please wait 15 minutes or reset your password.';

const loginGuard = {
  // Middleware before the login handler: refuse while either counter is full.
  check(req, res, next) {
    if (!enabled()) return next();
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    if (!email) return next();
    const now = Date.now();
    return Promise.all([counters.peek('login-pair|' + email + '|' + clientKey(req.ip), now), counters.peek('login-email|' + email, now)]).then(([pair, all]) => {
      if (pair && pair.count >= perPairMax()) return tooMany(res, pair.resetAt, now, LOCKED);
      if (all && all.count >= perEmailMax()) return tooMany(res, all.resetAt, now, LOCKED);
      return next();
    }, next);
  },
  // Both resolve once counted, so the next attempt sees it (also across instances).
  failed(req, email) {
    if (!enabled() || !email) return Promise.resolve();
    const now = Date.now();
    return Promise.all([counters.hit('login-pair|' + email + '|' + clientKey(req.ip), LOGIN_WINDOW, now), counters.hit('login-email|' + email, LOGIN_WINDOW, now)]).catch(() => null);
  },
  succeeded(req, email) {
    return email ? counters.remove('login-pair|' + email + '|' + clientKey(req.ip)).catch(() => null) : Promise.resolve();
  },
};

// ---- load shedding -------------------------------------------------------------
const inflight = { count: 0 };
function shedLoad() {
  return function shed(req, res, next) {
    // Live event streams stay open for minutes; they have their own cap (lib/live.js).
    if (['/live', '/live/', '/api/live', '/api/live/'].includes(req.path)) return next();
    const max = intEnv('MAX_CONCURRENT_REQUESTS', 500);
    if (inflight.count >= max) {
      res.set('Retry-After', '5');
      return sendError(res, 503, 'overloaded', 'The server is busy. Please try again in a few seconds.');
    }
    inflight.count++;
    let done = false;
    const release = () => { if (!done) { done = true; inflight.count--; } };
    res.on('finish', release);
    res.on('close', release);
    return next();
  };
}

// ---- same-origin writes --------------------------------------------------------
// allowed: origins the app is served from (FRONTEND_ORIGIN, APP_BASE_URL).
// Requests without Origin (curl, mail providers' one-click unsubscribe POSTs,
// same-origin GETs) pass; SameSite=Lax cookies already keep those safe.
function sameOriginWrites(allowed) {
  const ok = new Set(allowed.filter(Boolean));
  return function checkOrigin(req, res, next) {
    if (isRead(req) || req.method === 'OPTIONS') return next();
    const origin = req.get('Origin');
    // "null" (sandboxed frames, some redirects) is never one of ours.
    if (!origin || ok.has(origin)) return next();
    return sendError(res, 403, 'forbidden', 'Cross-site requests are not allowed.');
  };
}

module.exports = {
  enabled, clientKey, limiter, apiLimiter, writeLimiter, authLimiter, loginGuard, shedLoad, sameOriginWrites,
  resetAll, inflight,
};
