// GET /s/:code — the URL inside printed QR codes. Counts the scan (see
// lib/scans.js) and redirects to the post. Unknown, malformed and hidden
// posts get the same "not available" page, so the link can't be used to tell
// them apart. Ended sales still redirect (the post page says it ended).
const router = require('express').Router();
const i18n = require('../lib/i18n');
const crypto = require('crypto');
const models = require('../models');
const links = require('../lib/shortlinks');
const scans = require('../lib/scans');

// Light brake on guessing: 30 misses per 10 minutes per (hashed) client.
const MISS_WINDOW_MS = 10 * 60 * 1000;
const MISS_MAX = 30;
const missKey = crypto.randomBytes(32);
const misses = new Map();
function missed(req) {
  const k = crypto.createHmac('sha256', missKey).update(scans.clientIp(req)).digest('base64url');
  const now = Date.now();
  const e = misses.get(k);
  if (!e || now - e.start > MISS_WINDOW_MS) { misses.set(k, { start: now, n: 1 }); return 1; }
  e.n += 1;
  if (misses.size > 10000) for (const [key, v] of misses) if (now - v.start > MISS_WINDOW_MS) misses.delete(key);
  return e.n;
}
function tooMany(req) {
  const k = crypto.createHmac('sha256', missKey).update(scans.clientIp(req)).digest('base64url');
  const e = misses.get(k);
  return !!e && Date.now() - e.start <= MISS_WINDOW_MS && e.n >= MISS_MAX;
}
function resetMisses() { misses.clear(); }

// Small HTML pages for people who scanned a printed QR code, in their phone's language.
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function page(res, status, titleKey, textKey) {
  const lang = i18n.requestLang(res.req);
  const title = escHtml(i18n.t(lang, titleKey));
  const text = escHtml(i18n.t(lang, textKey));
  const home = links.baseUrl() + '/';
  res.vary('Accept-Language');
  res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' });
  return res.send('<!doctype html><html lang="' + lang + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="robots" content="noindex"><title>' + title + ' · RapidGarage</title><style>'
    + 'body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#faf9f7;color:#1c1917;display:grid;place-items:center;min-height:100vh}'
    + 'main{max-width:420px;padding:32px;text-align:center}.brand{color:#c2410c;font-weight:800;font-size:20px;letter-spacing:-.02em}'
    + 'h1{font-size:24px;margin:24px 0 8px}p{color:#57534e;line-height:1.5}a.btn{display:inline-block;margin-top:16px;background:#c2410c;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600}'
    + '</style></head><body><main><div class="brand">RapidGarage</div><h1>' + title + '</h1><p>' + text + '</p><a class="btn" href="' + home + '">' + escHtml(i18n.t(lang, 'page.findSales')) + '</a></main></body></html>');
}

const unavailable = (res) => page(res, 404, 'page.unavailableTitle', 'page.unavailableText');

router.get('/:code', async (req, res) => {
  if (tooMany(req)) { res.set('Retry-After', '600'); return page(res, 429, 'page.tooManyTitle', 'page.tooManyText'); }
  const code = links.normalize(req.params.code);
  try {
    const post = code ? await models.Post.findOne({ where: { shortCode: code }, attributes: ['id', 'userId', 'hidden', 'timeZone'] }) : null;
    if (!post || post.hidden) { missed(req); return unavailable(res); }
    try { await scans.record(req, post); } catch (err) { console.error('scan count failed', err && err.message); }
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' });
    return res.redirect(302, links.postUrl(post.id));
  } catch (err) {
    console.error(err);
    return page(res, 500, 'page.errorTitle', 'page.errorText');
  }
});

module.exports = router;
module.exports.resetMisses = resetMisses;
