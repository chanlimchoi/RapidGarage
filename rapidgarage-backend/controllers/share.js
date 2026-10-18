// Link previews (lib/share.js).
//   GET /share/head?path=/post/12&lang=ko   { lang, head } — the <head> tags
//       for a page, for servers that don't render them themselves (the Vite
//       preview/dev plugin, rapidgarage-frontend/share/vite-plugin.js).
//   GET /share/image/site.png                the generic card
//   GET /share/image/:kind/:id.(png|jpg)     a sale / neighborhood sale / wanted image
// Everything here is public and shows only what lib/share.js allows; hidden or
// ended items answer with the generic preview, never a 404 that would confirm
// they exist.
const router = require('express').Router();
const share = require('../lib/share');
const { badRequest, serverError } = require('../lib/http');

router.get('/head', async (req, res) => {
  const p = typeof req.query.path === 'string' ? req.query.path : '';
  if (!p.startsWith('/') || p.length > 300) return badRequest(res, 'path must be a site path.');
  try {
    const out = await share.headFor(p, req);
    res.set('Cache-Control', 'no-cache');
    res.set('Vary', 'Accept-Language');
    return res.json({ lang: out.lang, head: out.head, generic: out.preview.generic });
  } catch (err) { return serverError(res, err); }
});

async function sendImage(req, res, target) {
  const { lang } = share.langOf(req);
  const p = await share.previewFor(target, lang);
  const buf = await share.imageFor(p);
  res.type(buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : 'image/png');
  // ?v= is the content key: an exact match can be cached long; anything else
  // (old links, no v) briefly, so a changed sale shows its new card soon.
  res.set('Cache-Control', req.query.v === p.imageKey ? 'public, max-age=604800' : 'public, max-age=300');
  res.set('Vary', 'Accept-Language');
  // Public preview images: chat apps' web clients may embed them from their own origin.
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return res.send(buf);
}

router.get('/image/site.png', (req, res) => sendImage(req, res, null).catch((err) => serverError(res, err)));

const KINDS = ['post', 'event', 'wanted'];
router.get('/image/:kind/:file', (req, res) => {
  const m = /^(\d{1,12})\.(png|jpg)$/.exec(req.params.file || '');
  if (KINDS.indexOf(req.params.kind) === -1 || !m) return badRequest(res, 'Unknown preview image.');
  return sendImage(req, res, { kind: req.params.kind, id: Number(m[1]) }).catch((err) => serverError(res, err));
});

module.exports = router;
