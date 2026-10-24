// In-app notifications (login): GET /notifications, POST /notifications/seen { ids? }.
const router = require('express').Router();
const { badRequest, serverError, requireLogin, parseId } = require('../lib/http');
const N = require('../lib/notifications');

router.use(requireLogin);
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.get('/', async (req, res) => {
  try {
    const results = await N.list(req.user);
    return res.json({ results, unread: results.filter((n) => !n.seen).length });
  } catch (err) { return serverError(res, err); }
});

// Mark some (ids) or all of my notifications seen.
router.post('/seen', async (req, res) => {
  const b = req.body || {};
  let ids;
  if (b.ids !== undefined) {
    if (!Array.isArray(b.ids) || b.ids.length > 200) return badRequest(res, 'Invalid request.', { ids: 'ids must be a list of notification ids.' });
    ids = b.ids.map(parseId);
    if (ids.some((x) => !x)) return badRequest(res, 'Invalid request.', { ids: 'ids must be a list of notification ids.' });
  }
  try {
    const marked = await N.markSeen(req.user.id, ids);
    return res.json({ marked });
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
