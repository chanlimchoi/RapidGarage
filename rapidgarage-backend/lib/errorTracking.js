// Error tracking (optional): unexpected server errors, and errors the web app
// reports through POST /client-errors, go to Sentry when SENTRY_DSN is set.
// Without it nothing is loaded or sent, and errors are only logged as before.
//
// Privacy: no cookies, headers, request bodies, query strings, IP addresses or
// user emails are sent; only the user id, the route (path without its query)
// and the error. Messages and stacks are scrubbed of email addresses, API keys
// (sk-ant-..., AWS-style keys), bearer tokens and long secrets before sending.
let sentry = null; // the @sentry/node module once initialized
let override = null; // tests: setReporter({ capture(err, ctx) })

const dsn = () => String(process.env.SENTRY_DSN || '').trim();
const enabled = () => !!override || !!sentry;

function sampleRate() {
  const n = Number(process.env.SENTRY_SAMPLE_RATE);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 1;
}

// ---- scrubbing --------------------------------------------------------------
const PATTERNS = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]'],
  [/sk-ant-[A-Za-z0-9_-]+/g, '[api-key]'],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '[aws-key]'],
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [token]'],
  [/(postgres(?:ql)?:\/\/)[^\s@/]+@/gi, '$1[credentials]@'],
  [/\b[A-Za-z0-9_-]{40,}\b/g, '[secret]'],
];
function scrub(text) {
  if (typeof text !== 'string') return text;
  return PATTERNS.reduce((s, [re, to]) => s.replace(re, to), text).slice(0, 8000);
}

// Sentry beforeSend: drop everything about the request except method and path,
// scrub messages, exception values and breadcrumbs.
function beforeSend(event) {
  if (event.request) {
    const url = String(event.request.url || '').split('?')[0];
    event.request = { method: event.request.method, url: scrub(url) };
  }
  if (event.user) event.user = event.user.id ? { id: String(event.user.id) } : undefined;
  delete event.server_name;
  if (event.message) event.message = scrub(event.message);
  ((event.exception && event.exception.values) || []).forEach((v) => {
    v.value = scrub(v.value);
    ((v.stacktrace && v.stacktrace.frames) || []).forEach((f) => { delete f.vars; });
  });
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.filter((b) => b.category !== 'http' && b.category !== 'console').map((b) => Object.assign({}, b, { message: scrub(b.message), data: undefined }));
  if (event.extra) Object.keys(event.extra).forEach((k) => { event.extra[k] = scrub(typeof event.extra[k] === 'string' ? event.extra[k] : JSON.stringify(event.extra[k])); });
  return event;
}

// Called once at startup (app.js). Safe to call without a DSN.
function init(env) {
  const e = env || process.env;
  if (sentry || !String(e.SENTRY_DSN || '').trim()) return false;
  const S = require('@sentry/node');
  S.init({
    dsn: String(e.SENTRY_DSN).trim(),
    environment: String(e.SENTRY_ENVIRONMENT || e.NODE_ENV || 'production'),
    release: String(e.SENTRY_RELEASE || e.APP_VERSION || '').trim() || undefined,
    sampleRate: sampleRate(),
    // Errors only: no performance tracing, no automatic HTTP/console capture.
    tracesSampleRate: 0,
    sendDefaultPii: false,
    defaultIntegrations: false,
    integrations: [S.onUncaughtExceptionIntegration(), S.onUnhandledRejectionIntegration({ mode: 'warn' }), S.linkedErrorsIntegration()],
    beforeSend,
  });
  sentry = S;
  return true;
}

// ctx: { req?, source?: 'server'|'client', tags?, extra? }
function capture(err, ctx) {
  const c = ctx || {};
  try {
    if (override) return override.capture(err, c);
    if (!sentry) return undefined;
    sentry.withScope((scope) => {
      const req = c.req;
      if (req) {
        scope.setTag('method', req.method);
        scope.setTag('route', String((req.baseUrl || '') + ((req.route && req.route.path) || req.path || '')).slice(0, 200));
        if (req.user && req.user.id) scope.setUser({ id: String(req.user.id) });
      }
      scope.setTag('source', c.source || 'server');
      Object.entries(c.tags || {}).forEach(([k, v]) => scope.setTag(k, String(v).slice(0, 200)));
      Object.entries(c.extra || {}).forEach(([k, v]) => scope.setExtra(k, v));
      sentry.captureException(err);
    });
  } catch (e) { /* never let reporting break a response */ }
  return undefined;
}

// Before exit: give queued events a moment to leave.
async function flush(ms) { if (sentry) { try { await sentry.flush(ms || 2000); } catch (e) { /* ignore */ } } }

function setReporter(r) { override = r || null; }

module.exports = { init, capture, flush, scrub, beforeSend, enabled, dsn, setReporter };
