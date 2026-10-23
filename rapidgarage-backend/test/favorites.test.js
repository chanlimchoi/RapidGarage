// Favorites updates: people who favorited (saved) a sale hear in-app when it
// gets cheaper (item price, the sale's price range, a markdown starting) or
// items sell. Coalesced per sale; never the seller; blocks respected.
const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const schedule = require('../lib/schedule');
const alerts = require('../lib/alerts');
const favorites = require('../lib/favorites');

const PW = 'correct-horse';

describe('favorites updates', function () {
  this.timeout(30000);
  let seller, fan, stranger, sellerId, fanId, now;

  async function user(email, first, last) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: last });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return [agent, r.body.id];
  }
  async function sale(extra) {
    const p = await seller.post('/post').send(Object.assign({ title: 'Porch sale', street: '1 Main St', city: 'Brooklyn', zipCode: '11201',
      schedule: { timeZone: 'America/New_York', days: [{ date: '2026-10-24', start: '08:00', end: '16:00' }] } }, extra));
    assert.strictEqual(p.status, 201, JSON.stringify(p.body));
    return p.body;
  }
  const item = async (postId, name, price) => (await seller.post('/post/' + postId + '/items').send({ name, price })).body;
  const setItem = async (postId, id, body) => { const r = await seller.put('/post/' + postId + '/items/' + id).send(body); assert.strictEqual(r.status, 200, JSON.stringify(r.body)); await alerts.idle(); };
  const bell = async (agent) => (await agent.get('/notifications')).body.results;

  beforeEach(async () => {
    await models.sequelize.sync({ force: true });
    now = new Date('2026-10-20T15:00:00Z');
    schedule.setClock(() => now);
    [seller, sellerId] = await user('sam.seller@example.com', 'Sam', 'Seller');
    [fan, fanId] = await user('fay.fan@example.com', 'Fay', 'Fan');
    [stranger] = await user('stu.stranger@example.com', 'Stu', 'Stranger');
  });
  after(() => schedule.setClock(null));

  it('an item price drop tells favoriters, coalesces repeated drops, and ignores raises', async () => {
    const p = await sale();
    const lamp = await item(p.id, 'Brass lamp', '40');
    const rug = await item(p.id, 'Rug', '30');
    assert.strictEqual((await fan.put('/saved/' + p.id)).status < 300, true);
    await setItem(p.id, lamp.id, { price: '45' });
    assert.deepStrictEqual(await bell(fan), [], 'a raise is not news');
    await setItem(p.id, lamp.id, { price: '30' });
    let list = await bell(fan);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].kind, 'price_drop');
    assert.deepStrictEqual(list[0].data.items, [{ id: lamp.id, name: 'Brass lamp', from: 4500, to: 3000 }]);
    // More drops before they look: still one notification, "from" stays the first price.
    await setItem(p.id, lamp.id, { price: '25' });
    await setItem(p.id, rug.id, { price: '20' });
    list = await bell(fan);
    assert.strictEqual(list.length, 1);
    assert.deepStrictEqual(list[0].data.items.map((i) => [i.name, i.from, i.to]), [['Rug', 3000, 2000], ['Brass lamp', 4500, 2500]]);
    // Once seen, the next drop is a new notification.
    await fan.post('/notifications/seen').send({});
    await setItem(p.id, rug.id, { price: '10' });
    list = await bell(fan);
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list.filter((n) => !n.seen).length, 1);
    // Nobody else hears; the seller doesn't hear about their own sale.
    assert.deepStrictEqual(await bell(stranger), []);
    assert.deepStrictEqual(await bell(seller), []);
    // Privacy: the seller shows as "First L.", no emails.
    assert.deepStrictEqual(list[0].post.seller, { id: sellerId, name: 'Sam S.' });
    assert.ok(!/@/.test(JSON.stringify(list)));
  });

  it('items selling, then the last one: item_sold, then sold out', async () => {
    const p = await sale();
    const a = await item(p.id, 'Desk', '50');
    const b = await item(p.id, 'Chair', '15');
    await fan.put('/saved/' + p.id);
    await setItem(p.id, a.id, { sold: true });
    let list = await bell(fan);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].kind, 'item_sold');
    assert.deepStrictEqual(list[0].data, { items: [{ id: a.id, name: 'Desk' }], soldOut: false });
    await setItem(p.id, a.id, { sold: true }); // already sold: nothing new
    await setItem(p.id, b.id, { sold: true });
    list = await bell(fan);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].data.soldOut, true);
    assert.deepStrictEqual(list[0].data.items.map((i) => i.name), ['Chair', 'Desk']);
    // Sold items never count as a price drop.
    await setItem(p.id, b.id, { price: '1' });
    assert.strictEqual((await bell(fan)).filter((n) => n.kind === 'price_drop').length, 0);
  });

  it('the sale\'s own price range: lower or now free is a drop; higher is not', async () => {
    const p = await sale({ priceMin: 5, priceMax: 100 });
    await fan.put('/saved/' + p.id);
    assert.strictEqual((await seller.put('/post/' + p.id).send({ priceMin: 5, priceMax: 150 })).status, 200);
    await alerts.idle();
    assert.deepStrictEqual(await bell(fan), []);
    assert.strictEqual((await seller.put('/post/' + p.id).send({ priceMin: 5, priceMax: 60 })).status, 200);
    await alerts.idle();
    let list = await bell(fan);
    assert.deepStrictEqual(list[0].data.price, { from: 150, to: 60 });
    assert.strictEqual((await seller.put('/post/' + p.id).send({ isFree: true, priceMin: null, priceMax: null })).status, 200);
    await alerts.idle();
    list = await bell(fan);
    assert.strictEqual(list.length, 1, 'coalesced');
    assert.deepStrictEqual(list[0].data.price, { from: 150, to: 0 });
  });

  it('a scheduled markdown starting is a price drop, once per markdown window', async () => {
    const p = await sale({ markdownPercent: 25, markdownFrom: '14:00' });
    await fan.put('/saved/' + p.id);
    now = new Date('2026-10-24T17:00:00Z'); // 1pm New York: not yet
    assert.strictEqual(await favorites.markdownsStarted(now), 0);
    now = new Date('2026-10-24T18:30:00Z'); // 2:30pm
    assert.strictEqual(await favorites.markdownsStarted(now), 1);
    assert.strictEqual(await favorites.markdownsStarted(now), 0, 'told once');
    const list = await bell(fan);
    assert.strictEqual(list[0].kind, 'price_drop');
    assert.deepStrictEqual(list[0].data, { markdown: 25 });
    // The worker pass runs it too (no crash, counted).
    const summary = await alerts.processQueue(now);
    assert.strictEqual(summary.markdownDrops, 0);
  });

  it('blocks and hidden sales stop it', async () => {
    const p = await sale();
    const lamp = await item(p.id, 'Lamp', '20');
    await fan.put('/saved/' + p.id);
    await models.UserBlock.create({ blockerId: fanId, blockedId: sellerId });
    await setItem(p.id, lamp.id, { price: '10' });
    assert.strictEqual(await models.Notification.count(), 0);
    await models.UserBlock.destroy({ where: {} });
    await models.Post.update({ hidden: true }, { where: { id: p.id } });
    const post = await models.Post.findByPk(p.id);
    assert.deepStrictEqual(await favorites.watchers(post), []);
  });

  it('merge keeps at most 5 items, newest first', () => {
    let d = null;
    for (let i = 1; i <= 7; i++) d = favorites.merge(d, { items: [{ id: i, name: 'I' + i }] });
    assert.deepStrictEqual(d.items.map((x) => x.id), [7, 6, 5, 4, 3]);
  });
});
