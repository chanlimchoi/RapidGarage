const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const alerts = require('../lib/alerts');
const schedule = require('../lib/schedule');

const PW = 'correct-horse';
const H = 3600000;

describe('seller sale report', function () {
  this.timeout(30000);
  let sam, bea, samId, beaId, post, items, now;

  async function user(email, first) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: 'Test' });
    assert.strictEqual(r.status, 201);
    return [agent, r.body.id];
  }

  after(() => { schedule.setClock(null); geo.setProvider(null); });
  afterEach(() => alerts.idle());

  beforeEach(async () => {
    geo.setProvider(() => Promise.resolve({ status: 'ok', lat: 40.75, lng: -73.98 }));
    await models.sequelize.sync({ force: true });
    now = new Date(Math.floor(Date.now() / H) * H);
    schedule.setClock(() => now);
    [sam, samId] = await user('sam@example.com', 'Sam');
    [bea, beaId] = await user('bea@example.com', 'Bea');
    post = (await sam.post('/post').send({ title: 'Porch sale', street: '1 Main St', city: 'New York', state: 'NY', zipCode: '10036',
      startDate: new Date(now.getTime() - 5 * H), endDate: new Date(now.getTime() - H) })).body;
    const r = await sam.post('/post/' + post.id + '/items/bulk').send({ items: [{ name: 'Lamp', price: '5' }, { name: 'Chair', price: '20' }, { name: 'Rug' }, { name: 'Desk', price: '40' }] });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    items = r.body.items;
  });

  it('itemizes sold items with agreed offer or listed prices, and count-only reach', async () => {
    // Lamp sold at its listed price; Chair by an accepted offer of $15; Rug (no price) sold; Desk left.
    for (const i of items.slice(0, 3)) assert.strictEqual((await sam.put('/post/' + post.id + '/items/' + i.id).send({ sold: true })).status, 200);
    const conv = await models.Conversation.create({ postId: post.id, buyerId: beaId, sellerId: samId, postTitle: post.title });
    await models.ItemHold.create({ itemId: items[1].id, postId: post.id, conversationId: conv.id, buyerId: beaId, sellerId: samId, status: 'completed', offerCents: 1500, expiresAt: now, decidedAt: now });
    await models.ItemHold.create({ itemId: items[1].id, postId: post.id, conversationId: conv.id, buyerId: beaId, sellerId: samId, status: 'declined', offerCents: 900, expiresAt: now, decidedAt: now });
    await models.Message.bulkCreate([
      { conversationId: conv.id, senderId: beaId, body: 'Is the chair still there?' },
      { conversationId: conv.id, senderId: samId, body: 'Yes!' },
      { conversationId: conv.id, senderId: samId, body: 'gone', removedAt: now },
    ]);
    await models.PostViewDay.bulkCreate([{ postId: post.id, day: '2026-10-30', count: 12 }, { postId: post.id, day: '2026-10-31', count: 3 }]);
    await models.PostScanDay.create({ postId: post.id, day: '2026-10-31', count: 4 });
    await models.PostShareDay.create({ postId: post.id, day: '2026-10-30', count: 2 });
    await models.SavedPost.create({ userId: beaId, postId: post.id });

    const r = await sam.get('/post/' + post.id + '/report');
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.headers['cache-control'], 'no-store');
    const b = r.body;
    assert.deepStrictEqual([b.post.title, b.post.status], ['Porch sale', 'ended']);
    assert.deepStrictEqual(b.sold.map((i) => [i.name, i.listedCents, i.soldCents, i.priceSource]),
      [['Lamp', 500, 500, 'listed'], ['Chair', 2000, 1500, 'offer'], ['Rug', null, null, null]]);
    assert.deepStrictEqual(b.unsold.map((i) => [i.name, i.listedCents]), [['Desk', 4000]]);
    assert.deepStrictEqual(b.totals, { items: 4, sold: 3, unsold: 1, earnedCents: 2000, listedValueSoldCents: 2500, unsoldListedCents: 4000, soldWithoutPrice: 1, soldByOffer: 1 });
    assert.deepStrictEqual(b.reach, { views: 15, scans: 4, shares: 2, saves: 1, conversations: 1, messages: 2, holdsCompleted: 1 });
    assert.deepStrictEqual(b.daily, [{ day: '2026-10-30', views: 12, scans: 0, shares: 2 }, { day: '2026-10-31', views: 3, scans: 4, shares: 0 }]);
    const text = JSON.stringify(b);
    assert.ok(!text.includes('@') && !text.includes('Bea') && !text.includes(String('chair still')), 'no visitor or buyer data, no message text');
  });

  it('owner only; empty sales report zeros', async () => {
    assert.strictEqual((await bea.get('/post/' + post.id + '/report')).status, 403);
    assert.strictEqual((await request(app).get('/post/' + post.id + '/report')).status, 401);
    assert.strictEqual((await sam.get('/post/999999/report')).status, 404);
    const other = (await sam.post('/post').send({ title: 'Empty', street: '2 Main St', city: 'New York', state: 'NY', zipCode: '10036' })).body;
    const r = await sam.get('/post/' + other.id + '/report');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual([r.body.totals.items, r.body.totals.earnedCents, r.body.reach.views, r.body.daily.length], [0, 0, 0, 0]);
  });
});
