import { t, intlLocale } from '../i18n';
// Sale item lists (see backend lib/items.js).
export const ITEM_NAME_MAX = 80;
export const KEYWORD_MAX = 60;

// 450 -> "$4.50", 300 -> "$3", 0 -> "Free", null -> "".
export function formatCents(c) {
  if (c === null || c === undefined) return '';
  if (c === 0) return t('price.free');
  const digits = c % 100 ? 2 : 0;
  return new Intl.NumberFormat(intlLocale(), { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(c / 100);
}

// For an <input>: 450 -> "4.50", 300 -> "3".
export function centsInput(c) {
  if (c === null || c === undefined) return '';
  return c % 100 ? (c / 100).toFixed(2) : String(c / 100);
}

export function validateItemFields({ name, price }) {
  const errors = {};
  const n = (name || '').trim();
  if (!n) errors.name = t('items.errName');
  else if (n.length > ITEM_NAME_MAX) errors.name = t('items.errNameLong', { max: ITEM_NAME_MAX });
  const p = (price || '').trim().replace(/^\$/, '');
  if (p && !/^\d{1,6}(\.\d{1,2})?$/.test(p)) errors.price = t('items.errPrice');
  else if (p && Number(p) > 100000) errors.price = t('items.errPriceMax', { max: formatCents(10000000) });
  return errors;
}

export function itemSummary(items) {
  const n = items.length;
  const sold = items.filter((i) => i.sold).length;
  return t('items.count', { count: n }) + (sold ? t('items.soldSuffix', { count: sold }) : '');
}
