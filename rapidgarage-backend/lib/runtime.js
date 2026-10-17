// Deployment settings read from the environment (see .env.production.example
// and DEPLOY.md). Pure functions so they can be unit-tested.
const fs = require('fs');
const path = require('path');

const isOn = (v) => /^(1|true|on|yes)$/i.test(String(v == null ? '' : v).trim());
const isOff = (v) => /^(0|false|off|no)$/i.test(String(v == null ? '' : v).trim());
const isProd = (env) => (env || process.env).NODE_ENV === 'production';

// Express "trust proxy". Set it to the number of proxies in front of the app
// (1 for Render, Fly, Caddy/nginx on the same host). Unset: 1 in production
// (the old behaviour), off otherwise. Off means req.ip is the TCP peer and
// X-Forwarded-* headers are ignored, which is right when nothing sits in front.
//   TRUST_PROXY=1 | 2 | false | true | loopback | 10.0.0.0/8,uniquelocal ...
function trustProxy(env) {
  const e = env || process.env;
  const raw = e.TRUST_PROXY;
  if (raw == null || String(raw).trim() === '') return isProd(e) ? 1 : false;
  const v = String(raw).trim();
  if (isOff(v)) return false;
  if (/^\d+$/.test(v)) return Number(v);
  // "true" trusts every hop, so a client can fake its IP; allowed but warned.
  if (isOn(v)) return true;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

const httpsBase = (e) => /^https:\/\//i.test(String(e.APP_BASE_URL || '').trim());

// Session cookie "secure" flag. COOKIE_SECURE=true | false | auto.
// Unset: production with an https APP_BASE_URL -> true; other production ->
// "auto" (Secure when the request arrived over HTTPS, as reported by the
// trusted proxy's X-Forwarded-Proto); development -> false.
function cookieSecure(env) {
  const e = env || process.env;
  const v = String(e.COOKIE_SECURE || '').trim().toLowerCase();
  if (v === 'auto') return 'auto';
  if (isOn(v)) return true;
  if (isOff(v)) return false;
  if (!isProd(e)) return false;
  return httpsBase(e) ? true : 'auto';
}

// HSTS only makes sense once the site is reachable over HTTPS.
function hsts(env) {
  const e = env || process.env;
  if (e.HSTS !== undefined && String(e.HSTS).trim() !== '') return isOn(e.HSTS);
  return isProd(e) && httpsBase(e);
}

// Directory with the built frontend (index.html, sw.js, assets/) when this
// process should serve it itself (Docker image). Unset: API only, as in dev.
function frontendDir(env) {
  const e = env || process.env;
  const v = String(e.SERVE_FRONTEND_DIR || '').trim();
  return v ? path.resolve(v) : null;
}

function origin(url) {
  try { return new URL(String(url).trim()).origin; } catch (_) { return null; }
}

// Startup checks. Errors stop a production start; warnings are logged.
function checkConfig(env) {
  const e = env || process.env;
  const errors = [];
  const warnings = [];
  if (!isProd(e)) return { errors, warnings };
  const secret = String(e.SESSION_SECRET || '');
  if (secret.length < 32 || /change_?me/i.test(secret)) errors.push('SESSION_SECRET must be a random string of at least 32 characters in production (openssl rand -base64 48).');
  if (!origin(e.APP_BASE_URL)) warnings.push('APP_BASE_URL is not set: email links and printed QR codes will point to ' + (e.FRONTEND_ORIGIN || 'http://localhost:3000') + '.');
  else if (!httpsBase(e)) warnings.push('APP_BASE_URL is not https: session cookies are not forced Secure and HSTS is off.');
  if (!e.KEY_ENCRYPTION_SECRET) warnings.push('KEY_ENCRYPTION_SECRET is not set: users cannot save their own Maps keys.');
  if (!e.SMTP_HOST) warnings.push('SMTP_HOST is not set: sale alert emails are logged and skipped.');
  if (trustProxy(e) === true) warnings.push('TRUST_PROXY=true trusts every X-Forwarded-For hop, so clients can fake their IP; prefer the number of proxies (e.g. 1).');
  const dir = frontendDir(e);
  if (dir && !fs.existsSync(path.join(dir, 'index.html'))) errors.push('SERVE_FRONTEND_DIR has no index.html: ' + dir);
  return { errors, warnings };
}

module.exports = { trustProxy, cookieSecure, hsts, frontendDir, origin, checkConfig, isOn };
