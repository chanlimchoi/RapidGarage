const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const schedule = require('../lib/schedule');
const bundles = require('../lib/bundles');

const PW = 'correct-horse';
const H = 3600000;
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);

describe('bundle deals', function () {
  this.timeout(30000);
  let now, seller, buyer, buyer2, admin, postId, items, conv, conv2;

  async function user(email, first) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: 'Test' });
    assert.strictEqual(r.status, 201);
    return agent;
  }
  const deal = (body) => seller.put('/post/' + postId).send(body);
  const ask = (agent, c, ids, extra) => agent.post('/conversations/' + c + '/bundles').send(Object.assign({ itemIds: ids }, extra));
  const thread = async (agent, c) => (await agent.get('/conversations/' + c)).body.messages;
  const holdsOf = (key) => models.ItemHold.findAll({ where: { bundleKey: key }, order: [['id', 'ASC']] });

  beforeEach(async () => {
    await models.sequelize.sync({ force: true });
    now = new Date();
    schedule.setClock(() => now);
    seller = await user('sam@example.com', 'Sam');
    buyer = await user('bea@example.com', 'Bea');
    buyer2 = await user('cal@example.com', 'Cal');
    admin = await user('ada@example.com', 'Ada');
    await models.User.update({ role: 'admin' }, { where: { email: 'ada@example.com' } });
    const d1 = ymd(new Date(now.getTime() + 24 * H));
    const p = await seller.post('/post').send({ title: 'Moving sale', street: '1 Main St', city: 'Brooklyn', zipCode: '11201',
      schedule: { timeZone: 'America/New_York', days: [{ date: d1, start: '08:00', end: '18:00' }] } });
    postId = p.body.id;
    items = [];
    for (const [name, price] of [['Desk', '40'], ['Lamp', '15'], ['Mug', '0'], ['Book', null]]) items.push((await seller.post('/post/' + postId + '/items').send({ name, price })).body);
    conv = (await buyer.post('/conversations').send({ postId })).body.id;
    conv2 = (await buyer2.post('/conversations').send({ postId })).body.id;
  });
  after(() => schedule.setClock(null));

  it('the seller sets a bundle rule; it is validated and shown on the post', async () => {
    let r = await deal({ bundleMinItems: 1, bundlePercent: 20 });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error.details.bundleMinItems, 'A bundle must be 2 to 10 items.');
    r = await deal({ bundleMinItems: 3, bundlePercent: 80 });
    assert.strictEqual(r.body.error.details.bundlePercent, 'The bundle discount must be a whole percent from 5 to 75.');
    r = await deal({ bundlePercent: 20 });
    assert.strictEqual(r.body.error.details.bundleMinItems, 'Choose how many items make a bundle.');
    r = await deal({ bundleMinItems: 2 });
    assert.strictEqual(r.body.error.details.bundlePercent, 'Choose the bundle discount.');
    r = await deal({ bundleMinItems: '2', bundlePercent: '20' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const pub = (await request(app).get('/post/' + postId)).body;
    assert.deepStrictEqual(pub.bundle, { minItems: 2, percent: 20 });
    assert.strictEqual(pub.bundleMinItems, undefined);
    // The buyer's hold panel offers the bundle with current prices.
    const h = (await buyer.get('/conversations/' + conv + '/holds')).body;
    assert.deepStrictEqual(h.bundle, { maxItems: bundles.MAX_ITEMS, minItems: 2, percent: 20 });
    assert.deepStrictEqual(h.holdable.map((i) => i.nowCents), [4000, 1500, 0, null]);
    // Changing just the percent keeps the minimum; clearing one clears both.
    assert.strictEqual((await deal({ bundlePercent: 25 })).status, 200);
    assert.deepStrictEqual((await request(app).get('/post/' + postId)).body.bundle, { minItems: 2, percent: 25 });
    assert.strictEqual((await deal({ bundleMinItems: null, bundlePercent: null })).status, 200);
    assert.strictEqual((await request(app).get('/post/' + postId)).body.bundle, null);
  });

  it('a buyer asks for a bundle through holds and messages; the seller accepts all of it', async () => {
    await deal({ bundleMinItems: 2, bundlePercent: 20 });
    const single = await buyer2.post('/conversations/' + conv2 + '/holds').send({ itemId: items[0].id });
    assert.strictEqual(single.status, 201);
    const r = await ask(buyer, conv, [items[0].id, items[1].id, items[2].id]);
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.deepStrictEqual([r.body.percent, r.body.totalCents, r.body.bundleTotalCents], [20, 5500, 4400]);
    assert.deepStrictEqual(r.body.results.map((h) => h.offerCents), [3200, 1200, null]);
    assert.ok(r.body.results.every((h) => h.bundleKey === r.body.bundleKey && h.status === 'pending'));
    // One event message for the whole bundle, naming every item.
    let msgs = await thread(seller, conv);
    const asked = msgs.filter((m) => m.kind === 'hold');
    assert.strictEqual(asked.length, 1);
    assert.deepStrictEqual([asked[0].hold.event, asked[0].hold.cents, asked[0].mine], ['bundle_requested', 4400, false]);
    assert.deepStrictEqual(asked[0].hold.bundle, { count: 3, items: ['Desk', 'Lamp', 'Mug'] });
    assert.strictEqual(asked[0].body, 'Asked for a bundle: Desk, Lamp, Mug for $44.');
    // No counteroffers on a bundle; accepting one hold accepts the bundle.
    const id = r.body.results[1].id;
    assert.strictEqual((await seller.post('/holds/' + id + '/counter').send({ offerCents: 1400 })).body.error.code, 'bundle');
    assert.strictEqual((await buyer.post('/holds/' + id + '/accept').send({})).status, 403);
    const a = await seller.post('/holds/' + id + '/accept').send({});
    assert.strictEqual(a.status, 200, JSON.stringify(a.body));
    const rows = await holdsOf(r.body.bundleKey);
    assert.deepStrictEqual(rows.map((h) => h.status), ['accepted', 'accepted', 'accepted']);
    for (const it of items.slice(0, 3)) assert.ok((await models.SaleItem.findByPk(it.id)).reservedUntil);
    msgs = await thread(buyer, conv);
    const ev = msgs[msgs.length - 1];
    assert.deepStrictEqual([ev.hold.event, ev.hold.cents, ev.hold.bundle.count], ['bundle_accepted', 4400, 3]);
    // The other buyer's request for the desk lost out.
    assert.deepStrictEqual([(await models.ItemHold.findByPk(single.body.id)).status, (await models.ItemHold.findByPk(single.body.id)).endedReason], ['declined', 'taken']);
    // The buyer gives up the bundle: every item is free again, one message.
    const c = await buyer.post('/holds/' + r.body.results[0].id + '/cancel');
    assert.strictEqual(c.status, 200, JSON.stringify(c.body));
    assert.deepStrictEqual((await holdsOf(r.body.bundleKey)).map((h) => h.status), ['cancelled', 'cancelled', 'cancelled']);
    for (const it of items.slice(0, 3)) assert.strictEqual((await models.SaleItem.findByPk(it.id)).reservedUntil, null);
    msgs = await thread(seller, conv);
    assert.strictEqual(msgs[msgs.length - 1].hold.event, 'bundle_cancelled');
    assert.strictEqual(msgs[msgs.length - 1].body, 'Cancelled the bundle: Desk, Lamp, Mug.');
  });

  it('the seller declines the bundle as a whole; acceptance is all or nothing', async () => {
    await deal({ bundleMinItems: 2, bundlePercent: 10 });
    const r = await ask(buyer, conv, [items[0].id, items[1].id]);
    assert.strictEqual(r.status, 201);
    const d = await seller.post('/holds/' + r.body.results[0].id + '/decline');
    assert.strictEqual(d.status, 200);
    assert.deepStrictEqual((await holdsOf(r.body.bundleKey)).map((h) => h.status), ['declined', 'declined']);
    const msgs = await thread(buyer, conv);
    assert.deepStrictEqual([msgs[msgs.length - 1].hold.event, msgs[msgs.length - 1].mine], ['bundle_declined', false]);
    // A second bundle, but the lamp gets reserved for someone else first.
    const r2 = await ask(buyer2, conv2, [items[0].id, items[1].id]);
    assert.strictEqual(r2.status, 201, JSON.stringify(r2.body));
    await models.SaleItem.update({ reservedUntil: new Date(now.getTime() + H) }, { where: { id: items[1].id } });
    const a = await seller.post('/holds/' + r2.body.results[0].id + '/accept').send({});
    assert.strictEqual(a.status, 409);
    assert.deepStrictEqual((await holdsOf(r2.body.bundleKey)).map((h) => h.status), ['pending', 'pending']);
    assert.strictEqual((await models.SaleItem.findByPk(items[0].id)).reservedUntil, null, 'the desk reservation was undone');
  });

  it('rejects bundles that break the rules', async () => {
    assert.strictEqual((await ask(buyer, conv, [items[0].id, items[1].id])).body.error.code, 'no_bundle');
    await deal({ bundleMinItems: 3, bundlePercent: 20 });
    let r = await ask(buyer, conv, [items[0].id, items[1].id]);
    assert.strictEqual(r.body.error.details.itemIds, 'Choose at least 3 items for the bundle.');
    r = await ask(buyer, conv, [items[0].id, items[1].id, items[3].id]);
    assert.strictEqual(r.body.error.details.itemIds, 'Every item in a bundle needs a price.');
    assert.strictEqual((await ask(buyer, conv, 'nope')).status, 400);
    assert.strictEqual((await ask(buyer, conv, [items[0].id, items[1].id, 99999])).status, 404);
    assert.strictEqual((await ask(seller, conv, [items[0].id, items[1].id, items[2].id])).status, 403, 'only the buyer asks');
    assert.strictEqual((await ask(buyer2, conv, [items[0].id, items[1].id, items[2].id])).status, 404, 'not a participant');
    await models.SaleItem.update({ sold: true }, { where: { id: items[2].id } });
    assert.strictEqual((await ask(buyer, conv, [items[0].id, items[1].id, items[2].id])).body.error.code, 'item_unavailable');
    await models.SaleItem.update({ sold: false }, { where: { id: items[2].id } });
    // Blocks end the conversation for bundles too.
    await seller.post('/conversations/' + conv + '/block');
    assert.strictEqual((await ask(buyer, conv, [items[0].id, items[1].id, items[2].id])).body.error.code, 'blocked');
    await seller.delete('/conversations/' + conv + '/block');
    assert.strictEqual((await ask(buyer, conv, [items[0].id, items[1].id, items[2].id])).status, 201);
    assert.strictEqual((await ask(buyer, conv, [items[0].id, items[1].id, items[2].id])).body.error.code, 'already_requested');
  });

  it('keeps the bundle conversation private and names people as first name and last initial', async () => {
    await deal({ bundleMinItems: 2, bundlePercent: 20 });
    assert.strictEqual((await ask(buyer, conv, [items[0].id, items[1].id])).status, 201);
    assert.strictEqual((await admin.get('/admin/conversations/' + conv)).status, 404, 'admins cannot read unreported conversations');
    const view = (await seller.get('/conversations/' + conv)).body;
    const txt = JSON.stringify(view);
    assert.ok(!txt.includes('bea@example.com') && !txt.includes('sam@example.com'), 'no emails');
    assert.strictEqual(view.conversation.other.name, 'Bea T.');
  });

  it('prices a bundle from the current (marked down) price, rounded down', () => {
    assert.strictEqual(bundles.bundleCents(1999, 15), 1699);
    const post = { bundleMinItems: 2, bundlePercent: 10, markdownPercent: null };
    const q = bundles.quote(post, [{ priceCents: 1000 }, { priceCents: 555 }, { priceCents: 0 }], new Date());
    assert.deepStrictEqual([q.totalCents, q.bundleTotalCents], [1555, 1399]);
  });
});
