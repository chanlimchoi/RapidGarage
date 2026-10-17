// Post prices. A garage sale has many items, so a post carries an optional
// price *range* in whole US dollars (integers), or is marked free:
//   isFree            -> "Free"           (priceMin/priceMax must be null)
//   min = max         -> "$5"
//   min < max         -> "$5–$50"
//   only max          -> "Up to $50"
//   only min          -> "From $5"
//   nothing set       -> no price shown
// Mirrored in rapidgarage-frontend/app/lib/price.js; keep the two in sync.
const PRICE_CAP = 100000; // $100,000: well above any garage-sale item

// Parse one price field. Returns { value } or { error }. undefined = absent.
function parsePrice(raw, label) {
  if (raw === undefined) return { value: undefined };
  if (raw === null || raw === '') return { value: null };
  let n;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(raw)) n = Number(raw);
  else return { error: label + ' must be a number of dollars.' };
  if (!Number.isFinite(n)) return { error: label + ' must be a number of dollars.' };
  if (n < 0) return { error: label + " can't be negative." };
  if (!Number.isInteger(n)) return { error: label + ' must be whole dollars (no cents).' };
  if (n > PRICE_CAP) return { error: label + ' must be $' + PRICE_CAP.toLocaleString('en-US') + ' or less.' };
  return { value: n };
}

function parseFree(raw) {
  if (raw === undefined) return { value: undefined };
  if (raw === null) return { value: false };
  if (typeof raw === 'boolean') return { value: raw };
  return { error: 'isFree must be true or false.' };
}

// Validate the price fields present in body. `existing` (for updates) fills in
// fields that are not being changed so cross-field rules see the final state.
// Returns { errors, values } where values only has the fields that were sent.
function validatePrice(body, existing) {
  const errors = {};
  const values = {};
  const min = parsePrice(body.priceMin, 'Lowest price');
  const max = parsePrice(body.priceMax, 'Highest price');
  const free = parseFree(body.isFree);
  if (min.error) errors.priceMin = min.error; else if (min.value !== undefined) values.priceMin = min.value;
  if (max.error) errors.priceMax = max.error; else if (max.value !== undefined) values.priceMax = max.value;
  if (free.error) errors.isFree = free.error; else if (free.value !== undefined) values.isFree = free.value;
  if (Object.keys(errors).length) return { errors, values };
  const prev = existing || {};
  const pick = (k, def) => (values[k] !== undefined ? values[k] : (prev[k] !== undefined && prev[k] !== null ? prev[k] : def));
  const fMin = pick('priceMin', null);
  const fMax = pick('priceMax', null);
  const fFree = pick('isFree', false);
  if (fFree && (fMin !== null || fMax !== null)) errors.isFree = "A free sale can't also have a price. Clear the prices or untick Free.";
  else if (fMin !== null && fMax !== null && fMin > fMax) errors.priceMax = 'Highest price must be at least the lowest price.';
  return { errors, values };
}

// Search filter. maxPrice: sales with something at or under $X, i.e. free
// sales, sales whose lowest price is <= X, and "up to $Y" sales (their lowest
// item price is unknown but within 0..Y). Sales with no price info are excluded.
function priceWhere(Op, filter) {
  if (!filter) return null;
  if (filter.freeOnly) return { isFree: true };
  if (filter.maxPrice === undefined || filter.maxPrice === null) return null;
  return {
    [Op.or]: [
      { isFree: true },
      { priceMin: { [Op.lte]: filter.maxPrice } },
      { priceMin: null, priceMax: { [Op.ne]: null } },
    ],
  };
}

// The same rule as priceWhere, for one post in memory (sale alerts).
function matchesPrice(post, filter) {
  if (!filter) return true;
  if (filter.freeOnly) return !!post.isFree;
  if (filter.maxPrice === undefined || filter.maxPrice === null) return true;
  if (post.isFree) return true;
  if (post.priceMin !== null && post.priceMin !== undefined) return post.priceMin <= filter.maxPrice;
  return post.priceMax !== null && post.priceMax !== undefined;
}

// "Free", "$5", "$5–$50", "Up to $50", "From $5" or null (no price info).
function formatPrice(post) {
  if (post.isFree) return 'Free';
  const lo = post.priceMin;
  const hi = post.priceMax;
  const has = (v) => v !== null && v !== undefined;
  const usd = (n) => '$' + Number(n).toLocaleString('en-US');
  if (has(lo) && has(hi)) return lo === hi ? usd(lo) : usd(lo) + '–' + usd(hi);
  if (has(hi)) return 'Up to ' + usd(hi);
  if (has(lo)) return 'From ' + usd(lo);
  return null;
}

module.exports = { PRICE_CAP, parsePrice, validatePrice, priceWhere, matchesPrice, formatPrice };
