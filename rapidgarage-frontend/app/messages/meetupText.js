// Localized wording for meetup suggestions in a conversation (message.kind 'meetup').
import { t } from '../i18n/index.js';
import { holdTime } from './holdText.js';

export const KINDS = ['police', 'library', 'store', 'community', 'other'];
const KIND_KEY = {
  police: 'meet.kind.police', library: 'meet.kind.library', store: 'meet.kind.store', community: 'meet.kind.community', other: 'meet.kind.other',
};
export const kindLabel = (k) => t(KIND_KEY[k] || 'meet.kind.custom');
// The meeting time, in the viewer's language and zone ("Sat, Oct 24, 9:30 AM").
export const meetTime = (v) => holdTime(v);

const STATUS = {
  accepted: 'meet.status.accepted', declined: 'meet.status.declined', countered: 'meet.status.countered',
  cancelled: 'meet.status.cancelled', expired: 'meet.status.expired',
};
// Status chip for a suggestion card.
export function statusText(p, other) {
  if (p.status === 'pending') return p.mine ? t('meet.status.waitingFor', { name: other }) : t('meet.status.waitingForYou');
  if (p.status === 'cancelled' && p.endedReason === 'blocked') return t('meet.status.ended');
  return STATUS[p.status] ? t(STATUS[p.status]) : '';
}

const EV_MINE = {
  proposed: 'meet.ev.proposed.mine', countered: 'meet.ev.countered.mine', accepted: 'meet.ev.accepted.mine',
  declined: 'meet.ev.declined.mine', cancelled: 'meet.ev.cancelled.mine',
};
const EV_OTHER = {
  proposed: 'meet.ev.proposed.other', countered: 'meet.ev.countered.other', accepted: 'meet.ev.accepted.other',
  declined: 'meet.ev.declined.other', cancelled: 'meet.ev.cancelled.other',
};

// One-line text for an event (the thread's small event rows and the inbox preview).
// m: a message with m.meetup = { event, mine?, place: { name }, meetAt }.
export function meetupEventText(m, other) {
  const p = m.meetup || {};
  const vars = { place: (p.place && p.place.name) || t('meet.aPlace'), time: p.meetAt ? meetTime(p.meetAt) : '', name: other };
  if (p.event === 'expired') return t('meet.ev.expired', vars);
  const key = (m.mine ? EV_MINE : EV_OTHER)[p.event];
  // Names are "First L.", so a sentence ending in one would read "Alex R..".
  return key ? t(key, vars).replace(/\.\.$/, '.') : m.body;
}

// The latest agreed meetup still ahead, for the banner under the thread header.
export function upcomingAgreed(messages, now) {
  const at = now || new Date();
  const seen = new Map();
  (messages || []).forEach((m) => { if (m.kind === 'meetup' && m.meetup && m.meetup.id) seen.set(m.meetup.id, m.meetup); });
  return Array.from(seen.values())
    .filter((p) => p.status === 'accepted' && p.meetAt && new Date(p.meetAt) > at)
    .sort((a, b) => new Date(a.meetAt) - new Date(b.meetAt))[0] || null;
}

// After new messages arrive, every card about the same suggestion shows its newest status.
export function syncMeetups(messages) {
  const latest = new Map();
  messages.forEach((m) => { if (m.kind === 'meetup' && m.meetup && m.meetup.id && m.meetup.status) latest.set(m.meetup.id, m.meetup); });
  return messages.map((m) => {
    if (m.kind !== 'meetup' || !m.meetup) return m;
    const l = latest.get(m.meetup.id);
    return l && l !== m.meetup && l.status !== m.meetup.status ? Object.assign({}, m, { meetup: Object.assign({}, l, { event: m.meetup.event }) }) : m;
  });
}
