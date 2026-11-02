// Price check: while a seller lists an item, what did similar items sell for
// nearby? Uses only this site's own data: items marked sold in the last
// PRICE_CHECK_DAYS days at sales within PRICE_CHECK_RADIUS_MILES of the
// seller's sale. The recorded price of a sold item is the agreed offer of its
// completed hold (offers, bundle deals) when there is one, else its listed
// price; free and unpriced items are left out.
//
// Nothing is shown below PRICE_CHECK_MIN_SAMPLES matches (default 5): with a
// handful of sales the "median" would just be one neighbour's price. Only
// aggregates come back (count, median, quartiles, min/max): never item names,
// sales, sellers or buyers.
const { Op } = require('sequelize');
const geo = require('./geo');
const schedule = require('./schedule');
const { contains } = require('./items');

function models() { return require('../models'); }

function intEnv(name, dflt) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : dflt;
}
const minSamples = () => intEnv('PRICE_CHECK_MIN_SAMPLES', 5);
const radiusMiles = () => Math.min(100, intEnv('PRICE_CHECK_RADIUS_MILES', 25));
const lookbackDays = () => Math.min(730, intEnv('PRICE_CHECK_DAYS', 365));

const DAY = 24 * 3600 * 1000;
const NAME_MAX = 120;
const MAX_WORDS = 3;
const SAMPLE_LIMIT = 1000;
// Words that say nothing about what the item is.
const STOP = new Set(('a an and the of for with in on to set pair lot box old new used vintage antique small medium large big mini '
  + 'good great nice like works working excellent condition clean brand size color colour').split(' '));

// "Kids' bikes (2)" -> ['kid', 'bike']: lowercase letters/digits, drop stop
// words and 1-2 letter words, crude singular (the match is a substring, so
// 'bike' still finds 'bikes'), longest words first, at most MAX_WORDS.
function keywords(name) {
  const words = String(name || '').slice(0, NAME_MAX).toLowerCase().normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean)
    .map((w) => (w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w))
    .filter((w) => !STOP.has(w) && (w.length >= 3 || /[^\x00-\x7f]/.test(w)) && !/^\d+$/.test(w));
  return Array.from(new Set(words)).sort((a, b) => b.length - a.length || (a < b ? -1 : 1)).slice(0, MAX_WORDS);
}

// Linear-interpolated percentile of a sorted list (p in 0..1).
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
}

function summarize(cents) {
  const s = cents.slice().sort((a, b) => a - b);
  return { medianCents: percentile(s, 0.5), lowCents: percentile(s, 0.25), highCents: percentile(s, 0.75), minCents: s[0], maxCents: s[s.length - 1] };
}

// Recorded sale prices (cents > 0) of sold items whose name has every word,
// at visible sales near `center`, sold since `since`, not at excludePostId.
async function samples(words, center, opts) {
  const m = models();
  const since = new Date(opts.now.getTime() - opts.days * DAY);
  const rows = await m.SaleItem.findAll({
    where: { [Op.and]: [{ sold: true, soldAt: { [Op.gte]: since } }, opts.excludePostId ? { postId: { [Op.ne]: opts.excludePostId } } : {}]
      .concat(words.map((w) => contains(m, 'name', w))) },
    attributes: ['id', 'postId', 'priceCents'], order: [['soldAt', 'DESC'], ['id', 'DESC']], limit: SAMPLE_LIMIT, raw: true,
  });
  if (!rows.length) return [];
  const box = geo.boundingBox(center, opts.radius);
  const posts = await m.Post.findAll({
    where: { id: Array.from(new Set(rows.map((r) => r.postId))), hidden: false, lat: { [Op.between]: [box.minLat, box.maxLat] },
      [Op.or]: box.lngRanges.map(([a, b]) => ({ lng: { [Op.between]: [a, b] } })) },
    attributes: ['id', 'lat', 'lng'], raw: true,
  });
  const near = new Set(posts.filter((p) => geo.haversineMiles(center, { lat: p.lat, lng: p.lng }) <= opts.radius).map((p) => p.id));
  const kept = rows.filter((r) => near.has(r.postId));
  if (!kept.length) return [];
  const holds = await m.ItemHold.findAll({ where: { itemId: kept.map((r) => r.id), status: 'completed', offerCents: { [Op.ne]: null } },
    attributes: ['itemId', 'offerCents'], order: [['decidedAt', 'DESC'], ['id', 'DESC']], raw: true });
  const agreed = new Map();
  holds.forEach((h) => { if (!agreed.has(h.itemId)) agreed.set(h.itemId, h.offerCents); });
  return kept.map((r) => (agreed.has(r.id) ? agreed.get(r.id) : r.priceCents)).filter((c) => Number.isInteger(c) && c > 0);
}

// -> { words, sample, minSample, radiusMiles, days, enough, basis: 'all'|'broad'|null,
//      medianCents?, lowCents?, highCents?, minCents?, maxCents? }
// Tries every keyword first; with too few matches and several keywords, falls
// back to the single most specific (longest) one ("broad").
async function check({ name, post, at }) {
  const words = keywords(name);
  const base = { words, sample: 0, minSample: minSamples(), radiusMiles: radiusMiles(), days: lookbackDays(), enough: false, basis: null };
  if (!words.length || !post || typeof post.lat !== 'number' || typeof post.lng !== 'number') return base;
  const opts = { now: at || schedule.now(), days: base.days, radius: base.radiusMiles, excludePostId: post.id };
  const center = { lat: post.lat, lng: post.lng };
  let basis = 'all';
  let cents = await samples(words, center, opts);
  if (cents.length < base.minSample && words.length > 1) {
    const broad = await samples(words.slice(0, 1), center, opts);
    if (broad.length > cents.length) { cents = broad; basis = 'broad'; }
  }
  const out = Object.assign(base, { sample: cents.length, basis });
  if (cents.length < base.minSample) return out;
  return Object.assign(out, { enough: true }, summarize(cents));
}

module.exports = { check, keywords, percentile, summarize, NAME_MAX };
