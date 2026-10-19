// Email verification (lib/emailVerify.js).
//   POST /verify-email/send      (login) email a new link
//   POST /verify-email/confirm   { token }  no login needed (the link may open on another device)
const router = require('express').Router();
const verify = require('../lib/emailVerify');
const { sendError, serverError, requireLogin } = require('../lib/http');

router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.post('/send', requireLogin, async (req, res) => {
  try {
    const status = await verify.send(req.user);
    if (status === 'limited') { res.set('Retry-After', '3600'); return sendError(res, 429, 'rate_limited', 'Too many requests. Please slow down and try again shortly.'); }
    if (status === 'not_configured') return sendError(res, 503, 'not_configured', "This server can't send email right now.");
    return res.json({ status });
  } catch (err) { return serverError(res, err); }
});

router.post('/confirm', async (req, res) => {
  try {
    const userId = await verify.confirm(req.body && req.body.token);
    if (!userId) return sendError(res, 400, 'invalid_token', 'This confirmation link is invalid or has expired. Ask for a new one.');
    return res.json({ verified: true });
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
