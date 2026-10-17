'use strict';
// Neighborhood sales ("events"): an organizer names an area (center + radius)
// and the days; sellers join with their own sale. joinMode "open" approves at
// once, "approval" waits for the organizer. A sale is in at most one event.
//
// Visibility follows posts: hidden events are seen only by the organizer and
// admins, ended events drop out of search, hidden/ended sales drop out of an
// event's list. Blocks: a seller and an organizer who blocked each other (either
// way) can't join/approve each other. Decline and remove delete the row, so a
// seller may ask again (approval events gate that anyway).
const { Op } = require('sequelize');
const crypto = require('crypto');
const geo = require('./geo');
const schedule = require('./schedule');
const links = require('./shortlinks');
const { isAdmin } = require('./roles');
const { publicUser } = require('./people');

function models() { return require('../models'); }

function intEnv(name, dflt) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : dflt;
}

const RADII = [0.25, 0.5, 1, 2, 3, 5]; // miles
const NAME_MAX = 80;
const DESC_MAX = 1000;
const AREA_MAX = 120;
const MAX_DAYS = 7;
const maxActive = () => intEnv('EVENT_MAX_ACTIVE', 3); // upcoming/open events per organizer
const maxPerDay = () => intEnv('EVENT_MAX_PER_DAY', 5); // events created per organizer per 24 h
const maxSales = () => intEnv('EVENT_MAX_SALES', 200); // pending + approved per event

const isOrganizer = (user, ev) => !!user && user.id === ev.organizerId;
const canSee = (user, ev) => !ev.hidden || isAdmin(user) || isOrganizer(user, ev);
const isEnded = (ev, at) => schedule.isEnded(ev, at);
const statusOf = (ev, at) => schedule.statusOf(ev, at);

function visibleWhere(user) {
  if (isAdmin(user)) return null;
  if (user && user.id) return { [Op.or]: [{ hidden: false }, { organizerId: user.id }] };
  return { hidden: false };
}
const notEndedWhere = (at) => ({ endDate: { [Op.gt]: at || schedule.now() } });

const str = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : v);

// body -> { errors, values }. creating: all of name, area, radius, schedule required.
// Area (lat/lng/areaLabel/radiusMiles) is fixed after creation; see the PR notes.
function validate(body, creating) {
  const b = body || {};
  const errors = {};
  const values = {};
  if (creating || b.name !== undefined) {
    const name = str(b.name);
    if (typeof name !== 'string' || !name) errors.name = 'Give the neighborhood sale a name.';
    else if (name.length > NAME_MAX) errors.name = 'Keep the name under ' + NAME_MAX + ' characters.';
    else values.name = name;
  }
  if (b.description !== undefined && b.description !== null) {
    if (typeof b.description !== 'string') errors.description = 'Description must be text.';
    else if (b.description.trim().length > DESC_MAX) errors.description = 'Keep the description under ' + DESC_MAX + ' characters.';
    else values.description = b.description.trim() || null;
  } else if (b.description === null) values.description = null;
  if (creating || b.joinMode !== undefined) {
    const mode = b.joinMode === undefined ? 'approval' : b.joinMode;
    if (models().SaleEvent.JOIN_MODES.indexOf(mode) === -1) errors.joinMode = 'joinMode must be one of: open, approval.';
    else values.joinMode = mode;
  }
  if (creating) {
    const area = str(b.areaLabel);
    if (typeof area !== 'string' || !area) errors.areaLabel = 'Name the area, like a neighborhood or a few streets.';
    else if (area.length > AREA_MAX) errors.areaLabel = 'Keep the area under ' + AREA_MAX + ' characters.';
    else values.areaLabel = area;
    const radius = typeof b.radiusMiles === 'string' ? Number(b.radiusMiles) : b.radiusMiles;
    if (RADII.indexOf(radius) === -1) errors.radiusMiles = 'radiusMiles must be one of ' + RADII.join(', ') + ' (miles).';
    else values.radiusMiles = radius;
    const hasLat = b.lat !== undefined && b.lat !== null && b.lat !== '';
    const hasLng = b.lng !== undefined && b.lng !== null && b.lng !== '';
    if (hasLat || hasLng) {
      const lat = Number(b.lat);
      const lng = Number(b.lng);
      if (!geo.isLat(lat) || !geo.isLng(lng)) errors.location = 'Location must be a valid latitude and longitude.';
      else { values.lat = lat; values.lng = lng; }
    }
  } else {
    ['areaLabel', 'radiusMiles', 'lat', 'lng'].forEach((k) => { if (b[k] !== undefined) errors[k] = "The area can't be changed after the neighborhood sale is created."; });
  }
  if (creating || b.schedule !== undefined) {
    if (!b.schedule || typeof b.schedule !== 'object') errors.schedule = 'Pick the days of the neighborhood sale.';
    else {
      const sched = schedule.validateSchedule(b.schedule, true);
      Object.assign(errors, sched.errors);
      if (!Object.keys(sched.errors).length) {
        if (!sched.value.days.length) errors.schedule = 'Pick the days of the neighborhood sale.';
        else if (sched.value.days.length > MAX_DAYS) errors.schedule = 'A neighborhood sale can run at most ' + MAX_DAYS + ' days.';
        else {
          values.timeZone = sched.value.timeZone;
          values.days = sched.value.days.map((d) => ({ date: d.date, startTime: d.startTime, endTime: d.endTime, startsAt: d.startsAt.toISOString(), endsAt: d.endsAt.toISOString() }));
          values.startDate = sched.value.startDate;
          values.endDate = sched.value.endDate;
        }
      }
    }
  }
  return { errors, values };
}

// A short code not used by any post or event.
async function newCode() {
  const m = models();
  for (let i = 0; i < 8; i++) {
    const c = links.newCode();
    const [p, e] = await Promise.all([m.Post.count({ where: { shortCode: c } }), m.SaleEvent.count({ where: { shortCode: c } })]);
    if (!p && !e) return c;
  }
  return crypto.randomBytes(6).toString('hex').slice(0, links.LENGTH);
}

// Local dates of a post's sale days.
const postDates = (post) => new Set((post.saleDays || []).map((d) => d.date));
const eventDates = (ev) => new Set((ev.days || []).map((d) => d.date));

// Why `post` can't join `ev` (null if it can). -> { code, message } | null
function ineligible(post, ev) {
  if (post.hidden) return { code: 'post_hidden', message: 'A moderator has hidden this sale, so it can\'t join a neighborhood sale.' };
  if (schedule.isEnded(post)) return { code: 'post_ended', message: 'This sale has ended.' };
  if (typeof post.lat !== 'number' || typeof post.lng !== 'number') return { code: 'no_location', message: 'Your sale needs an address on the map to join a neighborhood sale.' };
  if (geo.haversineMiles({ lat: ev.lat, lng: ev.lng }, { lat: post.lat, lng: post.lng }) > ev.radiusMiles) {
    return { code: 'outside_area', message: 'Your sale is outside this neighborhood sale\'s area.' };
  }
  const days = eventDates(ev);
  const overlap = Array.from(postDates(post)).some((d) => days.has(d));
  if (!overlap) return { code: 'dates', message: 'Your sale needs at least one day on the neighborhood sale\'s dates.' };
  return null;
}

async function blockedBetween(a, b) {
  if (a === b) return false;
  return (await models().UserBlock.count({ where: { [Op.or]: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } })) > 0;
}

// Approved, visible-to-viewer, not-ended sales of an event (with photos and days).
async function salesOf(ev, viewer, opts) {
  const m = models();
  const o = opts || {};
  const parts = await m.EventParticipant.findAll({ where: { eventId: ev.id, status: o.status || 'approved' }, attributes: ['postId', 'status', 'createdAt'], raw: true });
  if (!parts.length) return [];
  const { visibleWhere: postVisible } = require('./moderation');
  const where = { [Op.and]: [{ id: parts.map((p) => p.postId) }, postVisible(viewer), o.includeEnded ? null : schedule.notEndedWhere()].filter(Boolean) };
  const posts = await m.Post.findAll({ where, include: [{ model: m.PostPhoto, as: 'photos' }, { model: m.SaleDay, as: 'saleDays' }, { model: m.User, attributes: ['id', 'firstName', 'lastName'] }],
    order: [['id', 'ASC'], [{ model: m.PostPhoto, as: 'photos' }, 'position', 'ASC']] });
  const center = { lat: ev.lat, lng: ev.lng };
  return posts.filter((p) => !schedule.isEnded(p) || o.includeEnded).map((p) => {
    const j = p.toJSON();
    delete j.User;
    j.seller = p.User ? publicUser(p.User) : null;
    j.distanceMiles = typeof p.lat === 'number' ? Math.round(geo.haversineMiles(center, p) * 10) / 10 : null;
    return j;
  });
}

// Count of approved sales that are visible to everyone and not ended.
async function publicSaleCounts(eventIds) {
  const m = models();
  const out = new Map(eventIds.map((id) => [id, 0]));
  if (!eventIds.length) return out;
  const parts = await m.EventParticipant.findAll({ where: { eventId: eventIds, status: 'approved' }, attributes: ['eventId', 'postId'], raw: true });
  if (!parts.length) return out;
  const live = await m.Post.findAll({ where: { [Op.and]: [{ id: parts.map((p) => p.postId) }, { hidden: false }, schedule.notEndedWhere()] }, attributes: ['id'], raw: true });
  const ok = new Set(live.map((p) => p.id));
  parts.forEach((p) => { if (ok.has(p.postId)) out.set(p.eventId, out.get(p.eventId) + 1); });
  return out;
}

// postId -> { id, name } for posts approved into a visible, not-ended event.
async function eventsForPosts(postIds, viewer) {
  const m = models();
  const out = new Map();
  if (!postIds.length) return out;
  const parts = await m.EventParticipant.findAll({ where: { postId: postIds, status: 'approved' }, attributes: ['eventId', 'postId'], raw: true });
  if (!parts.length) return out;
  const evs = await m.SaleEvent.findAll({ where: { [Op.and]: [{ id: Array.from(new Set(parts.map((p) => p.eventId))) }, visibleWhere(viewer), notEndedWhere()].filter(Boolean) }, attributes: ['id', 'name', 'lat', 'lng', 'radiusMiles'] });
  const byId = new Map(evs.map((e) => [e.id, e]));
  parts.forEach((p) => { const e = byId.get(p.eventId); if (e) out.set(p.postId, { id: e.id, name: e.name }); });
  return out;
}

const scheduleJSON = (ev) => ({
  timeZone: ev.timeZone,
  days: (ev.days || []).map((d) => ({ date: d.date, start: d.startTime, end: d.endTime, startsAt: d.startsAt, endsAt: d.endsAt })),
});

// Public shape. Never includes the organizer's email or the short code.
function toJSON(ev, viewer, extra) {
  const mine = isOrganizer(viewer, ev);
  const out = {
    id: ev.id, name: ev.name, description: ev.description, areaLabel: ev.areaLabel,
    lat: ev.lat, lng: ev.lng, radiusMiles: ev.radiusMiles, joinMode: ev.joinMode,
    schedule: scheduleJSON(ev), startDate: ev.startDate, endDate: ev.endDate, status: statusOf(ev),
    organizer: ev.organizer ? publicUser(ev.organizer) : null,
    mine, createdAt: ev.createdAt,
  };
  if (mine || isAdmin(viewer)) Object.assign(out, { hidden: !!ev.hidden, hiddenSource: ev.hiddenSource || null });
  return Object.assign(out, extra || {});
}

// Events whose center is within `radius` miles of `center` (visible, not ended).
async function nearby(center, radius, viewer) {
  const m = models();
  const box = geo.boundingBox(center, radius);
  const rows = await m.SaleEvent.findAll({
    where: { [Op.and]: [
      { lat: { [Op.between]: [box.minLat, box.maxLat] } },
      { [Op.or]: box.lngRanges.map(([a, b]) => ({ lng: { [Op.between]: [a, b] } })) },
      visibleWhere(viewer), notEndedWhere(),
    ].filter(Boolean) },
    include: [{ model: m.User, as: 'organizer', attributes: ['id', 'firstName', 'lastName'] }],
    limit: 200,
  });
  return rows.map((e) => ({ e, d: geo.haversineMiles(center, { lat: e.lat, lng: e.lng }) }))
    .filter((x) => x.d <= radius).sort((a, b) => a.d - b.d || a.e.startDate - b.e.startDate);
}

module.exports = {
  RADII, NAME_MAX, DESC_MAX, AREA_MAX, MAX_DAYS, maxActive, maxPerDay, maxSales,
  isOrganizer, canSee, isEnded, statusOf, visibleWhere, notEndedWhere, validate, newCode,
  ineligible, blockedBetween, salesOf, publicSaleCounts, eventsForPosts, scheduleJSON, toJSON, nearby,
};
