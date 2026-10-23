// Localized wording for item-hold events in a conversation (message.kind 'hold').
import { t, intlLocale } from '../i18n/index.js';

const MINE = {
  requested: 'hold.ev.requested.mine', accepted: 'hold.ev.accepted.mine', declined: 'hold.ev.declined.mine',
  released: 'hold.ev.released.mine', cancelled: 'hold.ev.cancelled.mine',
  offered: 'hold.ev.offered.mine', acceptedAt: 'hold.ev.acceptedAt.mine', countered: 'hold.ev.countered.mine', agreed: 'hold.ev.agreed.mine',
};
const OTHER = {
  requested: 'hold.ev.requested.other', accepted: 'hold.ev.accepted.other', declined: 'hold.ev.declined.other',
  released: 'hold.ev.released.other', cancelled: 'hold.ev.cancelled.other',
  offered: 'hold.ev.offered.other', acceptedAt: 'hold.ev.acceptedAt.other', countered: 'hold.ev.countered.other', agreed: 'hold.ev.agreed.other',
};
const SYSTEM = { expired: 'hold.ev.expired', sold: 'hold.ev.sold' };
// Bundle deals: one event for the whole bundle (m.hold.bundle.items).
// [mine, other, mine with a price, other with a price]
const BUNDLE = {
  bundle_requested: ['bundle.ev.requested.mine', 'bundle.ev.requested.other', 'bundle.ev.requested.minePrice', 'bundle.ev.requested.otherPrice'],
  bundle_accepted: ['bundle.ev.accepted.mine', 'bundle.ev.accepted.other', 'bundle.ev.accepted.minePrice', 'bundle.ev.accepted.otherPrice'],
  bundle_declined: ['bundle.ev.declined.mine', 'bundle.ev.declined.other'],
  bundle_released: ['bundle.ev.released.mine', 'bundle.ev.released.other'],
  bundle_cancelled: ['bundle.ev.cancelled.mine', 'bundle.ev.cancelled.other'],
};

// "Desk, Lamp and Mug" in the UI language.
const list = (names) => {
  const clean = (names || []).map((n) => n || t('hold.anItem'));
  try { return new Intl.ListFormat(intlLocale(), { style: 'long', type: 'conjunction' }).format(clean); } catch (e) { return clean.join(', '); }
};

// 450 -> "$4.50" in the UI language (as lib/items formatCents; kept here so this file loads under node --test).
const money = (c) => new Intl.NumberFormat(intlLocale(), { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);

// "Sat, Oct 24, 9:30 AM" in the UI language.
export const holdTime = (v) => new Date(v).toLocaleString(intlLocale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// m: a message with m.hold = { event, itemName, endedReason }; other: the other person's name.
export function holdEventText(m, other) {
  const h = m.hold || {};
  if (BUNDLE[h.event]) {
    const items = h.bundle ? list(h.bundle.items) : (h.itemName || t('hold.anItem'));
    const keys = BUNDLE[h.event];
    const key = keys[(m.mine ? 0 : 1) + (h.cents && keys.length > 2 ? 2 : 0)];
    return t(key, { items, name: other, price: h.cents ? money(h.cents) : '' }).replace(/\.\.$/, '.');
  }
  const vars = { item: h.itemName || t('hold.anItem'), name: other, price: h.cents ? money(h.cents) : '' };
  // With a price: an offer, an accepted offer, a counteroffer or taking it.
  let event = h.event;
  if (h.cents && event === 'requested') event = 'offered';
  else if (h.cents && event === 'accepted') event = 'acceptedAt';
  if (SYSTEM[h.event]) return t(SYSTEM[h.event], vars);
  // An automatic decline because the item went to someone else.
  if (h.event === 'declined' && h.endedReason === 'taken') return t('hold.ev.taken', vars);
  const key = (m.mine ? MINE : OTHER)[event];
  // Names are "First L.", so a sentence ending in one would read "Alex R..".
  return key ? t(key, vars).replace(/\.\.$/, '.') : m.body;
}
