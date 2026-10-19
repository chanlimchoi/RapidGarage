const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createApp } = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const alerts = require('../lib/alerts');
const schedule = require('../lib/schedule');
const seo = require('../lib/seo');
const { setSetting } = require('../lib/features');
const { NONCE_PLACEHOLDER } = require('../lib/frontend');

const PW = 'correct-horse';
const TZ = 'America/New_York';
const C = { lat: 40.7581234, lng: -73.9855678 };

function fakeBuild() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-seo-build-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><!-- rg:head -->\n<title>RapidGarage</title>\n<!-- /rg:head --><script type="module" src="/assets/a.js" nonce="${NONCE_PLACEHOLDER}"></script></head><body><div id="root"></div></body></html>`);
  fs.writeFileSync(path.join(dir, 'assets', 'a.js'), '1');
  return dir;
}

// Every JSON-LD block in a page, parsed.
const ldOf = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

describe('search engines (SEO)', function () {
  this.timeout(30000);
  let app, dir, sam;
  const today = () => schedule.localDate(new Date(), TZ);
  const day = (n) => schedule.addDays(today(), n);
  async function sale(extra) {
    const r = await sam.post('/api/post').send(Object.assign({
      title: 'Moving sale', description: 'Couch </script><b>and</b> lamps', street: '12 Hidden Ln', city: 'New York', state: 'NY', zipCode: '10036',
      priceMin: '5', priceMax: '50', schedule: { timeZone: TZ, days: [{ date: day(1), start: '09:00', end: '15:00' }, { date: day(2), start: '10:00', end: '14:00' }] },
    }, extra));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    await alerts.idle();
    return r.body;
  }
  const page = async (p) => request(app).get(p).set('Accept', 'text/html');

  before(() => {
    dir = fakeBuild();
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    geo.setProvider(async () => ({ status: 'ok', lat: C.lat, lng: C.lng }));
  });
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.APP_BASE_URL;
    geo.setProvider(null);
  });
  beforeEach(async () => {
    process.env.APP_BASE_URL = 'https://garage.example';
    geo.resetRateLimits();
    seo.clearCache();
    app = createApp(Object.assign({}, process.env, { NODE_ENV: 'test', SESSION_SECRET: 'test-secret', SERVE_FRONTEND_DIR: dir, FRONTEND_ORIGIN: '' }));
    await models.sequelize.sync({ force: true });
    sam = request.agent(app);
    assert.strictEqual((await sam.post('/api/signup').send({ email: 'sam@seo.example', password: PW, firstName: 'Sam', lastName: 'Seller' })).status, 201);
  });

  it('describes a sale as schema.org SaleEvents, one per remaining day, without the street', async () => {
    const post = await sale();
    const r = await page('/post/' + post.id);
    assert.strictEqual(r.status, 200);
    const [ld] = ldOf(r.text);
    assert.strictEqual(ld['@context'], 'https://schema.org');
    const events = ld['@graph'];
    assert.strictEqual(events.length, 2);
    const e = events[0];
    assert.strictEqual(e['@type'], 'SaleEvent');
    assert.strictEqual(e.name, 'Moving sale');
    assert.strictEqual(e.url, 'https://garage.example/post/' + post.id);
    assert.ok(new Date(e.startDate) < new Date(e.endDate));
    assert.deepStrictEqual(e.location.address, { '@type': 'PostalAddress', addressCountry: 'US', addressLocality: 'New York', addressRegion: 'NY', postalCode: '10036' });
    assert.deepStrictEqual(e.location.geo, { '@type': 'GeoCoordinates', latitude: 40.76, longitude: -73.99 }, 'rounded to ~1 km');
    assert.deepStrictEqual([e.offers['@type'], e.offers.lowPrice, e.offers.highPrice, e.offers.priceCurrency], ['AggregateOffer', '5', '50', 'USD']);
    assert.ok(/^https:\/\/garage\.example\/api\/share\/image\/post\//.test(e.image[0]));
    assert.ok(!r.text.includes('Hidden Ln'), 'no street address');
    assert.ok(!r.text.includes('Seller'), 'no last name');
    // A description can't close the script tag.
    const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(r.text)[1];
    assert.ok(!block.includes('</script>') && !block.includes('<b>'));
  });

  it('adds hreflang alternates and the WebSite block on the home page', async () => {
    const r = await page('/');
    for (const l of ['en', 'es', 'ko', 'zh-CN', 'x-default']) assert.ok(r.text.includes('hreflang="' + l + '"'), l);
    assert.ok(r.text.includes('<link rel="alternate" hreflang="ko" href="https://garage.example/?lang=ko">'));
    const [ld] = ldOf(r.text);
    assert.strictEqual(ld['@type'], 'WebSite');
    assert.strictEqual(ld.url, 'https://garage.example/');
  });

  it('keeps private pages and unavailable sales out of the index', async () => {
    for (const p of ['/admin', '/settings', '/messages/3', '/login', '/reset-password', '/post/1/edit', '/events/new']) {
      const r = await page(p);
      assert.strictEqual(r.headers['x-robots-tag'], 'noindex', p);
      assert.ok(r.text.includes('<meta name="robots" content="noindex">'), p);
      assert.strictEqual(ldOf(r.text).length, 0, p);
    }
    const hidden = await sale({ title: 'Secret' });
    await models.Post.update({ hidden: true }, { where: { id: hidden.id } });
    const h = await page('/post/' + hidden.id);
    assert.ok(h.text.includes('noindex'));
    assert.strictEqual(ldOf(h.text).length, 0);
    assert.strictEqual((await page('/post/' + (await sale()).id)).headers['x-robots-tag'], undefined);
    assert.strictEqual(seo.isPrivate('/events/12'), false);
    assert.strictEqual(seo.isPrivate('/wanted/12/edit'), true);
  });

  it('serves robots.txt with the sitemap location', async () => {
    const r = await request(app).get('/robots.txt');
    assert.strictEqual(r.status, 200);
    assert.ok(/text\/plain/.test(r.headers['content-type']));
    assert.ok(r.text.includes('Disallow: /admin'));
    assert.ok(r.text.includes('Disallow: /api/'));
    assert.ok(r.text.includes('Allow: /api/share/image/'));
    assert.ok(r.text.includes('Sitemap: https://garage.example/sitemap.xml'));
  });

  it('lists only public, current items in sitemap.xml', async () => {
    const live = await sale({ title: 'Live' });
    const hidden = await sale({ title: 'Hidden' });
    await models.Post.update({ hidden: true }, { where: { id: hidden.id } });
    const ended = await sale({ title: 'Ended', schedule: { timeZone: TZ, days: [{ date: day(1), start: '09:00', end: '10:00' }] } });
    await models.SaleDay.update({ startsAt: new Date(Date.now() - 3 * 3600000), endsAt: new Date(Date.now() - 2 * 3600000) }, { where: { postId: ended.id } });
    await models.Post.update({ endDate: new Date(Date.now() - 2 * 3600000), startDate: new Date(Date.now() - 3 * 3600000) }, { where: { id: ended.id } });
    const r = await request(app).get('/sitemap.xml');
    assert.strictEqual(r.status, 200);
    assert.ok(/application\/xml/.test(r.headers['content-type']));
    const locs = [...r.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.ok(locs.includes('https://garage.example/'));
    assert.ok(locs.includes('https://garage.example/events'));
    assert.ok(locs.includes('https://garage.example/wanted'));
    assert.ok(locs.includes('https://garage.example/post/' + live.id));
    assert.ok(!locs.includes('https://garage.example/post/' + hidden.id), 'hidden');
    assert.ok(!locs.includes('https://garage.example/post/' + ended.id), 'ended');
    await setSetting('wantedPosts', false);
    seo.clearCache();
    assert.ok(!(await request(app).get('/sitemap.xml')).text.includes('/wanted<'), 'wanted board off');
  });

  it('free sales get a zero-price Offer; sales without prices get none', async () => {
    const free = await sale({ priceMin: null, priceMax: null, isFree: true });
    const e = ldOf((await page('/post/' + free.id)).text)[0]['@graph'][0];
    assert.deepStrictEqual([e.offers['@type'], e.offers.price], ['Offer', '0']);
    const none = await sale({ priceMin: null, priceMax: null, schedule: { timeZone: TZ, days: [{ date: day(1), start: '09:00', end: '15:00' }] } });
    const one = ldOf((await page('/post/' + none.id)).text)[0];
    assert.strictEqual(one['@type'], 'SaleEvent', 'a single day is not wrapped in @graph');
    assert.strictEqual(one.offers, undefined);
  });
});
