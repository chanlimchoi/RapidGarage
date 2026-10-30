// Photo-to-listing helpers (pure, tested in test/listing-suggest.test.js).
import { CATEGORIES } from './wanted.js';

// Form values for the parts of a suggestion the seller chose to use.
// pick: { title, category, price } booleans (all true = "Use all").
export function patchFrom(s, pick) {
  const p = pick || { title: true, category: true, price: true };
  const out = {};
  if (!s) return out;
  if (p.title && s.title) out.title = String(s.title).slice(0, 255);
  if (p.category && s.category && CATEGORIES.includes(s.category)) out.category = s.category;
  if (p.price && (s.priceMin !== null && s.priceMin !== undefined || s.priceMax !== null && s.priceMax !== undefined)) {
    out.isFree = false;
    out.priceMin = s.priceMin === null || s.priceMin === undefined ? '' : String(s.priceMin);
    out.priceMax = s.priceMax === null || s.priceMax === undefined ? '' : String(s.priceMax);
  }
  return out;
}

// Which line explains where the suggestion came from (an i18n key + vars).
export function basisText(s) {
  if (!s) return null;
  if (s.source === 'ai') return { key: 'suggest.fromAi', vars: {} };
  if (s.basis === 'similar') return { key: 'suggest.fromSimilar', vars: { count: s.similarCount || 0 } };
  return { key: 'suggest.fromTypical', vars: {} };
}
