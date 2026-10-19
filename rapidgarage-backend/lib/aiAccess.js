// Which Anthropic key an AI request for a seller uses, and their daily budget.
// Shared by "Draft items from photos" and "Write title & description".
//
// Order: a one-time key sent with this request (used once, never stored),
// else the seller's saved key (lib/userAiKey.js), else the site's key.
// Own-key requests have their own, higher daily cap (they cost the site nothing).
const { aiStatus } = require('./features');
const userAiKey = require('./userAiKey');
const aiItems = require('./aiItems');
const { keysOverHttps } = require('./runtime');

// Resolves to { apiKey, source } or { error: { status, code, message, details?, retryAfter? } }.
// `oneTime` is the raw body value (the caller has already removed it from req.body).
async function pickKey(req, oneTime, disabledMessage) {
  const ai = await aiStatus();
  if (!ai.enabled) return { error: { status: 404, code: 'feature_disabled', message: disabledMessage } };
  if (oneTime !== undefined) {
    if (!ai.userKeys) return { error: { status: 404, code: 'feature_disabled', message: 'Using your own AI key is turned off on this server.' } };
    if (!keysOverHttps(req)) return { error: { status: 400, code: 'bad_request', message: 'Keys can only be sent over HTTPS.' } };
    if (!(await userAiKey.takeAttempt(req.user.id))) return { error: { status: 429, code: 'rate_limited', message: 'Too many key attempts. Please try again later.', retryAfter: 3600 } };
    const apiKey = userAiKey.normalize(oneTime);
    if (!apiKey) return { error: { status: 400, code: 'bad_request', message: 'Invalid request.', details: { oneTimeKey: 'That does not look like an Anthropic API key (they start with "sk-ant-").' } } };
    return { apiKey, source: 'one_time' };
  }
  if (ai.userKeys) {
    const saved = await userAiKey.load(req.user.id);
    if (saved) return { apiKey: saved, source: 'saved' };
  }
  if (!ai.site) return { error: { status: 400, code: 'needs_key', message: 'Add your own Anthropic key in Settings, or paste one to use just once.' } };
  return { apiKey: null, source: 'site' };
}

const bucketOf = (userId, source) => (source === 'site' ? userId : 'own:' + userId);
const takeBudget = (userId, source) => aiItems.takeSlot(bucketOf(userId, source), source === 'site' ? aiItems.perDay() : aiItems.perDayOwnKey());
const giveBack = (userId, source) => aiItems.giveBack(bucketOf(userId, source));

// Send an error descriptor the same way every endpoint does.
function sendPicked(res, error) {
  const { sendError } = require('./http');
  if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
  return sendError(res, error.status, error.code, error.message, error.details);
}

module.exports = { pickKey, takeBudget, giveBack, sendPicked };
