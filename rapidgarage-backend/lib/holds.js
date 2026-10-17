'use strict';
// Item holds: a buyer, inside the conversation about a sale, asks the seller
// to set one item aside, optionally with a pickup time. The seller accepts or
// declines; an accepted hold marks the item "Reserved" (SaleItem.reservedUntil)
// until it expires, the seller releases it, the buyer cancels it, or the item
// is marked sold. Every step posts an event message into the conversation
// (Message.kind = 'hold'), so it shows in the thread and the unread badge.
//
// Expiry: pending requests lapse after HOLD_REQUEST_HOURS (default 24) without
// an answer; accepted holds last HOLD_HOURS (default 24) or until an hour after
// the pickup time, and never past the end of the sale. sweep() ends overdue
// holds; it runs on a timer and before hold reads, and "Reserved" is computed
// against the clock anyway, so a late sweep never shows a stale reservation.
//
// Abuse limits (per buyer): HOLD_MAX_ACTIVE open holds in total (5), 3 per
// sale, HOLD_MAX_PER_DAY requests per 24 h (10), no second request for an item
// the seller declined within 24 h; at most 5 pending requests per item.
const { Op } = require('sequelize');
const schedule = require('./schedule');

function models() { return require('../models'); }
function intEnv(name, dflt, max) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && (!max || n <= max) ? n : dflt;
}
const HOUR = 3600000;
const requestHours = () => intEnv('HOLD_REQUEST_HOURS', 24, 168);
const holdHours = () => intEnv('HOLD_HOURS', 24, 168);
const maxActive = () => intEnv('HOLD_MAX_ACTIVE', 5);
const maxPerDay = () => intEnv('HOLD_MAX_PER_DAY', 10);
const MAX_PER_SALE = 3;
const MAX_PENDING_PER_ITEM = 5;
const DECLINE_COOLDOWN_MS = 24 * HOUR;
const PICKUP_MAX_DAYS = 14;
const ACCEPT_HOURS_MAX = 72;
const PICKUP_GRACE_MS = HOUR;

const now = () => schedule.now();
const ms = (v) => (v instanceof Date ? v.getTime() : new Date(v).getTime());

// End of the sale (ms) or null when it has no dates.
function saleEnd(post) {
  const w = schedule.windowsOf(post);
  return w.length ? Math.max.apply(null, w.map((x) => x.endsAt)) : null;
}
const capAt = (t, post) => { const e = saleEnd(post); return new Date(e === null ? t : Math.min(t, e)); };

// English summaries stored in Message.body (moderators, old clients); the
// apps render their own localized text from holdEvent.
const SUMMARY = {
  requested: (n) => 'Asked to hold “' + n + '”.',
  accepted: (n) => 'Accepted the hold on “' + n + '”.',
  declined: (n) => 'Declined the hold on “' + n + '”.',
  released: (n) => 'Released the hold on “' + n + '”.',
  cancelled: (n) => 'Cancelled the hold on “' + n + '”.',
  expired: (n) => 'The hold on “' + n + '” expired.',
  sold: (n) => '“' + n + '” was sold.',
};

// Post an event into the hold's conversation. `by`: the user it is attributed
// to; the other participant gets it as unread. System events (expiry, sold)
// are attributed to the seller so the buyer is the one notified.
async function postEvent(hold, event, by, itemName) {
  const m = models();
  const msg = await m.Message.create({
    conversationId: hold.conversationId, senderId: by, kind: 'hold', holdId: hold.id, holdEvent: event,
    body: SUMMARY[event](String(itemName || '').slice(0, 80) || 'an item'),
  });
  const conv = await m.Conversation.findByPk(hold.conversationId);
  if (conv) {
    const fields = { lastMessageAt: msg.createdAt };
    // Acting implies having read the thread up to now (as when sending).
    if (by === conv.buyerId || by === conv.sellerId) fields[conv.lastReadField(by)] = msg.createdAt;
    await conv.update(fields, { silent: true });
  }
  return msg;
}

async function clearReservation(hold) {
  await models().SaleItem.update({ reservedUntil: null }, { where: { id: hold.itemId } });
}

// End overdue holds (pending and accepted). Returns how many ended.
async function sweep(at) {
  const m = models();
  const t = at || now();
  const due = await m.ItemHold.findAll({ where: { status: m.ItemHold.ACTIVE, expiresAt: { [Op.lte]: t } }, include: [{ model: m.SaleItem, as: 'item', attributes: ['id', 'name'] }], limit: 200 });
  let n = 0;
  for (const h of due) {
    const [changed] = await m.ItemHold.update({ status: 'expired', endedReason: h.status === 'pending' ? 'timeout' : null }, { where: { id: h.id, status: h.status } });
    if (!changed) continue; // someone else ended it meanwhile
    if (h.status === 'accepted') await clearReservation(h);
    await postEvent(h, 'expired', h.sellerId, h.item && h.item.name);
    n++;
  }
  return n;
}

// Item marked sold: an accepted hold is done; pending requests are told.
async function itemSold(item) {
  const m = models();
  const open = await m.ItemHold.findAll({ where: { itemId: item.id, status: m.ItemHold.ACTIVE } });
  for (const h of open) {
    if (h.status === 'accepted') { await h.update({ status: 'completed', decidedAt: now() }); continue; }
    await h.update({ status: 'declined', endedReason: 'sold', decidedAt: now() });
    await postEvent(h, 'sold', h.sellerId, item.name);
  }
  await item.update({ reservedUntil: null });
}

// A block ends every open hold between the two people (no messages: they can't
// message each other any more).
async function endBetween(a, b) {
  const m = models();
  const open = await m.ItemHold.findAll({ where: { status: m.ItemHold.ACTIVE, [Op.or]: [{ buyerId: a, sellerId: b }, { buyerId: b, sellerId: a }] } });
  for (const h of open) {
    if (h.status === 'accepted') await clearReservation(h);
    await h.update({ status: 'cancelled', endedReason: 'blocked', decidedAt: now() });
  }
  return open.length;
}

function holdJSON(h, me) {
  const item = h.item || null;
  return {
    id: h.id,
    status: h.status,
    role: me === h.buyerId ? 'buyer' : 'seller',
    item: item ? { id: item.id, name: item.name, priceCents: item.priceCents, sold: !!item.sold } : { id: h.itemId, name: null, priceCents: null, sold: false },
    pickupAt: h.pickupAt,
    expiresAt: h.expiresAt,
    decidedAt: h.decidedAt,
    endedReason: h.endedReason,
    createdAt: h.createdAt,
  };
}

// ---- validation -----------------------------------------------------------
// -> { value: Date|null } | { error }
function parsePickup(raw, post, t) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  if (typeof raw !== 'string') return { error: 'Pick a valid pickup time.' };
  const d = new Date(raw);
  if (isNaN(d.getTime())) return { error: 'Pick a valid pickup time.' };
  if (ms(d) <= ms(t)) return { error: 'Pick a pickup time in the future.' };
  if (ms(d) > ms(t) + PICKUP_MAX_DAYS * 24 * HOUR) return { error: 'Pick a pickup time within the next ' + PICKUP_MAX_DAYS + ' days.' };
  const end = saleEnd(post);
  if (end !== null && ms(d) > end) return { error: 'Pick a pickup time before the sale ends.' };
  return { value: d };
}

function parseHours(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > ACCEPT_HOURS_MAX) return { error: 'Hold for 1 to ' + ACCEPT_HOURS_MAX + ' hours.' };
  return { value: n };
}

// Expiry for a pending request and for an accepted hold.
const requestExpiry = (post, t) => capAt(ms(t) + requestHours() * HOUR, post);
function acceptExpiry(hold, post, hours, t) {
  let until;
  if (hours) until = ms(t) + hours * HOUR;
  else if (hold.pickupAt) until = Math.max(ms(t) + HOUR, Math.min(ms(hold.pickupAt) + PICKUP_GRACE_MS, ms(t) + ACCEPT_HOURS_MAX * HOUR));
  else until = ms(t) + holdHours() * HOUR;
  return capAt(until, post);
}

module.exports = {
  MAX_PER_SALE, MAX_PENDING_PER_ITEM, DECLINE_COOLDOWN_MS, PICKUP_MAX_DAYS, ACCEPT_HOURS_MAX,
  requestHours, holdHours, maxActive, maxPerDay, now, saleEnd,
  postEvent, clearReservation, sweep, itemSold, endBetween, holdJSON, parsePickup, parseHours, requestExpiry, acceptExpiry,
};
