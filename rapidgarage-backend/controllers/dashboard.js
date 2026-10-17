// Seller dashboard (login required). Only ever about the signed-in user's own
// sales: there is no user id parameter, and a sale that isn't yours is a 404
// for everyone, admins included (admins keep their existing views, e.g. scan
// counts on the print page, but can't open another seller's dashboard).
//   GET /dashboard?tz=Area/City      totals, 14-day series, every sale (ended too)
//   GET /dashboard/sales/:id         one sale: series, open holds, conversations
const router = require('express').Router();
const models = require('../models');
const { badRequest, notFound, serverError, requireLogin, parseId } = require('../lib/http');
const dashboard = require('../lib/dashboard');

router.use(requireLogin);

router.get('/', async (req, res) => {
  try {
    const tz = typeof req.query.tz === 'string' ? req.query.tz.slice(0, 64) : null;
    return res.json(await dashboard.forSeller(req.user.id, tz));
  } catch (err) { return serverError(res, err); }
});

router.get('/sales/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'Post id must be a positive integer.');
  try {
    const post = await models.Post.findByPk(id, { include: dashboard.postInclude() });
    if (!post || post.userId !== req.user.id) return notFound(res, 'Post not found.');
    return res.json(await dashboard.forSale(req.user.id, post));
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
