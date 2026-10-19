// "Draft items from photos": Claude looks at a sale's photos and suggests
// item names with typical garage-sale prices. Nothing is saved here; the
// seller reviews, edits and picks suggestions, then adds them through the
// normal item API (controllers/items.js).
//
// * On only when ANTHROPIC_API_KEY is set (and the admin switch is on).
// * Only the stored photos (already resized, EXIF/GPS stripped) and a fixed
//   prompt are sent: no names, emails, addresses or sale text.
// * Each seller gets AI_ITEMS_PER_DAY drafts per 24 hours (in memory, per
//   process): the call costs money.
const { getStorage } = require('./storage');
const items = require('./items');
const i18n = require('./i18n');

function intEnv(name, dflt) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : dflt;
}

const MAX_PHOTOS = 5;
const MAX_SUGGESTIONS = 40;
const model = () => String(process.env.AI_ITEMS_MODEL || '').trim() || 'claude-opus-5-5';
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const effort = () => { const e = String(process.env.AI_ITEMS_EFFORT || '').trim(); return EFFORTS.includes(e) ? e : 'medium'; };
const perDay = () => intEnv('AI_ITEMS_PER_DAY', 10);
const timeoutMs = () => intEnv('AI_ITEMS_TIMEOUT_MS', 90000);

const isConfigured = () => !!override || !!String(process.env.ANTHROPIC_API_KEY || '').trim();

// ---- client --------------------------------------------------------------
let client = null;
let clientKey = null;
let override = null; // tests: setClient({ beta: { messages: { create } } })

function getClient() {
  if (override) return override;
  const key = String(process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) return null;
  if (!client || clientKey !== key) {
    const sdk = require('@anthropic-ai/sdk');
    const Anthropic = sdk.default || sdk;
    client = new Anthropic({ apiKey: key, timeout: timeoutMs(), maxRetries: 1 });
    clientKey = key;
  }
  return client;
}
function setClient(c) { override = c || null; }

// A client for a person's own key (saved or one-time): made for this one
// request and never cached, so the key isn't kept once the request is done.
// Tests: setKeyClientFactory((apiKey) => fakeClient).
let keyFactory = null;
function clientForKey(apiKey) {
  if (keyFactory) return keyFactory(apiKey);
  const sdk = require('@anthropic-ai/sdk');
  const Anthropic = sdk.default || sdk;
  return new Anthropic({ apiKey, timeout: timeoutMs(), maxRetries: 1 });
}
function setKeyClientFactory(fn) { keyFactory = fn || null; }
const perDayOwnKey = () => intEnv('AI_ITEMS_PER_DAY_OWN_KEY', 50);

// ---- daily budget ---------------------------------------------------------
// Counted in lib/counters.js (shared by instances with RATE_LIMIT_STORE=db).
// bucket: the user id for the site's key, 'own:<id>' for their own key
// (own-key drafts cost the site nothing, so they have a higher cap).
const counters = require('./counters');
async function takeSlot(bucket, limit) {
  const key = 'ai-drafts|' + bucket;
  const max = limit || perDay();
  const e = await counters.hit(key, 86400000);
  if (e.count > max) { await counters.decrement(key); return false; }
  return true;
}
// A failed call (our side or Anthropic's) doesn't use up a draft.
const giveBack = (bucket) => counters.decrement('ai-drafts|' + bucket);
const resetBudgets = () => counters.reset();

// ---- request ----------------------------------------------------------------
const LANGUAGE_NAMES = { en: 'English', es: 'Spanish', ko: 'Korean', 'zh-CN': 'Simplified Chinese' };

// Structured output: Claude's reply must match this schema.
const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short item name a buyer would search for, e.g. "Oak dresser, 6 drawers".' },
          price_cents: { type: 'integer', description: 'Suggested garage-sale price in US cents, or -1 if unsure.' },
          photo: { type: 'integer', description: '1-based number of the photo the item is in.' },
        },
        required: ['name', 'price_cents', 'photo'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

function prompt(lang, count) {
  return [
    'These ' + count + ' photo(s) are from a garage or yard sale listing. List the distinct items that are clearly for sale, so the seller can add them to the listing.',
    '',
    'Guidelines:',
    '- One entry per sellable item or obvious set (e.g. "Set of 4 dining chairs"). Skip people, pets, the house, cars in the driveway, fixtures and anything that is clearly not for sale.',
    '- Names: short and specific (at most 60 characters), written in ' + (LANGUAGE_NAMES[lang] || 'English') + '. Mention brand, material or size only when visible.',
    '- price_cents: a typical asking price at a US garage sale for a used item in the condition shown (usually 10-30% of retail, rounded to a friendly amount like 50 cents or whole dollars). Use -1 when you cannot judge.',
    '- photo: the 1-based number of the photo where the item appears.',
    '- At most ' + MAX_SUGGESTIONS + ' items. If nothing is clearly for sale, return an empty list.',
  ].join('\n');
}

// Clean the model's list: trim, cap lengths, keep sane prices, drop duplicates.
function sanitize(list, photoIds) {
  const seen = new Set();
  const out = [];
  (Array.isArray(list) ? list : []).forEach((s) => {
    if (!s || typeof s.name !== 'string') return;
    const name = s.name.trim().replace(/\s+/g, ' ').slice(0, items.NAME_MAX);
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    const p = s.price_cents;
    const priceCents = Number.isInteger(p) && p >= 0 && p <= items.PRICE_CAP_CENTS ? p : null;
    const idx = Number.isInteger(s.photo) ? s.photo - 1 : -1;
    out.push({ name, priceCents, photoId: idx >= 0 && idx < photoIds.length ? photoIds[idx] : null });
  });
  return out.slice(0, MAX_SUGGESTIONS);
}

// photos: PostPhoto rows (in display order). lang: seller's language.
// Resolves to { suggestions } or rejects with err.code:
//   not_configured | refused | truncated | bad_output | ai_unavailable | ai_rate_limited
// opts.apiKey: the person's own key (used for this call only).
// One structured-output request; resolves to the parsed JSON. Errors carry
// err.code: not_configured | refused | truncated | bad_output | ai_unavailable |
// ai_rate_limited | own_key_rejected.
async function structuredCall(content, schema, opts) {
  const ownKey = opts && opts.apiKey;
  const c = ownKey ? clientForKey(ownKey) : getClient();
  if (!c) { const e = new Error('AI is not configured'); e.code = 'not_configured'; throw e; }
  let response;
  try {
    response = await c.beta.messages.create({
      model: model(),
      max_tokens: 16000,
      // Opus 5.5 always thinks; effort sets how much (its default is medium).
      output_config: { effort: effort(), format: { type: 'json_schema', schema } },
      // A policy decline is retried on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content }],
    });
  } catch (err) {
    const sdk = require('@anthropic-ai/sdk');
    const Anthropic = sdk.default || sdk;
    const e = new Error('AI request failed: ' + (err && err.message));
    if (err instanceof Anthropic.RateLimitError) e.code = 'ai_rate_limited';
    else if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) e.code = ownKey ? 'own_key_rejected' : 'not_configured';
    else e.code = 'ai_unavailable'; // timeouts, connection errors, 5xx, 400s from a bad config
    // Only the status and class name: nothing from the request (which carried the key).
    e.cause = { status: err && err.status, name: err && err.name };
    throw e;
  }
  if (response.stop_reason === 'refusal') { const e = new Error('AI declined'); e.code = 'refused'; throw e; }
  if (response.stop_reason === 'max_tokens') { const e = new Error('AI output was cut off'); e.code = 'truncated'; throw e; }
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse(text); } catch (err) { const e = new Error('AI returned invalid JSON'); e.code = 'bad_output'; throw e; }
}

async function imageBlocks(photos) {
  const storage = getStorage();
  const images = await Promise.all(photos.map((p) => storage.read(p.storageKey)));
  const content = [];
  images.forEach((buf, i) => {
    content.push({ type: 'text', text: 'Photo ' + (i + 1) + ':' });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/webp', data: buf.toString('base64') } });
  });
  return content;
}

async function suggest(photos, lang, opts) {
  const use = photos.slice(0, MAX_PHOTOS);
  const content = await imageBlocks(use);
  content.push({ type: 'text', text: prompt(i18n.normalize(lang) || 'en', use.length) });
  const parsed = await structuredCall(content, SCHEMA, opts);
  return { suggestions: sanitize(parsed && parsed.items, use.map((p) => p.id)) };
}

// ---- title & description --------------------------------------------------
const NL = String.fromCharCode(10);
const TITLE_MAX = 80;
const DESCRIPTION_MAX = 1200;
const DESCRIBE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Listing title, at most 80 characters.' },
    description: { type: 'string', description: 'Listing description, 2-5 short sentences.' },
  },
  required: ['title', 'description'],
  additionalProperties: false,
};

// Write a title and description from the sale's item names and up to 3
// photos. Only the item names, prices and city are sent (no street address).
async function describe(post, items, photos, lang, opts) {
  const l = i18n.normalize(lang) || 'en';
  const names = (items || []).filter((i) => !i.sold).map((i) => i.name + (i.priceCents ? ' ($' + (i.priceCents / 100).toFixed(i.priceCents % 100 ? 2 : 0) + ')' : '')).slice(0, 60);
  const content = await imageBlocks((photos || []).slice(0, 3));
  content.push({ type: 'text', text: [
    'Write a listing title and description for this garage/yard sale, in ' + (LANGUAGE_NAMES[l] || 'English') + '.',
    'Facts you may use (do not invent others; never add an address, phone number or prices that are not listed):',
    '- Kind of sale: ' + (post.title ? 'currently titled "' + String(post.title).slice(0, 120) + '"' : 'not titled yet'),
    '- Area: ' + ([post.city, post.state].filter(Boolean).join(', ') || 'not given'),
    names.length ? '- Items: ' + names.join('; ') : '- Items: see the photos',
    'Title: at most 80 characters, friendly and specific (mention the best 2-3 kinds of items). Description: 2-5 short sentences highlighting what is for sale; no emoji, no ALL CAPS, no exclamation marks in every sentence.',
  ].join(NL) });
  const parsed = await structuredCall(content, DESCRIBE_SCHEMA, opts);
  const clean = (v, max) => String(v || '').split(NL).join(' ').replace(/ {2,}/g, ' ').trim().slice(0, max);
  const title = clean(parsed.title, TITLE_MAX);
  const description = String(parsed.description || '').trim().slice(0, DESCRIPTION_MAX);
  if (!title) { const e = new Error('empty title'); e.code = 'bad_output'; throw e; }
  return { title, description };
}

module.exports = { MAX_PHOTOS, MAX_SUGGESTIONS, SCHEMA, model, effort, perDay, isConfigured, getClient, setClient, setKeyClientFactory, perDayOwnKey, describe, DESCRIBE_SCHEMA, takeSlot, giveBack, resetBudgets, prompt, sanitize, suggest };
