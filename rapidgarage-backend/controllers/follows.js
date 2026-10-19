// Following sellers (lib/follows.js).
//   GET    /follows                 people I follow { results: [{ seller, notify, currentSales, since }] }
//   GET    /follows/:sellerId       { following, notify, followers } (logged out: following=false)
//   PUT    /follows/:sellerId       { notify? }  follow, or change the email switch
//   DELETE /follows/:sellerId       unfollow
//   POST   /follows/unsubscribe     { f, t } one-click from the email (no login)
// Their sales: GET /allPosts?following=1.
const router = require('express').Router();
const F = require('../lib/follows');
const { badRequest, forbidden, notFound, conflict, sendError, serverError, requireLogin, parseId } = require('../lib/http');

router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.post('/unsubscribe', async (req, res) => {
  const body = req.body || {};
  const id = parseId(body.f !== undefined ? body.f : req.query.f);
  const token = body.t !== undefined ? body.t : req.query.t;
  if (!F.verifyToken(id || 0, token) || !id) return sendError(res, 400, 'invalid_token', 'This unsubscribe link is invalid.');
  try {
    const row = await F.turnOff(id);
    if (!row) return res.json({ ok: true, gone: true });
    return res.json({ ok: true, seller: require('../lib/people').publicUser(row.seller) });
  } catch (err) { return serverError(res, err); }
});

router.get('/:sellerId', async (req, res) => {
  const sellerId = parseId(req.params.sellerId);
  if (!sellerId) return notFound(res, 'User not found.');
  try { return res.json(await F.status(req.user ? req.user.id : null, sellerId)); } catch (err) { return serverError(res, err); }
});

router.use(requireLogin);

router.get('/', async (req, res) => {
  try { return res.json({ results: await F.list(req.user.id) }); } catch (err) { return serverError(res, err); }
});

router.put('/:sellerId', async (req, res) => {
  const sellerId = parseId(req.params.sellerId);
  if (!sellerId) return notFound(res, 'User not found.');
  const body = req.body || {};
  if (body.notify !== undefined && typeof body.notify !== 'boolean') return badRequest(res, 'Invalid request.', { notify: 'notify must be true or false.' });
  try {
    const out = await F.follow(req.user.id, sellerId, body.notify);
    if (out.reason === 'self') return badRequest(res, "You can't follow yourself.");
    if (out.reason === 'not_found') return notFound(res, 'User not found.');
    if (out.reason === 'blocked') return forbidden(res, "You can't follow this person.");
    if (out.reason === 'limit') return conflict(res, 'You follow the maximum number of people. Unfollow someone first.');
    return res.json(await F.status(req.user.id, sellerId));
  } catch (err) { return serverError(res, err); }
});

router.delete('/:sellerId', async (req, res) => {
  const sellerId = parseId(req.params.sellerId);
  if (!sellerId) return notFound(res, 'User not found.');
  try {
    await F.unfollow(req.user.id, sellerId);
    return res.json(await F.status(req.user.id, sellerId));
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
