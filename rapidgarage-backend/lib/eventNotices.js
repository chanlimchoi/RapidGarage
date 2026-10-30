// Neighborhood-sale notices in the bell (lib/notifications.js), so neither
// side has to keep checking the event page:
//   * organizer: a seller asked to join (approval events) or joined (open events);
//   * seller: the organizer approved, declined or removed their sale.
// The sale shows by title with its seller as "First L."; nobody's email is
// stored or shown. Each notice is written once (dedupe by participant row).
// Blocks between the two people suppress the notice.
const notifications = require('./notifications');
const ev = require('./events');

async function add(userId, kind, event, post, participant, extra) {
  if (await ev.blockedBetween(userId, kind === 'event_join' || kind === 'event_joined' ? post.userId : event.organizerId)) return 0;
  return notifications.add([{
    userId, kind, postId: post.id,
    dedupeKey: kind + ':' + event.id + ':' + participant.id + (extra && extra.at ? ':' + extra.at : ''),
    data: Object.assign({ eventId: event.id }, extra && extra.data ? extra.data : {}),
  }]);
}

const joined = (event, post, participant) => add(event.organizerId, participant.status === 'approved' ? 'event_joined' : 'event_join', event, post, participant);
const approved = (event, post, participant) => add(post.userId, 'event_approved', event, post, participant);
// A declined seller may ask again later (a new participant row); the time keeps the key unique anyway.
const removed = (event, post, participant, wasPending) => add(post.userId, 'event_removed', event, post, participant, { at: Date.now().toString(36), data: { declined: !!wasPending } });

module.exports = { joined, approved, removed };
