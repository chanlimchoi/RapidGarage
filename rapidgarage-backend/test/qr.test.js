const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const schedule = require('../lib/schedule');
const scans = require('../lib/scans');
const links = require('../lib/shortlinks');
const flyer = require('../lib/flyer');
const shortlinks = require('../controllers/shortlinks');

const PW = 'correct-horse';
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36';

describe('QR flyers and scan counter', function () {
  this.timeout(30000);
  let seller, other, admin, sellerId, postId, code, prevBase;
  let now = new Date('2026-10-23T14:00:00Z'); // Fri 10am New York

  async function user(email, first, role) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: 'Test' });
    assert.strictEqual(r.status, 201);
    if (role) await models.User.update({ role }, { where: { id: r.body.id } });
    return [agent, r.body.id];
  }
  const scan = (c, ip, ua, extra) => {
    let r = request(app).get('/s/' + (c || code)).set('X-Forwarded-For', ip || '203.0.113.5');
    if (ua !== null) r = r.set('User-Agent', ua === undefined ? PHONE : ua);
    Object.entries(extra || {}).forEach(([k, v]) => { r = r.set(k, v); });
    return r;
  };
  const total = async () => (await seller.get('/post/' + postId + '/print')).body.scans.total;

  before(() => {
    prevBase = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = 'https://rapidgarage.example/';
  });
  after(() => {
    if (prevBase === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = prevBase;
    schedule.setClock(null); scans.setClock(null);
  });

  beforeEach(async () => {
    await models.sequelize.sync({ force: true });
    now = new Date('2026-10-23T14:00:00Z');
    schedule.setClock(() => now); scans.setClock(() => now);
    scans.resetSalt(); shortlinks.resetMisses();
    [seller, sellerId] = await user('sam@example.com', 'Sam');
    [other] = await user('otto@example.com', 'Otto');
    [admin] = await user('ada@example.com', 'Ada', 'admin');
    const p = await seller.post('/post').send({ title: 'Moving sale', street: '30 Henry St', city: 'Brooklyn', state: 'NY', zipCode: '11201', priceMin: 1, priceMax: 80,
      schedule: { timeZone: 'America/New_York', days: [{ date: '2026-10-24', start: '08:00', end: '14:00' }, { date: '2026-10-25', start: '09:00', end: '13:00' }] } });
    assert.strictEqual(p.status, 201, JSON.stringify(p.body));
    postId = p.body.id;
    code = (await models.Post.findByPk(postId)).shortCode;
  });

  it('gives each post a random 8-letter code that public APIs never expose', async () => {
    assert.match(code, /^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/);
    const p2 = await seller.post('/post').send({ title: 'Second', street: '1 Main St', city: 'NYC', zipCode: '10001' });
    const c2 = (await models.Post.findByPk(p2.body.id)).shortCode;
    assert.notStrictEqual(c2, code);
    const codes = new Set(Array.from({ length: 2000 }, () => links.newCode()));
    assert.strictEqual(codes.size, 2000);
    for (const res of [await request(app).get('/post/' + postId), await request(app).get('/allPosts'), await other.get('/post/' + postId)]) {
      assert.ok(!JSON.stringify(res.body).includes(code), 'code leaked');
      assert.ok(!/shortCode/.test(JSON.stringify(res.body)));
    }
    const info = await seller.get('/post/' + postId + '/print');
    assert.strictEqual(info.body.shortUrl, 'https://rapidgarage.example/s/' + code);
  });

  it('redirects /s/<code> to the post (any case), no caching', async () => {
    const r = await scan();
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, 'https://rapidgarage.example/post/' + postId);
    assert.match(r.headers['cache-control'], /no-store/);
    assert.strictEqual(r.headers['referrer-policy'], 'no-referrer');
    assert.strictEqual((await scan(code.toUpperCase(), '198.51.100.9')).status, 302);
    assert.strictEqual(await total(), 2);
  });

  it('shows the same not-available page for unknown, malformed and hidden posts', async () => {
    const unknown = await scan('zzzzzzzz');
    const bad = await scan('abc');
    await models.Post.update({ hidden: true }, { where: { id: postId } });
    const hidden = await scan();
    for (const r of [unknown, bad, hidden]) {
      assert.strictEqual(r.status, 404);
      assert.match(r.headers['content-type'], /text\/html/);
      assert.match(r.text, /This sale isn’t available/);
      assert.ok(!r.text.includes('Moving sale'));
    }
    assert.strictEqual(unknown.text, hidden.text, 'hidden looks exactly like unknown');
    assert.strictEqual(await models.PostScanDay.count(), 0);
  });

  it('ended sales still redirect (and count)', async () => {
    now = new Date('2026-10-30T12:00:00Z');
    const r = await scan();
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, 'https://rapidgarage.example/post/' + postId);
    assert.strictEqual(await total(), 1);
  });

  it('counts each visitor once a day, per day in the sale time zone', async () => {
    await scan(null, '203.0.113.5');
    await scan(null, '203.0.113.5'); // repeat
    await scan(null, '203.0.113.5', ANDROID); // same network, other phone
    await scan(null, '198.51.100.7');
    let s = (await seller.get('/post/' + postId + '/print')).body.scans;
    assert.deepStrictEqual([s.total, s.today], [3, 3]);
    assert.strictEqual(s.days.length, 30);
    assert.deepStrictEqual(s.days[29], { date: '2026-10-23', count: 3 });
    // 03:30 UTC Saturday: a new UTC day (new salt), but still Friday evening in New York.
    now = new Date('2026-10-24T03:30:00Z');
    await scan(null, '203.0.113.5'); // new salt -> counted again, on Friday (local)
    now = new Date('2026-10-24T15:00:00Z');
    await scan(null, '203.0.113.5'); // same salt day as 03:30 -> repeat
    await scan(null, '192.0.2.44');
    s = (await seller.get('/post/' + postId + '/print')).body.scans;
    assert.strictEqual(s.total, 5);
    assert.deepStrictEqual(s.days.slice(-2), [{ date: '2026-10-23', count: 4 }, { date: '2026-10-24', count: 1 }]);
    assert.strictEqual(s.today, 1);
  });

  it('stores no IPs or user agents, and forgets yesterday’s hashes', async () => {
    await scan(null, '203.0.113.5');
    await scan(null, '198.51.100.7');
    const rows = await models.ScanDedupe.findAll({ raw: true });
    assert.strictEqual(rows.length, 2);
    for (const r of rows) {
      assert.deepStrictEqual(Object.keys(r).sort(), ['createdAt', 'day', 'hash', 'id', 'updatedAt']);
      assert.match(r.hash, /^[A-Za-z0-9_-]{22}$/);
    }
    const dump = JSON.stringify(rows) + JSON.stringify(await models.PostScanDay.findAll({ raw: true }));
    assert.ok(!/203\.0\.113|198\.51\.100|iPhone|Mozilla/.test(dump));
    now = new Date('2026-10-24T12:00:00Z');
    await scan(null, '192.0.2.1');
    const left = await models.ScanDedupe.findAll({ raw: true });
    assert.deepStrictEqual(left.map((r) => r.day), ['2026-10-24'], 'old day purged');
    // A restart (new salt) also drops today's hashes, which can no longer match.
    scans.resetSalt();
    await scan(null, '192.0.2.2');
    assert.strictEqual(await models.ScanDedupe.count(), 1);
  });

  it('skips bots, link previews, prefetches, HEAD, and the seller or admins themselves', async () => {
    const bots = ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'facebookexternalhit/1.1', 'WhatsApp/2.24.1', 'Slackbot-LinkExpanding 1.0',
      'curl/8.5.0', 'python-requests/2.32', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0 Safari/537.36', '', null];
    let i = 0;
    for (const ua of bots) {
      const r = await scan(null, '203.0.113.' + (++i), ua);
      assert.strictEqual(r.status, 302, 'bots still get the redirect');
    }
    await scan(null, '198.51.100.1', PHONE, { 'Sec-Purpose': 'prefetch' });
    await scan(null, '198.51.100.2', PHONE, { Purpose: 'prefetch' });
    const head = await request(app).head('/s/' + code).set('User-Agent', PHONE).set('X-Forwarded-For', '198.51.100.3');
    assert.strictEqual(head.status, 302);
    assert.strictEqual((await seller.get('/s/' + code).set('User-Agent', PHONE).set('X-Forwarded-For', '198.51.100.4')).status, 302);
    assert.strictEqual((await admin.get('/s/' + code).set('User-Agent', PHONE).set('X-Forwarded-For', '198.51.100.5')).status, 302);
    assert.strictEqual(await total(), 0);
    await other.get('/s/' + code).set('User-Agent', PHONE).set('X-Forwarded-For', '198.51.100.6');
    assert.strictEqual(await total(), 1, 'a logged-in buyer counts');
    assert.ok(scans.isBot('Mozilla/5.0 (compatible; bingbot/2.0)'));
    assert.ok(!scans.isBot(PHONE) && !scans.isBot(ANDROID));
  });

  it('only trusts the last X-Forwarded-For hop, and only from a local proxy', () => {
    const req = (remote, xff, trust) => ({ app: { get: () => trust }, ip: '10.9.9.9', socket: { remoteAddress: remote }, get: (h) => (h.toLowerCase() === 'x-forwarded-for' ? xff : undefined) });
    assert.strictEqual(scans.clientIp(req('127.0.0.1', '1.1.1.1, 203.0.113.5')), '203.0.113.5');
    assert.strictEqual(scans.clientIp(req('::1', '203.0.113.5')), '203.0.113.5');
    assert.strictEqual(scans.clientIp(req('198.51.100.1', '203.0.113.5')), '198.51.100.1', 'spoofed header from a remote client is ignored');
    assert.strictEqual(scans.clientIp(req('127.0.0.1', '203.0.113.5', 1)), '10.9.9.9', "with trust proxy, Express's req.ip");
  });

  it('slows down code guessing', async () => {
    for (let k = 0; k < 30; k++) await scan(links.newCode(), '203.0.113.99');
    const r = await scan(code, '203.0.113.99');
    assert.strictEqual(r.status, 429);
    assert.strictEqual((await scan(code, '203.0.113.100')).status, 302, 'other visitors unaffected');
  });

  it('stats: seller and admins only; print assets: seller only', async () => {
    const base = '/post/' + postId + '/print';
    for (const p of ['', '/qr.png', '/qr.svg', '/flyer.pdf']) assert.strictEqual((await request(app).get(base + p)).status, 401, p);
    for (const p of ['', '/qr.png', '/qr.svg', '/flyer.pdf']) assert.strictEqual((await other.get(base + p)).status, 403, p);
    const a = await admin.get(base);
    assert.strictEqual(a.status, 200);
    assert.strictEqual(a.body.canPrint, false);
    for (const p of ['/qr.png', '/qr.svg', '/flyer.pdf']) assert.strictEqual((await admin.get(base + p)).status, 403, 'admin ' + p);
    const s = await seller.get(base);
    assert.strictEqual(s.body.canPrint, true);
    assert.strictEqual((await seller.get('/post/9999/print')).status, 404);
  });

  it('serves QR PNG/SVG and the three PDF layouts', async () => {
    const base = '/post/' + postId + '/print';
    const png = await seller.get(base + '/qr.png?size=512&download=1').buffer(true);
    assert.strictEqual(png.headers['content-type'], 'image/png');
    assert.match(png.headers['content-disposition'], /^attachment; filename="rapidgarage-moving-sale-qr\.png"$/);
    assert.match(png.headers['cache-control'], /no-store/);
    assert.strictEqual(png.body.slice(1, 4).toString(), 'PNG');
    assert.strictEqual(png.body.readUInt32BE(16), 512);
    assert.strictEqual((await seller.get(base + '/qr.png?size=99')).status, 400);
    const svg = await seller.get(base + '/qr.svg').buffer(true);
    assert.strictEqual(svg.headers['content-type'], 'image/svg+xml; charset=utf-8');
    assert.match(String(svg.body), /^<svg[^>]+viewBox/);
    const sizes = { letter: '612 792', half: '396 612', sign: '792 612' };
    for (const layout of Object.keys(sizes)) {
      const r = await seller.get(base + '/flyer.pdf?layout=' + layout + '&arrow=right&headline=yard').buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
      assert.strictEqual(r.status, 200, layout);
      assert.strictEqual(r.headers['content-type'], 'application/pdf');
      assert.strictEqual(r.body.slice(0, 5).toString(), '%PDF-');
      assert.ok(r.body.toString('latin1').includes('/MediaBox [0 0 ' + sizes[layout] + ']'), layout + ' page size');
      assert.ok(!r.body.toString('latin1').includes('sam@example.com'));
    }
    const bad = await seller.get(base + '/flyer.pdf?layout=poster&arrow=up&headline=x&photo=yes');
    assert.strictEqual(bad.status, 400);
    assert.deepStrictEqual(Object.keys(bad.body.error.details).sort(), ['arrow', 'headline', 'layout', 'photo']);
  });

  it('hidden posts: stats stay visible to the seller, printing is refused', async () => {
    await models.Post.update({ hidden: true }, { where: { id: postId } });
    const s = await seller.get('/post/' + postId + '/print');
    assert.strictEqual(s.status, 200);
    assert.deepStrictEqual([s.body.hidden, s.body.canPrint], [true, false]);
    for (const p of ['/qr.png', '/qr.svg', '/flyer.pdf']) {
      const r = await seller.get('/post/' + postId + '/print' + p);
      assert.strictEqual(r.status, 409, p);
      assert.strictEqual(r.body.error.code, 'hidden');
    }
    assert.strictEqual((await other.get('/post/' + postId + '/print')).status, 404, 'hidden post is invisible to others');
  });

  it('flyer content: upcoming days, unsold items, safe text', async () => {
    await seller.post('/post/' + postId + '/items').send({ name: 'Road bike', price: '45' });
    await seller.post('/post/' + postId + '/items').send({ name: 'Lamp 💡', price: '0' });
    const sold = await seller.post('/post/' + postId + '/items').send({ name: 'Sofa', price: '120' });
    await seller.put('/post/' + postId + '/items/' + sold.body.id).send({ sold: true });
    const post = await models.Post.findByPk(postId, { include: [{ model: models.SaleDay, as: 'saleDays' }, { model: models.SaleItem, as: 'items' }] });
    const d = flyer.flyerData(post, { url: 'u' });
    assert.deepStrictEqual(d.when, ['Sat, Oct 24  ·  8 AM – 2 PM', 'Sun, Oct 25  ·  9 AM – 1 PM']);
    assert.deepStrictEqual(d.signWhen, ['SAT OCT 24  8AM–2PM', 'SUN OCT 25  9AM–1PM']);
    assert.deepStrictEqual(d.items, [{ name: 'Road bike', price: '$45' }, { name: 'Lamp', price: 'Free' }]);
    assert.strictEqual(d.price, '$1–$80');
    assert.strictEqual(flyer.flyerData(post, { url: 'u', noItems: true }).items.length, 0);
    now = new Date('2026-10-25T12:00:00Z'); // Saturday is over
    assert.deepStrictEqual(flyer.flyerData(post, { url: 'u' }).when, ['Sun, Oct 25  ·  9 AM – 1 PM']);
    now = new Date('2026-10-30T12:00:00Z');
    const ended = flyer.flyerData(post, { url: 'u' });
    assert.strictEqual(ended.ended, true);
    assert.strictEqual(ended.when.length, 2);
    assert.strictEqual(flyer.pdfText('Café “sale” 🚲 — ok'), 'Café “sale” — ok');
  });

  it('deleting a post removes its scan counts', async () => {
    await scan();
    assert.strictEqual(await models.PostScanDay.count(), 1);
    assert.strictEqual((await seller.delete('/post/' + postId)).status, 204);
    assert.strictEqual(await models.PostScanDay.count(), 0);
    assert.strictEqual((await scan()).status, 404);
  });
});
