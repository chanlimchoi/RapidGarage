// Forgot-password links: one-time tokens emailed to the account's address.
//
// * The token is 32 random bytes (base64url); only its SHA-256 is stored, so a
//   database leak gives nobody a working link.
// * Links expire after PASSWORD_RESET_TTL_MINUTES (default 60) and work once.
//   Using one (or setting a new password any other way) voids the others.
// * Requests answer the same way whether or not the email has an account, and
//   are rate-limited per account (in the database) and per IP (in memory).
// * A new password bumps User.authVersion, which signs out every other session.
const crypto = require('crypto');
const { Op } = require('sequelize');
const i18n = require('./i18n');
const mailer = require('./mailer');

function models() { return require('../models'); }

function intEnv(name, dflt) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : dflt;
}

const ttlMinutes = () => intEnv('PASSWORD_RESET_TTL_MINUTES', 60);
const perAccountPerHour = () => intEnv('PASSWORD_RESET_MAX_PER_HOUR', 3);
const perIpPerHour = () => intEnv('PASSWORD_RESET_MAX_PER_IP_HOUR', 20);
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/; // base64url of 32 bytes, unpadded

function baseUrl() {
  return String(process.env.APP_BASE_URL || process.env.FRONTEND_ORIGIN || 'http://localhost:3000').trim().replace(/\/+$/, '');
}

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const resetUrl = (token) => baseUrl() + '/reset-password?t=' + encodeURIComponent(token);

// Same rule as signup, plus an upper bound (bcrypt only reads 72 bytes anyway).
function passwordError(password) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) return 'Password must be at least 8 characters.';
  if (password.length > PASSWORD_MAX) return 'Password must be 200 characters or fewer.';
  return null;
}

// ---- per-IP limit -------------------------------------------------------
const counters = require('./counters');
async function takeIpSlot(ip) {
  const key = 'password-reset-ip|' + ip;
  const max = perIpPerHour();
  const e = await counters.hit(key, 3600000);
  if (e.count > max) { await counters.decrement(key); return false; }
  return true;
}
const resetIpLimits = () => counters.reset();

// ---- email --------------------------------------------------------------
const esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function shell(lang, heading, paragraphs, button) {
  return `<!doctype html><html lang="${esc(lang)}"><body style="margin:0;padding:24px;background:#f6f5f2;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,'Apple SD Gothic Neo','Malgun Gothic','PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif;color:#1c1b19">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e7e4dd;border-radius:16px;padding:24px">
<p style="margin:0 0 4px;font-weight:700;color:#c2410c;font-size:14px">RapidGarage</p>
<h1 style="margin:0 0 16px;font-size:20px">${esc(heading)}</h1>
${paragraphs.map((p, i) => (button && i === 1
    ? `<p style="margin:0 0 16px"><a href="${esc(button.url)}" style="display:inline-block;background:#c2410c;color:#ffffff;font-weight:600;text-decoration:none;padding:10px 18px;border-radius:10px">${esc(button.label)}</a></p>\n<p style="margin:0 0 12px">${esc(p)}</p>`
    : `<p style="margin:0 0 12px">${esc(p)}</p>`)).join('\n')}
</div></body></html>`;
}

// Written in the account's saved language (English if none).
function renderResetEmail(user, token) {
  const lang = i18n.normalize(user.locale) || 'en';
  const L = (key, vars) => i18n.t(lang, key, vars);
  const url = resetUrl(token);
  const hello = user.firstName ? L('mail.hi', { name: user.firstName }) : L('mail.hiAnon');
  const minutes = ttlMinutes();
  const subject = L('reset.subject');
  const text = [hello, '', L('reset.intro'), '', url, '', L('reset.expires', { count: minutes }), L('reset.ignore')].join('\n');
  const html = shell(lang, L('reset.heading'), [hello, L('reset.intro') + ' ' + L('reset.expires', { count: minutes }), L('reset.ignore')],
    { url, label: L('reset.button') });
  return { subject, text, html, headers: { 'Content-Language': lang } };
}

function renderChangedEmail(user) {
  const lang = i18n.normalize(user.locale) || 'en';
  const L = (key, vars) => i18n.t(lang, key, vars);
  const hello = user.firstName ? L('mail.hi', { name: user.firstName }) : L('mail.hiAnon');
  const forgot = baseUrl() + '/forgot-password';
  const text = [hello, '', L('reset.changedIntro'), L('reset.changedNotYou', { url: forgot })].join('\n');
  const html = shell(lang, L('reset.changedHeading'), [hello, L('reset.changedIntro'), L('reset.changedNotYou', { url: forgot })]);
  return { subject: L('reset.changedSubject'), text, html, headers: { 'Content-Language': lang } };
}

// ---- flow ---------------------------------------------------------------
// Emails go out after the response, so how long a request takes doesn't say
// whether the account exists. Tests can await idle().
const inflight = new Set();
function track(fn, what) {
  const p = Promise.resolve().then(fn).catch((err) => console.error(what, err && (err.code || err.message))).finally(() => inflight.delete(p));
  inflight.add(p);
  return p;
}
const idle = () => Promise.all(Array.from(inflight));

// Resolves to { status: 'sent' | 'no_account' | 'limited' | 'not_configured' }.
// Callers must answer 'sent', 'no_account' and 'limited' the same way.
async function request(email, now) {
  const m = models();
  now = now || new Date();
  if (!mailer.isConfigured()) return { status: 'not_configured' };
  const user = await m.User.findOne({ where: { email: String(email).trim().toLowerCase() } });
  if (!user) return { status: 'no_account' };
  const recent = await m.PasswordReset.count({ where: { userId: user.id, createdAt: { [Op.gt]: new Date(now.getTime() - 3600000) } } });
  if (recent >= perAccountPerHour()) return { status: 'limited' };
  const token = crypto.randomBytes(32).toString('base64url');
  const row = await m.PasswordReset.create({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + ttlMinutes() * 60000) });
  const message = renderResetEmail(user, token);
  track(() => mailer.send({ to: user.email, subject: message.subject, text: message.text, html: message.html, headers: message.headers })
    // A link nobody received shouldn't count against the hourly limit.
    .catch((err) => row.destroy().then(() => { throw err; })), 'Password reset email to user ' + user.id + ' failed:');
  return { status: 'sent' };
}

// The live reset row for a token, or null (malformed, unknown, used, expired).
async function findValid(token, now) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const row = await models().PasswordReset.findOne({ where: { tokenHash: hashToken(token) } });
  if (!row || row.usedAt || row.expiresAt <= (now || new Date())) return null;
  return row;
}

// Sets a new password, voids every outstanding link and signs out other
// sessions. Resolves to the updated user. Used by reset and change.
async function setPassword(userId, password) {
  const m = models();
  const user = await m.User.scope('withPassword').findByPk(userId);
  if (!user) return null;
  await user.update({ password, authVersion: (user.authVersion || 0) + 1 });
  await m.PasswordReset.update({ usedAt: new Date() }, { where: { userId, usedAt: null } });
  // Best effort: the change already happened, a lost notice must not undo it.
  if (mailer.isConfigured()) {
    const notice = renderChangedEmail(user);
    track(() => mailer.send({ to: user.email, subject: notice.subject, text: notice.text, html: notice.html, headers: notice.headers }),
      'Password changed notice to user ' + userId + ' failed:');
  }
  return m.User.findByPk(userId);
}

// Resolves to { user } or { invalid: true }.
async function confirm(token, password, now) {
  const row = await findValid(token, now);
  if (!row) return { invalid: true };
  // Claim the link first so two simultaneous submits can't both use it.
  const [claimed] = await models().PasswordReset.update({ usedAt: new Date() }, { where: { id: row.id, usedAt: null } });
  if (!claimed) return { invalid: true };
  const user = await setPassword(row.userId, password);
  return user ? { user } : { invalid: true };
}

module.exports = {
  ttlMinutes, perAccountPerHour, perIpPerHour, PASSWORD_MIN, PASSWORD_MAX, hashToken, resetUrl, passwordError,
  takeIpSlot, resetIpLimits, renderResetEmail, renderChangedEmail, request, findValid, setPassword, confirm, idle,
};
