// Search engines (lib/seo.js).
//   GET /robots.txt    crawl rules + sitemap location
//   GET /sitemap.xml   public sales, neighborhood sales and wanted posts (cached 10 min)
const router = require('express').Router();
const seo = require('../lib/seo');
const { serverError } = require('../lib/http');

router.get('/robots.txt', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('text/plain').send(seo.robotsTxt());
});

router.get('/sitemap.xml', async (req, res) => {
  try {
    const xml = await seo.sitemapXml();
    res.set('Cache-Control', 'public, max-age=600');
    return res.type('application/xml').send(xml);
  } catch (err) { return serverError(res, err); }
});

module.exports = router;
