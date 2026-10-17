const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const sharp = require('sharp');
const { createApp } = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const alerts = require('../lib/alerts');
const share = require('../lib/share');
const schedule = require('../lib/schedule');
const { setSetting } = require('../lib/features');
const { setStorage } = require('../lib/storage');
const LocalStorage = require('../lib/storage/local');
const { NONCE_PLACEHOLDER } = require('../lib/frontend');
const { parseHead, validate } = require('./helpers/meta');

const PW = 'correct-horse';
const C = { lat: 40.758, lng: -73.9855 };
const TZ = 'America/New_York';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36';
const FB = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const fakeProvider = (address) => Promise.resolve(/10036/.test(address) ? { status: 'ok', lat: C.lat, lng: C.lng } : { status: 'not_found' });

// A build like Vite's: static fallback tags between rg:head markers.
function fakeBuild(markers) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-share-build-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  const head = markers
    ? '<!-- rg:head -->\n<title>RapidGarage · Garage sales near you</title>\n<meta name="description" content="static">\n<meta property="og:title" content="static">\n<!-- /rg:head -->'
    : '<title>RapidGarage</title><meta name="description" content="static">';
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8">${head}<script type="module" src="/assets/a.js" nonce="${NONCE_PLACEHOLDER}"></script></head><body><div id="root"></div></body></html>`);
  fs.writeFileSync(path.join(dir, 'assets', 'a.js'), '1');
  return dir;
}

describe('share link previews', function () {
  this.timeout(30000);
  let app, dir, cache, photos, sam, samId, bea, post;
  const env = (extra) => Object.assign({}, process.env, { NODE_ENV: 'test', SESSION_SECRET: 'test-secret', SERVE_FRONTEND_DIR: dir, FRONTEND_ORIGIN: '' }, extra || {});
  const today = () => schedule.localDate(new Date(), TZ);
  const day = (n) => schedule.addDays(today(), n);
  async function user(email, firstName, lastName) {
    const agent = request.agent(app);
    const r = await agent.post('/api/signup').send({ email, password: PW, firstName, lastName });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return [agent, r.body.id];
  }
  async function sale(extra) {
    const r = await sam.post('/api/post').send(Object.assign({
      title: 'Moving sale', description: 'Couch, lamps and books. Ring the bell at the side door.', street: '12 Hidden Ln', city: 'New York', state: 'NY', zipCode: '10036',
      priceMin: '5', priceMax: '50', schedule: { timeZone: TZ, days: [{ date: day(1), start: '09:00', end: '15:00' }, { date: day(2), start: '10:00', end: '14:00' }] },
    }, extra));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    await alerts.idle();
    return r.body;
  }
  const page = async (p, headers) => {
    const r = await request(app).get(p).set(Object.assign({ 'User-Agent': FB, Accept: 'text/html' }, headers || {}));
    assert.strictEqual(r.status, 200);
    return { res: r, h: parseHead(r.text), html: r.text };
  };
  const image = async (url) => {
    const u = new URL(url);
    const r = await request(app).get(u.pathname + u.search).buffer(true).parse((res, cb) => { const b = []; res.on('data', (c) => b.push(c)); res.on('end', () => cb(null, Buffer.concat(b))); });
    assert.strictEqual(r.status, 200);
    return { r, meta: await sharp(r.body).metadata(), body: r.body };
  };
  const noPrivate = (html) => {
    assert.ok(!/Hidden Ln/.test(html), 'street address in preview');
    assert.ok(!/@share\.example/.test(html), 'email in preview');
    assert.ok(!/Seller|Poster/.test(html), 'last name in preview');
  };

  before(async () => {
    dir = fakeBuild(true);
    cache = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-share-cache-'));
    photos = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-share-photos-'));
  });
  after(() => { [dir, cache, photos].forEach((d) => fs.rmSync(d, { recursive: true, force: true })); setStorage(null); delete process.env.SHARE_CACHE_DIR; });

  beforeEach(async () => {
    await models.sequelize.sync({ force: true });
    process.env.APP_BASE_URL = 'https://garage.example';
    process.env.SHARE_CACHE_DIR = cache;
    process.env.GOOGLE_MAPS_API_KEY = 'test-server-key';
    geo.setProvider(fakeProvider);
    geo.resetRateLimits();
    setStorage(new LocalStorage(photos));
    share.clearMemory();
    app = createApp(env());
    [sam, samId] = await user('sam@share.example', 'Sam', 'Seller');
    [bea] = await user('bea@share.example', 'Bea', 'Buyer');
    post = await sale();
  });

  it('a sale: title, next day + more, city, price range; branded card; never the street, names or emails', async () => {
    const { h, html } = await page('/post/' + post.id);
    validate(h);
    assert.strictEqual(h.titles[0], 'Moving sale · RapidGarage');
    assert.strictEqual(h.one('og:title'), 'Moving sale');
    const d = h.one('og:description');
    assert.match(d, /^\w{3}, \w{3} \d{1,2} · 9 AM – 3 PM \(\+1 more day\) · New York, NY · \$5–\$50\. Couch, lamps and books\./);
    assert.strictEqual(h.one('og:url'), 'https://garage.example/post/' + post.id);
    assert.strictEqual(h.canonical, 'https://garage.example/post/' + post.id);
    assert.strictEqual(h.one('og:locale'), 'en_US');
    assert.deepStrictEqual(h.all('og:locale:alternate'), ['es_LA', 'ko_KR', 'zh_CN']);
    assert.match(h.one('og:image'), new RegExp('^https://garage\\.example/api/share/image/post/' + post.id + '\\.png\\?v=[\\w-]{16}$'));
    assert.strictEqual(h.one('og:image:secure_url'), h.one('og:image'));
    assert.strictEqual(h.one('twitter:image'), h.one('og:image'));
    assert.deepStrictEqual(h.all('robots'), []);
    assert.ok(!/content="static"/.test(html), 'static fallback replaced');
    noPrivate(html);
    const img = await image(h.one('og:image'));
    assert.strictEqual(img.r.headers['content-type'], 'image/png');
    assert.deepStrictEqual([img.meta.format, img.meta.width, img.meta.height], ['png', 1200, 630]);
    assert.match(img.r.headers['cache-control'], /max-age=604800/);
    // Cached on disk under its content key; a stale ?v= is served briefly cached.
    assert.ok(fs.readdirSync(cache).some((f) => f.startsWith(new URL(h.one('og:image')).searchParams.get('v'))));
    const stale = await image('https://garage.example/api/share/image/post/' + post.id + '.png?v=old');
    assert.match(stale.r.headers['cache-control'], /max-age=300/);
    assert.ok(stale.body.equals(img.body));
  });

  it('the image follows the content: an edit changes ?v= and the card', async () => {
    const a = (await page('/post/' + post.id)).h.one('og:image');
    assert.strictEqual((await sam.put('/api/post/' + post.id).send({ title: 'Big moving sale' })).status, 200);
    const b = (await page('/post/' + post.id)).h.one('og:image');
    assert.notStrictEqual(a, b);
    // The old URL now answers with the new card, cached only briefly.
    const old = await image(a);
    const now = await image(b);
    assert.ok(old.body.equals(now.body));
    assert.match(old.r.headers['cache-control'], /max-age=300/);
    assert.match(now.r.headers['cache-control'], /max-age=604800/);
  });

  it('language: ?lang= (kept in og:url), fb_locale, Accept-Language; the account language is ignored', async () => {
    const ko = await page('/post/' + post.id + '?lang=ko');
    validate(ko.h);
    assert.strictEqual(ko.h.lang, 'ko');
    assert.strictEqual(ko.h.one('og:locale'), 'ko_KR');
    assert.strictEqual(ko.h.one('og:url'), 'https://garage.example/post/' + post.id + '?lang=ko');
    assert.strictEqual(ko.h.canonical, 'https://garage.example/post/' + post.id);
    assert.match(ko.h.one('og:description'), /오전 9시 – 오후 3시 \(\+1일 더\) · New York, NY/);
    assert.match(ko.h.one('og:image'), /&lang=ko$/);
    const fb = await page('/post/' + post.id + '?fb_locale=zh_CN');
    assert.strictEqual(fb.h.one('og:locale'), 'zh_CN');
    const es = await page('/post/' + post.id, { 'Accept-Language': 'es-MX,es;q=0.9' });
    assert.strictEqual(es.h.one('og:locale'), 'es_LA');
    assert.strictEqual(es.h.one('og:url'), 'https://garage.example/post/' + post.id);
    // A signed-in Korean user's browser still gets the language it asked for.
    await sam.put('/api/me/locale').send({ locale: 'ko' });
    const mine = await sam.get('/post/' + post.id).set('Accept-Language', 'en-US');
    assert.strictEqual(parseHead(mine.text).one('og:locale'), 'en_US');
  });

  it('a sale photo is used (cropped to 1200x630 JPEG, no metadata)', async () => {
    const jpg = await sharp({ create: { width: 900, height: 1200, channels: 3, background: { r: 200, g: 120, b: 40 } } })
      .withMetadata({ exif: { IFD0: { Artist: 'Sam Seller' } } }).jpeg().toBuffer();
    assert.strictEqual((await sam.post('/api/post/' + post.id + '/photos').attach('photos', jpg, 'a.jpg')).status, 201);
    const { h } = await page('/post/' + post.id);
    validate(h);
    assert.match(h.one('og:image'), /\/post\/\d+\.jpg\?v=/);
    assert.strictEqual(h.one('og:image:type'), 'image/jpeg');
    assert.strictEqual(h.one('og:image:alt'), 'Photo from Moving sale');
    const img = await image(h.one('og:image'));
    assert.deepStrictEqual([img.meta.format, img.meta.width, img.meta.height], ['jpeg', 1200, 630]);
    assert.strictEqual(img.meta.exif, undefined);
    assert.ok(!img.body.includes('Sam Seller'));
  });

  it('hidden, missing and ended sales get the generic preview (noindex); free on the curb keeps an ended sale', async () => {
    const site = (await page('/')).h;
    validate(site);
    assert.deepStrictEqual(site.all('robots'), []);
    const checkGeneric = async (p) => {
      const { h, html } = await page(p);
      validate(h);
      assert.strictEqual(h.one('og:title'), 'RapidGarage · Garage sales near you');
      assert.match(h.one('og:image'), /\/api\/share\/image\/site\.png\?v=/);
      assert.strictEqual(h.one('robots'), 'noindex');
      assert.ok(!/Moving sale|Couch|New York/.test(html), p + ' leaks details');
      return h;
    };
    await models.Post.update({ hidden: true }, { where: { id: post.id } });
    await checkGeneric('/post/' + post.id);
    // The image URL for it answers with the site card too (no 404 that confirms it exists).
    const hiddenImg = await image('https://garage.example/api/share/image/post/' + post.id + '.png');
    const siteImg = await image(site.one('og:image'));
    assert.ok(hiddenImg.body.equals(siteImg.body));
    await checkGeneric('/post/999999');
    await models.Post.update({ hidden: false }, { where: { id: post.id } });
    const past = new Date(Date.now() - 3600000);
    await models.SaleDay.update({ startsAt: new Date(Date.now() - 5 * 3600000), endsAt: past }, { where: { postId: post.id } });
    await models.Post.update({ endDate: past }, { where: { id: post.id } });
    await checkGeneric('/post/' + post.id);
    await models.Post.update({ curbsideUntil: new Date(Date.now() + 2 * 3600000), curbsideAll: true }, { where: { id: post.id } });
    const curb = (await page('/post/' + post.id)).h;
    assert.strictEqual(curb.one('og:title'), 'Moving sale');
    assert.match(curb.one('og:description'), /^Free on the curb until \w{3},? \d{1,2}:\d{2} [AP]M · New York, NY\./);
    // A reported curbside offer is not advertised.
    await models.Report.create({ postId: post.id, reporterId: (await models.User.findOne({ where: { email: 'bea@share.example' } })).id, reason: 'spam', status: 'open' });
    await checkGeneric('/post/' + post.id);
  });

  it('a free sale shows Free; escaping is safe', async () => {
    const p = await sale({ title: 'Free stuff "today" <b>&</b>', priceMin: undefined, priceMax: undefined, isFree: true });
    const { h, html } = await page('/post/' + p.id);
    validate(h);
    assert.strictEqual(h.one('og:title'), 'Free stuff "today" <b>&</b>');
    assert.match(h.one('og:description'), / · Free\. /);
    assert.ok(!/<b>/.test(html.split('<body')[0].replace(/<script[\s\S]*?<\/script>/g, '')), 'raw markup in head');
  });

  it('a neighborhood sale: dates, area label and sale count; hidden or ended -> generic', async () => {
    const r = await sam.post('/api/events').send({ name: 'Elm Street Block Sale', description: 'Twenty stoops.', areaLabel: "Hell's Kitchen", lat: C.lat, lng: C.lng, radiusMiles: 1, joinMode: 'open',
      schedule: { timeZone: TZ, days: [{ date: day(1), start: '08:00', end: '16:00' }] } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual((await sam.post('/api/events/' + r.body.id + '/join').send({ postId: post.id })).status, 201);
    const { h, html } = await page('/events/' + r.body.id);
    validate(h);
    assert.strictEqual(h.one('og:title'), 'Elm Street Block Sale');
    assert.match(h.one('og:description'), /· 8 AM – 4 PM · Hell's Kitchen · 1 sale\. Twenty stoops\./);
    noPrivate(html);
    const img = await image(h.one('og:image'));
    assert.strictEqual(img.meta.width, 1200);
    await models.SaleEvent.update({ hidden: true }, { where: { id: r.body.id } });
    assert.strictEqual((await page('/events/' + r.body.id)).h.one('robots'), 'noindex');
  });

  it('a wanted post: only while open and the board is on', async () => {
    const r = await bea.post('/api/wanted').send({ title: 'Kids bike', details: 'Training wheels please.', areaLabel: 'Park Slope', lat: C.lat, lng: C.lng, radiusMiles: 3, maxPriceCents: 4000 });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const { h, html } = await page('/wanted/' + r.body.id);
    validate(h);
    assert.strictEqual(h.one('og:title'), 'Wanted: Kids bike');
    assert.strictEqual(h.one('og:description'), 'Near Park Slope · within 3 mi · Up to $40. Training wheels please.');
    noPrivate(html);
    assert.ok(!/Bea/.test(html));
    await setSetting('wantedPosts', false);
    assert.strictEqual((await page('/wanted/' + r.body.id)).h.one('robots'), 'noindex');
    await setSetting('wantedPosts', true);
    await models.WantedPost.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { id: r.body.id } });
    assert.strictEqual((await page('/wanted/' + r.body.id)).h.one('robots'), 'noindex');
  });

  it('GET /api/share/head for the Vite preview plugin; builds without markers get the tags before </head>', async () => {
    const r = await request(app).get('/api/share/head').query({ path: '/post/' + post.id, lang: 'es' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.lang, 'es');
    assert.strictEqual(r.body.generic, false);
    const h = parseHead(share.injectHead('<html lang="en"><head><title>x</title></head><body></body></html>', r.body.head, r.body.lang));
    validate(h);
    assert.strictEqual(h.lang, 'es');
    assert.strictEqual((await request(app).get('/api/share/head').query({ path: 'http://evil' })).status, 400);
    assert.strictEqual((await request(app).get('/api/share/image/user/1.png')).status, 400);
    const bare = fakeBuild(false);
    try {
      const app2 = createApp(env({ SERVE_FRONTEND_DIR: bare }));
      const b = await request(app2).get('/post/' + post.id).set('Accept', 'text/html');
      const hb = parseHead(b.text);
      validate(hb);
      assert.strictEqual(hb.one('og:title'), 'Moving sale');
      assert.match(b.headers['content-security-policy'], /nonce-/);
    } finally { fs.rmSync(bare, { recursive: true, force: true }); }
  });

  it('share counts: aggregate per day on the dashboard, once per person per day, no bots', async () => {
    const send = (agent, body, ua) => agent.post('/api/post/' + post.id + '/share').set('User-Agent', ua || UA).send(body);
    assert.strictEqual((await send(bea, { channel: 'copy' })).status, 204);
    assert.strictEqual((await send(bea, { channel: 'facebook' })).status, 204); // same person, same day
    // The seller's own share counts (dedupe is per IP + browser, so another browser here).
    assert.strictEqual((await send(sam, { channel: 'native' }, UA + ' Edg/141.0')).status, 204);
    assert.strictEqual((await send(request(app), { channel: 'x' }, FB)).status, 204); // bot: not counted
    assert.strictEqual((await send(bea, { channel: 'myspace' })).status, 400);
    const d = await sam.get('/api/dashboard');
    assert.strictEqual(d.status, 200);
    const s = d.body.sales.find((x) => x.id === post.id);
    assert.strictEqual(s.totals.shares, 2);
    assert.strictEqual(s.today.shares, 2);
    assert.strictEqual(d.body.overall.totals.shares, 2);
    assert.deepStrictEqual(Object.keys(await models.PostShareDay.findOne({ raw: true })).sort(), ['count', 'createdAt', 'day', 'id', 'postId', 'updatedAt']);
  });

  it('card text: CJK wraps by character, Korean by word, long lines get an ellipsis, emoji are dropped', async () => {
    const card = require('../lib/shareCard');
    const zh = card.wrap('搬家大甩卖家具书籍厨房用品儿童玩具全部低价出售欢迎光临', 60, 500, 3);
    assert.ok(zh.length > 1 && zh.every((l) => card.measure(l, 60) <= 500));
    const ko = card.wrap('브루클린 하이츠 골목 세일 이사 정리', 60, 500, 3);
    assert.ok(ko.every((l) => !/^\S+$/.test(l) || l.length < 8) && ko.join(' ') === '브루클린 하이츠 골목 세일 이사 정리');
    const long = card.wrap('word '.repeat(80), 60, 500, 2);
    assert.strictEqual(long.length, 2);
    assert.ok(long[1].endsWith('…'));
    assert.strictEqual(card.measure('🎉', 40), 0);
    const png = await card.renderCard({ kicker: '동네 세일', title: '골목 세일 🎉 搬家', lines: ['10월 18일'], footer: 'x' });
    const meta = await sharp(png).metadata();
    assert.deepStrictEqual([meta.width, meta.height], [1200, 630]);
  });
});
