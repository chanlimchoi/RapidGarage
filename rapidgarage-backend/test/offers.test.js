const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const schedule = require('../lib/schedule');

const PW = 'correct-horse';
const H = 3600000;
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);

describe('make an offer (on item holds)', function () {
  this.timeout(30000);
  let now, seller, buyer, buyer2, postId, items, conv, conv2;

  async function user(email, first) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: 'Test' });
    assert.strictEqual(r.status, 201);
    return agent;
  }
  const ask = (agent, c, itemId, extra) => agent.post('/conversations/' + c + '/holds').send(Object.assign({ itemId }, extra));
  const lastEvent = async (agent, c) => { const th = (await agent.get('/conversations/' + c)).body; return th.messages[th.messages.length - 1]; };

  beforeEach(async () => {
    await models.sequelize.sync({ force: true });
    now = new Date();
    schedule.setClock(() => now);
    seller = await user('sam@example.com', 'Sam');
    buyer = await user('bea@example.com', 'Bea');
    buyer2 = await user('cal@example.com', 'Cal');
    const d1 = ymd(new Date(now.getTime() + 24 * H));
    const p = await seller.post('/post').send({ title: 'Moving sale', street: '1 Main St', city: 'Brooklyn', zipCode: '11201',
      schedule: { timeZone: 'America/New_York', days: [{ date: d1, start: '08:00', end: '18:00' }] } });
    postId = p.body.id;
    items = [];
    for (const [name, price] of [['Desk', '40'], ['Mug', '0'], ['Book', null]]) items.push((await seller.post('/post/' + postId + '/items').send({ name, price })).body);
    conv = (await buyer.post('/conversations').send({ postId })).body.id;
    conv2 = (await buyer2.post('/conversations').send({ postId })).body.id;
  });
  after(() => schedule.setClock(null));

  it('buyer offers, seller accepts: the item is reserved at the agreed price', async () => {
    const r = await ask(buyer, conv, items[0].id, { offerCents: 3000 });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.deepStrictEqual([r.body.offerCents, r.body.counterCents], [3000, null]);
    let ev = await lastEvent(seller, conv);
    assert.deepStrictEqual([ev.hold.event, ev.hold.cents], ['requested', 3000]);
    assert.strictEqual(ev.body, 'Offered $30 for “Desk”.');
    const a = await seller.post('/holds/' + r.body.id + '/accept').send({});
    assert.strictEqual(a.status, 200, JSON.stringify(a.body));
    assert.deepStrictEqual([a.body.status, a.body.offerCents], ['accepted', 3000]);
    ev = await lastEvent(buyer, conv);
    assert.deepStrictEqual([ev.hold.event, ev.hold.cents], ['accepted', 3000]);
    // The seller's dashboard shows the agreed price.
    const dash = (await seller.get('/dashboard/sales/' + postId)).body.sale;
    assert.strictEqual(dash.holdList[0].offerCents, 3000);
  });

  it('seller counters, buyer takes it; other requests for the item are declined', async () => {
    const r = await ask(buyer, conv, items[0].id, { offerCents: 2500 });
    const other = await ask(buyer2, conv2, items[0].id, {});
    assert.strictEqual(other.status, 201);
    // Counter must be above the offer and at most the asking price.
    assert.strictEqual((await seller.post('/holds/' + r.body.id + '/counter').send({ offerCents: 2000 })).body.error.details.offerCents, 'A counteroffer has to be more than their offer.');
    assert.strictEqual((await seller.post('/holds/' + r.body.id + '/counter').send({ offerCents: 4500 })).status, 400);
    assert.strictEqual((await buyer.post('/holds/' + r.body.id + '/counter').send({ offerCents: 3500 })).status, 403, 'only the seller counters');
    const c = await seller.post('/holds/' + r.body.id + '/counter').send({ offerCents: 3500 });
    assert.strictEqual(c.status, 200, JSON.stringify(c.body));
    assert.deepStrictEqual([c.body.status, c.body.offerCents, c.body.counterCents], ['pending', 2500, 3500]);
    assert.strictEqual((await lastEvent(buyer, conv)).hold.event, 'countered');
    assert.strictEqual((await seller.post('/holds/' + r.body.id + '/take')).status, 403, 'only the buyer takes it');
    const tk = await buyer.post('/holds/' + r.body.id + '/take');
    assert.strictEqual(tk.status, 200, JSON.stringify(tk.body));
    assert.deepStrictEqual([tk.body.status, tk.body.offerCents, tk.body.counterCents], ['accepted', 3500, null]);
    const ev = await lastEvent(seller, conv);
    assert.deepStrictEqual([ev.hold.event, ev.hold.cents, ev.mine], ['agreed', 3500, false]);
    assert.strictEqual((await models.ItemHold.findByPk(other.body.id)).status, 'declined');
    assert.ok((await models.SaleItem.findByPk(items[0].id)).reservedUntil);
    // Nothing left to take.
    assert.strictEqual((await buyer.post('/holds/' + r.body.id + '/take')).status, 409);
  });

  it('validates offers: below the asking price, not on free items, whole cents', async () => {
    const bad = async (itemId, offerCents) => (await ask(buyer, conv, itemId, { offerCents })).body.error.details.offerCents;
    assert.strictEqual(await bad(items[0].id, 4000), 'Offer less than the asking price, or just ask to hold it.');
    assert.strictEqual(await bad(items[1].id, 100), 'This item is free.');
    assert.strictEqual(await bad(items[0].id, 12.5), 'Enter an amount in dollars, like 5 or 4.50.');
    assert.strictEqual(await bad(items[0].id, 0), 'Enter an amount in dollars, like 5 or 4.50.');
    // No asking price: any positive offer.
    assert.strictEqual((await ask(buyer, conv, items[2].id, { offerCents: 500 })).status, 201);
    // A plain hold can't be countered.
    const plain = await ask(buyer, conv, items[0].id, {});
    assert.strictEqual((await seller.post('/holds/' + plain.body.id + '/counter').send({ offerCents: 3000 })).body.error.code, 'no_offer');
    assert.strictEqual(await models.ItemHold.count(), 2);
  });

  it('accepting after a counter agrees to the original offer', async () => {
    const r = await ask(buyer, conv, items[0].id, { offerCents: 2500 });
    await seller.post('/holds/' + r.body.id + '/counter').send({ offerCents: 3500 });
    const a = await seller.post('/holds/' + r.body.id + '/accept').send({});
    assert.deepStrictEqual([a.body.status, a.body.offerCents, a.body.counterCents], ['accepted', 2500, null]);
  });
});
