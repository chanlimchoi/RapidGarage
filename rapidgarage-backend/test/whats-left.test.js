const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const live = require('../lib/live');
const alerts = require('../lib/alerts');
const schedule = require('../lib/schedule');
const whatsLeft = require('../lib/whatsLeft');

const PW = 'correct-horse';
const H = 3600000;

describe("live what's left (item status)", function () {
  this.timeout(30000);
  let sam, bea, cal, samId, beaId, calId, post, items, now, events, realEmit;

  async function user(email, first) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: 'Test' });
    assert.strictEqual(r.status, 201);
    return [agent, r.body.id];
  }

  before(() => { realEmit = live.emit; live.emit = (u, e, d) => { events.push([u, e, d]); return 1; }; });
  after(() => { live.emit = realEmit; schedule.setClock(null); geo.setProvider(null); });

  beforeEach(async () => {
    geo.setProvider(() => Promise.resolve({ status: 'ok', lat: 40.75, lng: -73.98 }));
    await models.sequelize.sync({ force: true });
    now = new Date(Math.floor(Date.now() / H) * H);
    schedule.setClock(() => now);
    events = [];
    [sam, samId] = await user('sam@example.com', 'Sam');
    [bea, beaId] = await user('bea@example.com', 'Bea');
    [cal, calId] = await user('cal@example.com', 'Cal');
    // Open right now, for 4 hours.
    post = (await sam.post('/post').send({ title: 'Porch sale', street: '1 Main St', city: 'New York', state: 'NY', zipCode: '10036',
      startDate: new Date(now.getTime() - H), endDate: new Date(now.getTime() + 3 * H) })).body;
    const r = await sam.post('/post/' + post.id + '/items/bulk').send({ items: [{ name: 'Lamp', price: '5' }, { name: 'Chair', price: '20' }, { name: 'Rug' }] });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    items = r.body.items;
  });

  it('status: ids with sold/reserved, last updated and a poll hint; ETag revalidation', async () => {
    const s1 = await request(app).get('/post/' + post.id + '/items/status');
    assert.strictEqual(s1.status, 200);
    assert.deepStrictEqual([s1.body.total, s1.body.sold, s1.body.pollSeconds], [3, 0, whatsLeft.POLL_OPEN_SECONDS]);
    assert.deepStrictEqual(s1.body.items.map((i) => [i.id, i.sold, i.reserved]), items.map((i) => [i.id, false, false]));
    assert.ok(s1.body.updatedAt, 'stamped by the bulk add');
    assert.ok(!('name' in s1.body.items[0]), 'ids and flags only');
    assert.strictEqual(s1.headers['cache-control'], 'no-cache');
    const etag = s1.headers.etag;
    assert.ok(etag);
    assert.strictEqual((await request(app).get('/post/' + post.id + '/items/status').set('If-None-Match', etag)).status, 304);
    now = new Date(now.getTime() + 5 * 60000);
    const put = await sam.put('/post/' + post.id + '/items/' + items[1].id).send({ sold: true });
    assert.strictEqual(put.status, 200);
    assert.strictEqual(new Date(put.body.itemsUpdatedAt).getTime(), now.getTime());
    const s2 = await request(app).get('/post/' + post.id + '/items/status').set('If-None-Match', etag);
    assert.strictEqual(s2.status, 200, 'changed');
    assert.deepStrictEqual([s2.body.sold, s2.body.items[1].sold, s2.body.updatedAt], [1, true, now.toISOString()]);
    // The sale page itself carries the stamp too.
    assert.strictEqual((await request(app).get('/post/' + post.id)).body.itemsUpdatedAt, now.toISOString());
  });

  it('one tap sold/available: savers get a live nudge and a bell; others and the seller do not', async () => {
    assert.ok((await bea.put('/saved/' + post.id).send({})).status < 300);
    events = [];
    assert.strictEqual((await cal.put('/post/' + post.id + '/items/' + items[0].id).send({ sold: true })).status, 403, 'only the seller');
    assert.strictEqual((await sam.put('/post/' + post.id + '/items/' + items[0].id).send({ sold: true })).status, 200);
    await alerts.idle();
    const nudges = events.filter((e) => e[1] === 'items');
    assert.deepStrictEqual(nudges, [[beaId, 'items', { postId: post.id }]]);
    const bell = (await bea.get('/notifications')).body.results;
    assert.strictEqual(bell[0].kind, 'item_sold');
    assert.deepStrictEqual(bell[0].data.items.map((i) => i.name), ['Lamp']);
    assert.ok(!(await cal.get('/notifications')).body.results.length);
    // Back to available: status follows, another nudge.
    events = [];
    assert.strictEqual((await sam.put('/post/' + post.id + '/items/' + items[0].id).send({ sold: false })).status, 200);
    assert.deepStrictEqual(events.filter((e) => e[1] === 'items').map((e) => e[0]), [beaId]);
    assert.strictEqual((await request(app).get('/post/' + post.id + '/items/status')).body.sold, 0);
    // Deleting an item also stamps the list.
    now = new Date(now.getTime() + 60000);
    assert.strictEqual((await sam.delete('/post/' + post.id + '/items/' + items[2].id)).status, 204);
    const s = (await request(app).get('/post/' + post.id + '/items/status')).body;
    assert.deepStrictEqual([s.total, s.updatedAt], [2, now.toISOString()]);
    void samId; void calId;
  });

  it('poll hint: fast while open or within the hour, slow when upcoming, none after it ended; hidden sales stay hidden', async () => {
    const p = await models.Post.findByPk(post.id, { include: [{ model: models.SaleDay, as: 'saleDays' }] });
    assert.strictEqual(whatsLeft.pollSeconds(p, now), 20);
    assert.strictEqual(whatsLeft.pollSeconds(p, new Date(now.getTime() - 1.5 * H)), 20, 'starts within the hour');
    assert.strictEqual(whatsLeft.pollSeconds(p, new Date(now.getTime() - 5 * H)), 300);
    assert.strictEqual(whatsLeft.pollSeconds(p, new Date(now.getTime() + 4 * H)), 0);
    await models.Post.update({ hidden: true }, { where: { id: post.id } });
    assert.strictEqual((await cal.get('/post/' + post.id + '/items/status')).status, 404);
    assert.strictEqual((await sam.get('/post/' + post.id + '/items/status')).status, 200, 'the owner still sees it');
  });
});
