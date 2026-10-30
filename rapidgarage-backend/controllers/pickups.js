// GET /pickups/upcoming : my upcoming pickups (as seller or buyer) for the dashboard.
const router = require('express').Router();
const models = require('../models');
const pickups = require('../lib/pickups');
const holds = require('../lib/holds');
const { publicUser } = require('../lib/people');
const { serverError, requireLogin } = require('../lib/http');

router.use(requireLogin, (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/upcoming', async (req, res) => {
  const me = req.user.id;
  try {
    await holds.sweep();
    const t = holds.now();
    const rows = await pickups.upcomingFor(me, t);
    const posts = new Map((await models.Post.findAll({ where: { id: rows.map((r) => r.plan.postId) }, attributes: ['id', 'title'] })).map((p) => [p.id, p]));
    const otherIds = rows.map((r) => (r.plan.sellerId === me ? r.plan.buyerId : r.plan.sellerId));
    const people = new Map((await models.User.findAll({ where: { id: otherIds }, attributes: ['id', 'firstName', 'lastName'] })).map((u) => [u.id, u]));
    return res.json({
      results: rows.map((r) => {
        const otherId = r.plan.sellerId === me ? r.plan.buyerId : r.plan.sellerId;
        const post = posts.get(r.plan.postId);
        return Object.assign(pickups.planJSON(r.plan, me, t), {
          items: r.items,
          post: post ? { id: post.id, title: post.title } : null,
          other: people.get(otherId) ? publicUser(people.get(otherId)) : null,
        });
      }),
    });
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
