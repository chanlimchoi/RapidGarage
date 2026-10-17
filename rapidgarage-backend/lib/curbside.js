// Free on the curb: after (or near the end of) a sale the seller offers the
// leftovers, either everything or chosen items, free until a pickup time.
// Signed-in neighbors tap "Taken" (rate limited, the seller can undo) and the
// seller marks things gone. Nothing needs a sweeper: an offer is simply over
// once curbsideUntil passes.
//
// Visibility: an offer only shows while the post itself is visible AND has no
// open report. Hidden or reported posts never show as free, and an ended
// sale that is listed only because of its offer drops out of lists then.
const { Op } = require('sequelize');
const schedule = require('./schedule');
const { isAdmin } = require('./roles');
const { publicUser } = require('./people');

function models() { return require('../models'); }

function intEnv(name, dflt) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : dflt;
}

const MAX_HOURS = 72;
const MIN_MINUTES = 15;
const NOTE_MAX = 200;
const MAX_ITEMS = 200;
// How long before the sale's last day ends the seller may start an offer.
const START_BEFORE_END_HOURS = 12;
const takenPerHour = () => intEnv('CURBSIDE_TAKEN_PER_HOUR', 10);

const HOUR = 3600000;
const zoneOf = (post) => post.timeZone || schedule.defaultTimeZone();

// Last end of the sale (ms), or null for posts without dates.
function lastEnd(post) {
  const w = schedule.windowsOf(post);
  return w.length ? Math.max.apply(null, w.map((x) => x.endsAt)) : null;
}
// May the seller start an offer now? From 12 hours before the last end on.
function canStart(post, at) {
  const end = lastEnd(post);
  return end === null || (at || schedule.now()).getTime() >= end - START_BEFORE_END_HOURS * HOUR;
}
// Default pickup time: 11:59 pm today in the sale's time zone (tomorrow's
// if less than an hour of today is left), never past the 72-hour cap.
function defaultUntil(post, at) {
  const now = at || schedule.now();
  const tz = zoneOf(post);
  let end = schedule.zonedToUtc(schedule.localDate(now, tz), '23:59', tz);
  if (end.getTime() - now.getTime() < HOUR) end = schedule.zonedToUtc(schedule.addDays(schedule.localDate(now, tz), 1), '23:59', tz);
  return new Date(Math.min(end.getTime(), now.getTime() + MAX_HOURS * HOUR));
}

// body -> { errors, values: { all, itemIds, until, note } }. Items are checked by the caller.
function validate(body, post, at) {
  const now = at || schedule.now();
  const b = body || {};
  const errors = {};
  const values = {};
  if (b.all !== undefined && typeof b.all !== 'boolean') errors.all = 'all must be true or false.';
  values.all = b.all === true;
  if (!values.all) {
    const ids = b.itemIds;
    if (!Array.isArray(ids) || !ids.length) errors.itemIds = 'Choose the items that are free, or offer everything that is left.';
    else if (ids.length > MAX_ITEMS || !ids.every((x) => Number.isInteger(x) && x > 0)) errors.itemIds = 'itemIds must be a list of item ids.';
    else values.itemIds = Array.from(new Set(ids));
  }
  if (b.until === undefined || b.until === null || b.until === '') values.until = defaultUntil(post, now);
  else {
    const u = new Date(b.until);
    if (typeof b.until !== 'string' || isNaN(u.getTime())) errors.until = 'Pickup time must be a date and time.';
    else if (u.getTime() < now.getTime() + MIN_MINUTES * 60000) errors.until = 'Pickup time must be at least ' + MIN_MINUTES + ' minutes from now.';
    else if (u.getTime() > now.getTime() + MAX_HOURS * HOUR + 60000) errors.until = 'Pickup time can be at most ' + MAX_HOURS + ' hours from now.';
    else values.until = u;
  }
  if (b.note === undefined || b.note === null) values.note = null;
  else if (typeof b.note !== 'string') errors.note = 'Note must be text.';
  else if (b.note.trim().length > NOTE_MAX) errors.note = 'Keep the note under ' + NOTE_MAX + ' characters.';
  else values.note = b.note.trim().replace(/\s+/g, ' ') || null;
  return { errors, values };
}

// ---- state ----------------------------------------------------------------
// off | active | expired | gone (taken) ; hidden posts are "paused" for their owner.
function rawState(post, at) {
  if (!post.curbsideUntil) return 'off';
  if (post.curbsideGoneAt) return 'gone';
  if (new Date(post.curbsideUntil) <= (at || schedule.now())) return 'expired';
  return 'active';
}
// Offer is live in the database (lists, search); open reports are checked separately.
const activeWhere = (at) => ({ curbsideUntil: { [Op.gt]: at || schedule.now() }, curbsideGoneAt: null });
const isLive = (post, at) => !post.hidden && rawState(post, at) === 'active';

// Post ids (of `ids`) with an open report.
async function reportedIds(ids) {
  if (!ids.length) return new Set();
  const rows = await models().Report.findAll({ where: { postId: ids, status: 'open' }, attributes: ['postId'], raw: true });
  return new Set(rows.map((r) => r.postId));
}
async function isReported(postId) { return (await reportedIds([postId])).has(postId); }

// Rows (posts, or plain rows with id, dates, hidden and the curbside fields)
// drop out when they are listed only because of a live curbside offer that
// can't show (the post has an open report). By default "only because of the
// offer" means the sale itself ended; search passes its own test (filters).
const endedTest = (now) => (r) => schedule.isEnded({ startDate: r.startDate, endDate: r.endDate, saleDays: r.saleDays }, now);
async function dropReportedLeftovers(rows, needsOffer, at) {
  const now = at || schedule.now();
  const test = needsOffer || endedTest(now);
  const onlyCurb = rows.filter((r) => rawState(r, now) === 'active' && test(r));
  if (!onlyCurb.length) return rows;
  const rep = await reportedIds(onlyCurb.map((r) => r.id));
  const drop = new Set(onlyCurb.filter((r) => rep.has(r.id)).map((r) => r.id));
  return rows.filter((r) => !drop.has(r.id));
}

// Add `curbside` to post JSON objects (list of plain objects with ids).
// Others see { state: 'active', ... } or null; the owner and admins also see
// expired / gone / paused offers, and the owner gets `canStart`.
async function annotate(list, viewer, opts) {
  const posts = (list || []).filter(Boolean);
  if (!posts.length) return list;
  const m = models();
  const now = schedule.now();
  const rows = await m.Post.findAll({
    where: { id: posts.map((p) => p.id) },
    attributes: ['id', 'userId', 'hidden', 'startDate', 'endDate', 'timeZone', 'curbsideUntil', 'curbsideNote', 'curbsideAll', 'curbsideStartedAt', 'curbsideGoneAt', 'curbsideGoneSource'],
    include: [{ model: m.SaleDay, as: 'saleDays', attributes: ['startsAt', 'endsAt'] }],
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const withOffer = rows.filter((r) => r.curbsideUntil);
  const rep = await reportedIds(withOffer.map((r) => r.id));
  const left = new Map();
  const partial = withOffer.filter((r) => !r.curbsideAll).map((r) => r.id);
  if (partial.length) {
    const items = await m.SaleItem.findAll({ where: { postId: partial, curbside: true, sold: false, curbsideGoneAt: null }, attributes: ['postId'], raw: true });
    items.forEach((i) => left.set(i.postId, (left.get(i.postId) || 0) + 1));
  }
  const marks = opts && opts.marks ? await marksFor(posts.map((p) => p.id), viewer) : null;
  posts.forEach((p) => {
    const r = byId.get(p.id);
    if (!r) { p.curbside = null; return; }
    const mine = !!viewer && viewer.id === r.userId;
    const staff = mine || isAdmin(viewer);
    let state = rawState(r, now);
    const paused = state === 'active' && (r.hidden || rep.has(r.id));
    if (paused) state = 'paused';
    if (state !== 'active' && !staff) { p.curbside = null; return; }
    if (state === 'off') { p.curbside = mine ? { state, canStart: canStart(r, now), defaultUntil: defaultUntil(r, now), maxUntil: new Date(now.getTime() + MAX_HOURS * HOUR) } : null; return; }
    const out = {
      state, all: !!r.curbsideAll, until: r.curbsideUntil, note: r.curbsideNote || null, startedAt: r.curbsideStartedAt,
      itemsLeft: r.curbsideAll ? null : (left.get(r.id) || 0),
    };
    if (staff) Object.assign(out, { goneAt: r.curbsideGoneAt, goneSource: r.curbsideGoneSource, pausedReason: paused ? (r.hidden ? 'hidden' : 'report') : null });
    if (mine) Object.assign(out, { canStart: canStart(r, now), defaultUntil: defaultUntil(r, now), maxUntil: new Date(now.getTime() + MAX_HOURS * HOUR) });
    if (marks && mine) out.marks = marks.get(r.id) || [];
    p.curbside = out;
  });
  return list;
}

// Recent "taken" marks on the seller's posts: [{ id, itemId, by, at, undone }].
async function marksFor(postIds, viewer) {
  const out = new Map();
  if (!viewer || !postIds.length) return out;
  const m = models();
  const rows = await m.CurbsideMark.findAll({
    where: { postId: postIds }, include: [{ model: m.User, as: 'user', attributes: ['id', 'firstName', 'lastName'] }, { model: m.Post, attributes: ['userId', 'curbsideStartedAt'] }],
    order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: 100,
  });
  rows.forEach((r) => {
    if (!r.Post || r.Post.userId !== viewer.id) return;
    if (r.Post.curbsideStartedAt && r.createdAt < r.Post.curbsideStartedAt) return;
    if (!out.has(r.postId)) out.set(r.postId, []);
    out.get(r.postId).push({ id: r.id, itemId: r.itemId, by: publicUser(r.user), at: r.createdAt, undone: !!r.undoneAt });
  });
  return out;
}

// After items change: a partial offer is gone once none of its items are left.
async function refreshGone(postId, transaction) {
  const m = models();
  const post = await m.Post.findByPk(postId, { transaction });
  if (!post || !post.curbsideUntil || post.curbsideAll) return post;
  const left = await m.SaleItem.count({ where: { postId, curbside: true, sold: false, curbsideGoneAt: null }, transaction });
  if (!left && !post.curbsideGoneAt) await post.update({ curbsideGoneAt: schedule.now(), curbsideGoneSource: 'items' }, { transaction });
  else if (left && post.curbsideGoneAt && post.curbsideGoneSource === 'items') await post.update({ curbsideGoneAt: null, curbsideGoneSource: null }, { transaction });
  return post;
}

// Sales open now / today: a live offer counts as "open" until its pickup time.
const LIVE_WHEN = ['now', 'today'];
const countsForWhen = (post, when, at) => LIVE_WHEN.indexOf(when) >= 0 && rawState(post, at) === 'active';

// Where-clause for lists: sales that haven't ended, or whose leftovers are
// free on the curb right now.
const listableWhere = (at) => ({ [Op.or]: [schedule.notEndedWhere(at), activeWhere(at)] });

// Is item `item` free right now as part of `post`'s live offer?
const itemFree = (post, item) => !item.sold && (post.curbsideAll || (item.curbside && !item.curbsideGoneAt));

module.exports = {
  MAX_HOURS, MIN_MINUTES, NOTE_MAX, START_BEFORE_END_HOURS, takenPerHour,
  lastEnd, canStart, defaultUntil, validate, rawState, activeWhere, isLive, reportedIds, isReported,
  dropReportedLeftovers, annotate, countsForWhen, listableWhere, marksFor, refreshGone, itemFree,
};
