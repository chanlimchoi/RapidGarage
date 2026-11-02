// Offer rules (backend lib/offerRules.js): pure helpers for
// post/OfferRules.jsx (test/offer-rules.test.js). No imports, so node --test loads it.

// "4.50" / "$4" -> cents; '' -> null; anything else -> undefined (invalid).
export function dollars(raw) {
  const p = String(raw === null || raw === undefined ? '' : raw).trim().replace(/^\$/, '');
  if (!p) return null;
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(p)) return undefined;
  const c = Math.round(Number(p) * 100);
  return c >= 1 && c <= 10000000 ? c : undefined;
}

// Per-item rule -> { field: i18n key } (same checks as the server).
export function itemRuleErrors({ accept, floor }, priceCents) {
  const e = {};
  const a = dollars(accept);
  const f = dollars(floor);
  if (a === undefined) e.accept = 'offerRules.errAmount';
  if (f === undefined) e.floor = 'offerRules.errAmount';
  if (Object.keys(e).length) return e;
  if (priceCents === 0 && (a || f)) return { accept: 'offerRules.errFree' };
  if (a !== null && Number.isInteger(priceCents) && a >= priceCents) e.accept = 'offerRules.errBelowAsking';
  if (f !== null && Number.isInteger(priceCents) && f >= priceCents) e.floor = 'offerRules.errBelowAsking';
  if (a !== null && f !== null && f >= a) e.floor = 'offerRules.errFloorBelowAccept';
  return e;
}

const pct = (raw) => {
  const s = String(raw === null || raw === undefined ? '' : raw).trim().replace(/%$/, '');
  if (!s) return null;
  if (!/^\d{1,2}$/.test(s) || Number(s) < 1) return undefined;
  return Number(s);
};
export function saleRuleErrors({ acceptPercent, floorPercent }) {
  const e = {};
  const a = pct(acceptPercent);
  const f = pct(floorPercent);
  if (a === undefined) e.acceptPercent = 'offerRules.errPercent';
  if (f === undefined) e.floorPercent = 'offerRules.errPercent';
  if (!Object.keys(e).length && a !== null && f !== null && f >= a) e.floorPercent = 'offerRules.errFloorBelowAccept';
  return e;
}
export const percentValue = (raw) => { const v = pct(raw); return v === undefined ? null : v; };

// What a buyer's offer on this item would meet: [{ key, cents }] in display
// order (auto-accept, floor), or [] when the seller answers every offer.
export function ruleLines(effective) {
  const e = effective || {};
  const out = [];
  if (e.acceptCents != null) out.push({ key: 'offerRules.acceptsAt', cents: e.acceptCents });
  if (e.floorCents != null) out.push({ key: 'offerRules.declinesBelow', cents: e.floorCents });
  return out;
}
