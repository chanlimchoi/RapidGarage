// Price check while listing (backend lib/priceCheck.js): pure helpers for
// post/PriceCheck.jsx (test/price-check.test.js).

// Worth asking the server? At least 3 letters typed.
export const MIN_CHARS = 3;
export const DEBOUNCE_MS = 600;
export function shouldCheck(name) {
  return typeof name === 'string' && name.trim().length >= MIN_CHARS;
}

// What to say for a result: { key, vars } with raw cents in vars (the
// component formats them), or null when there is nothing to say.
//   enough          -> priceCheck.range ("$5-$12, median $8 from 7 sales")
//   enough, flat    -> priceCheck.same  (all quartiles equal)
//   too few matches -> priceCheck.notEnough
export function priceCheckMessage(r) {
  if (!r || !Array.isArray(r.words) || !r.words.length) return null;
  if (!r.enough) return { key: 'priceCheck.notEnough', vars: { count: r.sample || 0, min: r.minSample, miles: r.radiusMiles } };
  const vars = { count: r.sample, median: r.medianCents, low: r.lowCents, high: r.highCents, miles: r.radiusMiles };
  return { key: r.lowCents === r.highCents ? 'priceCheck.same' : 'priceCheck.range', vars };
}

// The median as a price-field value: 2500 -> "25", 750 -> "7.50".
export function priceInput(cents) {
  if (!Number.isInteger(cents) || cents <= 0) return '';
  return cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100);
}

// Ignore answers to anything but the latest name typed.
export function isCurrent(requested, current) {
  return typeof requested === 'string' && typeof current === 'string' && requested.trim() === current.trim();
}
