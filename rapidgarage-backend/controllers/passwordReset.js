// Forgot password (lib/passwordReset.js).
//   POST /password-reset          { email }            -> 202, same answer for any email
//   POST /password-reset/check    { token }            -> { valid }
//   POST /password-reset/confirm  { token, password }  -> logs in, { user }
const router = require('express').Router();
const reset = require('../lib/passwordReset');
const { EMAIL_RE } = require('../lib/validate');
const { badRequest, sendError, serverError } = require('../lib/http');

function noStore(res) {
  res.set('Cache-Control', 'no-store');
}

router.post('/', async (req, res) => {
  noStore(res);
  const email = req.body && typeof req.body.email === 'string' ? req.body.email.trim() : '';
  if (!EMAIL_RE.test(email)) return badRequest(res, 'Invalid request.', { email: 'A valid email is required.' });
  if (!reset.takeIpSlot(req.ip)) {
    res.set('Retry-After', '3600');
    return sendError(res, 429, 'rate_limited', 'Too many reset requests. Please try again later.');
  }
  try {
    const { status } = await reset.request(email);
    if (status === 'not_configured') {
      return sendError(res, 503, 'not_configured', "Password reset emails aren't available on this server. Contact the site's administrator.");
    }
    // sent / no_account / limited all look the same (no account enumeration).
    return res.status(202).json({ ok: true, expiresInMinutes: reset.ttlMinutes() });
  } catch (err) {
    return serverError(res, err);
  }
});

router.post('/check', async (req, res) => {
  noStore(res);
  try {
    const row = await reset.findValid(req.body && req.body.token);
    return res.json({ valid: !!row });
  } catch (err) {
    return serverError(res, err);
  }
});

router.post('/confirm', async (req, res, next) => {
  noStore(res);
  const body = req.body || {};
  const pwError = reset.passwordError(body.password);
  if (pwError) return badRequest(res, 'Invalid request.', { password: pwError });
  try {
    const out = await reset.confirm(body.token, body.password);
    if (out.invalid) return sendError(res, 400, 'invalid_token', 'This reset link is invalid or has expired. Request a new one.');
    // Start a fresh session (new id) for the person who just proved they own the email.
    return req.session.regenerate((err) => {
      if (err) return next(err);
      return req.login(out.user, (loginErr) => {
        if (loginErr) return next(loginErr);
        return res.json({ user: out.user.toJSON() });
      });
    });
  } catch (err) {
    return serverError(res, err);
  }
});

module.exports = router;
