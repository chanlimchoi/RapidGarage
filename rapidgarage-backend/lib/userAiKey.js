// Bring-your-own Anthropic key for "Draft items from photos" (lib/aiItems.js).
//
// Two ways to use one:
//   * Saved: encrypted at rest (AES-256-GCM, lib/secretBox.js v2) with the
//     context "ai-key:user:<id>", so the ciphertext only decrypts for that row.
//     Saving needs the account password (when it has one), is checked against
//     Anthropic first and emails a notice. Deleting erases it immediately.
//     It is decrypted only inside the request that uses it.
//   * One-time: sent with a single draft request, used for that one call and
//     dropped. Never written to the database, session, logs or any cache.
//
// Either way the key never leaves the server again: no endpoint returns it
// (only the last 4 characters), errors never include it, and admins can't
// see it. Submitting keys is rate-limited per account, so the app can't be
// used to test leaked keys in bulk.
const secretBox = require('./secretBox');
const mailer = require('./mailer');
const i18n = require('./i18n');

function models() { return require('../models'); }

// Anthropic API keys: "sk-ant-" + URL-safe characters.
const KEY_RE = /^sk-ant-[A-Za-z0-9_-]{20,200}$/;
const context = (userId) => 'ai-key:user:' + userId;

function intEnv(name, dflt) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : dflt;
}
const attemptsPerHour = () => intEnv('AI_KEY_ATTEMPTS_PER_HOUR', 10);

// Trim, and only accept something shaped like an Anthropic key.
function normalize(raw) {
  const key = typeof raw === 'string' ? raw.trim() : '';
  return KEY_RE.test(key) ? key : null;
}

// ---- attempt limit (saving and one-time keys share it) --------------------
const counters = require('./counters');
async function takeAttempt(userId) {
  const key = 'ai-key-attempts|' + userId;
  const max = attemptsPerHour();
  const e = await counters.hit(key, 3600000);
  if (e.count > max) { await counters.decrement(key); return false; }
  return true;
}
const resetAttempts = () => counters.reset();

// ---- verification -----------------------------------------------------------
// One free request (list one model) proves the key works before it's saved.
// Resolves to 'ok' | 'rejected' | 'unavailable'. Tests replace it.
let verifier = null;
async function defaultVerify(key) {
  const sdk = require('@anthropic-ai/sdk');
  const Anthropic = sdk.default || sdk;
  const client = new Anthropic({ apiKey: key, timeout: 15000, maxRetries: 0 });
  try {
    await client.models.list({ limit: 1 });
    return 'ok';
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return 'rejected';
    return 'unavailable';
  }
}
const verify = (key) => (verifier || defaultVerify)(key);
function setVerifier(fn) { verifier = fn || null; }

// ---- saved keys ------------------------------------------------------------
async function status(userId) {
  const u = await models().User.findByPk(userId, { attributes: ['id', 'aiKeyLast4', 'aiKeySetAt'] });
  return { hasKey: !!(u && u.aiKeyLast4), last4: u && u.aiKeyLast4 ? u.aiKeyLast4 : null, setAt: u ? u.aiKeySetAt : null };
}

async function save(user, key) {
  await models().User.update({ aiKeyEncrypted: secretBox.encrypt(key, context(user.id)), aiKeyLast4: key.slice(-4), aiKeySetAt: new Date() }, { where: { id: user.id } });
  notify(user, 'aikey.addedSubject', 'aikey.addedText', key.slice(-4));
}

async function remove(user) {
  const [n] = await models().User.update({ aiKeyEncrypted: null, aiKeyLast4: null, aiKeySetAt: null }, { where: { id: user.id } });
  if (n && user.aiKeyLast4) notify(user, 'aikey.removedSubject', 'aikey.removedText', user.aiKeyLast4);
}

// The saved key in plain text, for one request; null when there is none or it
// can't be decrypted (wrong secret, or a value copied from another row).
async function load(userId) {
  const u = await models().User.scope('withAiKey').findByPk(userId, { attributes: ['id', 'aiKeyEncrypted'] });
  if (!u || !u.aiKeyEncrypted || !secretBox.isConfigured()) return null;
  try { return secretBox.decrypt(u.aiKeyEncrypted, context(userId)); } catch (err) {
    console.error('AI key for user ' + userId + ' could not be decrypted (wrong KEY_ENCRYPTION_SECRET or tampered value)');
    return null;
  }
}

// "An AI key was added/removed" email, so a stolen session can't change it quietly.
function notify(user, subjectKey, textKey, last4) {
  if (!mailer.isConfigured() || !user.email) return;
  const lang = i18n.normalize(user.locale) || 'en';
  const L = (k, v) => i18n.t(lang, k, v);
  const hello = user.firstName ? L('mail.hi', { name: user.firstName }) : L('mail.hiAnon');
  const text = [hello, '', L(textKey, { last4 }), L('aikey.notYou')].join('\n');
  mailer.send({ to: user.email, subject: L(subjectKey), text, headers: { 'Content-Language': lang } })
    .catch((err) => console.error('AI key notice to user ' + user.id + ' failed:', err && (err.code || err.name)));
}

module.exports = { KEY_RE, normalize, takeAttempt, resetAttempts, verify, setVerifier, status, save, remove, load, attemptsPerHour };
