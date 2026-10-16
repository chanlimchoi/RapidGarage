const router = require('express').Router();
const { unauthorized } = require('../lib/http');

// The server is the source of truth for who is logged in.
router.get('/', (req, res) => {
  if (!req.user) return unauthorized(res, 'Not logged in.');
  return res.json({ user: req.user.toJSON ? req.user.toJSON() : req.user });
});

module.exports = router;
