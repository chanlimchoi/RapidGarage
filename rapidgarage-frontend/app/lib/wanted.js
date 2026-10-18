// Wanted posts (pure helpers; see test/wanted.test.js). Mirrors the rules in
// rapidgarage-backend/lib/wanted.js; the server still has the final say.

export const TITLE_MIN = 3;
export const TITLE_MAX = 80;
export const KEYWORDS_MAX = 120;
export const DETAILS_MAX = 500;
export const AREA_MAX = 80;
export const MAX_WORDS = 5;
export const RADIUS = { min: 1, max: 50 };
export const DAYS_DEFAULT = 30;
export const DAYS_MAX = 90;
export const DAY_CHOICES = [7, 14, 30, 60, 90];
export const PRICE_CAP_CENTS = 100000 * 100;
export const CATEGORIES = ['furniture', 'electronics', 'kids', 'clothing', 'tools', 'sports', 'books', 'kitchen', 'toys', 'garden', 'music', 'decor'];

const STOP = new Set(['a', 'an', 'and', 'the', 'or', 'for', 'of', 'in', 'on', 'to', 'with', 'my', 'any', 'some', 'looking', 'wanted', 'want', 'need', 'needed', 'buy', 'iso', 'good', 'condition', 'used', 'please',
  'un', 'una', 'unos', 'unas', 'el', 'la', 'los', 'las', 'y', 'o', 'de', 'del', 'para', 'con', 'en', 'busco', 'necesito', 'quiero', 'buen', 'buena', 'estado']);

export function normalize(text) {
  return String(text || '').normalize('NFKC').toLowerCase().replace(/['’`]/g, '').replace(/[^\p{L}\p{N}\s-]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
const stem = (w) => (w.length > 3 && /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w);

// The words a sale must contain to match (same as the server): keywords if
// given, else the title; stop words dropped, plurals folded, at most 5.
export function wordsOf(text) {
  const out = [];
  normalize(text).split(' ').forEach((raw) => {
    const w = raw.replace(/^-+|-+$/g, '');
    if (!w || STOP.has(w) || (w.length < 2 && !/[^\x00-\x7f]/.test(w))) return;
    const s = stem(w);
    if (out.indexOf(s) === -1) out.push(s);
  });
  return out.slice(0, MAX_WORDS);
}
export function matchWords(title, keywords) {
  const k = keywords ? wordsOf(keywords) : [];
  return k.length ? k : wordsOf(title);
}

// "25", "25.5", "$25.50" -> 2550; "" -> null; bad -> undefined.
export function dollarsToCents(raw) {
  const s = String(raw === null || raw === undefined ? '' : raw).trim().replace(/^\$/, '');
  if (!s) return null;
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(s)) return undefined;
  const [d, c] = s.split('.');
  const cents = Number(d) * 100 + Number((c || '').padEnd(2, '0') || 0);
  return cents > PRICE_CAP_CENTS ? undefined : cents;
}
// 2550 -> "25.50", 3000 -> "30", null -> "".
export function centsToInput(c) {
  if (c === null || c === undefined) return '';
  return c % 100 ? (c / 100).toFixed(2) : String(c / 100);
}

// Whole days left until expiresAt (0 on the last day), or null once expired.
export function daysLeft(expiresAt, now) {
  const ms = new Date(expiresAt).getTime() - (now ? now.getTime() : Date.now());
  if (!(ms > 0)) return null;
  return Math.floor(ms / 86400000);
}

// Form values -> { field: [i18nKey, vars] } (empty when valid).
export function validateWanted(v, editing) {
  const e = {};
  const title = String(v.title || '').trim();
  if (title.length < TITLE_MIN) e.title = ['want.errTitle', { min: TITLE_MIN }];
  else if (title.length > TITLE_MAX) e.title = ['want.errTitleLong', { max: TITLE_MAX }];
  if (String(v.keywords || '').length > KEYWORDS_MAX) e.keywords = ['want.errKeywordsLong', { max: KEYWORDS_MAX }];
  else if (!e.title && !matchWords(title, v.keywords).length) e.keywords = ['want.errNoWords', null];
  if (dollarsToCents(v.maxPrice) === undefined) e.maxPrice = ['want.errPrice', null];
  if (String(v.details || '').length > DETAILS_MAX) e.details = ['want.errDetailsLong', { max: DETAILS_MAX }];
  const area = String(v.areaLabel || '').trim();
  if (!area) e.areaLabel = ['want.errArea', null];
  else if (area.length > AREA_MAX) e.areaLabel = ['want.errAreaLong', { max: AREA_MAX }];
  if (!editing || v.where !== 'keep') {
    if (v.where === 'address' && !String(v.address || '').trim()) e.location = ['want.errAddress', null];
    if (v.where === 'here' && !v.coords) e.location = ['want.errLocation', null];
  }
  const r = Number(v.radiusMiles);
  if (!/^\d+$/.test(String(v.radiusMiles).trim()) || r < RADIUS.min || r > RADIUS.max) e.radiusMiles = ['want.errRadius', { min: RADIUS.min, max: RADIUS.max }];
  return e;
}

// Form values -> API body (create when !editing).
export function wantedBody(v, editing) {
  const body = {
    title: String(v.title).trim(), keywords: String(v.keywords || '').trim() || null, category: v.category || null,
    details: String(v.details || '').trim() || null, maxPriceCents: dollarsToCents(v.maxPrice), areaLabel: String(v.areaLabel).trim(),
    radiusMiles: Number(v.radiusMiles), emailEnabled: !!v.emailEnabled,
  };
  if (v.where === 'address') body.address = String(v.address).trim();
  if (v.where === 'here' && v.coords) { body.lat = v.coords.lat; body.lng = v.coords.lng; }
  if (!editing) body.days = Number(v.days) || DAYS_DEFAULT;
  return body;
}
