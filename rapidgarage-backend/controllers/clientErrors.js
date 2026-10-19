// POST /client-errors: the web app reports its own crashes here (an uncaught
// error, a rejected promise, or a React render error), and they are forwarded
// to error tracking (lib/errorTracking.js). Only used when SENTRY_DSN is set;
// /config tells the app whether to send anything.
//
// Body: { kind: 'error'|'rejection'|'render', message, stack?, path?, release? }
// Always 204 (even when dropped), so the endpoint tells nobody anything.
// At most CLIENT_ERRORS_PER_HOUR (20) reports per IP per hour.
const router = require('express').Router();
const counters = require('../lib/counters');
const { clientKey } = require('../lib/rateLimit');
const errorTracking = require('../lib/errorTracking');

const KINDS = ['error', 'rejection', 'render'];
function perHour() {
  const n = Number(process.env.CLIENT_ERRORS_PER_HOUR);
  return Number.isInteger(n) && n >= 1 ? n : 20;
}
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

router.post('/', async (req, res) => {
  res.status(204).end();
  try {
    if (!errorTracking.enabled()) return;
    const b = req.body || {};
    const message = str(b.message, 1000).trim();
    if (!message || !KINDS.includes(b.kind)) return;
    const hit = await counters.hit('client-errors|' + clientKey(req.ip), 3600000);
    if (hit.count > perHour()) return;
    // A path inside the app only (no query string or other site).
    const path = str(b.path, 300).split('?')[0].split('#')[0];
    const err = new Error(message);
    err.name = 'ClientError';
    const stack = str(b.stack, 6000);
    if (stack) err.stack = stack;
    errorTracking.capture(err, {
      req, source: 'client',
      tags: Object.assign({ kind: b.kind }, path.startsWith('/') ? { page: path } : {}, str(b.release, 64) ? { clientRelease: str(b.release, 64) } : {}),
    });
  } catch (err) { /* never fail the page over a report */ }
});

module.exports = router;
