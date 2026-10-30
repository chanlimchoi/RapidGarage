// Localized wording for pickup scheduling (message.kind 'pickup'; backend lib/pickups.js).
import { t, intlLocale } from '../i18n/index.js';
import { holdTime } from './holdText.js';

const endTime = (v) => new Date(v).toLocaleTimeString(intlLocale(), { hour: 'numeric', minute: '2-digit' });
// "Sat, Nov 1, 9:00 AM – 9:30 AM" in the viewer's language and zone.
export const slotText = (s) => (s && s.start ? t('pickup.slot', { start: holdTime(s.start), end: s.end ? endTime(s.end) : '' }).replace(/\s*[–-]\s*$/, '') : '');

const MINE = {
  offered: 'pickup.ev.offered.mine', rescheduled: 'pickup.ev.rescheduled.mine', booked: 'pickup.ev.booked.mine',
  reschedule: 'pickup.ev.reschedule.mine', cancelled: 'pickup.ev.cancelled.mine',
};
const OTHER = {
  offered: 'pickup.ev.offered.other', rescheduled: 'pickup.ev.rescheduled.other', booked: 'pickup.ev.booked.other',
  reschedule: 'pickup.ev.reschedule.other', cancelled: 'pickup.ev.cancelled.other',
};

// One line for a pickup event (thread rows and the inbox preview).
export function pickupEventText(m, other) {
  const p = m.pickup || {};
  const key = (m.mine ? MINE : OTHER)[p.event];
  if (!key) return m.body || '';
  // Names are "First L.", so a sentence ending in one would read "Alex R..".
  return t(key, { name: other, time: p.start ? holdTime(p.start) : '' }).replace(/\.\.$/, '.');
}

// What the pickup card says about where things stand, for this viewer.
// plan: planJSON from the API; other: the other person's name.
export function pickupStatus(plan, other) {
  if (!plan) return '';
  if (plan.status === 'cancelled') return t('pickup.cancelledNote');
  if (plan.status === 'booked') return t('pickup.bookedFor', { time: slotText(plan.chosen) });
  return plan.role === 'buyer' ? t('pickup.pickOne') : t('pickup.waiting', { name: other }).replace(/\.\.$/, '.');
}

// Offered slots still in the future.
export const openSlots = (plan) => (plan && plan.slots ? plan.slots.filter((s) => !s.past) : []);
