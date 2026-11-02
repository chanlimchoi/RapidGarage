'use strict';
// Offer rules: a seller sets, per item or for the whole sale, the price at or
// above which an offer is accepted automatically and the floor below which it
// is politely declined. Only offers in between wait for the seller.
//
// * Per item: offerAcceptCents / offerFloorCents (SaleItem). Per sale:
//   offerAcceptPercent / offerFloorPercent of each item's asking price (Post),
//   used for items without their own rule and with an asking price.
// * Rules apply to single-item offers (POST /conversations/:id/holds with
//   offerCents), never to plain hold requests, counteroffers or bundles.
// * Auto-accept respects holds: never over a reservation (the request is
//   refused before then), and not while another buyer's pending request for
//   the same item asks the full price (plain hold) or offers at least as much;
//   then the seller decides as usual. It reserves exactly like the seller
//   accepting (lib/holds.js reserveHold), default hold length / pickup time.
// * A floor decline is not a seller "decline": no 24 h cooldown, the buyer may
//   offer more right away (endedReason 'floor'). The message never says the floor.
// * The rules are the seller's: never in public JSON, only GET /post/:id/offer-rules.
const { Op } = require('sequelize');
const holds = require('./holds');
const { PRICE_CAP_CENTS, parseCents } = require('./items');

function models() { return require('../models'); }

const PERCENT_MIN = 1;
const PERCENT_MAX = 99;

// Effective rule for one item: { acceptCents, floorCents, source } (nulls when none).
function effective(item, post) {
  const price = item.priceCents;
  const pct = (p, round) => (p && Number.isInteger(price) && price > 0 ? Math[round]((price * p) / 100) : null);
  const accept = item.offerAcceptCents != null ? item.offerAcceptCents : pct(post && post.offerAcceptPercent, 'ceil');
  let floor = item.offerFloorCents != null ? item.offerFloorCents : pct(post && post.offerFloorPercent, 'floor');
  if (accept != null && floor != null && floor > accept) floor = accept;
  const own = item.offerAcceptCents != null || item.offerFloorCents != null;
  const sale = !!(post && (post.offerAcceptPercent || post.offerFloorPercent)) && Number.isInteger(price) && price > 0;
  return { acceptCents: accept, floorCents: floor, source: own ? 'item' : sale && (accept != null || floor != null) ? 'sale' : null };
}

// What happens to an offer of `cents`: 'accept' | 'decline' | null (seller decides).
function decide(cents, rule) {
  if (!Number.isInteger(cents) || cents < 1) return null;
  if (rule.acceptCents != null && cents >= rule.acceptCents) return 'accept';
  if (rule.floorCents != null && cents < rule.floorCents) return 'decline';
  return null;
}

// ---- validation ----------------------------------------------------------
// Dollar amount or null/'' to clear -> { value } | { error }
function parseAmount(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const c = parseCents(typeof raw === 'number' ? String(raw) : raw);
  if (c.error) return { error: c.error };
  if (c.value === null || c.value === undefined) return { value: null };
  if (c.value < 1 || c.value > PRICE_CAP_CENTS) return { error: 'Enter an amount in dollars, like 5 or 4.50.' };
  return { value: c.value };
}

// Per item: { accept, floor } in dollars. -> { values: { offerAcceptCents, offerFloorCents } } | { errors }
function parseItemRule(body, item) {
  const errors = {};
  const a = parseAmount(body.accept);
  const f = parseAmount(body.floor);
  if (a.error) errors.accept = a.error;
  if (f.error) errors.floor = f.error;
  if (Object.keys(errors).length) return { errors };
  if (item.priceCents === 0 && (a.value || f.value)) return { errors: { accept: 'This item is free.' } };
  if (a.value != null && Number.isInteger(item.priceCents) && a.value >= item.priceCents) errors.accept = 'Set it below the asking price (offers are always below it).';
  if (f.value != null && Number.isInteger(item.priceCents) && f.value >= item.priceCents) errors.floor = 'Set it below the asking price (offers are always below it).';
  if (a.value != null && f.value != null && f.value >= a.value) errors.floor = 'The floor has to be below the auto-accept price.';
  if (Object.keys(errors).length) return { errors };
  return { values: { offerAcceptCents: a.value, offerFloorCents: f.value } };
}

// Per sale: { acceptPercent, floorPercent } 1-99 or null. -> { values } | { errors }
function parseSaleRule(body) {
  const errors = {};
  const pct = (raw, key) => {
    if (raw === undefined || raw === null || raw === '') return null;
    const n = typeof raw === 'string' && /^\s*\d+\s*$/.test(raw) ? Number(raw) : raw;
    if (!Number.isInteger(n) || n < PERCENT_MIN || n > PERCENT_MAX) { errors[key] = 'Choose a percentage from 1 to 99.'; return null; }
    return n;
  };
  const a = pct(body.acceptPercent, 'acceptPercent');
  const f = pct(body.floorPercent, 'floorPercent');
  if (!errors.acceptPercent && !errors.floorPercent && a != null && f != null && f >= a) errors.floorPercent = 'The floor has to be below the auto-accept price.';
  if (Object.keys(errors).length) return { errors };
  return { values: { offerAcceptPercent: a, offerFloorPercent: f } };
}

// ---- applying ------------------------------------------------------------
// Another buyer's open request that should go first: a plain hold (full
// price) or an offer at least this high.
async function outranked(hold) {
  const m = models();
  return !!(await m.ItemHold.count({ where: { itemId: hold.itemId, status: 'pending', id: { [Op.ne]: hold.id },
    [Op.or]: [{ offerCents: null }, { offerCents: { [Op.gte]: hold.offerCents } }] } }));
}

// Right after a single-item offer is created (status pending). Returns
// 'accepted' | 'declined' | null; the hold is reloaded when it changed.
async function apply(hold, item, post) {
  if (!hold.offerCents || hold.bundleKey || hold.status !== 'pending') return null;
  const rule = effective(item, post);
  const what = decide(hold.offerCents, rule);
  if (what === 'decline') {
    const [changed] = await models().ItemHold.update({ status: 'declined', endedReason: 'floor', decidedAt: holds.now() }, { where: { id: hold.id, status: 'pending' } });
    if (!changed) return null;
    await hold.reload({ include: [{ model: models().SaleItem, as: 'item' }] });
    await holds.postEvent(hold, 'auto_declined', hold.sellerId, item.name, hold.offerCents);
    return 'declined';
  }
  if (what === 'accept') {
    if (await outranked(hold)) return null;
    const out = await holds.reserveHold(hold, { by: hold.sellerId, hours: null, fields: { counterCents: null }, event: 'auto_accepted', cents: hold.offerCents });
    return out.hold ? 'accepted' : null;
  }
  return null;
}

// GET /post/:id/offer-rules
function view(post, items) {
  return {
    sale: { acceptPercent: post.offerAcceptPercent || null, floorPercent: post.offerFloorPercent || null },
    items: items.map((i) => Object.assign({ id: i.id, name: i.name, priceCents: i.priceCents, sold: !!i.sold,
      acceptCents: i.offerAcceptCents == null ? null : i.offerAcceptCents, floorCents: i.offerFloorCents == null ? null : i.offerFloorCents },
    { effective: effective(i, post) })),
    limits: { percentMin: PERCENT_MIN, percentMax: PERCENT_MAX },
  };
}

module.exports = { effective, decide, parseAmount, parseItemRule, parseSaleRule, apply, view, PERCENT_MIN, PERCENT_MAX };
