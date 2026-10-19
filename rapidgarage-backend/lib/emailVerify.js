// Email verification: new local accounts confirm their address before they
// can post sales, wanted posts or neighborhood sales, or message anyone (the
// things spammers sign up for). Everything else works right away.
//
// * Enforced when REQUIRE_EMAIL_VERIFICATION is on (default: on in production,
//   off in development and tests) and SMTP is configured (no way to verify
//   without email).
// * Links: 32 random bytes, only the SHA-256 stored, valid 48 hours, single
//   use. Sending is limited to 5 an hour per account.
// * Google sign-in (Google verified the address) and a completed password
//   reset (the person read mail sent to it) count as verified. Accounts that
//   existed before this feature were marked verified by the migration.
const crypto = require('crypto');
const { Op } = require('sequelize');
const i18n = require('./i18n');
const mailer = require('./mailer');
const counters = require('./counters');
const { sendError } = require('./http');

function models() { return require('../models'); }

const TTL_MS = 48 * 3600000;
const SENDS_PER_HOUR = 5;

function required() {
  const raw = process.env.REQUIRE_EMAIL_VERIFICATION;
  const on = raw === undefined || String(raw).trim() === '' ? process.env.NODE_ENV === 'production' : /^(1|true|yes|on)$/i.test(String(raw).trim());
  return on && mailer.isConfigured();
}

const isVerified = (user) => !!(user && user.emailVerifiedAt);
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const baseUrl = () => require('./alerts').baseUrl();

const inflight = new Set();
const idle = async () => { while (inflight.size) await Promise.all(Array.from(inflight)); };

// Keep a promise visible to idle() until it settles. Signup fires a send
// without awaiting it, so idle() has to see the whole operation -- the counter
// hit and the row insert too, not just the mail attempt -- or it can return
// while the send is still awaiting its first database round-trip.
function track(promise) {
  inflight.add(promise);
  const done = () => inflight.delete(promise);
  promise.then(done, done);
  return promise;
}

// Email a fresh link. Resolves to 'sent' | 'verified' | 'limited' | 'not_configured'.
function send(user) { return track(sendLink(user)); }

async function sendLink(user) {
  if (isVerified(user)) return 'verified';
  if (!mailer.isConfigured()) return 'not_configured';
  const key = 'verify-send|' + user.id;
  const e = await counters.hit(key, 3600000);
  if (e.count > SENDS_PER_HOUR) { await counters.decrement(key); return 'limited'; }
  const token = crypto.randomBytes(32).toString('base64url');
  await models().EmailVerification.create({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + TTL_MS) });
  const lang = i18n.normalize(user.locale) || 'en';
  const L = (k, v) => i18n.t(lang, k, v);
  const url = baseUrl() + '/verify-email?t=' + encodeURIComponent(token);
  const hello = user.firstName ? L('mail.hi', { name: user.firstName }) : L('mail.hiAnon');
  track(mailer.send({
    to: user.email,
    subject: L('verify.subject'),
    text: [hello, '', L('verify.intro'), '', url, '', L('verify.expires'), L('verify.ignore')].join('\n'),
    headers: { 'Content-Language': lang },
  }).catch((err) => console.error('Verification email to user ' + user.id + ' failed:', err && (err.code || err.name))));
  return 'sent';
}

async function markVerified(userId) {
  await models().User.update({ emailVerifiedAt: new Date() }, { where: { id: userId, emailVerifiedAt: null } });
  await models().EmailVerification.update({ usedAt: new Date() }, { where: { userId, usedAt: null } });
}

// Resolves to the verified user id, or null for an invalid/used/expired link.
async function confirm(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const m = models();
  const row = await m.EmailVerification.findOne({ where: { tokenHash: hashToken(token), usedAt: null, expiresAt: { [Op.gt]: new Date() } } });
  if (!row) return null;
  const [claimed] = await m.EmailVerification.update({ usedAt: new Date() }, { where: { id: row.id, usedAt: null } });
  if (!claimed) return null;
  await markVerified(row.userId);
  return row.userId;
}

// Middleware for the spam-prone actions.
function requireVerified(req, res, next) {
  if (!required() || isVerified(req.user)) return next();
  return sendError(res, 403, 'email_unverified', 'Confirm your email address first: open the link we sent you, or ask for a new one.');
}

module.exports = { required, isVerified, send, confirm, markVerified, requireVerified, idle, hashToken, TTL_MS };
