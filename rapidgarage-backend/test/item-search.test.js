const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const schedule = require('../lib/schedule');

const PW = 'correct-horse';
const CENTER = { lat: 40.758, lng: -73.9855 };
const MI_PER_DEG = (Math.PI / 180) * geo.EARTH_RADIUS_MI;
const north = (miles) => ({ lat: CENTER.lat + miles / MI_PER_DEG, lng: CENTER.lng });
const H = 3600000;
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
// Calendar days after `d` in New York (not 24-hour steps, which repeat a date across DST changes).
const daysAfter = (d, n) => { const t = new Date(ymd(d) + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

describe('item search (GET /search/items)', function () {
  this.timeout(30000);
  let alice, bob, now, near, far, hidden, ended;

  function provider(address) {
    const m = address.match(/^(\d+(?:\.\d+)?) mi\b/);
    if (m) return Promise.resolve(Object.assign({ status: 'ok' }, north(Number(m[1]))));
    if (/^10036/.test(address) || /times square/i.test(address)) return Promise.resolve(Object.assign({ status: 'ok' }, CENTER));
    return Promise.resolve({ status: 'not_found' });
  }
  const sale = (agent, mi, title, dayOffset) => agent.post('/post').send({ title, street: mi + ' mi St', city: 'New York', state: 'NY', zipCode: '10036',
    schedule: { timeZone: 'America/New_York', days: [{ date: daysAfter(now, dayOffset || 1), start: '08:00', end: '14:00' }] } });
  const item = (agent, postId, body) => agent.post('/post/' + postId + '/items').send(body);

  before(() => { process.env.GOOGLE_MAPS_API_KEY = 'test-server-key'; });
  after(() => { geo.setProvider(null); schedule.setClock(null); delete process.env.GOOGLE_MAPS_API_KEY; });

  beforeEach(async () => {
    geo.setProvider(provider);
    geo.resetRateLimits();
    await models.sequelize.sync({ force: true });
    now = new Date(Math.ceil(Date.now() / H) * H);
    schedule.setClock(() => now);
    alice = request.agent(app);
    bob = request.agent(app);
    await alice.post('/signup').send({ email: 'alice@example.com', password: PW, firstName: 'Alice', lastName: 'Seller' });
    await bob.post('/signup').send({ email: 'bob@example.com', password: PW, firstName: 'Bob', lastName: 'Buyer' });
    near = (await sale(alice, 1, 'Garage sale', 1)).body;
    far = (await sale(alice, 8, 'Moving sale', 2)).body;
    hidden = (await sale(alice, 2, 'Hidden sale', 1)).body;
    await models.Post.update({ hidden: true }, { where: { id: hidden.id } });
    ended = (await alice.post('/post').send({ title: 'Old sale', street: '3 mi St', city: 'New York', zipCode: '10036', startDate: new Date(now.getTime() - 48 * H), endDate: new Date(now.getTime() - 40 * H) })).body;
    const photo = await models.PostPhoto.create({ postId: near.id, storageKey: 'k/bike.jpg', thumbKey: 'k/bike-t.jpg', width: 10, height: 10, position: 0, alt: 'A red bike' });
    await models.PostPhoto.create({ postId: far.id, storageKey: 'k/cover.jpg', thumbKey: 'k/cover-t.jpg', width: 10, height: 10, position: 0 });
    assert.strictEqual((await item(alice, near.id, { name: 'Kids bike', price: '25', photoId: photo.id })).status, 201);
    await item(alice, near.id, { name: 'Lamp', price: '5' });
    const sold = await item(alice, near.id, { name: 'Road bike', price: '90' });
    await alice.put('/post/' + near.id + '/items/' + sold.body.id).send({ sold: true });
    await item(alice, far.id, { name: 'Bike helmet', price: '10' });
    await item(alice, far.id, { name: 'BIKE pump' });
    await item(alice, hidden.id, { name: 'Hidden bike' });
    await item(alice, ended.id, { name: 'Old bike' });
  });

  it('returns unsold items matching every word, nearest sale first, with photo, price, distance and date', async () => {
    const r = await request(app).get('/search/items').query({ keyword: 'bike', lat: CENTER.lat, lng: CENTER.lng, radius: 10 });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.mode, 'distance');
    assert.deepStrictEqual(r.body.results.map((i) => i.name), ['Kids bike', 'Bike helmet', 'BIKE pump']);
    const [kid, helmet, pump] = r.body.results;
    assert.strictEqual(kid.priceCents, 2500);
    assert.deepStrictEqual([kid.photo.ofSale, kid.photo.alt, /bike-t\.jpg$/.test(kid.photo.thumbUrl)], [false, 'A red bike', true]);
    assert.deepStrictEqual([helmet.photo.ofSale, /cover/.test(helmet.photo.url)], [true, true], 'falls back to the sale cover, marked');
    assert.strictEqual(pump.priceCents, null);
    assert.strictEqual(kid.sale.id, near.id);
    assert.ok(Math.abs(kid.sale.distanceMiles - 1) < 0.2 && Math.abs(helmet.sale.distanceMiles - 8) < 0.2);
    assert.strictEqual(kid.sale.window.status, 'upcoming');
    assert.ok(kid.sale.window.startsAt < helmet.sale.window.startsAt);
    assert.deepStrictEqual(r.body.sales.map((s) => s.id), [near.id, far.id], 'map pins for this page');
    assert.ok(typeof r.body.sales[0].lat === 'number');
    assert.ok(!JSON.stringify(r.body).includes('@'), 'no emails');
    // Multi-word: every word in the item name.
    const two = await request(app).get('/search/items').query({ keyword: 'road bike', lat: CENTER.lat, lng: CENTER.lng });
    assert.deepStrictEqual(two.body.results, [], 'sold items never show');
    // Radius narrows.
    const r5 = await request(app).get('/search/items').query({ keyword: 'bike', lat: CENTER.lat, lng: CENTER.lng, radius: 5 });
    assert.deepStrictEqual(r5.body.results.map((i) => i.name), ['Kids bike']);
  });

  it('applies the normal filters and paging, and works by place or with no place', async () => {
    const tomorrow = await request(app).get('/search/items').query({ keyword: 'bike', q: '10036', radius: 10, when: 'today' });
    assert.strictEqual(tomorrow.status, 200);
    assert.strictEqual(tomorrow.body.center.source, 'geocoded');
    assert.deepStrictEqual(tomorrow.body.results, [], 'nothing is on today');
    const capped = await request(app).get('/search/items').query({ keyword: 'bike', lat: CENTER.lat, lng: CENTER.lng, maxPrice: 0, free: 'true' });
    assert.deepStrictEqual(capped.body.results, [], 'free filter applies to the sale');
    const paged = await request(app).get('/search/items').query({ keyword: 'bike', lat: CENTER.lat, lng: CENTER.lng, pageSize: 2, page: 2 });
    assert.deepStrictEqual([paged.body.total, paged.body.totalPages, paged.body.results.map((i) => i.name)], [3, 2, ['BIKE pump']]);
    assert.deepStrictEqual(paged.body.sales.map((s) => s.id), [far.id]);
    const anywhere = await request(app).get('/search/items').query({ keyword: 'bike' });
    assert.strictEqual(anywhere.body.mode, 'recent');
    assert.deepStrictEqual(anywhere.body.results.map((i) => [i.name, i.sale.distanceMiles]).sort(), [['BIKE pump', null], ['Bike helmet', null], ['Kids bike', null]]);
    // The owner sees their own hidden sale's items, like the normal search.
    const own = await alice.get('/search/items').query({ keyword: 'bike' });
    assert.ok(own.body.results.some((i) => i.name === 'Hidden bike'));
  });

  it('validates input', async () => {
    assert.strictEqual((await request(app).get('/search/items').query({ lat: CENTER.lat, lng: CENTER.lng })).status, 400, 'keyword required');
    assert.strictEqual((await request(app).get('/search/items').query({ keyword: 'bike', radius: 7, lat: 1, lng: 1 })).status, 400);
    assert.strictEqual((await request(app).get('/search/items').query({ keyword: 'x'.repeat(61) })).status, 400);
    assert.strictEqual((await request(app).get('/search/items').query({ keyword: 'bike', q: 'nowhere at all' })).status, 404);
    // Literal matching: LIKE wildcards are not wildcards.
    assert.deepStrictEqual((await request(app).get('/search/items').query({ keyword: '%' })).body.results, []);
    void bob;
  });
});
