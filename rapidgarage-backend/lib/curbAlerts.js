'use strict';
// Free stuff at the curb: a quick post (a photo, where, a few words) that is
// free for a set number of hours (default 4) and then disappears, plus
// opt-in alerts for people nearby within a radius they choose.
//
// A quick post is an ordinary Post with quickCurb = true, isFree, startDate =
// now and endDate = the expiry, and a whole-post curbside offer (lib/curbside.js)
// until the same time. So lists, search, the map, "Taken" marks, reports and
// moderation all work as for curbside leftovers, and it ends by itself: no
// sweeper. The poster can end it early.
//
// Posting is rate limited (CURB_POSTS_PER_HOUR, CURB_POSTS_PER_DAY). Alerts are
// in-app (bell) plus push, never email; each person gets at most
// CURB_ALERTS_PER_DAY, never about their own posts or across a block, and the
// alert says roughly how far, never where the person is.
const { Op } = require('sequelize');
const geo = require('./geo');
const schedule = require('./schedule');

function models() { return require('../models'); }

function intEnv(name, dflt, max) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && (!max || n <= max) ? n : dflt;
}

const MAX_HOURS = 12;
const RADII = [0.5, 1, 2, 3, 5, 10];
const TITLE_MAX = 80;
const NOTE_MAX = 200;
const STREET_MAX = 120;
const defaultHours = () => intEnv('CURB_POST_HOURS', 4, MAX_HOURS);
const postsPerHour = () => intEnv('CURB_POSTS_PER_HOUR', 2);
const postsPerDay = () => intEnv('CURB_POSTS_PER_DAY', 5);
const alertsPerDay = () => intEnv('CURB_ALERTS_PER_DAY', 10);
const HOUR = 3600000;

const str = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : NaN);

// body -> { errors, values: { title, note, hours, lat?, lng?, street, city, state, zipCode } }
function validatePost(body) {
  const b = body || {};
  const errors = {};
  const values = {};
  const title = str(b.title);
  if (title.length > TITLE_MAX) errors.title = 'Keep the title to ' + TITLE_MAX + ' characters.';
  values.title = title || null;
  if (b.note !== undefined && b.note !== null && typeof b.note !== 'string') errors.note = 'Note must be text.';
  const note = str(b.note);
  if (note.length > NOTE_MAX) errors.note = 'Keep the note to ' + NOTE_MAX + ' characters.';
  values.note = note || null;
  if (b.hours === undefined || b.hours === null || b.hours === '') values.hours = defaultHours();
  else {
    const h = num(b.hours);
    if (!Number.isInteger(h) || h < 1 || h > MAX_HOURS) errors.hours = 'Choose 1 to ' + MAX_HOURS + ' hours.';
    else values.hours = h;
  }
  const hasPoint = b.lat !== undefined && b.lat !== null && b.lat !== '';
  if (hasPoint) {
    const lat = num(b.lat);
    const lng = num(b.lng);
    if (!geo.isLat(lat) || !geo.isLng(lng)) errors.location = 'That location is not valid.';
    else { values.lat = lat; values.lng = lng; }
  }
  ['street', 'city', 'state'].forEach((k) => {
    const v = str(b[k]);
    if (v.length > STREET_MAX) errors[k] = 'Too long.';
    values[k] = v || null;
  });
  const zip = str(b.zipCode);
  if (zip && !/^\d{5}$/.test(zip)) errors.zipCode = 'A 5-digit zip code.';
  values.zipCode = zip || null;
  if (!hasPoint && !values.street && !values.zipCode) errors.location = 'Use your location, or give a street and zip code.';
  return { errors, values };
}

// Posting budget: { ok } or { ok: false, retryAfter } (seconds).
async function canPost(userId, at) {
  const now = (at || schedule.now()).getTime();
  const rows = await models().Post.findAll({ where: { userId, quickCurb: true, createdAt: { [Op.gt]: new Date(now - 24 * HOUR) } }, attributes: ['createdAt'], order: [['createdAt', 'ASC']], raw: true });
  const times = rows.map((r) => new Date(r.createdAt).getTime());
  const lastHour = times.filter((t) => t > now - HOUR);
  if (times.length >= postsPerDay()) return { ok: false, retryAfter: Math.max(60, Math.ceil((times[times.length - postsPerDay()] + 24 * HOUR - now) / 1000)) };
  if (lastHour.length >= postsPerHour()) return { ok: false, retryAfter: Math.max(60, Math.ceil((lastHour[lastHour.length - postsPerHour()] + HOUR - now) / 1000)) };
  return { ok: true };
}

// Alert body -> { errors, values: { lat, lng, radiusMiles, enabled } }.
function validateAlert(body) {
  const b = body || {};
  const errors = {};
  const values = {};
  const lat = num(b.lat);
  const lng = num(b.lng);
  if (!geo.isLat(lat) || !geo.isLng(lng)) errors.location = 'Give a valid location.';
  else { values.lat = Math.round(lat * 1e4) / 1e4; values.lng = Math.round(lng * 1e4) / 1e4; }
  const r = num(b.radiusMiles);
  if (RADII.indexOf(r) === -1) errors.radiusMiles = 'Choose one of ' + RADII.join(', ') + ' miles.';
  else values.radiusMiles = r;
  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') errors.enabled = 'enabled must be true or false.';
    else values.enabled = b.enabled;
  }
  return { errors, values };
}

// Who hears about `post`: enabled alerts whose circle holds the post, minus
// the poster, blocks either way, and people at today's cap. -> [{ userId, miles }]
async function recipients(post, at) {
  const m = models();
  if (post.lat === null || post.lat === undefined || post.hidden) return [];
  const now = at || schedule.now();
  const box = geo.boundingBox({ lat: post.lat, lng: post.lng }, Math.max.apply(null, RADII));
  const rows = await m.CurbAlert.findAll({ where: { enabled: true, userId: { [Op.ne]: post.userId }, lat: { [Op.between]: [box.minLat, box.maxLat] },
    [Op.or]: box.lngRanges.map(([a, b]) => ({ lng: { [Op.between]: [a, b] } })) }, raw: true });
  let near = rows.map((a) => ({ userId: a.userId, miles: geo.haversineMiles({ lat: a.lat, lng: a.lng }, { lat: post.lat, lng: post.lng }), radius: a.radiusMiles }))
    .filter((x) => x.miles <= x.radius);
  if (!near.length) return [];
  const ids = near.map((x) => x.userId);
  const blocks = await m.UserBlock.findAll({ where: { [Op.or]: [{ blockerId: post.userId, blockedId: ids }, { blockedId: post.userId, blockerId: ids }] }, raw: true });
  const blocked = new Set(blocks.map((b) => (b.blockerId === post.userId ? b.blockedId : b.blockerId)));
  near = near.filter((x) => !blocked.has(x.userId));
  const today = await m.Notification.findAll({ where: { kind: 'curb_free', userId: near.map((x) => x.userId), createdAt: { [Op.gt]: new Date(now.getTime() - 24 * HOUR) } }, attributes: ['userId'], raw: true });
  const used = new Map();
  today.forEach((r) => used.set(r.userId, (used.get(r.userId) || 0) + 1));
  return near.filter((x) => (used.get(x.userId) || 0) < alertsPerDay()).map((x) => ({ userId: x.userId, miles: Math.round(x.miles * 10) / 10 }));
}

// Bell + push for everyone in range (once per post). Returns how many were told.
async function notifyNearby(post, at) {
  const list = await recipients(post, at);
  if (!list.length) return 0;
  const m = models();
  const key = 'curb:' + post.id;
  const before = new Set((await m.Notification.findAll({ where: { dedupeKey: key, userId: list.map((x) => x.userId) }, attributes: ['userId'], raw: true })).map((r) => r.userId));
  const n = await require('./notifications').add(list.map((x) => ({ userId: x.userId, kind: 'curb_free', postId: post.id, dedupeKey: key,
    data: { miles: x.miles, until: post.curbsideUntil ? new Date(post.curbsideUntil).toISOString() : null } })));
  const push = require('./push');
  list.filter((x) => !before.has(x.userId)).forEach((x) => push.curbFree(x.userId, { title: post.title, postId: post.id, miles: x.miles }));
  return n;
}

module.exports = { MAX_HOURS, RADII, TITLE_MAX, NOTE_MAX, defaultHours, postsPerHour, postsPerDay, alertsPerDay, validatePost, canPost, validateAlert, recipients, notifyNearby };
