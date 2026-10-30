// Morning-of reminders (lib/reminders.js).
//   GET  /reminders/today        today's in-app notices for me
//   POST /reminders/:id/seen     dismiss one
//   GET  /reminders/settings     { defaultOn, emailAvailable, hour }
//   PUT  /reminders/settings     { defaultOn, applyToSaved? }
//   POST /reminders/unsubscribe  { r, t } one-click from the email (no login)
// Per sale: PUT /saved/:postId/reminder (controllers/saved.js).
const router = require('express').Router();
const models = require('../models');
const { badRequest, notFound, sendError, serverError, requireLogin, parseId } = require('../lib/http');
const mailer = require('../lib/mailer');
const R = require('../lib/reminders');

router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Same contract as the other unsubscribe links: the token is checked before
// any lookup and every invalid request gets the same 400.
router.post('/unsubscribe', async (req, res) => {
  const body = req.body || {};
  const id = parseId(body.r !== undefined ? body.r : req.query.r);
  const token = body.t !== undefined ? body.t : req.query.t;
  if (!R.verifyToken(id || 0, token) || !id) return sendError(res, 400, 'invalid_token', 'This unsubscribe link is invalid.');
  try {
    await R.turnOffAll(id);
    return res.json({ ok: true, reminders: false });
  } catch (err) { return serverError(res, err); }
});

router.use(requireLogin);

router.get('/today', async (req, res) => {
  try { return res.json({ results: await R.notices(req.user) }); } catch (err) { return serverError(res, err); }
});

router.post('/:id/seen', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return notFound(res, 'Reminder not found.');
  try {
    const [n] = await models.SaleReminder.update({ seenAt: new Date() }, { where: { id, userId: req.user.id } });
    if (!n) return notFound(res, 'Reminder not found.');
    return res.json({ ok: true });
  } catch (err) { return serverError(res, err); }
});

const settings = (user) => ({ defaultOn: !!user.remindSaved, emailAvailable: mailer.isConfigured(), hour: R.reminderHour(),
  // Night-before reminder in the bell / push (lib/eveReminders.js).
  nightBefore: user.remindEve !== false, eveHour: require('../lib/eveReminders').eveHour() });

router.get('/settings', (req, res) => res.json(settings(req.user)));

router.put('/settings', async (req, res) => {
  const body = req.body || {};
  if (body.nightBefore !== undefined && typeof body.nightBefore !== 'boolean') return badRequest(res, 'Invalid reminder settings.', { nightBefore: 'nightBefore must be true or false.' });
  // Only the night-before switch: { nightBefore }.
  if (body.defaultOn === undefined && typeof body.nightBefore === 'boolean') {
    try {
      const user = await models.User.findByPk(req.user.id);
      await user.update({ remindEve: body.nightBefore });
      return res.json(Object.assign(settings(user), { changed: 0 }));
    } catch (err) { return serverError(res, err); }
  }
  if (typeof body.defaultOn !== 'boolean') return badRequest(res, 'Invalid reminder settings.', { defaultOn: 'defaultOn must be true or false.' });
  if (body.applyToSaved !== undefined && typeof body.applyToSaved !== 'boolean') return badRequest(res, 'Invalid reminder settings.', { applyToSaved: 'applyToSaved must be true or false.' });
  try {
    const user = await models.User.findByPk(req.user.id);
    await user.update(Object.assign({ remindSaved: body.defaultOn }, typeof body.nightBefore === 'boolean' ? { remindEve: body.nightBefore } : {}));
    let changed = 0;
    if (body.applyToSaved) [changed] = await models.SavedPost.update({ remind: body.defaultOn }, { where: { userId: user.id } });
    return res.json(Object.assign(settings(user), { changed }));
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
