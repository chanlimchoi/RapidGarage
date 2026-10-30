// Photo-to-listing: after a seller picks a photo on "Post a sale", suggest a
// title, a category and a price range. Nothing is saved or submitted here:
// the seller accepts or edits each suggestion in the form and publishes as usual.
//
// * With a vision provider (any OpenAI-compatible chat-completions endpoint:
//   VISION_API_BASE_URL + VISION_MODEL, VISION_API_KEY if it needs one) the
//   photo is described by that model. Only a resized JPEG without metadata
//   (no EXIF/GPS) and a fixed prompt are sent: no names, emails or addresses.
// * Without one, or when it fails, suggestions come from similar past sales
//   on this site: the category is guessed from words the seller typed (and the
//   photo's file name), and the price range is the median of recent sales in
//   that category (or a typical range when there are too few).
// * The provider is optional and never required; VISION_PER_DAY caps calls
//   per seller per 24 hours (in memory, per process).
const { Op } = require('sequelize');
const sharp = require('sharp');
const { sniffImageType } = require('./photos');
const { CATEGORIES, CATEGORY_KEYS, normalize } = require('./wanted');
const { PRICE_CAP } = require('./price');
const i18n = require('./i18n');

function models() { return require('../models'); }

function intEnv(name, dflt) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : dflt;
}

const TITLE_MAX = 80;
const HINT_MAX = 255;
const IMAGE_PX = 768;
const MIN_SAMPLES = 3;
const SAMPLE_LIMIT = 200;
const SAMPLE_DAYS = 365;
const perDay = () => intEnv('VISION_PER_DAY', 20);
const timeoutMs = () => intEnv('VISION_TIMEOUT_MS', 20000);
const baseUrl = () => String(process.env.VISION_API_BASE_URL || '').trim().replace(/\/+$/, '');
const modelName = () => String(process.env.VISION_MODEL || '').trim();

// Typical garage-sale ranges (whole dollars) when there are too few similar sales.
const TYPICAL = {
  furniture: [10, 150], electronics: [5, 100], kids: [2, 40], clothing: [1, 20], tools: [5, 60], sports: [5, 80],
  books: [1, 10], kitchen: [1, 25], toys: [1, 20], garden: [2, 40], music: [10, 150], decor: [2, 40], '': [1, 50],
};

// ---- vision provider (tests replace fetch) ---------------------------------
let fetchOverride = null; // async (url, init) -> Response-like
function setFetch(fn) { fetchOverride = fn || null; }
const doFetch = (url, init) => (fetchOverride || fetch)(url, init);

function isConfigured() {
  const base = baseUrl();
  if (!base || !modelName()) return false;
  try { const u = new URL(base); return u.protocol === 'https:' || u.protocol === 'http:'; } catch (e) { return false; }
}

const budgets = new Map(); // userId -> [timestamps]
function takeBudget(userId) {
  const now = Date.now();
  const list = (budgets.get(userId) || []).filter((t) => now - t < 24 * 3600 * 1000);
  if (list.length >= perDay()) { budgets.set(userId, list); return false; }
  list.push(now);
  budgets.set(userId, list);
  return true;
}
const resetBudgets = () => budgets.clear();

// A small JPEG with no metadata (sharp drops EXIF/GPS unless asked to keep it).
async function visionImage(buf) {
  return sharp(buf, { limitInputPixels: 50e6 }).rotate()
    .resize({ width: IMAGE_PX, height: IMAGE_PX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 }).toBuffer();
}

const LANG_NAMES = { en: 'English', es: 'Spanish', ko: 'Korean', 'zh-CN': 'Simplified Chinese' };
function prompt(lang) {
  return 'This photo is from a garage or yard sale listing. Suggest a short listing title (at most 60 characters, in '
    + (LANG_NAMES[lang] || 'English') + ', no addresses or personal details), one category from this list or null: '
    + CATEGORY_KEYS.join(', ') + ', and a typical US garage-sale price range for what is shown, in whole dollars. '
    + 'Answer with only a JSON object: {"title": string, "category": string|null, "price_min": integer, "price_max": integer}.';
}

// The first {...} in the model's text (some providers wrap JSON in ``` fences).
function parseJson(text) {
  const s = String(text || '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch (e) { return null; }
}

const wholeDollars = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(/[$,\s]/g, '')) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  return Math.min(PRICE_CAP, Math.round(n));
};
function cleanTitle(v) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^["'“]+|["'”]+$/g, '');
  return s ? s.slice(0, TITLE_MAX) : null;
}
function cleanRange(min, max) {
  let a = wholeDollars(min);
  let b = wholeDollars(max);
  if (a === null && b === null) return { priceMin: null, priceMax: null };
  if (a === null) a = b;
  if (b === null) b = a;
  if (a > b) { const t = a; a = b; b = t; }
  return { priceMin: a, priceMax: b };
}

async function askVision(buf, lang) {
  const jpeg = await visionImage(buf);
  const headers = { 'Content-Type': 'application/json' };
  const key = String(process.env.VISION_API_KEY || '').trim();
  if (key) headers.Authorization = 'Bearer ' + key;
  const body = {
    model: modelName(),
    max_tokens: 300,
    temperature: 0.2,
    messages: [{ role: 'user', content: [
      { type: 'text', text: prompt(lang) },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + jpeg.toString('base64') } },
    ] }],
  };
  const res = await doFetch(baseUrl() + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs()), redirect: 'error' });
  if (!res || !res.ok) { const e = new Error('vision_http'); e.code = 'vision_http'; e.status = res && res.status; throw e; }
  const data = await res.json();
  const choice = data && data.choices && data.choices[0];
  const content = choice && choice.message && choice.message.content;
  const text = Array.isArray(content) ? content.map((c) => (c && c.text) || '').join('') : content;
  const out = parseJson(text);
  if (!out) { const e = new Error('vision_bad_output'); e.code = 'vision_bad_output'; throw e; }
  const title = cleanTitle(out.title);
  const category = CATEGORY_KEYS.indexOf(out.category) >= 0 ? out.category : null;
  const range = cleanRange(out.price_min, out.price_max);
  if (!title && !category && range.priceMin === null) { const e = new Error('vision_bad_output'); e.code = 'vision_bad_output'; throw e; }
  return Object.assign({ title, category }, range);
}

// ---- similar past sales --------------------------------------------------
// Category whose words appear most in `text` (ties: the earlier category).
function guessCategory(text) {
  const s = ' ' + normalize(text) + ' ';
  if (!s.trim()) return null;
  let best = null;
  let bestScore = 0;
  for (const key of CATEGORY_KEYS) {
    // Latin words must start a word ("hat" is not in "that"); CJK words match anywhere.
    const score = CATEGORIES[key].reduce((n, w) => n + (s.indexOf(/^[\p{Script=Latin}\d\s-]+$/u.test(w) ? ' ' + w : w) >= 0 ? 1 : 0), 0);
    if (score > bestScore) { best = key; bestScore = score; }
  }
  return best;
}

// "IMG_2041.jpg" says nothing; "red-bike_helmet.jpeg" says "red bike helmet".
function fileWords(name) {
  const base = String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_\-.]+/g, ' ');
  return /^(img|dsc|pxl|photo|image|screenshot|whatsapp)?\s*\d[\d\s]*$/i.test(base.trim()) ? '' : base;
}

const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

// Median low and high prices of recent visible sales (in this category when
// given). Only aggregated numbers leave this function.
async function similarPrices(category) {
  const where = {
    hidden: false, isFree: false,
    createdAt: { [Op.gte]: new Date(Date.now() - SAMPLE_DAYS * 24 * 3600 * 1000) },
    [Op.or]: [{ priceMin: { [Op.ne]: null } }, { priceMax: { [Op.ne]: null } }],
  };
  if (category) where.category = category;
  const rows = await models().Post.findAll({ attributes: ['priceMin', 'priceMax'], where, order: [['createdAt', 'DESC']], limit: SAMPLE_LIMIT, raw: true });
  if (rows.length < MIN_SAMPLES) return { count: rows.length, range: null };
  const lows = rows.map((r) => (r.priceMin !== null ? r.priceMin : r.priceMax));
  const highs = rows.map((r) => (r.priceMax !== null ? r.priceMax : r.priceMin));
  return { count: rows.length, range: cleanRange(median(lows), median(highs)) };
}

// The seller's own most recent category, if they set one before.
async function lastCategory(userId) {
  const p = await models().Post.findOne({ attributes: ['category'], where: { userId, category: { [Op.ne]: null } }, order: [['createdAt', 'DESC']], raw: true });
  return p ? p.category : null;
}

function titleFor(category, hint, lang) {
  const h = cleanTitle(hint);
  if (h) return h.charAt(0).toLocaleUpperCase() + h.slice(1);
  return i18n.t(lang, category ? 'suggest.title.' + category : 'suggest.title.any');
}

async function fromSimilar({ userId, hint, fileName, lang }) {
  const category = guessCategory([hint, fileWords(fileName)].filter(Boolean).join(' ')) || (userId ? await lastCategory(userId) : null);
  const similar = await similarPrices(category);
  const typical = TYPICAL[category || ''];
  const range = similar.range || { priceMin: typical[0], priceMax: typical[1] };
  return Object.assign({ source: 'similar', title: titleFor(category, hint, lang), category, basis: similar.range ? 'similar' : 'typical', similarCount: similar.range ? similar.count : 0 }, range);
}

// -> { source: 'ai'|'similar', title, category, priceMin, priceMax, basis?, similarCount?, aiFailed? }
// `buf` may be null (no photo): then only similar sales are used.
async function suggest({ userId, buf, fileName, hint, lang }) {
  const text = typeof hint === 'string' ? hint.slice(0, HINT_MAX) : '';
  let aiFailed = false;
  if (buf && isConfigured() && sniffImageType(buf)) {
    if (takeBudget(userId)) {
      try {
        const ai = await askVision(buf, lang);
        // Fill gaps from similar sales; the seller sees one suggestion either way.
        if (!ai.title || !ai.category || ai.priceMin === null) {
          const sim = await fromSimilar({ userId, hint: text || ai.title || '', fileName, lang });
          return { source: 'ai', title: ai.title || sim.title, category: ai.category || sim.category, priceMin: ai.priceMin !== null ? ai.priceMin : sim.priceMin, priceMax: ai.priceMax !== null ? ai.priceMax : sim.priceMax };
        }
        return Object.assign({ source: 'ai' }, ai);
      } catch (err) {
        aiFailed = true;
        console.error('Vision suggestion failed:', err.code || err.name, err.status || '');
      }
    } else aiFailed = true;
  }
  const out = await fromSimilar({ userId, hint: text, fileName, lang });
  if (aiFailed) out.aiFailed = true;
  return out;
}

module.exports = { suggest, isConfigured, guessCategory, fileWords, similarPrices, parseJson, cleanRange, cleanTitle, setFetch, resetBudgets, TYPICAL, TITLE_MAX, HINT_MAX };
