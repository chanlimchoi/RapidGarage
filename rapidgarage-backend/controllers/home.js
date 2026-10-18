const express = require('express');
const models = require('../models');
const { badRequest, notFound, serverError, parseId } = require('../lib/http');
const { ZIP_RE } = require('../lib/validate');
const { Op } = require('sequelize');
const { visibleWhere } = require('../lib/moderation');
const { isAdmin } = require('../lib/roles');
const { publicUser } = require('../lib/people');
const schedule = require('../lib/schedule');
const itemsLib = require('../lib/items');
const events = require('../lib/events');
const curbside = require('../lib/curbside');

// Add { event: { id, name } } to posts that are part of a neighborhood sale.
async function withEvents(list, viewer) {
  const json = list.map((p) => (typeof p.toJSON === 'function' ? p.toJSON() : p));
  const map = await events.eventsForPosts(json.map((p) => p.id), viewer);
  return json.map((p) => (map.has(p.id) ? Object.assign(p, { event: map.get(p.id) }) : p));
}

// AND a listing filter with the viewer's visibility rule (hidden posts).
// Ended sales drop out of listings, except the owner's and admins' views of a
// seller's sales, and sales whose leftovers are free on the curb right now.
const visible = (req, where, keepEnded) => ({ [Op.and]: [where || {}, visibleWhere(req.user) || {}, keepEnded ? {} : curbside.listableWhere()] });

// Drop leftovers-only listings that can't show (reported), then add `curbside`.
async function finish(req, posts, keepEnded) {
  const kept = keepEnded ? posts : await curbside.dropReportedLeftovers(posts);
  const json = await withEvents(kept, req.user);
  return curbside.annotate(json, req.user);
}

const router = express.Router();
const newestFirst = {
  include: [{ model: models.PostPhoto, as: 'photos' }, { model: models.SaleDay, as: 'saleDays' }],
  order: [['createdAt', 'DESC'], [{ model: models.PostPhoto, as: 'photos' }, 'position', 'ASC']],
};

// Destroy the passport session.
router.post('/logout', (req, res, next) => {
  req.logout();
  if (!req.session) return res.json({ success: true });
  req.session.destroy((err) => {
    if (err) return next(err);
    // Same attributes as the session cookie, or browsers keep it.
    res.clearCookie('connect.sid', { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
    return res.json({ success: true });
  });
});

// ?when=today|weekend|now narrows to sales open in that window (sale's local time).
// ?keyword= keeps sales whose title, description or an unsold item matches every word
// (each result then carries matchedItems: up to 3 matching item names).
router.get('/allPosts', async (req, res) => {
  const w = schedule.parseWhen(req.query.when);
  if (w.error) return badRequest(res, 'Invalid filter.', { when: w.error });
  const k = itemsLib.parseKeyword(req.query.keyword);
  if (k.error) return badRequest(res, 'Invalid filter.', { keyword: k.error });
  const cs = req.query.curbside;
  if (cs !== undefined && cs !== '' && ['true', '1', 'false', '0'].indexOf(cs) === -1) return badRequest(res, 'Invalid filter.', { curbside: 'curbside must be true or false.' });
  const onlyCurb = cs === 'true' || cs === '1';
  try {
    const where = onlyCurb ? Object.assign({}, curbside.activeWhere()) : null;
    let posts = await models.Post.findAll(Object.assign({ where: visible(req, where) }, newestFirst));
    if (w.when) posts = posts.filter((p) => schedule.matchesWhen(p, w.when) || curbside.countsForWhen(p, w.when));
    if (onlyCurb) posts = posts.filter((p) => !p.hidden);
    if (!k.words) { const out = await finish(req, posts); return res.json(onlyCurb ? out.filter((p) => p.curbside && p.curbside.state === 'active') : out); }
    const ids = await itemsLib.keywordPostIds(models, k.words, posts.map((p) => p.id));
    posts = posts.filter((p) => ids.has(p.id));
    const matched = await itemsLib.matchedItems(models, k.words, posts.map((p) => p.id));
    const out = await finish(req, posts);
    out.forEach((p) => { p.matchedItems = matched[p.id] || []; });
    return res.json(onlyCurb ? out.filter((p) => p.curbside && p.curbside.state === 'active') : out);
  } catch (err) { return serverError(res, err); }
});

router.get('/profile/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return badRequest(res, 'User id must be a positive integer.');
  models.User.findByPk(id)
    .then((user) => {
      if (!user) return notFound(res, 'User not found.');
      // Full profile (email etc.) only for yourself and admins; everyone else
      // gets first name + last initial.
      if (req.user && (req.user.id === user.id || isAdmin(req.user))) return res.json(user);
      return res.json(Object.assign(publicUser(user), { createdAt: user.createdAt }));
    })
    .catch((err) => serverError(res, err));
});

router.get('/all/:zipCode', (req, res) => {
  const zipCode = req.params.zipCode;
  if (!ZIP_RE.test(zipCode)) return badRequest(res, 'Zip code must be 5 digits.');
  models.Post.findAll(Object.assign({ where: visible(req, { zipCode }) }, newestFirst))
    .then((posts) => finish(req, posts))
    .then((posts) => res.json(posts))
    .catch((err) => serverError(res, err));
});

router.get('/allbyuserId/:userId', (req, res) => {
  const userId = parseId(req.params.userId);
  if (!userId) return badRequest(res, 'User id must be a positive integer.');
  const own = !!req.user && (req.user.id === userId || isAdmin(req.user));
  models.Post.findAll(Object.assign({ where: visible(req, { userId }, own) }, newestFirst))
    .then((posts) => finish(req, posts, own))
    .then((posts) => res.json(posts))
    .catch((err) => serverError(res, err));
});

// The old catch-all GET /:id (which shadowed other routes) is replaced by GET /post/:id.

module.exports = router;
