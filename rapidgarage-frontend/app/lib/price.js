// Client mirror of rapidgarage-backend/lib/price.js. Prices are whole US dollars.
export const PRICE_CAP = 100000;

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, minimumFractionDigits: 0 });
export const formatUSD = (n) => usd.format(n);

const has = (v) => typeof v === 'number' && Number.isFinite(v);

// "Free" | "$5" | "$5–$50" | "Up to $50" | "From $5" | null
export function formatPrice(post) {
  if (!post) return null;
  if (post.isFree) return 'Free';
  const min = has(post.priceMin) ? post.priceMin : null;
  const max = has(post.priceMax) ? post.priceMax : null;
  if (min !== null && max !== null) return min === max ? formatUSD(min) : formatUSD(min) + '–' + formatUSD(max);
  if (max !== null) return 'Up to ' + formatUSD(max);
  if (min !== null) return 'From ' + formatUSD(min);
  return null;
}

// Validate one form input (a string). Returns '' or a message (same rules as the server).
export function priceFieldError(raw, label) {
  const v = String(raw == null ? '' : raw).trim();
  if (!v) return '';
  if (!/^-?\d+(\.\d+)?$/.test(v)) return label + ' must be a number of dollars.';
  const n = Number(v);
  if (n < 0) return label + " can't be negative.";
  if (!Number.isInteger(n)) return label + ' must be whole dollars (no cents).';
  if (n > PRICE_CAP) return label + ' must be ' + formatUSD(PRICE_CAP) + ' or less.';
  return '';
}

// Form values { isFree, priceMin, priceMax } (strings) -> { field: message }.
export function priceErrors(v) {
  const errors = {};
  const minErr = priceFieldError(v.priceMin, 'Lowest price');
  const maxErr = priceFieldError(v.priceMax, 'Highest price');
  if (minErr) errors.priceMin = minErr;
  if (maxErr) errors.priceMax = maxErr;
  const min = String(v.priceMin || '').trim();
  const max = String(v.priceMax || '').trim();
  if (v.isFree && (min || max)) errors.isFree = "A free sale can't also have a price. Clear the prices or untick Free.";
  else if (!minErr && !maxErr && min && max && Number(min) > Number(max)) errors.priceMax = 'Highest price must be at least the lowest price.';
  return errors;
}

export const toPriceNumber = (s) => (String(s == null ? '' : s).trim() === '' ? null : Number(String(s).trim()));
