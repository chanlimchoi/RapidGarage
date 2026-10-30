// Fan-out when something happens that people should see right away: a live
// event for their open tabs (lib/live.js) and, when no tab is open, a push
// notification (lib/push.js). Never fails the action that triggered it.
const live = require('./live');
const push = require('./push');
const { publicName } = require('./people');

function models() { return require('../models'); }

// A new message (text, hold or meetup step) in a conversation.
async function messageCreated(msg) {
  const m = models();
  const conv = await m.Conversation.findByPk(msg.conversationId, { attributes: ['id', 'buyerId', 'sellerId', 'postTitle'] });
  if (!conv) return;
  const recipientId = msg.senderId === conv.buyerId ? conv.sellerId : conv.buyerId;
  // The sender's other tabs and the recipient's tabs refresh the thread and badge.
  live.emit(msg.senderId, 'message', { conversationId: conv.id });
  live.emit(recipientId, 'message', { conversationId: conv.id });
  live.emit(recipientId, 'badges', {});
  const sender = await m.User.findByPk(msg.senderId, { attributes: ['id', 'firstName', 'lastName'] });
  // Offer steps (an amount was asked, countered or accepted) use the "offers" push switch.
  if (msg.kind === 'hold' && msg.holdCents !== null && msg.holdCents !== undefined && push.OFFER_TITLES[msg.holdEvent]) {
    push.offer(recipientId, { senderName: publicName(sender), postTitle: conv.postTitle, conversationId: conv.id, event: msg.holdEvent });
    return;
  }
  push.message(recipientId, { senderName: publicName(sender), postTitle: conv.postTitle, conversationId: conv.id });
}

// Tracked with the push sends, so push.idle() covers the whole chain (tests).
function safely(fn, what) {
  return push.track(() => Promise.resolve().then(fn).catch((err) => console.error(what + ' notification failed:', err && err.message)));
}

module.exports = { messageCreated: (msg) => safely(() => messageCreated(msg), 'Message') };
