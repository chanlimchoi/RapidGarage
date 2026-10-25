'use strict';
// Site activity counters: what was clicked or viewed, never who.
//
// Stored (ActivityDays): kind, target (type + id, or a page name / city),
// local day and a count. No user id, IP or user agent. Repeats are filtered
// exactly like sale views and QR scans (lib/scans.js): one count per visitor
// per day per thing, using the same keyed hash with a random daily salt that
// lives only in memory, so nothing can be traced back to a person.
// Not counted: bots, link previews and prefetches; admins; and people acting
// on their own sale/event/wanted post/profile (except kinds marked countOwner,
// such as a seller printing their own flyer or sharing their own event).
//
// Some kinds are counted by the API itself when the action succeeds (server:
// true); the rest come from the app as fire-and-forget beacons (POST /activity).
const { Op, fn, col, literal } = require('sequelize');
const schedule = require('./schedule');
const scans = require('./scans');
const { isAdmin } = require('./roles');

function models() { return require('../models'); }

const PAGES = ['home', 'search', 'map', 'favorites', 'route', 'notifications', 'inbox', 'events', 'wanted', 'about', 'safety'];

// targets: allowed target types ([] = none). label: admin list order.
const KINDS = {
  // Counted by the API on success.
  message_start: { targets: ['post'], server: true, action: true },
  offer: { targets: ['post'], server: true, action: true },
  hold: { targets: ['post'], server: true, action: true },
  bundle: { targets: ['post'], server: true, action: true },
  save_search: { targets: [], server: true, action: true },
  route_plan: { targets: [], server: true, action: true },
  search_empty: { targets: ['city'], server: true },
  // Beacons from the app.
  directions: { targets: ['post', 'event'], action: true },
  route_add: { targets: ['post'], action: true },
  calendar: { targets: ['post', 'event'], action: true },
  print: { targets: ['post', 'event'], action: true, countOwner: true },
  bell: { targets: [], action: true },
  view: { targets: ['event', 'wanted', 'user'] },
  share: { targets: ['event', 'wanted'], countOwner: true },
  page: { targets: ['page'] },
};
const ACTIONS = Object.keys(KINDS).filter((k) => KINDS[k].action);
const CLIENT_KINDS = Object.keys(KINDS).filter((k) => !KINDS[k].server);

let clock = () => new Date();
function setClock(f) { clock = f || (() => new Date()); }

// The thing acted on: { owner, timeZone, ok } (ok false: hidden or gone).
async function loadTarget(type, id) {
  const m = models();
  if (type === 'post') {
    const p = await m.Post.findByPk(id, { attributes: ['id', 'userId', 'timeZone', 'hidden'] });
    return p ? { ok: !p.hidden, owner: p.userId, timeZone: p.timeZone } : null;
  }
  if (type === 'event') {
    const e = await m.SaleEvent.findByPk(id, { attributes: ['id', 'organizerId', 'timeZone', 'hidden'] });
    return e ? { ok: !e.hidden, owner: e.organizerId, timeZone: e.timeZone } : null;
  }
  if (type === 'wanted') {
    const w = await m.WantedPost.findByPk(id, { attributes: ['id', 'userId', 'hidden'] });
    return w ? { ok: !w.hidden, owner: w.userId } : null;
  }
  if (type === 'user') {
    const u = await m.User.findByPk(id, { attributes: ['id'] });
    return u ? { ok: true, owner: u.id } : null;
  }
  return null;
}

// Why this request isn't counted, or null.
function skipReason(req, kind, owner) {
  const ua = req.get('user-agent') || '';
  if (scans.isBot(ua)) return 'bot';
  if (scans.isPrefetch(req)) return 'prefetch';
  if (req.user && !KINDS[kind].countOwner) {
    if (isAdmin(req.user)) return 'admin';
    if (owner && req.user.id === owner) return 'owner';
  }
  return null;
}

const clean = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 64);

// Count one event. what: { targetType?, targetId?, key?, owner?, timeZone? }
// (server callers pass the owner/time zone they already know). Never throws.
// -> { counted, reason }
async function record(req, kind, what) {
  try {
    const K = KINDS[kind];
    if (!K) return { counted: false, reason: 'kind' };
    const w = what || {};
    const targetType = w.targetType || '';
    const targetId = Number(w.targetId) || 0;
    const key = clean(w.key);
    const reason = skipReason(req, kind, w.owner);
    if (reason) return { counted: false, reason };
    const M = models();
    const { day, hash } = scans.visitorHash('a:' + kind + ':' + targetType + ':' + targetId + ':' + key, scans.clientIp(req), req.get('user-agent') || '');
    await scans.settle();
    try {
      await M.ScanDedupe.create({ day, hash });
    } catch (err) {
      if (err && err.name === 'SequelizeUniqueConstraintError') return { counted: false, reason: 'repeat' };
      throw err;
    }
    const tz = w.timeZone && schedule.isValidTimeZone(w.timeZone) ? w.timeZone : schedule.defaultTimeZone();
    const where = { kind, targetType, targetId, key, day: schedule.localDate(clock(), tz) };
    let row = await M.ActivityDay.findOne({ where });
    if (!row) {
      try {
        await M.ActivityDay.create(Object.assign({ count: 1 }, where));
        return { counted: true, reason: null };
      } catch (err) {
        if (!err || err.name !== 'SequelizeUniqueConstraintError') throw err;
        row = await M.ActivityDay.findOne({ where });
      }
    }
    await row.increment('count');
    return { counted: true, reason: null };
  } catch (err) {
    console.error('[activity] count failed: ' + ((err && err.name) || 'Error') + ': ' + String((err && err.message) || err).slice(0, 200));
    return { counted: false, reason: 'error' };
  }
}

// Server-side shortcut for an action on a post the caller already loaded.
const onPost = (req, kind, post) => record(req, kind, { targetType: 'post', targetId: post.id, owner: post.userId, timeZone: post.timeZone });

// Empty search results, by city only (never the search text): the city of the
// nearest known sale to the search center, within 30 miles; '' when none.
async function nearestCity(center) {
  if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return '';
  const d = 0.45; // ~30 miles of latitude
  const rows = await models().Post.findAll({
    attributes: ['city', 'lat', 'lng'],
    where: { lat: { [Op.between]: [center.lat - d, center.lat + d] }, lng: { [Op.between]: [center.lng - d * 1.4, center.lng + d * 1.4] }, city: { [Op.ne]: null } },
    limit: 200, raw: true,
  });
  let best = null;
  let bestD = Infinity;
  rows.forEach((r) => {
    if (!r.city) return;
    const dd = (r.lat - center.lat) ** 2 + ((r.lng - center.lng) * Math.cos(center.lat * Math.PI / 180)) ** 2;
    if (dd < bestD) { bestD = dd; best = r.city; }
  });
  return best ? clean(best) : '';
}
async function searchEmpty(req, center) {
  try { return await record(req, 'search_empty', { targetType: 'city', key: await nearestCity(center) }); } catch (err) { return { counted: false, reason: 'error' }; }
}

// Validate a beacon body. -> { error } | { kind, what } (what without owner).
function parseBeacon(body) {
  const b = body || {};
  const kind = b.kind;
  if (typeof kind !== 'string' || CLIENT_KINDS.indexOf(kind) === -1) return { error: 'Unknown activity.' };
  const K = KINDS[kind];
  if (kind === 'page') {
    if (PAGES.indexOf(b.page) === -1) return { error: 'Unknown page.' };
    return { kind, what: { targetType: 'page', key: b.page } };
  }
  if (!K.targets.length) return { kind, what: {} };
  const id = Number(b.targetId);
  if (K.targets.indexOf(b.targetType) === -1 || !Number.isInteger(id) || id < 1) return { error: 'Unknown target.' };
  return { kind, what: { targetType: b.targetType, targetId: id } };
}

// Forget counts about deleted things (posts, events, wanted posts, accounts).
async function forget(targetType, ids, transaction) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!list.length) return 0;
  return models().ActivityDay.destroy({ where: { targetType, targetId: list }, transaction });
}

// ---- reporting --------------------------------------------------------------
// Totals per kind/targetType/key between two local days [from, to).
async function totals(where, from, to, group) {
  const rows = await models().ActivityDay.findAll({
    attributes: group.concat([[fn('sum', col('count')), 'n']]),
    where: Object.assign({ day: { [Op.gte]: from, [Op.lt]: to } }, where),
    group, raw: true,
  });
  return rows.map((r) => Object.assign({}, r, { n: Number(r.n) }));
}

// Per target id: { [id]: { kind: total } } for the given kinds (seller dashboard).
async function byTarget(targetType, ids, kinds) {
  if (!ids.length) return {};
  const rows = await models().ActivityDay.findAll({
    attributes: ['targetId', 'kind', [fn('sum', col('count')), 'n']],
    where: { targetType, targetId: ids, kind: kinds },
    group: ['targetId', 'kind'], raw: true,
  });
  const out = {};
  rows.forEach((r) => { (out[r.targetId] = out[r.targetId] || {})[r.kind] = Number(r.n); });
  return out;
}

module.exports = { loadTarget, KINDS, PAGES, ACTIONS, CLIENT_KINDS, setClock, record, onPost, searchEmpty, nearestCity, parseBeacon, forget, totals, byTarget, skipReason, literal };
