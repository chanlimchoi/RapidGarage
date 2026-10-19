// GET /live  Server-Sent Events stream of small "something changed" events for
// the logged-in user (lib/live.js): badges, message { conversationId }.
const router = require('express').Router();
const live = require('../lib/live');
const { sendError, requireLogin } = require('../lib/http');

router.get('/', requireLogin, (req, res) => {
  if (!live.connect(req.user.id, req, res)) {
    res.set('Retry-After', '30');
    return sendError(res, 503, 'overloaded', 'The server is busy. Please try again in a few seconds.');
  }
  return undefined;
});

module.exports = router;
