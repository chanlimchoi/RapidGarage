// Client mirror of rapidgarage-backend/lib/price.js. Prices are whole US dollars,
// written the way the current UI language writes US dollars.
import { t, intlLocale } from '../i18n';
export const PRICE_CAP = 100000;

const formatters = {};
export const formatUSD = (n) => {
  const l = intlLocale();
  if (!formatters[l]) formatters[l] = new Intl.NumberFormat(l, { style: 'currency', currency: 'USD', maximumFractionDigits: 0, minimumFractionDigits: 0 });
  return formatters[l].format(n);
};

const has = (v) => typeof v === 'number' && Number.isFinite(v);

// "Free" | "$5" | "$5–$50" | "Up to $50" | "From $5" | null
export function formatPrice(post) {
  if (!post) return null;
  if (post.isFree) return t('price.free');
  const min = has(post.priceMin) ? post.priceMin : null;
  const max = has(post.priceMax) ? post.priceMax : null;
  if (min !== null && max !== null) return min === max ? formatUSD(min) : t('price.range', { min: formatUSD(min), max: formatUSD(max) });
  if (max !== null) return t('price.upTo', { max: formatUSD(max) });
  if (min !== null) return t('price.from', { min: formatUSD(min) });
  return null;
}

// Validate one form input (a string). Returns '' or a message (same rules as the server).
export function priceFieldError(raw, label) {
  const v = String(raw == null ? '' : raw).trim();
  if (!v) return '';
  if (!/^-?\d+(\.\d+)?$/.test(v)) return t('price.errNumber', { label });
  const n = Number(v);
  if (n < 0) return t('price.errNegative', { label });
  if (!Number.isInteger(n)) return t('price.errWhole', { label });
  if (n > PRICE_CAP) return t('price.errMax', { label, max: formatUSD(PRICE_CAP) });
  return '';
}

// Form values { isFree, priceMin, priceMax } (strings) -> { field: message }.
export function priceErrors(v) {
  const errors = {};
  const minErr = priceFieldError(v.priceMin, t('price.lowest'));
  const maxErr = priceFieldError(v.priceMax, t('price.highest'));
  if (minErr) errors.priceMin = minErr;
  if (maxErr) errors.priceMax = maxErr;
  const min = String(v.priceMin || '').trim();
  const max = String(v.priceMax || '').trim();
  if (v.isFree && (min || max)) errors.isFree = t('price.errFreeAndPrice');
  else if (!minErr && !maxErr && min && max && Number(min) > Number(max)) errors.priceMax = t('price.errOrder');
  return errors;
}

export const toPriceNumber = (s) => (String(s == null ? '' : s).trim() === '' ? null : Number(String(s).trim()));
