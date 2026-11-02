'use strict';
// Leftover donation pickup. After a sale has ended, the seller lists unsold
// items (all of them, or a chosen few) as one donation lot with up to
// MAX_SLOTS pickup slots (the same slot lengths as pickup scheduling,
// lib/pickups.js) in the next DONATION_SLOT_DAYS days (default 7). A nearby
// person, or someone picking up for an organization, claims the lot for one
// slot; it is then theirs until they cancel, the seller releases it or marks
// it picked up. Claiming opens (or reuses) the claimer's conversation with the
// seller about the sale, so the two can talk through messages.
//
// Discovery: GET /donations/nearby (open lots with a future slot near a
// point) and a bell notification + push ("saved searches" switch) for people
// whose free-at-the-curb alert circle holds the sale (lib/curbAlerts.js).
// People appear as "First L."; the claimer's organization name is shown only
// to the seller. Hidden sales and blocks either way hide lots.
const { Op } = require('sequelize');
const schedule = require('./schedule');
const geo = require('./geo');
const pickups = require('./pickups');
const notifications = require('./notifications');
const { publicUser, publicName } = require('./people');

function models() { return require('../models'); }

function intEnv(name, dflt, min, max) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : dflt;
}
const slotDays = () => intEnv('DONATION_SLOT_DAYS', 7, 1, 14);
const HOUR = 3600000;
const DAY = 24 * HOUR;
const NOTE_MAX = 300;
const ORG_MAX = 80;
const RADII = [1, 2, 5, 10, 25];
const NEARBY_MAX = 50;
const ms = (v) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

// { itemIds?, note?, slots: [iso], minutes } -> { value } | { errors }
// unsold: the sale's unsold items ([{ id }]); none chosen = all of them.
function validate(body, unsold, t) {
  const b = body || {};
  const errors = {};
  const ids = unsold.map((i) => i.id);
  let itemIds = ids;
  if (b.itemIds !== undefined && b.itemIds !== null) {
    if (!Array.isArray(b.itemIds) || b.itemIds.some((x) => !Number.isInteger(x) || ids.indexOf(x) === -1)) errors.itemIds = 'Choose unsold items from this sale.';
    else itemIds = Array.from(new Set(b.itemIds));
  }
  const note = typeof b.note === 'string' ? b.note.trim().replace(/\s+/g, ' ') : '';
  if (b.note !== undefined && b.note !== null && typeof b.note !== 'string') errors.note = 'Must be text.';
  else if (note.length > NOTE_MAX) errors.note = 'Keep it to ' + NOTE_MAX + ' characters.';
  if (!errors.itemIds && !itemIds.length && !note) errors.itemIds = 'Choose what is left to donate, or describe it in the note.';
  const minutes = b.minutes === undefined || b.minutes === null || b.minutes === '' ? 30 : Number(b.minutes);
  if (!pickups.MINUTES.includes(minutes)) errors.minutes = 'Pick a slot length of 15, 30, 60 or 120 minutes.';
  const slots = [];
  if (!Array.isArray(b.slots) || !b.slots.length) errors.slots = 'Offer at least one pickup time.';
  else if (b.slots.length > pickups.MAX_SLOTS) errors.slots = 'Offer at most ' + pickups.MAX_SLOTS + ' pickup times.';
  else {
    for (const raw of b.slots) {
      const d = typeof raw === 'string' ? new Date(raw) : null;
      if (!d || isNaN(d.getTime())) { errors.slots = 'Pick a valid pickup time.'; break; }
      if (ms(d) <= ms(t)) { errors.slots = 'Pick a pickup time in the future.'; break; }
      if (ms(d) > ms(t) + slotDays() * DAY) { errors.slots = 'Pick a pickup time within the next ' + slotDays() + ' days.'; break; }
      if (slots.some((x) => Math.abs(ms(x) - ms(d)) < 60000)) { errors.slots = 'Each pickup time can only be offered once.'; break; }
      slots.push(d);
    }
  }
  if (Object.keys(errors).length) return { errors };
  slots.sort((a, c) => ms(a) - ms(c));
  return { value: { itemIds, note: note || null, slots: slots.map((d) => d.toISOString()), slotMinutes: minutes } };
}

const futureSlots = (lot, t) => lot.slotList().filter((s) => ms(s) > ms(t));

// What a viewer sees. role: 'seller' | 'claimer' | null.
function lotJSON(lot, post, items, viewer, t, extra) {
  const at = ms(t || schedule.now());
  const me = viewer ? viewer.id : null;
  const role = me && me === lot.sellerId ? 'seller' : me && me === lot.claimerId ? 'claimer' : null;
  const len = lot.slotMinutes * 60000;
  const slot = (iso) => ({ start: new Date(iso).toISOString(), end: new Date(ms(iso) + len).toISOString(), past: ms(iso) <= at });
  const out = {
    id: lot.id, postId: lot.postId, status: lot.status, role,
    title: post ? post.title : null, city: post ? post.city || null : null,
    seller: post && post.User ? publicUser(post.User) : null,
    items: items.map((i) => ({ id: i.id, name: i.name })), itemCount: items.length,
    note: lot.note || null, slotMinutes: lot.slotMinutes, timeZone: lot.timeZone,
    slots: lot.status === 'open' || role ? lot.slotList().map(slot) : [],
    claimed: lot.status !== 'open',
    createdAt: lot.createdAt,
  };
  if (role) {
    out.chosen = lot.chosenAt ? slot(lot.chosenAt) : null;
    out.conversationId = lot.conversationId || null;
  }
  if (role === 'seller') out.claimer = lot.claimerId && extra && extra.claimer ? { name: publicName(extra.claimer), org: lot.claimOrg || null } : null;
  if (role === 'claimer') out.org = lot.claimOrg || null;
  return out;
}

async function itemsOf(lot) {
  const ids = lot.itemIdList();
  if (!ids.length) return [];
  const rows = await models().SaleItem.findAll({ where: { id: ids, postId: lot.postId }, attributes: ['id', 'name', 'position'], order: [['position', 'ASC'], ['id', 'ASC']] });
  return rows;
}

async function blockedBetween(a, b) {
  if (!a || !b) return false;
  return !!(await models().UserBlock.count({ where: { [Op.or]: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } }));
}

// Nearby open lots with at least one future slot. -> [{ lot JSON + distanceMiles }]
async function nearby(center, radius, viewer, t) {
  const m = models();
  const at = t || schedule.now();
  const box = geo.boundingBox(center, radius);
  const rows = await m.DonationLot.findAll({ where: { status: 'open', lat: { [Op.between]: [box.minLat, box.maxLat] },
    [Op.or]: box.lngRanges.map(([a, b]) => ({ lng: { [Op.between]: [a, b] } })) }, limit: 500 });
  let list = rows.map((l) => ({ l, d: geo.haversineMiles(center, { lat: l.lat, lng: l.lng }) }))
    .filter((x) => x.d <= radius && futureSlots(x.l, at).length);
  if (viewer && list.length) {
    const ids = list.map((x) => x.l.sellerId);
    const blocks = await m.UserBlock.findAll({ where: { [Op.or]: [{ blockerId: viewer.id, blockedId: ids }, { blockedId: viewer.id, blockerId: ids }] }, raw: true });
    const bad = new Set(blocks.map((b) => (b.blockerId === viewer.id ? b.blockedId : b.blockerId)));
    list = list.filter((x) => !bad.has(x.l.sellerId));
  }
  list.sort((a, b) => a.d - b.d);
  list = list.slice(0, NEARBY_MAX);
  if (!list.length) return [];
  const posts = await m.Post.findAll({ where: { id: list.map((x) => x.l.postId), hidden: false }, include: [{ model: m.User, attributes: ['id', 'firstName', 'lastName'] }] });
  const byId = new Map(posts.map((p) => [p.id, p]));
  const out = [];
  for (const x of list) {
    const post = byId.get(x.l.postId);
    if (!post) continue;
    out.push(Object.assign(lotJSON(x.l, post, await itemsOf(x.l), viewer, at), { distanceMiles: Math.round(x.d * 10) / 10 }));
  }
  return out;
}

// Tell people whose curb alert circle holds the sale (once per lot).
async function notifyNearby(lot, post) {
  if (lot.lat === null || lot.lat === undefined) return 0;
  const curbAlerts = require('./curbAlerts');
  const list = await curbAlerts.recipients({ id: post.id, lat: lot.lat, lng: lot.lng, userId: post.userId, hidden: post.hidden });
  if (!list.length) return 0;
  const key = 'donation:' + lot.id;
  const before = new Set((await models().Notification.findAll({ where: { dedupeKey: key, userId: list.map((x) => x.userId) }, attributes: ['userId'], raw: true })).map((r) => r.userId));
  const n = await notifications.add(list.map((x) => ({ userId: x.userId, kind: 'donation_lot', postId: post.id, dedupeKey: key, data: { miles: x.miles, lotId: lot.id } })));
  const push = require('./push');
  list.filter((x) => !before.has(x.userId)).forEach((x) => push.donationNearby(x.userId, { title: post.title, postId: post.id, miles: x.miles }));
  return n;
}

// A claim changed: bell (+ push for claims) to the other person.
async function notifyChange(lot, post, toUserId, event, fromUser) {
  const data = { event, lotId: lot.id, name: fromUser ? publicName(fromUser) : null, start: lot.chosenAt ? new Date(lot.chosenAt).toISOString() : null };
  if (event === 'claimed' && lot.claimOrg) data.org = lot.claimOrg;
  await notifications.add([{ userId: toUserId, kind: event === 'claimed' ? 'donation_claimed' : 'donation_update', postId: post.id,
    dedupeKey: 'donation:' + lot.id + ':' + event + ':' + Date.now().toString(36), data }]);
  if (event === 'claimed') require('./push').donationClaimed(toUserId, { name: data.name, title: post.title, postId: post.id, conversationId: lot.conversationId });
}

module.exports = { NOTE_MAX, ORG_MAX, RADII, slotDays, validate, futureSlots, lotJSON, itemsOf, blockedBetween, nearby, notifyNearby, notifyChange };
