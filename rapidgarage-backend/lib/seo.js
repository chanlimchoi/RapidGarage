'use strict';
// Search engines: structured data (schema.org JSON-LD), hreflang alternates,
// robots.txt, sitemap.xml and noindex for private pages.
//
// Same privacy line as link previews (lib/share.js): structured data carries
// the city, state and zip but never the street address, and no names or
// emails. Only what a signed-out visitor can see is listed or described:
// visible, not-ended sales and neighborhood sales, open wanted posts.
const { Op } = require('sequelize');
const i18n = require('./i18n');
const schedule = require('./schedule');

function models() { return require('../models'); }
function baseUrl() { return require('./alerts').baseUrl(); }

// Pages that are per-person, forms or tools: never indexed.
const PRIVATE_RE = /^\/(admin|settings|messages|saved|dashboard|profile|login|signup|logout|forgot-password|reset-password|alerts|newpost|following)(\/|$)|^\/post\/\d+\/(edit|print|items)\/?$|^\/events\/(new|\d+\/(edit|print))\/?$|^\/wanted\/(new|\d+\/edit)\/?$/;
const isPrivate = (pathname) => PRIVATE_RE.test(String(pathname || '/').split('?')[0]);

// Public pages worth listing besides the items themselves.
const STATIC_PAGES = ['/', '/events', '/wanted', '/about', '/safety'];

// JSON inside <script>: "<" can't close the tag, and U+2028/9 can't break it.
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const BS = String.fromCharCode(92); // backslash
const ldScript = (obj) => '<script type="application/ld+json">' + JSON.stringify(obj)
  .replace(/</g, BS + 'u003c').split(LS).join(BS + 'u2028').split(PS).join(BS + 'u2029') + '</script>';

const iso = (v) => new Date(v).toISOString();
const live = (days, at) => (days || []).filter((d) => new Date(d.endsAt) > at).sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));

function place(name, city, state, zip, geo) {
  const address = { '@type': 'PostalAddress', addressCountry: 'US' };
  if (city) address.addressLocality = city;
  if (state) address.addressRegion = state;
  if (zip) address.postalCode = zip;
  const out = { '@type': 'Place', name: name || [city, state].filter(Boolean).join(', ') || 'RapidGarage', address };
  if (geo) out.geo = { '@type': 'GeoCoordinates', latitude: geo.lat, longitude: geo.lng };
  return out;
}

// Whole-dollar price range -> Offer / AggregateOffer (or nothing).
function offers(post, url) {
  if (post.isFree) return { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock', url };
  const lo = typeof post.priceMin === 'number' ? post.priceMin : null;
  const hi = typeof post.priceMax === 'number' ? post.priceMax : null;
  if (lo === null && hi === null) return null;
  return { '@type': 'AggregateOffer', priceCurrency: 'USD', lowPrice: String(lo !== null ? lo : 0), highPrice: String(hi !== null ? hi : lo), availability: 'https://schema.org/InStock', url };
}

// One schema.org SaleEvent per remaining sale day (how search engines expect
// multi-day events). Coordinates are rounded to ~1 km so the exact house
// isn't pinpointed; the sale page itself shows the street.
function postLd(post, preview, imageUrl, at) {
  const url = baseUrl() + '/post/' + post.id;
  const days = live(post.saleDays, at || schedule.now()).slice(0, 14);
  if (!days.length) return null;
  const geo = typeof post.lat === 'number' && typeof post.lng === 'number' ? { lat: Math.round(post.lat * 100) / 100, lng: Math.round(post.lng * 100) / 100 } : null;
  const where = place(null, post.city, post.state, post.zipCode, geo);
  const offer = offers(post, url);
  const events = days.map((d) => Object.assign({
    '@type': 'SaleEvent',
    name: preview.title,
    description: preview.description,
    url,
    startDate: iso(d.startsAt),
    endDate: iso(d.endsAt),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    isAccessibleForFree: true,
    location: where,
    image: [imageUrl],
  }, offer ? { offers: offer } : {}));
  return events.length === 1 ? Object.assign({ '@context': 'https://schema.org' }, events[0]) : { '@context': 'https://schema.org', '@graph': events };
}

function eventLd(ev, preview, imageUrl, at) {
  const url = baseUrl() + '/events/' + ev.id;
  const days = live(ev.days, at || schedule.now()).slice(0, 14);
  if (!days.length) return null;
  const where = place(ev.areaLabel, null, null, null, { lat: Math.round(ev.lat * 100) / 100, lng: Math.round(ev.lng * 100) / 100 });
  const events = days.map((d) => ({
    '@type': 'SaleEvent', name: preview.title, description: preview.description, url,
    startDate: iso(d.startsAt), endDate: iso(d.endsAt),
    eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    isAccessibleForFree: true, location: where, image: [imageUrl],
  }));
  return events.length === 1 ? Object.assign({ '@context': 'https://schema.org' }, events[0]) : { '@context': 'https://schema.org', '@graph': events };
}

function siteLd(lang) {
  const base = baseUrl();
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'RapidGarage',
    url: base + '/',
    description: i18n.t(lang, 'share.siteDescription'),
    inLanguage: i18n.CODES,
  };
}

// <link rel="alternate" hreflang> for every UI language (?lang=), plus x-default.
function hreflangTags(pathname) {
  const base = baseUrl();
  const p = String(pathname || '/').split('?')[0] || '/';
  const href = (lang) => base + p + (lang === 'en' ? '' : '?lang=' + encodeURIComponent(lang));
  return i18n.CODES.map((l) => '<link rel="alternate" hreflang="' + l + '" href="' + href(l) + '">')
    .concat('<link rel="alternate" hreflang="x-default" href="' + href('en') + '">');
}

// ---- robots.txt / sitemap.xml ---------------------------------------------
function robotsTxt() {
  const lines = [
    '# RapidGarage: public sales, neighborhood sales and wanted posts may be indexed.',
    'User-agent: *',
    'Allow: /',
    'Allow: /api/share/image/',
    'Allow: /api/uploads/',
    'Disallow: /api/',
    'Disallow: /s/',
  ];
  ['admin', 'settings', 'messages', 'saved', 'dashboard', 'profile', 'login', 'signup', 'logout', 'forgot-password', 'reset-password', 'alerts', 'newpost', 'following']
    .forEach((p) => lines.push('Disallow: /' + p));
  ['/post/*/edit', '/post/*/print', '/post/*/items', '/events/new', '/events/*/edit', '/events/*/print', '/wanted/new', '/wanted/*/edit'].forEach((p) => lines.push('Disallow: ' + p));
  lines.push('', 'Sitemap: ' + baseUrl() + '/sitemap.xml', '');
  return lines.join('\n');
}

const MAX_URLS = 45000;
const CACHE_MS = 10 * 60000;
let cached = null;

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function sitemapEntries(at) {
  const m = models();
  const now = at || schedule.now();
  const base = baseUrl();
  const out = STATIC_PAGES.filter((p) => p !== '/wanted').map((p) => ({ loc: base + p, changefreq: p === '/' ? 'hourly' : 'daily' }));
  const posts = await m.Post.findAll({
    attributes: ['id', 'updatedAt', 'startDate', 'endDate', 'timeZone'],
    where: { [Op.and]: [{ hidden: false }, schedule.notEndedWhere(now)] },
    order: [['updatedAt', 'DESC']],
    limit: MAX_URLS,
  });
  posts.forEach((p) => out.push({ loc: base + '/post/' + p.id, lastmod: iso(p.updatedAt), changefreq: 'daily' }));
  const E = require('./events');
  const evs = await m.SaleEvent.findAll({ where: { hidden: false }, order: [['updatedAt', 'DESC']], limit: 5000 });
  evs.filter((ev) => !E.isEnded(ev, now)).forEach((ev) => out.push({ loc: base + '/events/' + ev.id, lastmod: iso(ev.updatedAt), changefreq: 'daily' }));
  if (await require('./features').wantedEnabled()) {
    out.push({ loc: base + '/wanted', changefreq: 'daily' });
    const W = require('./wanted');
    const ws = await m.WantedPost.findAll({ where: W.activeWhere(now), order: [['updatedAt', 'DESC']], limit: 5000 });
    ws.filter((w) => W.isOpen(w, now)).forEach((w) => out.push({ loc: base + '/wanted/' + w.id, lastmod: iso(w.updatedAt), changefreq: 'weekly' }));
  }
  return out.slice(0, MAX_URLS);
}

async function sitemapXml(at) {
  const key = baseUrl();
  if (!at && cached && cached.key === key && Date.now() - cached.time < CACHE_MS) return cached.xml;
  const entries = await sitemapEntries(at);
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + entries.map((e) => '  <url><loc>' + xmlEsc(e.loc) + '</loc>' + (e.lastmod ? '<lastmod>' + e.lastmod + '</lastmod>' : '') + (e.changefreq ? '<changefreq>' + e.changefreq + '</changefreq>' : '') + '</url>').join('\n')
    + '\n</urlset>\n';
  if (!at) cached = { key, time: Date.now(), xml };
  return xml;
}
const clearCache = () => { cached = null; };

module.exports = { PRIVATE_RE, isPrivate, STATIC_PAGES, ldScript, postLd, eventLd, siteLd, hreflangTags, robotsTxt, sitemapEntries, sitemapXml, clearCache, MAX_URLS };
