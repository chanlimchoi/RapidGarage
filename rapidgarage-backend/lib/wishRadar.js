'use strict';
// Buyer wish radar: what buyers near a place are hunting for, for sellers
// deciding what to put out or list. Count-only and anonymous.
//
// Sources (nothing new to fill in for buyers):
// * saved searches with words (SaleAlerts.keyword: the "hunting for" list),
//   enabled and with radar on (the owner can turn it off per search);
// * active, visible "wanted" posts (lib/wanted.js), by words and category.
// A buyer counts for a place when the place is inside their circle (the same
// rule that would send them the sale). Searches are grouped by their words
// (filler dropped, simple singular, order ignored: lib/priceCheck keywords).
//
// Privacy: only terms with at least RADAR_MIN_HUNTERS different buyers
// (default 3, never below 2) are shown, the viewer never counts, totals under
// the minimum read "fewer than N", and no names, ids, places or the exact
// text of any one search comes back unless the minimum shared it.
const { Op } = require('sequelize');
const geo = require('./geo');
const schedule = require('./schedule');
const { keywords } = require('./priceCheck');
const { CATEGORY_KEYS } = require('./wanted');

function models() { return require('../models'); }

function intEnv(name, dflt, min, max) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : dflt;
}
const minHunters = () => intEnv('RADAR_MIN_HUNTERS', 3, 2, 50);
const OUTER_MILES = 50; // the largest saved-search / wanted radius
const TOP = 20;

const keyOf = (phrase) => keywords(phrase).slice().sort().join(' ');
const median = (xs) => {
  const s = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

function inBox(box) {
  return { lat: { [Op.between]: [box.minLat, box.maxLat] }, [Op.or]: box.lngRanges.map(([a, b]) => ({ lng: { [Op.between]: [a, b] } })) };
}

// -> { minHunters, hunters, fewerThan?, terms: [{ term, count, typicalMaxCents?, onYourList? }], categories: [{ category, count }] }
async function demand(center, { viewerId, at, itemNames } = {}) {
  const m = models();
  const now = at || schedule.now();
  const min = minHunters();
  const box = geo.boundingBox(center, OUTER_MILES);
  const within = (r) => geo.haversineMiles(center, { lat: r.lat, lng: r.lng }) <= r.radiusMiles;
  const notMe = viewerId ? { userId: { [Op.ne]: viewerId } } : {};
  const [searches, wanted] = await Promise.all([
    m.SaleAlert.findAll({ where: Object.assign({ enabled: true, radar: true, keyword: { [Op.ne]: null } }, notMe, inBox(box)),
      attributes: ['userId', 'keyword', 'lat', 'lng', 'radiusMiles', 'maxPrice'], raw: true }),
    m.WantedPost.findAll({ where: Object.assign({ status: 'active', hidden: false, expiresAt: { [Op.gt]: now } }, notMe, inBox(box)),
      attributes: ['userId', 'title', 'keywords', 'category', 'lat', 'lng', 'radiusMiles', 'maxPriceCents'], raw: true }),
  ]);
  // term key -> { users: Set, phrases: Map(phrase -> n), maxes: Map(userId -> cents) }
  const terms = new Map();
  const everyone = new Set();
  const add = (phrase, userId, maxCents) => {
    const key = keyOf(phrase);
    if (!key) return;
    if (!terms.has(key)) terms.set(key, { users: new Set(), phrases: new Map(), maxes: new Map() });
    const t = terms.get(key);
    t.users.add(userId);
    const p = String(phrase).trim().toLowerCase().replace(/\s+/g, ' ');
    t.phrases.set(p, (t.phrases.get(p) || 0) + 1);
    if (Number.isInteger(maxCents) && maxCents > 0 && !t.maxes.has(userId)) t.maxes.set(userId, maxCents);
    everyone.add(userId);
  };
  searches.filter(within).forEach((s) => add(s.keyword, s.userId, s.maxPrice ? s.maxPrice * 100 : null));
  const cats = new Map();
  wanted.filter(within).forEach((w) => {
    add(w.keywords || w.title, w.userId, w.maxPriceCents);
    if (w.category && CATEGORY_KEYS.indexOf(w.category) >= 0) {
      if (!cats.has(w.category)) cats.set(w.category, new Set());
      cats.get(w.category).add(w.userId);
      everyone.add(w.userId);
    }
  });
  const names = (itemNames || []).map((n) => String(n).toLowerCase());
  const list = [];
  for (const [key, t] of terms) {
    if (t.users.size < min) continue;
    // The phrase most people used (ties: the shortest), which by construction
    // shares its words with at least `min` buyers.
    const term = Array.from(t.phrases.entries()).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || (a[0] < b[0] ? -1 : 1))[0][0];
    const row = { term, count: t.users.size };
    if (t.maxes.size >= min) row.typicalMaxCents = median(Array.from(t.maxes.values()));
    if (itemNames) row.onYourList = names.some((n) => key.split(' ').every((w) => n.indexOf(w) >= 0));
    list.push(row);
  }
  list.sort((a, b) => b.count - a.count || (a.term < b.term ? -1 : 1));
  const categories = Array.from(cats.entries()).filter(([, u]) => u.size >= min).map(([category, u]) => ({ category, count: u.size }))
    .sort((a, b) => b.count - a.count || (a.category < b.category ? -1 : 1));
  const out = { minHunters: min, hunters: everyone.size >= min ? everyone.size : null, terms: list.slice(0, TOP), categories };
  if (everyone.size < min) out.fewerThan = min;
  return out;
}

module.exports = { demand, minHunters, keyOf };
