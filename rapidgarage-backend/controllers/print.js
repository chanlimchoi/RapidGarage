// Print assets and scan stats for a post (mounted at /post/:id/print after
// requireLogin + loadPost, so req.post is set and visible to req.user).
//   GET /            { code, shortUrl, hidden, canPrint, scans: { total, today, days } }  owner or admin
//   GET /qr.png      ?size=256..2048&download=1                                         owner
//   GET /qr.svg      ?download=1                                                        owner
//   GET /flyer.pdf   ?layout=letter|half|sign&arrow=none|left|right&headline=garage|yard|moving|estate
//                    &photo=0|1&items=0|1&download=1                                    owner
// Print assets are refused (409) while a moderator has the post hidden: the
// short link would only show "not available".
const router = require('express').Router();
const sharp = require('sharp');
const { badRequest, forbidden, sendError, serverError } = require('../lib/http');
const { isAdmin } = require('../lib/roles');
const links = require('../lib/shortlinks');
const scans = require('../lib/scans');
const flyer = require('../lib/flyer');
const { getStorage } = require('../lib/storage');

const isOwner = (req) => req.post.userId === req.user.id;

function ownerOnly(req, res, next) {
  if (!isOwner(req)) return forbidden(res, 'Only the seller can print flyers for this sale.');
  if (req.post.hidden) return sendError(res, 409, 'hidden', 'A moderator has hidden this sale, so its QR code shows "not available". Printing is turned off until it is visible again.');
  return next();
}

function slug(post) {
  return String(post.title || 'sale').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'sale';
}

function sendFile(req, res, type, name, body) {
  res.set({ 'Content-Type': type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  res.set('Content-Disposition', (req.query.download === '1' ? 'attachment' : 'inline') + '; filename="' + name + '"');
  return res.send(body);
}

router.get('/', async (req, res) => {
  if (!isOwner(req) && !isAdmin(req.user)) return forbidden(res, 'Only the seller and admins can see scan counts.');
  try {
    const code = await links.ensureCode(req.post);
    const stats = await scans.stats(req.post, 30);
    return res.json({ postId: req.post.id, code, shortUrl: links.shortUrl(code), hidden: !!req.post.hidden, canPrint: isOwner(req) && !req.post.hidden, scans: stats });
  } catch (err) { return serverError(res, err); }
});

router.get('/qr.png', ownerOnly, async (req, res) => {
  const size = req.query.size === undefined ? 1024 : Number(req.query.size);
  if (!Number.isInteger(size) || size < 256 || size > 2048) return badRequest(res, 'size must be a whole number from 256 to 2048.');
  try {
    const url = links.shortUrl(await links.ensureCode(req.post));
    return sendFile(req, res, 'image/png', 'rapidgarage-' + slug(req.post) + '-qr.png', await flyer.qrPng(url, size));
  } catch (err) { return serverError(res, err); }
});

router.get('/qr.svg', ownerOnly, async (req, res) => {
  try {
    const url = links.shortUrl(await links.ensureCode(req.post));
    return sendFile(req, res, 'image/svg+xml', 'rapidgarage-' + slug(req.post) + '-qr.svg', await flyer.qrSvg(url));
  } catch (err) { return serverError(res, err); }
});

async function firstPhoto(post) {
  const p = (post.photos || []).slice().sort((a, b) => a.position - b.position)[0];
  if (!p) return null;
  try {
    const raw = await getStorage().read(p.storageKey);
    return await sharp(raw).rotate().resize(1200, 900, { fit: 'cover' }).jpeg({ quality: 82 }).toBuffer();
  } catch (err) { return null; } // a missing file just means no photo on the flyer
}

router.get('/flyer.pdf', ownerOnly, async (req, res) => {
  const q = req.query;
  const layout = q.layout === undefined ? 'letter' : q.layout;
  const arrow = q.arrow === undefined ? 'none' : q.arrow;
  const headline = q.headline === undefined ? 'garage' : q.headline;
  const errors = {};
  if (flyer.LAYOUTS.indexOf(layout) === -1) errors.layout = 'layout must be one of: ' + flyer.LAYOUTS.join(', ') + '.';
  if (flyer.ARROWS.indexOf(arrow) === -1) errors.arrow = 'arrow must be one of: ' + flyer.ARROWS.join(', ') + '.';
  if (!flyer.HEADLINES[headline]) errors.headline = 'headline must be one of: ' + Object.keys(flyer.HEADLINES).join(', ') + '.';
  ['photo', 'items'].forEach((k) => { if (q[k] !== undefined && q[k] !== '0' && q[k] !== '1') errors[k] = k + ' must be 0 or 1.'; });
  if (Object.keys(errors).length) return badRequest(res, 'Invalid print options.', errors);
  try {
    const url = links.shortUrl(await links.ensureCode(req.post));
    const post = req.post;
    const photo = layout !== 'sign' && q.photo !== '0' ? await firstPhoto(post) : null;
    const pdf = await flyer.buildPdf(post, { layout, arrow, headline, photo, url, noItems: q.items === '0' });
    const kind = layout === 'sign' ? 'sign' : layout === 'half' ? 'half-page-flyer' : 'flyer';
    return sendFile(req, res, 'application/pdf', 'rapidgarage-' + slug(post) + '-' + kind + '.pdf', pdf);
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
