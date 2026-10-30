// Saved searches and the notification list (pure helpers; see
// test/saved-search.test.js). The server (controllers/alerts.js,
// lib/notifications.js) has the final say.
import { t, intlLocale } from '../i18n/index.js';
import { reasonText, dayName } from './weatherText.js';

export const KEYWORD_MAX = 60;
export const LABEL_MAX = 80;

// Same normalising as the search box and lib/items.js parseKeyword.
export function cleanKeyword(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

// The alert body for "save this search": center, radius, price filter and
// the words searched for (if any).
//   s: { center, radius, filter: { freeOnly, maxPrice }, keyword, place }
export function searchAlertBody(s) {
  const f = s.filter || {};
  const keyword = cleanKeyword(s.keyword) || null;
  const where = s.place ? t('list.alertNear', { place: s.place }) : t('list.alertNearMe');
  const label = keyword ? t('alerts.searchLabel', { keyword, where }) : where;
  return {
    label: label.slice(0, LABEL_MAX),
    keyword,
    lat: s.center.lat, lng: s.center.lng, radiusMiles: s.radius,
    freeOnly: !!f.freeOnly,
    maxPrice: !f.freeOnly && f.maxPrice !== null && f.maxPrice !== undefined ? f.maxPrice : null,
  };
}

// Identity of a search, so "Saved" sticks to the search it was saved for.
export function searchKey(s) {
  if (!s.center) return null;
  const f = s.filter || {};
  return [s.center.lat, s.center.lng, s.radius, f.freeOnly ? 1 : 0, f.maxPrice, cleanKeyword(s.keyword).toLowerCase()].join('|');
}

export function notificationLink(n) {
  // Neighborhood-sale notices open the event (where the organizer approves).
  if (n.kind && n.kind.indexOf('event_') === 0 && n.data && n.data.eventId) return '/events/' + n.data.eventId;
  return n.post ? '/post/' + n.post.id : '/settings#alerts';
}

// 4550 -> "$45.50", 300 -> "$3", 0 -> "Free" (cents); dollars(25) -> "$25".
export function money(cents) {
  if (cents === null || cents === undefined) return '';
  if (cents === 0) return t('price.free');
  const digits = cents % 100 ? 2 : 0;
  return new Intl.NumberFormat(intlLocale(), { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(cents / 100);
}
const dollars = (d) => (d === null || d === undefined ? '' : money(Math.round(d * 100)));

// "8 AM" / "2:30 PM" from "HH:MM" (sale-local time, shown as written).
function clock(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return '';
  const opts = { hour: 'numeric', minute: Number(m[2]) ? '2-digit' : undefined, timeZone: 'UTC' };
  try { return new Intl.DateTimeFormat(intlLocale(), opts).format(new Date(Date.UTC(2000, 0, 1, Number(m[1]), Number(m[2])))); } catch (e) { return hhmm; }
}

// One line for a notification, in the reader's language.
export function notificationText(n) {
  const title = n.post ? n.post.title || t('bell.untitled') : '';
  const d = n.data || {};
  if (n.kind === 'price_drop') {
    if (d.markdown) return t('bell.markdown', { title, percent: d.markdown });
    if (d.items && d.items.length === 1) {
      const i = d.items[0];
      return i.to === 0 ? t('bell.itemFree', { title, item: i.name }) : t('bell.itemDrop', { title, item: i.name, from: money(i.from), to: money(i.to) });
    }
    if (d.items && d.items.length > 1) return t('bell.itemsDrop', { title, count: d.items.length });
    if (d.price && d.price.to === 0) return t('bell.nowFree', { title });
    if (d.price && d.price.from !== null && d.price.from !== undefined) return t('bell.priceDrop', { title, from: dollars(d.price.from), to: dollars(d.price.to) });
    return t('bell.cheaper', { title });
  }
  if (n.kind === 'item_sold') {
    if (d.soldOut) return t('bell.soldOut', { title });
    const items = d.items || [];
    if (items.length === 1) return t('bell.itemSold', { title, item: items[0].name });
    return t('bell.itemsSold', { title, count: items.length });
  }
  if (n.kind === 'reminder_eve') {
    const time = d.start && d.end ? clock(d.start) + '–' + clock(d.end) : '';
    return time ? t('bell.reminderEve', { title, time }) : t('bell.reminderEvePlain', { title });
  }
  if (n.kind === 'event_join') return t('bell.eventJoin', { title, event: d.eventName || '' });
  if (n.kind === 'event_joined') return t('bell.eventJoined', { title, event: d.eventName || '' });
  if (n.kind === 'event_approved') return t('bell.eventApproved', { title, event: d.eventName || '' });
  if (n.kind === 'event_removed') return t(d.declined ? 'bell.eventDeclined' : 'bell.eventRemoved', { title, event: d.eventName || '' });
  if (n.kind === 'rain_check') return t('bell.rainCheck', { title, what: reasonText(d.reason), day: dayName(d.date) });
  if (n.kind === 'sale_postponed') {
    const time = d.start && d.end ? clock(d.start) + '–' + clock(d.end) : '';
    return time ? t('bell.postponed', { title, day: dayName(d.date), time }) : t('bell.postponedPlain', { title, day: dayName(d.date) });
  }
  if (n.kind === 'search_match') {
    const search = n.search ? (n.search.label || (n.search.keyword ? '“' + n.search.keyword + '”' : '')) : '';
    return search ? t('bell.searchMatch', { search, title }) : t('bell.searchMatchPlain', { title });
  }
  return title;
}

export const unseenCount = (list) => (list || []).filter((n) => !n.seen).length;
