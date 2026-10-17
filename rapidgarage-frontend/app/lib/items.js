// Sale item lists (see backend lib/items.js).
export const ITEM_NAME_MAX = 80;
export const KEYWORD_MAX = 60;

// 450 -> "$4.50", 300 -> "$3", 0 -> "Free", null -> "".
export function formatCents(c) {
  if (c === null || c === undefined) return '';
  if (c === 0) return 'Free';
  const d = Math.floor(c / 100);
  const r = c % 100;
  return '$' + d.toLocaleString('en-US') + (r ? '.' + String(r).padStart(2, '0') : '');
}

// For an <input>: 450 -> "4.50", 300 -> "3".
export function centsInput(c) {
  if (c === null || c === undefined) return '';
  return c % 100 ? (c / 100).toFixed(2) : String(c / 100);
}

export function validateItemFields({ name, price }) {
  const errors = {};
  const n = (name || '').trim();
  if (!n) errors.name = 'Give the item a name.';
  else if (n.length > ITEM_NAME_MAX) errors.name = 'Keep the name to ' + ITEM_NAME_MAX + ' characters.';
  const p = (price || '').trim().replace(/^\$/, '');
  if (p && !/^\d{1,6}(\.\d{1,2})?$/.test(p)) errors.price = 'Enter a price like 5 or 2.50.';
  else if (p && Number(p) > 100000) errors.price = 'Price must be $100,000 or less.';
  return errors;
}

export function itemSummary(items) {
  const n = items.length;
  const sold = items.filter((i) => i.sold).length;
  return n + (n === 1 ? ' item' : ' items') + (sold ? ' · ' + sold + ' sold' : '');
}
