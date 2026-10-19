'use strict';
// Link previews (Open Graph + Twitter Card) for shared links.
//
//   /post/:id      a sale          /events/:id   a neighborhood sale
//   /wanted/:id    a wanted post   anything else the site itself
//
// The HTML for those routes carries <meta> tags built here, from what the
// page shows to a signed-out visitor, and a bit less:
//   * title, day/time of the next sale day (+N more), city and state, the
//     price range or "Free on the curb until …", and the start of the
//     description. Never the street address (it's on the page, but a preview
//     travels further than the link), seller or poster names, or emails.
//   * Hidden, removed and ended sales (unless still free on the curb, and not
//     reported), hidden or ended neighborhood sales, and wanted posts that
//     aren't open (hidden, expired, fulfilled, or the board is switched off)
//     get the generic site preview, plus noindex.
// The image is the sale's first photo (EXIF was stripped on upload) cropped to
// 1200x630, or a branded card (lib/shareCard.js). Images are addressed by a
// content key (?v=), cached on disk, and change when the preview does.
//
// Language: ?lang= (the Share button adds it outside English), then
// Facebook's fb_locale, then Accept-Language, else English.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const i18n = require('./i18n');
const schedule = require('./schedule');
const ft = require('./flyerText');
const card = require('./shareCard');
const seo = require('./seo');

function models() { return require('../models'); }

const RENDER_VERSION = '1';
const DESC_MAX = 200;
const OG_LOCALE = { en: 'en_US', es: 'es_LA', ko: 'ko_KR', 'zh-CN': 'zh_CN' };
const ROUTES = [
  { kind: 'post', re: /^\/post\/(\d+)\/?$/ },
  { kind: 'event', re: /^\/events\/(\d+)\/?$/ },
  { kind: 'wanted', re: /^\/wanted\/(\d+)\/?$/ },
];

function baseUrl() { return require('./alerts').baseUrl(); }
const hostLabel = () => { try { return new URL(baseUrl()).host; } catch (e) { return 'RapidGarage'; } };

// "/post/12" -> { kind: 'post', id: 12 } or null.
function match(pathname) {
  const p = String(pathname || '').split('?')[0];
  for (const r of ROUTES) {
    const m = r.re.exec(p);
    if (m) { const id = Number(m[1]); if (Number.isSafeInteger(id) && id > 0) return { kind: r.kind, id }; }
  }
  return null;
}

// { lang, explicit } for a request (or a { query, headers } stand-in).
function langOf(req) {
  const q = (req && req.query) || {};
  const asked = i18n.normalize(typeof q.lang === 'string' ? q.lang : null);
  if (asked) return { lang: asked, explicit: true };
  const fb = i18n.normalize(typeof q.fb_locale === 'string' ? q.fb_locale : null);
  if (fb) return { lang: fb, explicit: true };
  const al = req && req.get ? req.get('Accept-Language') : null;
  // Accept-Language only (crawlers have no session; a signed-in browser's
  // account language must not leak into what it renders for the page).
  return { lang: i18n.requestLang({ get: (h) => (/^accept-language$/i.test(h) ? al : null) }), explicit: false };
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
function clip(s, max) {
  const t = clean(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s.,;:!?·-]+$/, '') + '…';
}
const join = (parts) => parts.filter(Boolean).join(' · ');
const ms = (v) => new Date(v).getTime();

// First upcoming day as "Sun, Oct 18 · 9 AM – 3 PM", plus "+2 more days".
function dateLine(lang, days, at) {
  const t = ms(at);
  const live = (days || []).filter((d) => ms(d.endsAt) > t).sort((a, b) => ms(a.startsAt) - ms(b.startsAt));
  if (!live.length) return '';
  const d = live[0];
  const first = ft.dayLines(lang, [{ date: d.date, start: d.startTime || d.start, end: d.endTime || d.end }])[0];
  return live.length > 1 ? first + ' ' + i18n.t(lang, 'share.moreDays', { count: live.length - 1 }) : first;
}

function timeIn(lang, at, tz) {
  try { return new Intl.DateTimeFormat(i18n.intlLocale(lang), { timeZone: tz || schedule.defaultTimeZone(), weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(at)).replace(/[\u202f\u00a0]/g, ' '); } catch (e) { return ''; }
}

function sitePreview(lang, target) {
  const title = i18n.t(lang, 'share.siteTitle');
  const description = i18n.t(lang, 'share.siteDescription');
  return {
    generic: true, kind: target ? target.kind : 'site', id: target ? target.id : null, lang, title, description,
    card: { generic: true, title: i18n.t(lang, 'share.siteHeadline'), tagline: description, footer: hostLabel() },
    imageAlt: title,
  };
}

async function postPreview(id, lang, at) {
  const M = models();
  const post = await M.Post.findByPk(id, {
    include: [{ model: M.PostPhoto, as: 'photos' }, { model: M.SaleDay, as: 'saleDays' }],
    order: [[{ model: M.PostPhoto, as: 'photos' }, 'position', 'ASC'], [{ model: M.PostPhoto, as: 'photos' }, 'id', 'ASC']],
  });
  if (!post || post.hidden) return null;
  const cs = require('./curbside');
  const curb = cs.isLive(post, at) && !(await cs.isReported(post.id));
  if (schedule.isEnded(post, at) && !curb) return null;
  const tz = post.timeZone || schedule.defaultTimeZone();
  const curbText = curb ? i18n.t(lang, 'share.curbUntil', { time: timeIn(lang, post.curbsideUntil, tz) }) : '';
  const when = dateLine(lang, post.saleDays, at);
  const place = [post.city, post.state].filter(Boolean).join(', ');
  const price = ft.priceIn(lang, post);
  const facts = join([curbText, when, place, curb ? '' : price]);
  const photo = (post.photos || [])[0];
  return {
    generic: false, kind: 'post', id: post.id, lang, title: clean(post.title),
    description: clip(join([facts]) + (post.description ? '. ' + clean(post.description) : ''), DESC_MAX),
    photo: photo ? { key: photo.storageKey } : null,
    card: photo ? null : {
      kicker: i18n.t(lang, 'share.kicker.sale'), title: clean(post.title), lines: [when, place], footer: hostLabel(),
      chip: curb ? { text: curbText, tone: 'free' } : price ? { text: price, tone: price === i18n.t(lang, 'price.free') ? 'free' : 'brand' } : null,
    },
    imageAlt: photo ? i18n.t(lang, 'share.photoAlt', { title: clean(post.title) }) : i18n.t(lang, 'share.cardAlt', { title: clean(post.title) }),
    source: post,
  };
}

async function eventPreview(id, lang, at) {
  const ev = await models().SaleEvent.findByPk(id);
  const E = require('./events');
  if (!ev || ev.hidden || E.isEnded(ev, at)) return null;
  const count = (await E.publicSaleCounts([ev.id])).get(ev.id) || 0;
  const when = dateLine(lang, ev.days, at);
  const area = clean(ev.areaLabel);
  const sales = count ? i18n.t(lang, 'share.saleCount', { count }) : '';
  return {
    generic: false, kind: 'event', id: ev.id, lang, title: clean(ev.name),
    description: clip(join([when, area, sales]) + (ev.description ? '. ' + clean(ev.description) : ''), DESC_MAX),
    card: { kicker: i18n.t(lang, 'share.kicker.event'), title: clean(ev.name), lines: [when, join([area, sales])], footer: hostLabel() },
    imageAlt: i18n.t(lang, 'share.cardAlt', { title: clean(ev.name) }),
    source: ev,
  };
}

async function wantedPreview(id, lang, at) {
  const W = require('./wanted');
  if (!(await require('./features').wantedEnabled())) return null;
  const w = await models().WantedPost.findByPk(id);
  if (!w || !W.isOpen(w, at)) return null;
  const title = i18n.t(lang, 'share.wantedTitle', { title: clean(w.title) });
  const area = i18n.t(lang, 'share.near', { area: clean(w.areaLabel), miles: w.radiusMiles });
  const price = w.maxPriceCents === null || w.maxPriceCents === undefined ? '' : w.maxPriceCents === 0
    ? i18n.t(lang, 'price.free') : i18n.t(lang, 'price.upTo', { max: ft.centsIn(lang, w.maxPriceCents) });
  return {
    generic: false, kind: 'wanted', id: w.id, lang, title,
    description: clip(join([area, price]) + (w.details ? '. ' + clean(w.details) : ''), DESC_MAX),
    card: { kicker: i18n.t(lang, 'share.kicker.wanted'), title: clean(w.title), lines: [area], chip: price ? { text: price, tone: 'brand' } : null, footer: hostLabel() },
    imageAlt: i18n.t(lang, 'share.cardAlt', { title }),
  };
}

const LOADERS = { post: postPreview, event: eventPreview, wanted: wantedPreview };

// The preview for `target` ({ kind, id } or null for the site) in `lang`.
async function previewFor(target, lang, at) {
  const now = at || schedule.now();
  const l = i18n.normalize(lang) || 'en';
  const p = target && LOADERS[target.kind] ? await LOADERS[target.kind](target.id, l, now) : null;
  const out = p || sitePreview(l, target);
  out.imageKey = imageKey(out);
  out.imageType = out.photo ? 'image/jpeg' : 'image/png';
  return out;
}

function imageKey(p) {
  const src = p.photo ? 'photo:' + p.photo.key : 'card:' + JSON.stringify(p.card);
  return crypto.createHash('sha256').update(RENDER_VERSION + '\n' + src).digest('base64url').slice(0, 16);
}

// Path (under the public base URL) of a preview's image.
function imagePath(p) {
  const lang = p.lang !== 'en' ? '&lang=' + encodeURIComponent(p.lang) : '';
  if (p.generic) return '/api/share/image/site.png?v=' + p.imageKey + lang;
  return '/api/share/image/' + p.kind + '/' + p.id + (p.photo ? '.jpg' : '.png') + '?v=' + p.imageKey + lang;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// The <head> block for a preview requested at `pathname`.
function headTags(p, pathname, explicitLang) {
  const base = baseUrl();
  const pagePath = String(pathname || '/').split('?')[0] || '/';
  const canonical = base + pagePath;
  const url = canonical + (explicitLang && p.lang !== 'en' ? '?lang=' + encodeURIComponent(p.lang) : '');
  const image = base + imagePath(p);
  const docTitle = p.generic ? p.title : p.title + ' · RapidGarage';
  const m = (attr, k, v) => `<meta ${attr}="${k}" content="${esc(v)}">`;
  const tags = [
    `<title>${esc(docTitle)}</title>`,
    m('name', 'description', p.description),
    `<link rel="canonical" href="${esc(canonical)}">`,
    m('property', 'og:site_name', 'RapidGarage'),
    m('property', 'og:type', 'website'),
    m('property', 'og:title', p.title),
    m('property', 'og:description', p.description),
    m('property', 'og:url', url),
    m('property', 'og:locale', OG_LOCALE[p.lang] || 'en_US'),
    ...Object.keys(OG_LOCALE).filter((l) => l !== p.lang).map((l) => m('property', 'og:locale:alternate', OG_LOCALE[l])),
    m('property', 'og:image', image),
    ...(image.startsWith('https:') ? [m('property', 'og:image:secure_url', image)] : []),
    m('property', 'og:image:type', p.imageType),
    m('property', 'og:image:width', String(card.W)),
    m('property', 'og:image:height', String(card.H)),
    m('property', 'og:image:alt', p.imageAlt),
    m('name', 'twitter:card', 'summary_large_image'),
    m('name', 'twitter:title', p.title),
    m('name', 'twitter:description', p.description),
    m('name', 'twitter:image', image),
    m('name', 'twitter:image:alt', p.imageAlt),
  ];
  // Search engines (lib/seo.js): private pages and unavailable items are
  // noindex; public ones get hreflang alternates and structured data.
  const noindex = (p.generic && p.kind !== 'site') || seo.isPrivate(pagePath);
  if (noindex) tags.push(m('name', 'robots', 'noindex'));
  else {
    tags.push(...seo.hreflangTags(pagePath));
    const ld = p.kind === 'post' && p.source ? seo.postLd(p.source, p, image)
      : p.kind === 'event' && p.source ? seo.eventLd(p.source, p, image)
        : p.kind === 'site' && pagePath === '/' ? seo.siteLd(p.lang) : null;
    if (ld) tags.push(seo.ldScript(ld));
  }
  return tags.join('\n    ');
}

const HEAD_RE = /<!--\s*rg:head\s*-->[\s\S]*?<!--\s*\/rg:head\s*-->/;

// Put `head` into index.html: between <!-- rg:head --> markers (the build's
// static fallback), else before </head> replacing <title>/description.
function injectHead(html, head, lang) {
  let out = String(html);
  const block = '<!-- rg:head -->\n    ' + head + '\n    <!-- /rg:head -->';
  if (HEAD_RE.test(out)) out = out.replace(HEAD_RE, () => block);
  else {
    out = out.replace(/<title>[\s\S]*?<\/title>\s*/i, '').replace(/<meta\s+name="description"[^>]*>\s*/i, '');
    out = out.replace(/<\/head>/i, () => '    ' + block + '\n  </head>');
  }
  if (lang) out = out.replace(/<html([^>]*?)\slang="[^"]*"/i, (all, pre) => '<html' + pre + ' lang="' + esc(lang) + '"');
  return out;
}

// { lang, head } for a page path and request (used by lib/frontend.js and GET /share/head).
async function headFor(pathname, req, at) {
  const { lang, explicit } = langOf(req);
  const p = await previewFor(match(pathname), lang, at);
  return { lang, head: headTags(p, pathname, explicit), preview: p };
}

// ---- images ----------------------------------------------------------------
const cacheDir = () => path.resolve(process.env.SHARE_CACHE_DIR || path.join(os.tmpdir(), 'rapidgarage-share'));
const CACHE_MAX_FILES = 500;
const memory = new Map(); // key -> Buffer, small LRU in front of the disk
const MEMORY_MAX = 40;

function remember(key, buf) {
  memory.delete(key);
  memory.set(key, buf);
  while (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value);
}

function pruneDisk(dir) {
  try {
    const files = fs.readdirSync(dir).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => a.t - b.t);
    files.slice(0, Math.max(0, files.length - CACHE_MAX_FILES)).forEach((x) => fs.unlinkSync(path.join(dir, x.f)));
  } catch (e) { /* best effort */ }
}

// Buffer for a preview's image, from the cache or rendered now.
async function imageFor(p) {
  const ext = p.photo ? '.jpg' : '.png';
  const key = p.imageKey;
  if (memory.has(key)) { const b = memory.get(key); remember(key, b); return b; }
  const dir = cacheDir();
  const file = path.join(dir, key + ext);
  try { const b = fs.readFileSync(file); remember(key, b); return b; } catch (e) { /* not cached */ }
  let buf;
  if (p.photo) {
    try { buf = await card.renderPhoto(await require('./storage').getStorage().read(p.photo.key)); } catch (e) { buf = null; }
    if (!buf) { // photo file missing or unreadable: the site card
      const site = sitePreview(p.lang);
      return imageFor(Object.assign(site, { imageKey: imageKey(site) }));
    }
  } else buf = await card.renderCard(p.card);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file + '.tmp' + process.pid, buf);
    fs.renameSync(file + '.tmp' + process.pid, file);
    pruneDisk(dir);
  } catch (e) { /* cache is optional */ }
  remember(key, buf);
  return buf;
}

function clearMemory() { memory.clear(); }

module.exports = { match, langOf, previewFor, headTags, headFor, injectHead, imagePath, imageFor, cacheDir, clearMemory, OG_LOCALE, DESC_MAX };
