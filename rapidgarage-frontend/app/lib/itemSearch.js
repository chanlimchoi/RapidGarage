// Item search (GET /api/search/items; backend lib/itemSearch.js): pure helpers
// so they can be tested with node --test.
import { discounted } from './markdown.js';

const PAGE_SIZE = 12;

// Query params for the item search from the browse page's state:
// { lastWhere: { coords } | { q } | null, radius, activeKeyword, freeOnly, maxPrice, when, neighborhood, curbside, markdown }.
export function itemParams(s, page) {
  const w = s.lastWhere || null;
  const out = { keyword: s.activeKeyword, page: page || 1, pageSize: PAGE_SIZE };
  if (w && w.coords) Object.assign(out, { lat: w.coords.lat, lng: w.coords.lng, radius: s.radius });
  else if (w && w.q) Object.assign(out, { q: w.q, radius: s.radius });
  if (s.freeOnly) out.free = 'true';
  else if (s.maxPrice && String(s.maxPrice).trim()) out.maxPrice = String(s.maxPrice).trim();
  if (s.when) out.when = s.when;
  if (s.neighborhood) out.neighborhood = 'true';
  if (s.curbside) out.curbside = 'true';
  if (s.markdown) out.markdown = 'true';
  return out;
}

export function queryString(params) {
  return Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
}

// Price to show for an item: { cents, wasCents } (wasCents only while the
// sale's markdown runs and the item has a price above zero).
export function itemPrice(item) {
  const md = item && item.sale && item.sale.markdown;
  if (item.priceCents === null || item.priceCents === undefined) return { cents: null, wasCents: null };
  if (md && md.active && item.priceCents > 0) return { cents: discounted(item.priceCents, md.percent), wasCents: item.priceCents };
  return { cents: item.priceCents, wasCents: null };
}

// A post-like object for the shared schedule helpers (saleBadge, shortWhen).
export function saleAsPost(sale) {
  return { id: sale.id, title: sale.title, city: sale.city, state: sale.state, schedule: sale.schedule, distanceMiles: sale.distanceMiles, markdown: sale.markdown };
}

export { PAGE_SIZE };
