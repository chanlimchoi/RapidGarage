const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const schedule = require('../lib/schedule');

const PW = 'correct-horse';
const DAY = 24 * 3600000;
const C = { lat: 40.75, lng: -73.98 };

describe('buyer wish radar', function () {
  this.timeout(30000);
  let sam, samId, ids, agents, postId, now;

  async function user(email, first) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: 'Test' });
    assert.strictEqual(r.status, 201);
    return [agent, r.body.id];
  }
  const search = (userId, keyword, extra) => models.SaleAlert.create(Object.assign({ userId, keyword, lat: C.lat + 0.01, lng: C.lng, radiusMiles: 10 }, extra));
  const wanted = (userId, title, extra) => models.WantedPost.create(Object.assign({ userId, title, areaLabel: 'Midtown', lat: C.lat, lng: C.lng, radiusMiles: 5,
    expiresAt: new Date(now.getTime() + 7 * DAY) }, extra));

  after(() => schedule.setClock(null));
  beforeEach(async () => {
    delete process.env.RADAR_MIN_HUNTERS;
    await models.sequelize.sync({ force: true });
    now = new Date();
    schedule.setClock(() => now);
    [sam, samId] = await user('sam@example.com', 'Sam');
    ids = []; agents = [];
    for (const n of ['Ann', 'Ben', 'Cat', 'Dan', 'Eve']) { const [a, id] = await user(n.toLowerCase() + '@example.com', n); agents.push(a); ids.push(id); }
    postId = (await sam.post('/post').send({ title: 'Porch sale', street: '1 Main St', city: 'New York', state: 'NY', zipCode: '10036' })).body.id;
    await models.Post.update({ lat: C.lat, lng: C.lng }, { where: { id: postId } });
    await sam.post('/post/' + postId + '/items/bulk').send({ items: [{ name: 'Kids bike', price: '20' }, { name: 'Lamp', price: '5' }] });
  });
  after(() => { delete process.env.RADAR_MIN_HUNTERS; });

  it('count-only demand near a sale from saved searches and wanted posts, minimum 3 buyers per term', async () => {
    await search(ids[0], 'bikes', { maxPrice: 30 });
    await search(ids[1], 'Bike', { maxPrice: 40 });
    await wanted(ids[2], 'Bike for my kid', { keywords: 'bike', maxPriceCents: 2500, category: 'sports' });
    await search(ids[2], 'bike'); // same buyer twice counts once
    await search(ids[3], 'record player');
    await search(ids[4], 'record player');
    await wanted(ids[0], 'Patio chairs', { category: 'sports' });
    await wanted(ids[1], 'Treadmill', { category: 'sports' });
    // Not counted: too far for their circle, disabled, radar off, expired/hidden wanted, the seller themself.
    await search(ids[3], 'bike', { lat: 41.9, lng: -87.6 });
    await search(ids[4], 'bike', { enabled: false });
    const off = await search(ids[3], 'bike');
    assert.strictEqual((await agents[3].put('/alerts/' + off.id).send({ radar: false })).status, 200);
    assert.strictEqual((await agents[3].get('/alerts')).body.results.find((a) => a.id === off.id).radar, false);
    await wanted(ids[4], 'bike', { expiresAt: new Date(now.getTime() - DAY) });
    await wanted(ids[4], 'bike', { hidden: true });
    await search(samId, 'bike');

    const r = await sam.get('/post/' + postId + '/radar');
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.headers['cache-control'], 'no-store');
    assert.deepStrictEqual(r.body.terms, [{ term: 'bike', count: 3, typicalMaxCents: 3000, onYourList: true }]);
    assert.deepStrictEqual(r.body.categories, [{ category: 'sports', count: 3 }]);
    assert.deepStrictEqual([r.body.hunters, r.body.minHunters, r.body.fewerThan], [5, 3, undefined]);
    const text = JSON.stringify(r.body);
    assert.ok(!/Ann|Ben|Cat|@|record|Patio|Treadmill|kid/.test(text), 'nothing below the minimum, no people: ' + text);
    // The minimum is configurable (never below 2).
    process.env.RADAR_MIN_HUNTERS = '2';
    const r2 = await sam.get('/post/' + postId + '/radar');
    assert.deepStrictEqual(r2.body.terms.map((x) => [x.term, x.count]), [['bike', 3], ['record player', 2]]);
    assert.strictEqual(r2.body.terms[1].onYourList, false);
    process.env.RADAR_MIN_HUNTERS = '1';
    assert.strictEqual((await sam.get('/post/' + postId + '/radar')).body.minHunters, 3);
  });

  it('few buyers: "fewer than"; seller only; /radar for any place', async () => {
    await search(ids[0], 'bike');
    const r = await sam.get('/post/' + postId + '/radar');
    assert.deepStrictEqual([r.body.terms, r.body.hunters, r.body.fewerThan], [[], null, 3]);
    assert.strictEqual((await agents[0].get('/post/' + postId + '/radar')).status, 403);
    assert.strictEqual((await request(app).get('/radar').query(C)).status, 401);
    assert.strictEqual((await sam.get('/radar').query({ lat: 'x', lng: 1 })).status, 400);
    await search(ids[1], 'bike'); await search(ids[2], 'bike');
    const p = await agents[3].get('/radar').query(C);
    assert.deepStrictEqual(p.body.terms, [{ term: 'bike', count: 3 }]);
    // The viewer's own searches never count.
    const self = await agents[0].get('/radar').query(C);
    assert.deepStrictEqual([self.body.terms, self.body.fewerThan], [[], 3]);
  });
});
