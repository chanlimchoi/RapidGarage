'use strict';
// Bundle deals: the seller offers "buy N+ items, get X% off". A buyer asks for
// a bundle inside the conversation (POST /conversations/:id/bundles): one hold
// per item, each offering its bundle price, sharing a bundleKey, so the
// existing hold/offer flow (accept, decline, cancel, release, expiry, sold)
// applies. The seller answers the bundle as a whole.
//
//   bundleMinItems  2-10, null = no bundle deal
//   bundlePercent   5-75 (required with a minimum)
// Clients get post.bundle = { minItems, percent } or null.
// Mirrored in rapidgarage-frontend/app/lib/bundles.js.
const crypto = require('crypto');

const MIN_ITEMS = { min: 2, max: 10 };
const PERCENT = { min: 5, max: 75 };
const MAX_ITEMS = 10;
const FIELDS = ['bundleMinItems', 'bundlePercent'];

const int = (v) => (typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : v);

// Like validateMarkdown: only the fields sent, cross-checked with `existing`.
function validateBundle(body, existing) {
  const errors = {};
  const values = {};
  if (body.bundleMinItems !== undefined) {
    const v = body.bundleMinItems;
    if (v === null || v === '') values.bundleMinItems = null;
    else {
      const n = int(v);
      if (!Number.isInteger(n) || n < MIN_ITEMS.min || n > MIN_ITEMS.max) errors.bundleMinItems = 'A bundle must be ' + MIN_ITEMS.min + ' to ' + MIN_ITEMS.max + ' items.';
      else values.bundleMinItems = n;
    }
  }
  if (body.bundlePercent !== undefined) {
    const v = body.bundlePercent;
    if (v === null || v === '') values.bundlePercent = null;
    else {
      const n = int(v);
      if (!Number.isInteger(n) || n < PERCENT.min || n > PERCENT.max) errors.bundlePercent = 'The bundle discount must be a whole percent from ' + PERCENT.min + ' to ' + PERCENT.max + '.';
      else values.bundlePercent = n;
    }
  }
  if (Object.keys(errors).length) return { errors, values: {} };
  const pick = (k) => (values[k] !== undefined ? values[k] : existing ? existing[k] : null);
  const min = pick('bundleMinItems');
  const pct = pick('bundlePercent');
  if (FIELDS.some((k) => values[k] !== undefined)) {
    if ((min === null || min === undefined) && (pct === null || pct === undefined)) { values.bundleMinItems = null; values.bundlePercent = null; }
    else if (min === null || min === undefined) errors.bundleMinItems = 'Choose how many items make a bundle.';
    else if (pct === null || pct === undefined) errors.bundlePercent = 'Choose the bundle discount.';
  }
  return { errors, values: Object.keys(errors).length ? {} : values };
}

function state(post) {
  return post && post.bundleMinItems && post.bundlePercent ? { minItems: post.bundleMinItems, percent: post.bundlePercent } : null;
}

// The item's price now (a running markdown counts), in cents; null = no price.
function currentCents(post, item, at) {
  if (item.priceCents === null || item.priceCents === undefined) return null;
  const md = require('./markdown');
  return md.isActive(post, at) ? md.discounted(item.priceCents, post.markdownPercent) : item.priceCents;
}

// Bundle price of one item: X% off its current price, rounded down to the cent.
const bundleCents = (cents, percent) => Math.floor(cents * (100 - percent) / 100);

// { lines: [{ item, cents, bundleCents }], totalCents, bundleTotalCents }
function quote(post, items, at) {
  const deal = state(post);
  const lines = items.map((item) => {
    const cents = currentCents(post, item, at);
    return { item, cents, bundleCents: cents === null || !deal ? cents : bundleCents(cents, deal.percent) };
  });
  const sum = (k) => lines.reduce((s, l) => s + (l[k] || 0), 0);
  return { lines, totalCents: sum('cents'), bundleTotalCents: sum('bundleCents') };
}

const newKey = () => crypto.randomBytes(9).toString('hex');

module.exports = { MIN_ITEMS, PERCENT, MAX_ITEMS, FIELDS, validateBundle, state, currentCents, bundleCents, quote, newKey };
