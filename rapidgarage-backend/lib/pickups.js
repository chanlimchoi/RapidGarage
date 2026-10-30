'use strict';
// Pickup scheduling. After the seller accepts a hold or an offer in a
// conversation (lib/holds.js), they offer a few pickup time slots; the buyer
// books one. The booked time becomes the accepted holds' pickup time, so the
// reservation lasts until an hour after it (never past the end of the sale).
// Either person can ask to reschedule (the plan goes back to "offered": the
// buyer picks another slot or the seller offers new ones) or cancel the pickup
// (the holds stay as they are). Every step posts a Message (kind 'pickup')
// with an English summary, so it shows in the thread, the unread badge and
// push, like holds and meetups. The address is the sale's own (already shown
// to the buyer); nothing about where either person is gets stored.
const { Op } = require('sequelize');
const schedule = require('./schedule');
const holds = require('./holds');

function models() { return require('../models'); }

const MAX_SLOTS = 6;
const MINUTES = [15, 30, 60, 120];
const PER_DAY = 20; // pickup steps per person per conversation per 24 h
const HOUR = 3600000;
const ms = (v) => (v instanceof Date ? v.getTime() : new Date(v).getTime());
const zoneOf = (tz) => (tz && schedule.isValidTimeZone(tz) ? tz : schedule.defaultTimeZone());

function whenText(start, tz) {
  return new Intl.DateTimeFormat('en-US', { timeZone: zoneOf(tz), weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(start));
}
const SUMMARY = {
  offered: (p, n) => 'Offered ' + n + (n === 1 ? ' pickup time.' : ' pickup times.'),
  rescheduled: (p, n) => 'Offered new pickup times (' + n + ').',
  booked: (p, n, start) => 'Booked pickup for ' + whenText(start, p.timeZone) + '.',
  reschedule: () => 'Asked to pick a different pickup time.',
  cancelled: () => 'Cancelled the pickup.',
};

// Accepted, unexpired holds in the conversation (what is being picked up).
async function acceptedHolds(conversationId, t) {
  const m = models();
  return m.ItemHold.findAll({
    where: { conversationId, status: 'accepted', expiresAt: { [Op.gt]: t || holds.now() } },
    include: [{ model: m.SaleItem, as: 'item', attributes: ['id', 'name'] }], order: [['id', 'ASC']],
  });
}

// { slots: [iso...], minutes } -> { value: { slots: [Date], minutes } } | { errors }
function parseSlots(body, post, t) {
  const errors = {};
  const b = body || {};
  const minutes = b.minutes === undefined || b.minutes === null || b.minutes === '' ? 30 : Number(b.minutes);
  if (!MINUTES.includes(minutes)) errors.minutes = 'Pick a slot length of 15, 30, 60 or 120 minutes.';
  if (!Array.isArray(b.slots) || !b.slots.length) errors.slots = 'Offer at least one pickup time.';
  else if (b.slots.length > MAX_SLOTS) errors.slots = 'Offer at most ' + MAX_SLOTS + ' pickup times.';
  const out = [];
  if (!errors.slots) {
    for (const raw of b.slots) {
      const r = holds.parsePickup(raw, post, t);
      if (r.error || !r.value) { errors.slots = r.error || 'Pick a valid pickup time.'; break; }
      if (out.some((d) => Math.abs(ms(d) - ms(r.value)) < 60000)) { errors.slots = 'Each pickup time can only be offered once.'; break; }
      out.push(r.value);
    }
  }
  if (Object.keys(errors).length) return { errors };
  out.sort((a, c) => ms(a) - ms(c));
  return { value: { slots: out, minutes } };
}

function planJSON(p, me, t) {
  if (!p) return null;
  const at = ms(t || holds.now());
  const len = p.slotMinutes * 60000;
  const slot = (iso) => ({ start: new Date(iso), end: new Date(ms(iso) + len), past: ms(iso) <= at });
  return {
    id: p.id,
    conversationId: p.conversationId,
    postId: p.postId,
    status: p.status,
    role: me === p.buyerId ? 'buyer' : 'seller',
    slotMinutes: p.slotMinutes,
    timeZone: p.timeZone,
    slots: p.slotList().map(slot),
    chosen: p.chosenAt ? slot(p.chosenAt) : null,
    updatedAt: p.updatedAt,
  };
}

async function postEvent(p, event, by, extra) {
  const m = models();
  const n = p.slotList().length;
  const msg = await m.Message.create({
    conversationId: p.conversationId, senderId: by, kind: 'pickup', pickupId: p.id, pickupEvent: event,
    pickupStart: event === 'booked' ? p.chosenAt : null, body: SUMMARY[event](p, n, p.chosenAt, extra),
  });
  const conv = await m.Conversation.findByPk(p.conversationId);
  if (conv) {
    const fields = { lastMessageAt: msg.createdAt };
    if (by === conv.buyerId || by === conv.sellerId) fields[conv.lastReadField(by)] = msg.createdAt;
    await conv.update(fields, { silent: true });
  }
  return msg;
}

async function overLimit(conversationId, userId, t) {
  const n = await models().Message.count({ where: { conversationId, senderId: userId, kind: 'pickup', createdAt: { [Op.gte]: new Date(ms(t) - 24 * HOUR) } } });
  return n >= PER_DAY;
}

// The booked time becomes the pickup time of every accepted hold in the
// conversation; their reservation is extended (never shortened) to cover it.
async function applyToHolds(p, post, t) {
  const m = models();
  const rows = await acceptedHolds(p.conversationId, t);
  for (const h of rows) {
    h.pickupAt = p.chosenAt;
    const until = holds.acceptExpiry(h, post, null, t);
    const expiresAt = ms(until) > ms(h.expiresAt) ? until : h.expiresAt;
    await m.ItemHold.update({ pickupAt: p.chosenAt, expiresAt }, { where: { id: h.id, status: 'accepted' } });
    await m.SaleItem.update({ reservedUntil: expiresAt }, { where: { id: h.itemId, sold: false } });
  }
  return rows.length;
}

// Upcoming plans for the dashboard: booked (soonest first) then waiting ones.
async function upcomingFor(userId, t) {
  const m = models();
  const at = t || holds.now();
  const rows = await m.PickupPlan.findAll({
    where: { status: ['offered', 'booked'], [Op.or]: [{ sellerId: userId }, { buyerId: userId }] },
    order: [['updatedAt', 'DESC']], limit: 50,
  });
  const out = [];
  for (const p of rows) {
    if (p.status === 'booked' && ms(p.chosenAt) + p.slotMinutes * 60000 < ms(at)) continue;
    if (p.status === 'offered' && !p.slotList().some((s) => ms(s) > ms(at))) continue;
    const items = await acceptedHolds(p.conversationId, at);
    if (!items.length) continue;
    out.push({ plan: p, items: items.map((h) => (h.item && h.item.name) || null).filter(Boolean) });
  }
  out.sort((a, b) => {
    if (a.plan.status !== b.plan.status) return a.plan.status === 'booked' ? -1 : 1;
    return ms(a.plan.chosenAt || a.plan.slotList()[0]) - ms(b.plan.chosenAt || b.plan.slotList()[0]);
  });
  return out;
}

module.exports = {
  MAX_SLOTS, MINUTES, PER_DAY, SUMMARY,
  zoneOf, whenText, acceptedHolds, parseSlots, planJSON, postEvent, overLimit, applyToHolds, upcomingFor,
};
