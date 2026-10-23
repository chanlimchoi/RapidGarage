// Bundle deals: "buy N+ items, get X% off" (mirrors rapidgarage-backend/lib/bundles.js).
// Imports i18n with its extension so node --test can load this file.
import { t, intlLocale } from '../i18n/index.js';

export const MIN_CHOICES = [2, 3, 4, 5, 6, 8, 10];
export const PERCENT_CHOICES = [5, 10, 15, 20, 25, 30, 40, 50];

// post.bundle ({ minItems, percent } or null) -> form values.
export function bundleValues(p) {
  const b = (p && p.bundle) || null;
  return { bundleMinItems: b ? String(b.minItems) : '', bundlePercent: b ? String(b.percent) : '' };
}

// Form values -> PUT/POST /post fields (both or neither; null clears).
export function bundleBody(v) {
  const on = !!(v.bundleMinItems && v.bundlePercent);
  return { bundleMinItems: on ? Number(v.bundleMinItems) : null, bundlePercent: on ? Number(v.bundlePercent) : null };
}

// { field: i18n key } for a half-filled rule.
export function bundleErrorKeys(v) {
  if (v.bundleMinItems && !v.bundlePercent) return { bundlePercent: 'bundle.errPercent' };
  if (v.bundlePercent && !v.bundleMinItems) return { bundleMinItems: 'bundle.errMin' };
  return {};
}
export function bundleErrors(v) {
  const keys = bundleErrorKeys(v);
  const out = {};
  Object.keys(keys).forEach((k) => { out[k] = t(keys[k]); });
  return out;
}

// X% off, rounded down to the cent (as the server).
export const bundleCents = (cents, percent) => Math.floor(cents * (100 - percent) / 100);

// items: holdable items with nowCents (current price, markdowns included).
export function quote(items, percent) {
  const priced = items.filter((i) => i.nowCents !== null && i.nowCents !== undefined);
  const totalCents = priced.reduce((s, i) => s + i.nowCents, 0);
  const bundleTotalCents = priced.reduce((s, i) => s + bundleCents(i.nowCents, percent), 0);
  return { count: priced.length, totalCents, bundleTotalCents, savedCents: totalCents - bundleTotalCents };
}

// Holds (newest first) -> rows: { hold } for single holds, { key, holds } for
// a bundle (its holds oldest first), in the order the first of each appears.
export function groupHolds(list) {
  const out = [];
  const byKey = new Map();
  (list || []).forEach((h) => {
    if (!h.bundleKey) { out.push({ hold: h }); return; }
    let g = byKey.get(h.bundleKey);
    if (!g) { g = { key: h.bundleKey, holds: [] }; byKey.set(h.bundleKey, g); out.push(g); }
    g.holds.push(h);
  });
  byKey.forEach((g) => { g.holds.sort((a, b) => a.id - b.id); });
  return out;
}

// The hold the bundle's buttons act on (the server applies it to all of them).
export const lead = (g) => g.holds.find((h) => h.status === 'pending' || h.status === 'accepted') || g.holds[0];

// "Desk, Lamp and Mug" in the UI language.
export function itemList(names) {
  const clean = (names || []).map((n) => n || t('hold.anItem'));
  try { return new Intl.ListFormat(intlLocale(), { style: 'long', type: 'conjunction' }).format(clean); } catch (e) { return clean.join(', '); }
}

// "Bundle deal: 3+ items, 20% off"
export const describe = (b) => (b ? t('bundle.deal', { count: b.minItems, percent: b.percent }) : '');
