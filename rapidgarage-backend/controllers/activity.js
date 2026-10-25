// POST /activity { kind, targetType?, targetId?, page? } : a fire-and-forget
// beacon from the app (lib/activity.js). Always 204 once valid, whether or not
// it was counted (repeats, bots, admins and owners are silently skipped).
// 404 when the target doesn't exist or is hidden; 400 for an unknown kind.
const router = require('express').Router();
const { badRequest, notFound, serverError } = require('../lib/http');
const activity = require('../lib/activity');

const loaders = { post: 1, event: 1, wanted: 1, user: 1 };

router.post('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const parsed = activity.parseBeacon(req.body);
  if (parsed.error) return badRequest(res, parsed.error);
  try {
    const what = parsed.what;
    if (loaders[what.targetType]) {
      const target = await activity.loadTarget(what.targetType, what.targetId);
      if (!target || !target.ok) return notFound(res, 'Not found.');
      what.owner = target.owner;
      what.timeZone = target.timeZone;
    }
    await activity.record(req, parsed.kind, what);
    return res.status(204).end();
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
