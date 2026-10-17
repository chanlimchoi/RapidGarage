// Localized wording for item-hold events in a conversation (message.kind 'hold').
import { t, intlLocale } from '../i18n/index.js';

const MINE = {
  requested: 'hold.ev.requested.mine', accepted: 'hold.ev.accepted.mine', declined: 'hold.ev.declined.mine',
  released: 'hold.ev.released.mine', cancelled: 'hold.ev.cancelled.mine',
};
const OTHER = {
  requested: 'hold.ev.requested.other', accepted: 'hold.ev.accepted.other', declined: 'hold.ev.declined.other',
  released: 'hold.ev.released.other', cancelled: 'hold.ev.cancelled.other',
};
const SYSTEM = { expired: 'hold.ev.expired', sold: 'hold.ev.sold' };

// "Sat, Oct 24, 9:30 AM" in the UI language.
export const holdTime = (v) => new Date(v).toLocaleString(intlLocale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// m: a message with m.hold = { event, itemName, endedReason }; other: the other person's name.
export function holdEventText(m, other) {
  const h = m.hold || {};
  const vars = { item: h.itemName || t('hold.anItem'), name: other };
  if (SYSTEM[h.event]) return t(SYSTEM[h.event], vars);
  // An automatic decline because the item went to someone else.
  if (h.event === 'declined' && h.endedReason === 'taken') return t('hold.ev.taken', vars);
  const key = (m.mine ? MINE : OTHER)[h.event];
  return key ? t(key, vars) : m.body;
}
