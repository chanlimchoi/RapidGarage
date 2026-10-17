'use strict';
// Wanted posts: a signed-in buyer says what they're looking for (match words,
// an optional category and max price, an area = center + radius, an expiry).
// New or updated sales and sale items that match notify the buyer in the app
// (WantedMatch rows, shown on the wanted post) and by email through the sale
// alert machinery (same SMTP, digest interval, daily cap and signed
// unsubscribe links; see lib/alerts.js).
//
// Matching: a sale matches when every match word appears in its title or
// description (or every word appears in one unsold item's name), the category
// (if any) has one of its words in that same text, the price fits and the sale
// is inside the wanted area. One match per (wanted post, sale), so nobody is
// told twice about the same sale, however often it is edited.
//
// Privacy: the board shows "First L." and the area name; the exact center is
// only used for matching and the API returns it rounded to ~1 km.
const { Op } = require('sequelize');
const geo = require('./geo');
const i18n = require('./i18n');
const schedule = require('./schedule');
const mailer = require('./mailer');
const { isAdmin } = require('./roles');
const { publicUser, publicName } = require('./people');
const { wantedEnabled } = require('./features');

function curbside() { return require('./curbside'); }
function models() { return require('../models'); }
function alerts() { return require('./alerts'); }

function intEnv(name, dflt) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : dflt;
}

const TITLE_MIN = 3;
const TITLE_MAX = 80;
const KEYWORDS_MAX = 120;
const DETAILS_MAX = 500;
const AREA_MAX = 80;
const MAX_WORDS = 5;
const RADIUS_MIN = 1;
const RADIUS_MAX = 50; // same as sale alerts
const DAYS_DEFAULT = 30;
const DAYS_MAX = 90;
const PRICE_CAP_CENTS = 100000 * 100; // same cap as sale items
const PUBLIC_DECIMALS = 2; // ~1.1 km of latitude
const maxActive = () => intEnv('WANTED_MAX_ACTIVE', 10);
const maxPerDay = () => intEnv('WANTED_MAX_PER_DAY', 20);
const BACKFILL_LIMIT = 300;

// Categories narrow a match: the sale (or item) text must also contain one of
// the category's words. Words in all four UI languages; matched as substrings
// of lower-cased text, so "sofa" also catches "sofas".
const CATEGORIES = {
  furniture: ['furniture', 'sofa', 'couch', 'chair', 'table', 'desk', 'dresser', 'shelf', 'shelves', 'bookcase', 'cabinet', 'bed', 'mattress', 'nightstand', 'ottoman', 'stool', 'mueble', 'silla', 'mesa', 'cama', 'sillón', 'escritorio', '가구', '소파', '의자', '책상', '침대', '식탁', '家具', '沙发', '椅子', '桌', '床', '柜'],
  electronics: ['electronic', 'tv', 'television', 'computer', 'laptop', 'monitor', 'phone', 'tablet', 'speaker', 'headphone', 'camera', 'console', 'playstation', 'xbox', 'nintendo', 'stereo', 'printer', 'electrónic', 'televisor', 'computadora', 'cámara', '전자', '텔레비전', '컴퓨터', '노트북', '카메라', '스피커', '电子', '电视', '电脑', '笔记本', '相机', '音箱'],
  kids: ['kid', 'child', 'baby', 'toddler', 'stroller', 'crib', 'car seat', 'high chair', 'niño', 'niña', 'bebé', 'cochecito', 'cuna', '아기', '아동', '유모차', '어린이', '儿童', '婴儿', '宝宝', '童车', '婴儿车'],
  clothing: ['cloth', 'shirt', 'dress', 'jacket', 'coat', 'shoe', 'boot', 'jeans', 'pants', 'sweater', 'hat', 'bag', 'purse', 'ropa', 'camisa', 'vestido', 'chaqueta', 'zapato', '옷', '의류', '신발', '가방', '자켓', '衣', '鞋', '裙', '外套', '包'],
  tools: ['tool', 'drill', 'saw', 'wrench', 'hammer', 'ladder', 'mower', 'toolbox', 'sander', 'herramienta', 'taladro', 'sierra', 'escalera', '공구', '드릴', '사다리', '工具', '电钻', '梯子'],
  sports: ['sport', 'bike', 'bicycle', 'golf', 'tennis', 'ski', 'snowboard', 'skate', 'fitness', 'weights', 'treadmill', 'camping', 'tent', 'kayak', 'fishing', 'bicicleta', 'deporte', 'pesca', '자전거', '운동', '캠핑', '골프', '스키', '自行车', '运动', '健身', '露营', '钓鱼'],
  books: ['book', 'novel', 'comic', 'magazine', 'vinyl', 'record', 'dvd', 'blu-ray', 'cd', 'libro', 'revista', 'disco', '책', '도서', '만화', '음반', '书', '漫画', '唱片', '杂志'],
  kitchen: ['kitchen', 'dish', 'plate', 'bowl', 'pot', 'pan', 'mixer', 'blender', 'toaster', 'microwave', 'cookware', 'glass', 'mug', 'appliance', 'cocina', 'plato', 'olla', 'sartén', 'licuadora', '주방', '그릇', '냄비', '프라이팬', '믹서', '厨房', '餐具', '锅', '碗', '盘'],
  toys: ['toy', 'game', 'lego', 'puzzle', 'doll', 'board game', 'stuffed', 'juguete', 'juego', 'muñeca', '장난감', '레고', '퍼즐', '게임', '玩具', '乐高', '拼图', '游戏'],
  garden: ['garden', 'plant', 'planter', 'pot', 'hose', 'patio', 'grill', 'bbq', 'outdoor', 'lawn', 'jardín', 'planta', 'parrilla', 'maceta', '정원', '화분', '식물', '그릴', '花园', '植物', '花盆', '烧烤', '庭院'],
  music: ['music', 'guitar', 'piano', 'keyboard', 'drum', 'violin', 'amp', 'ukulele', 'música', 'guitarra', 'batería', '악기', '기타', '피아노', '드럼', '乐器', '吉他', '钢琴', '鼓'],
  decor: ['decor', 'lamp', 'rug', 'mirror', 'frame', 'art', 'painting', 'curtain', 'vase', 'clock', 'lámpara', 'alfombra', 'espejo', 'cuadro', '조명', '러그', '거울', '액자', '灯', '地毯', '镜子', '画', '窗帘'],
};
const CATEGORY_KEYS = Object.keys(CATEGORIES);

// Words that never make a useful match word on their own.
const STOP = new Set(['a', 'an', 'and', 'the', 'or', 'for', 'of', 'in', 'on', 'to', 'with', 'my', 'any', 'some', 'looking', 'wanted', 'want', 'need', 'needed', 'buy', 'iso', 'good', 'condition', 'used', 'please',
  'un', 'una', 'unos', 'unas', 'el', 'la', 'los', 'las', 'y', 'o', 'de', 'del', 'para', 'con', 'en', 'busco', 'necesito', 'quiero', 'buen', 'buena', 'estado']);

// Lower-case, NFKC, apostrophes dropped, other punctuation -> spaces.
function normalize(text) {
  return String(text || '').normalize('NFKC').toLowerCase().replace(/['’`]/g, '').replace(/[^\p{L}\p{N}\s-]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

// "bikes" -> "bike" so a word also matches the singular inside longer text.
const stem = (w) => (w.length > 3 && /s$/.test(w) && !/ss$/.test(w) ? w.slice(0, -1) : w);

// Match words from a keywords string or a title: unique, stop words dropped, max 5.
function wordsOf(text) {
  const out = [];
  normalize(text).split(' ').forEach((raw) => {
    const w = raw.replace(/^-+|-+$/g, '');
    if (!w || STOP.has(w) || (w.length < 2 && !/[^\x00-\x7f]/.test(w))) return;
    const s = stem(w);
    if (out.indexOf(s) === -1) out.push(s);
  });
  return out.slice(0, MAX_WORDS);
}

// The words a wanted post matches on: its keywords, else its title.
function matchWords(w) {
  const k = w.keywords ? wordsOf(w.keywords) : [];
  return k.length ? k : wordsOf(w.title);
}

const hasAll = (text, words) => words.every((x) => text.indexOf(x) >= 0);
const inCategory = (text, category) => !category || !CATEGORIES[category] || CATEGORIES[category].some((x) => text.indexOf(x) >= 0);

// Sale price (whole dollars, lib/price.js) vs a max in cents. Same rule as the
// search price filter: free sales, sales from <= max, "up to $Y" sales.
function salePriceFits(post, maxCents) {
  if (maxCents === null || maxCents === undefined) return true;
  if (post.isFree) return true;
  if (post.priceMin !== null && post.priceMin !== undefined) return post.priceMin * 100 <= maxCents;
  return post.priceMax !== null && post.priceMax !== undefined;
}
// Items without a price don't match a max price (we can't tell).
const itemPriceFits = (item, maxCents) => maxCents === null || maxCents === undefined || (item.priceCents !== null && item.priceCents !== undefined && item.priceCents <= maxCents);

// Does sale `post` (with its unsold `items`) match wanted post `w`?
// Returns null or { itemId } (the first matching item, null = the sale itself).
// opts.curbside: the post has a live "free on the curb" offer, so its free
// items cost 0; opts.onlyCurbside: the sale ended, so only what's on the
// curb is still there.
function matchSale(w, post, items, opts) {
  const words = matchWords(w);
  if (!words.length) return null;
  const o = opts || {};
  const max = w.maxPriceCents;
  for (const item of items || []) {
    if (item.sold) continue;
    const free = o.curbside && curbside().itemFree(post, item);
    if (o.onlyCurbside && !free) continue;
    const text = normalize(item.name);
    if (hasAll(text, words) && inCategory(text, w.category) && (free || itemPriceFits(item, max))) return { itemId: item.id };
  }
  const freeAll = o.curbside && !!post.curbsideAll;
  if (o.onlyCurbside && !freeAll) return null;
  const text = normalize([post.title, post.description].filter(Boolean).join(' '));
  if (hasAll(text, words) && inCategory(text, w.category) && (freeAll || salePriceFits(post, max))) return { itemId: null };
  return null;
}

// ---- status / JSON ------------------------------------------------------
const isOwner = (user, w) => !!user && user.id === w.userId;
const canSee = (user, w) => !w.hidden || isAdmin(user) || isOwner(user, w);
// active | expired | fulfilled
function statusOf(w, at) {
  if (w.status === 'fulfilled') return 'fulfilled';
  return new Date(w.expiresAt) <= (at || schedule.now()) ? 'expired' : 'active';
}
const isOpen = (w, at) => !w.hidden && statusOf(w, at) === 'active';
const activeWhere = (at) => ({ status: 'active', expiresAt: { [Op.gt]: at || schedule.now() } });
const round = (n) => Math.round(n * Math.pow(10, PUBLIC_DECIMALS)) / Math.pow(10, PUBLIC_DECIMALS);
const publicPoint = (w) => ({ lat: round(w.lat), lng: round(w.lng) });

function toJSON(w, viewer, extra) {
  const mine = isOwner(viewer, w);
  const out = {
    id: w.id, title: w.title, keywords: w.keywords ? w.keywords.split(' ') : [], matchWords: matchWords(w),
    category: w.category || null, details: w.details || null, maxPriceCents: w.maxPriceCents === undefined ? null : w.maxPriceCents,
    areaLabel: w.areaLabel, approx: publicPoint(w), radiusMiles: w.radiusMiles,
    status: statusOf(w), expiresAt: w.expiresAt, fulfilledAt: w.fulfilledAt || null, createdAt: w.createdAt, updatedAt: w.updatedAt,
    poster: w.poster ? publicUser(w.poster) : { id: w.userId, name: publicName(null) }, mine,
  };
  if (mine || isAdmin(viewer)) Object.assign(out, { hidden: !!w.hidden, hiddenSource: w.hiddenSource || null });
  if (mine) out.emailEnabled = !!w.emailEnabled;
  return Object.assign(out, extra || {});
}

// ---- validation -----------------------------------------------------------
const str = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : v);

// "12", "12.5", 12 -> cents; "" / null -> null.
function parseMaxCents(raw) {
  if (raw === null || raw === undefined || raw === '') return { value: null };
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= PRICE_CAP_CENTS) return { value: raw };
  return { error: 'Max price must be a whole number of cents from 0 to ' + PRICE_CAP_CENTS + '.' };
}

// body -> { errors, values } (location is read by lib/area.js).
function validate(body, creating) {
  const b = body || {};
  const errors = {};
  const values = {};
  const has = (k) => b[k] !== undefined;
  if (creating || has('title')) {
    const t = str(b.title);
    if (typeof t !== 'string' || t.length < TITLE_MIN) errors.title = 'Say what you are looking for (at least ' + TITLE_MIN + ' characters).';
    else if (t.length > TITLE_MAX) errors.title = 'Keep the title under ' + TITLE_MAX + ' characters.';
    else values.title = t;
  }
  if (has('keywords')) {
    if (b.keywords === null || b.keywords === '') values.keywords = null;
    else if (typeof b.keywords !== 'string' && !Array.isArray(b.keywords)) errors.keywords = 'Keywords must be text.';
    else {
      const raw = Array.isArray(b.keywords) ? b.keywords.join(' ') : b.keywords;
      if (raw.length > KEYWORDS_MAX) errors.keywords = 'Keep keywords under ' + KEYWORDS_MAX + ' characters.';
      else { const words = wordsOf(raw); values.keywords = words.length ? words.join(' ') : null; }
    }
  }
  if (has('category')) {
    if (b.category === null || b.category === '') values.category = null;
    else if (CATEGORY_KEYS.indexOf(b.category) === -1) errors.category = 'Choose one of the categories.';
    else values.category = b.category;
  }
  if (has('details')) {
    if (b.details === null) values.details = null;
    else if (typeof b.details !== 'string') errors.details = 'Details must be text.';
    else if (b.details.trim().length > DETAILS_MAX) errors.details = 'Keep the details under ' + DETAILS_MAX + ' characters.';
    else values.details = b.details.trim() || null;
  }
  if (has('maxPriceCents')) {
    const p = parseMaxCents(b.maxPriceCents);
    if (p.error) errors.maxPriceCents = p.error; else values.maxPriceCents = p.value;
  }
  if (creating || has('areaLabel')) {
    const a = str(b.areaLabel);
    if (typeof a !== 'string' || !a) errors.areaLabel = 'Name the area, like a neighborhood or a town.';
    else if (a.length > AREA_MAX) errors.areaLabel = 'Keep the area under ' + AREA_MAX + ' characters.';
    else values.areaLabel = a;
  }
  if (creating || has('radiusMiles')) {
    const r = typeof b.radiusMiles === 'string' && b.radiusMiles.trim() ? Number(b.radiusMiles) : b.radiusMiles;
    if (!Number.isInteger(r) || r < RADIUS_MIN || r > RADIUS_MAX) errors.radiusMiles = 'Radius must be a whole number of miles from ' + RADIUS_MIN + ' to ' + RADIUS_MAX + '.';
    else values.radiusMiles = r;
  }
  if (has('emailEnabled')) {
    if (typeof b.emailEnabled !== 'boolean') errors.emailEnabled = 'emailEnabled must be true or false.';
    else values.emailEnabled = b.emailEnabled;
  }
  if (creating || has('days')) {
    const d = parseDays(b.days);
    if (d.error) errors.days = d.error; else if (creating) values.days = d.value;
  }
  // Something to match on: keywords, or a title with at least one real word.
  if (creating && !errors.title && !errors.keywords && !matchWords({ title: values.title, keywords: values.keywords }).length) {
    errors.keywords = 'Add a keyword we can match sales on.';
  }
  return { errors, values };
}

function parseDays(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: DAYS_DEFAULT };
  const d = typeof raw === 'string' ? Number(raw) : raw;
  if (!Number.isInteger(d) || d < 1 || d > DAYS_MAX) return { error: 'Choose how long to keep it up: 1 to ' + DAYS_MAX + ' days.' };
  return { value: d };
}
const expiryFrom = (days, at) => new Date((at || schedule.now()).getTime() + days * 86400000);

// ---- blocks ---------------------------------------------------------------
// Ids of users `me` blocked or who blocked `me`.
async function blockedWith(me) {
  if (!me) return new Set();
  const rows = await models().UserBlock.findAll({ where: { [Op.or]: [{ blockerId: me }, { blockedId: me }] }, raw: true });
  return new Set(rows.map((r) => (r.blockerId === me ? r.blockedId : r.blockerId)));
}

// ---- matching -------------------------------------------------------------
// A sale can match while it's visible, placed, and either not ended or
// offering leftovers free on the curb (offer: live and not reported).
const saleVisible = (post, at, offer) => post && !post.hidden && typeof post.lat === 'number' && typeof post.lng === 'number' && (!schedule.isEnded(post, at) || !!offer);
// { curbside, onlyCurbside } for matchSale; offer = live offer and no open report.
async function offerOf(post, at) {
  const live = curbside().isLive(post, at) && !(await curbside().isReported(post.id));
  return { curbside: live, onlyCurbside: live && schedule.isEnded(post, at) };
}

// Record matches of one sale against every open wanted post nearby. New rows
// are email-pending (or skipped when the buyer turned email off); the unique
// (wanted, sale) index drops repeats. Returns the number of matches found.
async function enqueueForPost(postId) {
  const m = models();
  if (!(await wantedEnabled())) return 0;
  const post = await m.Post.findByPk(postId, { include: [{ model: m.SaleDay, as: 'saleDays' }, { model: m.SaleItem, as: 'items' }] });
  const now = schedule.now();
  if (!post) return 0;
  const offer = await offerOf(post, now);
  if (!saleVisible(post, now, offer.curbside)) return 0;
  const dLat = RADIUS_MAX / 69.0;
  const candidates = await m.WantedPost.findAll({ where: Object.assign({ hidden: false, userId: { [Op.ne]: post.userId }, lat: { [Op.between]: [post.lat - dLat, post.lat + dLat] } }, activeWhere(now)) });
  const hits = [];
  candidates.forEach((w) => {
    const d = geo.haversineMiles({ lat: w.lat, lng: w.lng }, { lat: post.lat, lng: post.lng });
    if (d > w.radiusMiles) return;
    const hit = matchSale(w, post, post.items || [], offer);
    if (hit) hits.push({ w, d, itemId: hit.itemId });
  });
  if (!hits.length) return 0;
  const blocked = await blockedWith(post.userId);
  const rows = hits.filter((h) => !blocked.has(h.w.userId)).map((h) => ({
    wantedId: h.w.id, userId: h.w.userId, postId: post.id, itemId: h.itemId, distanceMiles: Math.round(h.d * 10) / 10,
    status: h.w.emailEnabled ? 'pending' : 'skipped', lastError: h.w.emailEnabled ? null : 'email_off',
  }));
  if (!rows.length) return 0;
  await m.WantedMatch.bulkCreate(rows, { ignoreDuplicates: true });
  return rows.length;
}

// Fire-and-forget after a sale or item is published or changed (shares the
// in-flight set with sale alerts, so tests can await alerts.idle()).
function schedulePost(postId) {
  return alerts().track(() => enqueueForPost(postId), 'Wanted matching failed for post ' + postId);
}

// When a wanted post is created, edited or renewed: sales that already match
// are listed on it (in-app only, no email: the buyer is looking right now).
async function backfill(w) {
  const m = models();
  if (!isOpen(w)) return 0;
  const now = schedule.now();
  const box = geo.boundingBox({ lat: w.lat, lng: w.lng }, w.radiusMiles);
  const posts = await m.Post.findAll({
    where: { [Op.and]: [{ hidden: false, userId: { [Op.ne]: w.userId }, lat: { [Op.between]: [box.minLat, box.maxLat] } },
      { [Op.or]: box.lngRanges.map(([a, b]) => ({ lng: { [Op.between]: [a, b] } })) }, curbside().listableWhere(now)] },
    include: [{ model: m.SaleItem, as: 'items' }, { model: m.SaleDay, as: 'saleDays' }], limit: BACKFILL_LIMIT,
  });
  const blocked = await blockedWith(w.userId);
  const reported = await curbside().reportedIds(posts.filter((p) => curbside().isLive(p, now)).map((p) => p.id));
  const rows = [];
  posts.forEach((post) => {
    const live = curbside().isLive(post, now) && !reported.has(post.id);
    const offer = { curbside: live, onlyCurbside: live && schedule.isEnded(post, now) };
    if (blocked.has(post.userId) || !saleVisible(post, now, live)) return;
    const d = geo.haversineMiles({ lat: w.lat, lng: w.lng }, { lat: post.lat, lng: post.lng });
    if (d > w.radiusMiles) return;
    const hit = matchSale(w, post, post.items || [], offer);
    if (hit) rows.push({ wantedId: w.id, userId: w.userId, postId: post.id, itemId: hit.itemId, distanceMiles: Math.round(d * 10) / 10, status: 'skipped', lastError: 'existing' });
  });
  if (rows.length) await m.WantedMatch.bulkCreate(rows, { ignoreDuplicates: true });
  return rows.length;
}

// Matches to show on a wanted post: sales still visible, not ended, not blocked.
async function matchesOf(w, viewer) {
  const m = models();
  const rows = await m.WantedMatch.findAll({ where: { wantedId: w.id }, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: 100 });
  if (!rows.length) return [];
  const posts = await m.Post.findAll({ where: { id: rows.map((r) => r.postId) }, include: [{ model: m.PostPhoto, as: 'photos' }, { model: m.SaleDay, as: 'saleDays' }, { model: m.User, attributes: ['id', 'firstName', 'lastName'] }] });
  const items = await m.SaleItem.findAll({ where: { id: rows.map((r) => r.itemId).filter(Boolean) }, raw: true });
  const byPost = new Map(posts.map((p) => [p.id, p]));
  const byItem = new Map(items.map((i) => [i.id, i]));
  const blocked = await blockedWith(viewer ? viewer.id : null);
  const now = schedule.now();
  const reported = await curbside().reportedIds(posts.filter((p) => curbside().isLive(p, now)).map((p) => p.id));
  const out = [];
  rows.forEach((r) => {
    const p = byPost.get(r.postId);
    const live = !!p && curbside().isLive(p, now) && !reported.has(p.id);
    if (!p || p.hidden || (schedule.isEnded(p) && !live) || blocked.has(p.userId)) return;
    const photos = (p.photos || []).slice().sort((a, b) => a.position - b.position);
    const item = r.itemId ? byItem.get(r.itemId) : null;
    const free = live && (!item || curbside().itemFree(p, item));
    // After the sale, only what's on the curb is still there.
    if (schedule.isEnded(p) && !free) return;
    out.push({
      id: r.id, matchedAt: r.createdAt, isNew: !r.seenAt, distanceMiles: r.distanceMiles,
      post: { id: p.id, title: p.title, city: p.city, state: p.state, isFree: p.isFree, priceMin: p.priceMin, priceMax: p.priceMax, status: schedule.statusOf(p), startDate: p.startDate, thumbUrl: photos.length ? photos[0].toJSON().thumbUrl : null, seller: publicUser(p.User),
        curbsideUntil: free ? p.curbsideUntil : null },
      item: item && !item.sold ? { id: item.id, name: item.name, priceCents: item.priceCents, free } : null,
    });
  });
  return out;
}

// Unseen matches per user (nav badge) or per wanted post.
async function newMatchCount(userId) {
  const m = models();
  return m.WantedMatch.count({ where: { userId, seenAt: null }, include: [{ model: m.WantedPost, as: 'wanted', attributes: [], where: { hidden: false } }] });
}

// ---- email ----------------------------------------------------------------
const esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const PURPOSE = 'wanted.unsub.v1.';
const unsubscribeToken = (w) => alerts().unsubscribeToken(typeof w === 'object' ? w.id : w, PURPOSE);
const verifyToken = (id, token) => alerts().verifyToken(id, token, PURPOSE);
const unsubscribeUrl = (w) => alerts().baseUrl() + '/alerts/unsubscribe?w=' + w.id + '&t=' + encodeURIComponent(unsubscribeToken(w));
const oneClickUrl = (w) => alerts().baseUrl() + '/api/wanted/unsubscribe?w=' + w.id + '&t=' + encodeURIComponent(unsubscribeToken(w));

// items: [{ wanted, post, item, seller, distanceMiles }] -> { subject, text, html, headers }.
// "Sat 11:59 PM" in the sale's time zone, in the reader's language.
function curbTime(lang, at, tz) {
  try { return new Intl.DateTimeFormat(i18n.intlLocale(lang), { timeZone: tz || schedule.defaultTimeZone(), weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(at)); } catch (e) { return new Date(at).toISOString(); }
}

function renderEmail(user, items) {
  const lang = i18n.normalize(user.locale) || 'en';
  const L = (key, vars) => i18n.t(lang, key, vars);
  const base = alerts().baseUrl();
  const { priceIn, centsIn } = require('./flyerText');
  const wanteds = Array.from(new Map(items.map((i) => [i.wanted.id, i.wanted])).values());
  const subject = items.length === 1 ? L('wmail.subjectOne', { title: items[0].wanted.title }) : L('wmail.subjectMany', { count: items.length });
  const lines = items.map((i) => {
    const where = [i.post.city, i.post.state].filter(Boolean).join(', ');
    const away = i.distanceMiles !== null && i.distanceMiles !== undefined ? L('mail.away', { distance: i18n.formatNumber(lang, i.distanceMiles) }) : null;
    const curb = i.curbsideUntil ? L('wmail.curbside', { time: curbTime(lang, i.curbsideUntil, i.post.timeZone) }) : null;
    const what = i.item ? [L('wmail.item', { name: i.item.name }), curb ? null : centsIn(lang, i.item.priceCents)].filter(Boolean).join(' ') : (curb ? null : priceIn(lang, i.post));
    return {
      title: i.post.title, url: base + '/post/' + i.post.id,
      meta: [curb, what, away, where, L('mail.by', { name: publicName(i.seller) })].filter(Boolean).join(' · '),
      wanted: L('wmail.for', { title: i.wanted.title }),
    };
  });
  const hello = user.firstName ? L('mail.hi', { name: user.firstName }) : L('mail.hiAnon');
  const manage = base + '/wanted';
  const text = [
    hello, '',
    items.length === 1 ? L('wmail.introOne') : L('wmail.introMany', { count: items.length }), '',
    ...lines.map((l) => '* ' + l.title + '\n  ' + l.meta + '\n  ' + l.wanted + '\n  ' + l.url + '\n'),
    L('wmail.manageText', { url: manage }),
    ...wanteds.map((w) => L('wmail.turnOffText', { title: w.title, url: unsubscribeUrl(w) })),
  ].join('\n');
  const html = `<!doctype html><html lang="${esc(lang)}"><body style="margin:0;padding:24px;background:#f6f5f2;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,'Apple SD Gothic Neo','Malgun Gothic','PingFang SC','Microsoft YaHei','Noto Sans CJK SC',sans-serif;color:#1c1b19">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e7e4dd;border-radius:16px;padding:24px">
<p style="margin:0 0 4px;font-weight:700;color:#c2410c;font-size:14px">RapidGarage</p>
<h1 style="margin:0 0 16px;font-size:20px">${esc(items.length === 1 ? L('wmail.headOne') : L('wmail.headMany', { count: items.length }))}</h1>
<p style="margin:0 0 16px">${esc(hello)}</p>
${lines.map((l) => `<div style="border:1px solid #e7e4dd;border-radius:12px;padding:12px 14px;margin:0 0 10px">
<a href="${esc(l.url)}" style="color:#c2410c;font-weight:600;font-size:16px;text-decoration:none">${esc(l.title)}</a>
<div style="color:#5f5b53;font-size:13px;margin-top:4px">${esc(l.meta)}</div>
<div style="color:#8a857b;font-size:12px;margin-top:2px">${esc(l.wanted)}</div></div>`).join('\n')}
<p style="margin:16px 0 0;font-size:13px"><a href="${esc(manage)}" style="color:#c2410c">${esc(L('wmail.manage'))}</a></p>
<p style="margin:8px 0 0;font-size:12px;color:#8a857b">${wanteds.map((w) => `<a href="${esc(unsubscribeUrl(w))}" style="color:#8a857b">${esc(L('wmail.turnOff', { title: w.title }))}</a>`).join(' · ')}</p>
</div></body></html>`;
  const headers = { 'List-Unsubscribe': '<' + oneClickUrl(wanteds[0]) + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click', 'Content-Language': lang };
  return { subject, text, html, headers };
}

// ---- outbox worker (called from alerts.processQueue) ----------------------
async function skipPending(where, reason) {
  const [n] = await models().WantedMatch.update({ status: 'skipped', lastError: reason, claimToken: null }, { where: Object.assign({ status: 'pending' }, where) });
  return n;
}
const finish = (rows, values) => (rows.length ? models().WantedMatch.update(values, { where: { id: rows.map((r) => r.id) } }) : null);

async function processQueue(now) {
  const m = models();
  const A = alerts();
  now = now || new Date();
  const summary = { sent: 0, emails: 0, skipped: 0, failed: 0, deferred: 0, reason: null };
  await m.WantedMatch.update({ status: 'pending', claimToken: null }, { where: { status: 'sending', updatedAt: { [Op.lt]: new Date(now.getTime() - 10 * 60000) } } });
  summary.skipped += await skipPending({ createdAt: { [Op.lt]: new Date(now.getTime() - A.EXPIRE_DAYS * 86400000) } }, 'expired');
  if (!(await wantedEnabled())) {
    summary.skipped += await skipPending({}, 'wanted_disabled');
    summary.reason = 'wanted_disabled';
    return summary;
  }
  if (!mailer.isConfigured()) {
    const n = await skipPending({}, 'smtp_not_configured');
    if (n) console.log('Wanted posts: SMTP is not configured (SMTP_HOST); skipped ' + n + ' match email(s). Matches still show in the app.');
    summary.skipped += n;
    summary.reason = 'smtp_not_configured';
    return summary;
  }
  const due = { status: 'pending', [Op.or]: [{ nextAttemptAt: null }, { nextAttemptAt: { [Op.lte]: now } }] };
  const users = (await m.WantedMatch.findAll({ where: due, attributes: ['userId'], group: ['userId'], raw: true })).map((r) => r.userId);
  for (const userId of users) {
    if (!(await A.emailBudget(userId, now))) { summary.deferred++; continue; }
    const claim = require('crypto').randomBytes(12).toString('hex');
    const ids = (await m.WantedMatch.findAll({ where: Object.assign({ userId }, due), attributes: ['id'], order: [['createdAt', 'ASC']], limit: A.postsPerEmail(), raw: true })).map((r) => r.id);
    await m.WantedMatch.update({ status: 'sending', claimToken: claim }, { where: { id: ids, status: 'pending' } });
    const rows = await m.WantedMatch.findAll({ where: { claimToken: claim, status: 'sending' } });
    if (!rows.length) continue;
    const [user, wanteds, posts, itemRows, blocked] = await Promise.all([
      m.User.findByPk(userId),
      m.WantedPost.findAll({ where: { id: rows.map((r) => r.wantedId) } }),
      m.Post.findAll({ where: { id: rows.map((r) => r.postId) }, include: [{ model: m.User, attributes: ['id', 'firstName', 'lastName'] }, { model: m.SaleDay, as: 'saleDays' }] }),
      m.SaleItem.findAll({ where: { id: rows.map((r) => r.itemId).filter(Boolean) } }),
      blockedWith(userId),
    ]);
    const W = new Map(wanteds.map((w) => [w.id, w]));
    const P = new Map(posts.map((p) => [p.id, p]));
    const I = new Map(itemRows.map((i) => [i.id, i]));
    // Live curbside offers (not reported): what they offer is free, even after the sale.
    const offered = await curbside().reportedIds(posts.filter((p) => curbside().isLive(p, now)).map((p) => p.id));
    const freeNow = (post, r) => {
      if (!curbside().isLive(post, now) || offered.has(post.id)) return false;
      const it = r.itemId ? I.get(r.itemId) : null;
      return it ? curbside().itemFree(post, it) : !!post.curbsideAll;
    };
    const items = [];
    const drop = [];
    rows.forEach((r) => {
      const post = P.get(r.postId);
      const w = W.get(r.wantedId);
      let why = null;
      if (!post) why = 'post_deleted';
      else if (post.hidden) why = 'post_hidden';
      else if (schedule.isEnded(post, now) && !freeNow(post, r)) why = 'post_ended';
      else if (!w || !isOpen(w, now)) why = 'wanted_closed';
      else if (!w.emailEnabled) why = 'email_off';
      else if (blocked.has(post.userId)) why = 'blocked';
      if (why) drop.push({ r, why });
      else { const it = r.itemId ? I.get(r.itemId) : null; items.push({ row: r, post, wanted: w, item: it && !it.sold ? it : null, seller: post.User, distanceMiles: r.distanceMiles, curbsideUntil: freeNow(post, r) ? post.curbsideUntil : null }); }
    });
    for (const d of drop) await finish([d.r], { status: 'skipped', lastError: d.why, claimToken: null });
    summary.skipped += drop.length;
    if (!user || !items.length) { await finish(items.map((i) => i.row), { status: 'skipped', lastError: 'no_user', claimToken: null }); continue; }
    items.sort((a, b) => (a.distanceMiles || 0) - (b.distanceMiles || 0));
    const email = renderEmail(user, items);
    try {
      await mailer.send({ to: user.email, subject: email.subject, text: email.text, html: email.html, headers: email.headers });
      const digest = await m.AlertDigest.create({ userId, postCount: items.length, sentAt: new Date(), kind: 'wanted' });
      await finish(items.map((i) => i.row), { status: 'sent', sentAt: new Date(), digestId: digest.id, claimToken: null, lastError: null });
      summary.sent += items.length;
      summary.emails++;
    } catch (err) {
      const reason = String((err && (err.code || err.responseCode || err.name)) || 'send_failed').slice(0, 200);
      console.error('Wanted posts: sending to user ' + userId + ' failed (' + reason + ')');
      for (const i of items) {
        const attempts = i.row.attempts + 1;
        if (attempts >= A.MAX_ATTEMPTS) { await finish([i.row], { status: 'failed', attempts, lastError: reason, claimToken: null }); summary.failed++; } else {
          await finish([i.row], { status: 'pending', attempts, lastError: reason, claimToken: null, nextAttemptAt: new Date(now.getTime() + Math.pow(2, attempts) * 60000) });
          summary.deferred++;
        }
      }
    }
  }
  return summary;
}

module.exports = {
  TITLE_MIN, TITLE_MAX, KEYWORDS_MAX, DETAILS_MAX, AREA_MAX, MAX_WORDS, RADIUS_MIN, RADIUS_MAX, DAYS_DEFAULT, DAYS_MAX, PRICE_CAP_CENTS,
  CATEGORIES, CATEGORY_KEYS, maxActive, maxPerDay,
  normalize, wordsOf, matchWords, matchSale, salePriceFits, statusOf, isOpen, isOwner, canSee, activeWhere, publicPoint, toJSON,
  validate, parseDays, expiryFrom, blockedWith, enqueueForPost, schedulePost, backfill, matchesOf, newMatchCount,
  unsubscribeToken, verifyToken, unsubscribeUrl, renderEmail, processQueue,
};
