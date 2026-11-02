const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const schedule = require('../lib/schedule');
const offerRules = require('../lib/offerRules');

const PW = 'correct-horse';
// The sale is "tomorrow" in New York by calendar day (DST-safe: no 24 h steps).
const nyDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
const daysAfter = (ymdStr, n) => { const x = new Date(ymdStr + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

describe('offer rules (auto-accept and floor)', function () {
  this.timeout(30000);
  let now, seller, buyer, buyer2, postId, items, conv, conv2;

  async function user(email, first) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: 'Test' });
    assert.strictEqual(r.status, 201);
    return agent;
  }
  const ask = (agent, c, itemId, extra) => agent.post('/conversations/' + c + '/holds').send(Object.assign({ itemId }, extra));
  const thread = async (agent, c) => (await agent.get('/conversations/' + c)).body.messages;

  beforeEach(async () => {
    await models.sequelize.sync({ force: true });
    now = new Date();
    schedule.setClock(() => now);
    seller = await user('sam@example.com', 'Sam');
    buyer = await user('bea@example.com', 'Bea');
    buyer2 = await user('cal@example.com', 'Cal');
    const p = await seller.post('/post').send({ title: 'Moving sale', street: '1 Main St', city: 'Brooklyn', zipCode: '11201',
      schedule: { timeZone: 'America/New_York', days: [{ date: daysAfter(nyDay(now), 1), start: '08:00', end: '18:00' }] } });
    postId = p.body.id;
    items = [];
    for (const [name, price] of [['Desk', '40'], ['Lamp', '10'], ['Book', null], ['Mug', '0']]) items.push((await seller.post('/post/' + postId + '/items').send({ name, price })).body);
    conv = (await buyer.post('/conversations').send({ postId })).body.id;
    conv2 = (await buyer2.post('/conversations').send({ postId })).body.id;
  });
  after(() => schedule.setClock(null));

  it('effective rule: item overrides sale percent; floor never above accept', () => {
    const post = { offerAcceptPercent: 80, offerFloorPercent: 50 };
    assert.deepStrictEqual(offerRules.effective({ priceCents: 4000 }, post), { acceptCents: 3200, floorCents: 2000, source: 'sale' });
    assert.deepStrictEqual(offerRules.effective({ priceCents: 999 }, post), { acceptCents: 800, floorCents: 499, source: 'sale' });
    assert.deepStrictEqual(offerRules.effective({ priceCents: 4000, offerAcceptCents: 3500 }, post), { acceptCents: 3500, floorCents: 2000, source: 'item' });
    assert.deepStrictEqual(offerRules.effective({ priceCents: null, offerFloorCents: 500 }, post), { acceptCents: null, floorCents: 500, source: 'item' });
    assert.deepStrictEqual(offerRules.effective({ priceCents: null }, post), { acceptCents: null, floorCents: null, source: null });
    assert.deepStrictEqual(offerRules.effective({ priceCents: 4000, offerAcceptCents: 1000 }, post), { acceptCents: 1000, floorCents: 1000, source: 'item' });
    assert.strictEqual(offerRules.decide(3200, { acceptCents: 3200, floorCents: 2000 }), 'accept');
    assert.strictEqual(offerRules.decide(1999, { acceptCents: 3200, floorCents: 2000 }), 'decline');
    assert.strictEqual(offerRules.decide(2000, { acceptCents: 3200, floorCents: 2000 }), null);
  });

  it('seller sets rules (owner only, validated, never public)', async () => {
    assert.strictEqual((await buyer.get('/post/' + postId + '/offer-rules')).status, 403);
    let r = await seller.put('/post/' + postId + '/offer-rules').send({ acceptPercent: 50, floorPercent: 60 });
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.error.details.floorPercent);
    assert.strictEqual((await seller.put('/post/' + postId + '/offer-rules').send({ acceptPercent: 100 })).status, 400);
    r = await seller.put('/post/' + postId + '/offer-rules').send({ acceptPercent: 80, floorPercent: '50' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.sale, { acceptPercent: 80, floorPercent: 50 });
    assert.deepStrictEqual(r.body.items.map((i) => [i.name, i.effective.acceptCents, i.effective.floorCents]),
      [['Desk', 3200, 2000], ['Lamp', 800, 500], ['Book', null, null], ['Mug', null, null]]);
    // Item rules: below the asking price, floor below accept, not on free items.
    const put = (i, body) => seller.put('/post/' + postId + '/offer-rules/items/' + items[i].id).send(body);
    assert.ok((await put(0, { accept: '40' })).body.error.details.accept);
    assert.ok((await put(0, { accept: '30', floor: '30' })).body.error.details.floor);
    assert.strictEqual((await put(3, { accept: '1' })).status, 400);
    assert.strictEqual((await put(0, { accept: 'abc' })).status, 400);
    assert.strictEqual((await buyer.put('/post/' + postId + '/offer-rules/items/' + items[0].id).send({ accept: '30' })).status, 403);
    r = await put(2, { accept: '15', floor: '5' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.items[2].effective, { acceptCents: 1500, floorCents: 500, source: 'item' });
    // Public post and item JSON never carry the rules.
    const pub = JSON.stringify((await request(app).get('/post/' + postId)).body) + JSON.stringify((await buyer.get('/post/' + postId + '/items')).body)
      + JSON.stringify((await buyer.get('/conversations/' + conv + '/holds')).body);
    assert.ok(!/offerAccept|offerFloor|Percent/.test(pub), pub);
    // Clearing.
    r = await seller.put('/post/' + postId + '/offer-rules').send({ acceptPercent: null, floorPercent: '' });
    assert.deepStrictEqual(r.body.sale, { acceptPercent: null, floorPercent: null });
  });

  it('offers at or above auto-accept are accepted and reserved; below the floor declined politely; in between wait', async () => {
    await seller.put('/post/' + postId + '/offer-rules').send({ acceptPercent: 80, floorPercent: 50 });
    // In between: pending, the seller is asked.
    const mid = await ask(buyer, conv, items[0].id, { offerCents: 2500 });
    assert.deepStrictEqual([mid.status, mid.body.status, mid.body.auto], [201, 'pending', null]);
    assert.strictEqual((await thread(seller, conv)).slice(-1)[0].hold.event, 'requested');
    await buyer.post('/holds/' + mid.body.id + '/cancel');
    // Below the floor: declined, no cooldown, floor not revealed.
    const low = await ask(buyer, conv, items[0].id, { offerCents: 1500 });
    assert.deepStrictEqual([low.status, low.body.status, low.body.auto, low.body.endedReason], [201, 'declined', 'declined', 'floor']);
    let ev = (await thread(buyer, conv)).slice(-1)[0];
    assert.deepStrictEqual([ev.hold.event, ev.hold.cents, ev.mine], ['auto_declined', 1500, false]);
    assert.ok(!/\$20/.test(ev.body), ev.body);
    // At auto-accept: accepted and reserved at the offer, the seller isn't asked.
    const hi = await ask(buyer, conv, items[0].id, { offerCents: 3200 });
    assert.deepStrictEqual([hi.status, hi.body.status, hi.body.auto, hi.body.offerCents], [201, 'accepted', 'accepted', 3200]);
    assert.ok((await models.SaleItem.findByPk(items[0].id)).reservedUntil > now);
    ev = (await thread(seller, conv)).slice(-1)[0];
    assert.deepStrictEqual([ev.hold.event, ev.hold.cents, ev.mine], ['auto_accepted', 3200, true]);
    assert.strictEqual((await seller.get('/conversations/unread')).body.count, 0, 'nothing for the seller to answer');
    // Someone else can't hold the reserved item.
    assert.strictEqual((await ask(buyer2, conv2, items[0].id, { offerCents: 3900 })).status, 409);
    assert.strictEqual(require('../lib/push').OFFER_TITLES.auto_accepted, 'push.offerAcceptedTitle');
  });

  it('auto-accept respects earlier full-price requests and higher offers; plain holds, bundles and items without rules are untouched', async () => {
    await seller.put('/post/' + postId + '/offer-rules/items/' + items[1].id).send({ accept: '6', floor: '3' });
    // Cal asked to hold the lamp at full price first: Bea's $7 offer waits for the seller.
    const plain = await ask(buyer2, conv2, items[1].id, {});
    assert.strictEqual(plain.body.status, 'pending');
    const r = await ask(buyer, conv, items[1].id, { offerCents: 700 });
    assert.deepStrictEqual([r.body.status, r.body.auto], ['pending', null]);
    // A plain hold request is never auto-answered, even below the floor.
    assert.strictEqual(plain.body.auto, null);
    // Book: no asking price, item floor $5 -> $4 declined; Mug is free (no offers at all).
    await seller.put('/post/' + postId + '/offer-rules/items/' + items[2].id).send({ floor: '5' });
    const b = await ask(buyer, conv, items[2].id, { offerCents: 400 });
    assert.deepStrictEqual([b.body.status, b.body.auto], ['declined', 'declined']);
    // The floor decline doesn't start the 24 h "declined" cooldown: a higher offer goes through to the seller.
    const b2 = await ask(buyer, conv, items[2].id, { offerCents: 600 });
    assert.deepStrictEqual([b2.status, b2.body.status, b2.body.auto], [201, 'pending', null]);
  });
});
