// Saved searches and the notification list (pure helpers; see
// test/saved-search.test.js). The server (controllers/alerts.js,
// lib/notifications.js) has the final say.
import { t } from '../i18n/index.js';

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
  return n.post ? '/post/' + n.post.id : '/settings#alerts';
}

// One line for a notification, in the reader's language.
export function notificationText(n) {
  const title = n.post ? n.post.title || t('bell.untitled') : '';
  if (n.kind === 'search_match') {
    const search = n.search ? (n.search.label || (n.search.keyword ? '“' + n.search.keyword + '”' : '')) : '';
    return search ? t('bell.searchMatch', { search, title }) : t('bell.searchMatchPlain', { title });
  }
  return title;
}

export const unseenCount = (list) => (list || []).filter((n) => !n.seen).length;
