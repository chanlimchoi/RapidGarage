// POST /meetups/:id/accept    the recipient agrees
// POST /meetups/:id/decline   the recipient says no
// POST /meetups/:id/counter   the recipient suggests another place/time
//                             ({ spotId | place, meetAt, note? }, as when suggesting)
// POST /meetups/:id/cancel    the proposer withdraws a pending suggestion, or
//                             either person calls off an accepted meetup
// Suggestions are made inside a conversation: POST /conversations/:id/meetups.
// Only the two participants can see or act on one (everyone else: 404).
const router = require('express').Router();
const models = require('../models');
const { badRequest, notFound, sendError, serverError, requireLogin, parseId } = require('../lib/http');
const meetups = require('../lib/meetups');
const msg = require('../lib/messaging');

router.use(requireLogin);
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

async function load(req, res, next) {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Meetup id must be a positive integer.');
  try {
    await meetups.sweep();
    const p = await models.MeetupProposal.findByPk(id);
    if (!p || (p.proposerId !== req.user.id && p.recipientId !== req.user.id)) return notFound(res, 'Meetup suggestion not found.');
    req.meetup = p;
    return next();
  } catch (err) { return serverError(res, err); }
}
const closed = (res) => sendError(res, 409, 'meetup_closed', 'This meetup suggestion is no longer open.');

async function canAct(req, res) {
  if (req.user.messagingBanned) { sendError(res, 403, 'messaging_banned', 'A moderator has turned off messaging for your account. You can still read your conversations.'); return false; }
  const p = req.meetup;
  const other = p.proposerId === req.user.id ? p.recipientId : p.proposerId;
  const b = await msg.blockState(req.user.id, other);
  if (b.byMe || b.byThem) { sendError(res, 403, 'blocked', "You can't message this person."); return false; }
  return true;
}

// Move from one status to another atomically and post the event.
async function move(req, res, from, to, event) {
  const p = req.meetup;
  if (from.indexOf(p.status) === -1) return closed(res);
  if (!(await canAct(req, res))) return undefined;
  const [changed] = await models.MeetupProposal.update({ status: to, respondedAt: meetups.now() }, { where: { id: p.id, status: p.status } });
  if (!changed) return closed(res);
  await p.reload();
  await meetups.postEvent(p, event, req.user.id);
  return res.json(meetups.proposalJSON(p, req.user.id));
}
const recipientOnly = (req, res, next) => (req.meetup.recipientId === req.user.id ? next() : sendError(res, 403, 'forbidden', 'Only the person it was suggested to can answer it.'));

router.post('/:id/accept', load, recipientOnly, (req, res) => move(req, res, ['pending'], 'accepted', 'accepted').catch((err) => serverError(res, err)));
router.post('/:id/decline', load, recipientOnly, (req, res) => move(req, res, ['pending'], 'declined', 'declined').catch((err) => serverError(res, err)));
router.post('/:id/cancel', load, (req, res) => {
  const p = req.meetup;
  // A pending suggestion is withdrawn by its proposer (the other person declines instead).
  if (p.status === 'pending' && p.proposerId !== req.user.id) return sendError(res, 403, 'forbidden', 'Only the person who suggested it can withdraw it. You can decline it instead.');
  return move(req, res, ['pending', 'accepted'], 'cancelled', 'cancelled').catch((err) => serverError(res, err));
});

router.post('/:id/counter', load, recipientOnly, async (req, res) => {
  const p = req.meetup;
  try {
    if (p.status !== 'pending') return closed(res);
    const t = meetups.now();
    const { errors, values } = await meetups.parseProposal(req.body, t);
    if (Object.keys(errors).length) return badRequest(res, 'Invalid meetup suggestion.', errors);
    if (!(await canAct(req, res))) return undefined;
    const [changed] = await models.MeetupProposal.update({ status: 'countered', respondedAt: t }, { where: { id: p.id, status: 'pending' } });
    if (!changed) return closed(res);
    const next = await models.MeetupProposal.create(Object.assign(values, {
      conversationId: p.conversationId, proposerId: req.user.id, recipientId: p.proposerId, status: 'pending', timeZone: p.timeZone, counterOfId: p.id,
    }));
    await meetups.postEvent(next, 'countered', req.user.id);
    return res.status(201).json(meetups.proposalJSON(next, req.user.id));
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
