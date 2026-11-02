const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const schedule = require('../lib/schedule');
const alerts = require('../lib/alerts');
const push = require('../lib/push');

const PW = 'correct-horse';
const H = 3600000;
// Calendar days in New York (DST-safe): the sale is "tomorrow", 08:00-12:00.
const nyDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
const addDays = (ymd, n) => { const x = new Date(ymd + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

describe('leftover donation lots', function () {
  this.timeout(30000);
  let sam, bea, cal, dee, beaId, postId, items, now, saleDay;

  async function user(email, first) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: 'Test' });
    assert.strictEqual(r.status, 201);
    return [agent, r.body.id];
  }
  const lot = (rest) => '/donations/' + postId + (rest || '');
  const slotsFrom = (base, n) => Array.from({ length: n }, (_, i) => new Date(base.getTime() + (i + 2) * H).toISOString());

  after(() => { schedule.setClock(null); geo.setProvider(null); });
  afterEach(() => alerts.idle());
  beforeEach(async () => {
    geo.setProvider(() => Promise.resolve({ status: 'ok', lat: 40.75, lng: -73.98 }));
    await models.sequelize.sync({ force: true });
    now = new Date(Math.floor(Date.now() / H) * H);
    schedule.setClock(() => now);
    [sam] = await user('sam@example.com', 'Sam');
    [bea, beaId] = await user('bea@example.com', 'Bea');
    [cal] = await user('cal@example.com', 'Cal');
    [dee] = await user('dee@example.com', 'Dee');
    saleDay = addDays(nyDay(now), 1);
    const p = await sam.post('/post').send({ title: 'Moving sale', street: '1 Main St', city: 'New York', state: 'NY', zipCode: '10036',
      schedule: { timeZone: 'America/New_York', days: [{ date: saleDay, start: '08:00', end: '12:00' }] } });
    assert.strictEqual(p.status, 201, JSON.stringify(p.body));
    postId = p.body.id;
    await models.Post.update({ lat: 40.75, lng: -73.98 }, { where: { id: postId } });
    items = (await sam.post('/post/' + postId + '/items/bulk').send({ items: [{ name: 'Lamp', price: '5' }, { name: 'Chair', price: '20' }, { name: 'Books' }] })).body.items;
    await sam.put('/post/' + postId + '/items/' + items[0].id).send({ sold: true });
  });
  // The day after the sale, 10:00 New York.
  const afterSale = () => { now = schedule.zonedToUtc(addDays(saleDay, 1), '10:00', 'America/New_York'); };

  it('only after the sale ends, by the seller; unsold items, validated slots', async () => {
    const early = await sam.put(lot()).send({ slots: slotsFrom(now, 1) });
    assert.deepStrictEqual([early.status, early.body.error.code], [409, 'sale_not_ended']);
    afterSale();
    assert.strictEqual((await bea.put(lot()).send({ slots: slotsFrom(now, 1) })).status, 403);
    assert.ok((await sam.put(lot()).send({ slots: [] })).body.error.details.slots);
    assert.ok((await sam.put(lot()).send({ slots: [new Date(now.getTime() - H).toISOString()] })).body.error.details.slots);
    assert.ok((await sam.put(lot()).send({ slots: [new Date(now.getTime() + 8 * 24 * H).toISOString()] })).body.error.details.slots);
    assert.ok((await sam.put(lot()).send({ slots: slotsFrom(now, 1), itemIds: [items[0].id] })).body.error.details.itemIds, 'sold items are not leftovers');
    assert.ok((await sam.put(lot()).send({ slots: slotsFrom(now, 1), minutes: 45 })).body.error.details.minutes);
    const r = await sam.put(lot()).send({ slots: slotsFrom(now, 2), minutes: 60, note: 'Also two boxes of kitchen stuff' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.deepStrictEqual([r.body.status, r.body.role, r.body.itemCount, r.body.items.map((i) => i.name), r.body.slots.length, r.body.slotMinutes],
      ['open', 'seller', 2, ['Chair', 'Books'], 2, 60]);
    const ko = await sam.put(lot()).set('Accept-Language', 'ko').send({ slots: [] });
    assert.strictEqual(ko.body.error.details.slots, '픽업 시간을 하나 이상 제안하세요.');
  });

  it('nearby people find it (and curb-alert holders are told); one claimer per lot; the seller sees who', async () => {
    const ca = await bea.put('/curb/alert').send({ lat: 40.751, lng: -73.981, radiusMiles: 2 });
    assert.ok(ca.status < 300, JSON.stringify(ca.body));
    afterSale();
    const slots = slotsFrom(now, 2);
    await sam.put(lot()).send({ slots });
    await alerts.idle();
    const bell = (await bea.get('/notifications')).body.results;
    assert.deepStrictEqual([bell[0].kind, bell[0].post.id], ['donation_lot', postId]);
    // Search by place.
    let near = await cal.get('/donations/nearby').query({ lat: 40.76, lng: -73.97, radius: 5 });
    assert.strictEqual(near.status, 200);
    assert.deepStrictEqual(near.body.results.map((l) => [l.postId, l.itemCount, l.claimed]), [[postId, 2, false]]);
    assert.ok(near.body.results[0].distanceMiles < 2);
    assert.strictEqual((await cal.get('/donations/nearby').query({ lat: 41.9, lng: -87.6, radius: 25 })).body.results.length, 0);
    assert.strictEqual((await cal.get('/donations/nearby').query({ lat: 40.76, lng: -73.97, radius: 3 })).status, 400);
    // Claims: not your own, an offered slot, one winner.
    assert.strictEqual((await sam.post(lot('/claim')).send({ slot: slots[0] })).status, 403);
    assert.ok((await cal.post(lot('/claim')).send({ slot: new Date(now.getTime() + 5 * H).toISOString() })).body.error.details.slot);
    const c = await cal.post(lot('/claim')).send({ slot: slots[1], org: 'Northside Food Pantry' });
    assert.strictEqual(c.status, 200, JSON.stringify(c.body));
    assert.deepStrictEqual([c.body.status, c.body.role, c.body.chosen.start, c.body.org], ['claimed', 'claimer', slots[1], 'Northside Food Pantry']);
    assert.ok(c.body.conversationId);
    assert.strictEqual((await dee.post(lot('/claim')).send({ slot: slots[0] })).status, 409);
    // Others no longer see it nearby, nor the slots; the seller sees the claimer as "First L." and the org.
    assert.strictEqual((await dee.get('/donations/nearby').query({ lat: 40.76, lng: -73.97, radius: 5 })).body.results.length, 0);
    const pub = (await dee.get(lot())).body;
    assert.deepStrictEqual([pub.claimed, pub.slots.length, pub.claimer, pub.chosen], [true, 0, undefined, undefined]);
    const mine = (await sam.get(lot())).body;
    assert.deepStrictEqual(mine.claimer, { name: 'Cal T.', org: 'Northside Food Pantry' });
    const sbell = (await sam.get('/notifications')).body.results[0];
    assert.deepStrictEqual([sbell.kind, sbell.data.name, sbell.data.org], ['donation_claimed', 'Cal T.', 'Northside Food Pantry']);
    assert.ok(!JSON.stringify(pub).includes('@') && !JSON.stringify(mine).includes('@'));
    // The claimer and seller share a conversation.
    assert.strictEqual((await cal.get('/conversations/' + c.body.conversationId)).status, 200);
    assert.strictEqual((await sam.get('/donations/mine')).body.results.length, 1);
    assert.strictEqual((await cal.get('/donations/mine')).body.results[0].role, 'claimer');
  });

  it('unclaim, release, done, take down; blocks hide it', async () => {
    afterSale();
    const slots = slotsFrom(now, 2);
    await sam.put(lot()).send({ slots });
    await cal.post(lot('/claim')).send({ slot: slots[0] });
    // Changing a claimed lot needs a release first.
    assert.strictEqual((await sam.put(lot()).send({ slots })).status, 409);
    assert.strictEqual((await dee.post(lot('/unclaim'))).status, 403);
    let r = await cal.post(lot('/unclaim'));
    assert.deepStrictEqual([r.status, r.body.status], [200, 'open']);
    assert.strictEqual((await sam.get('/notifications')).body.results[0].data.event, 'unclaimed');
    await dee.post(lot('/claim')).send({ slot: slots[0] });
    r = await sam.post(lot('/release'));
    assert.deepStrictEqual([r.status, r.body.status], [200, 'open']);
    assert.strictEqual((await dee.get('/notifications')).body.results[0].data.event, 'released');
    await dee.post(lot('/claim')).send({ slot: slots[1] });
    assert.strictEqual((await dee.post(lot('/done'))).status, 403);
    r = await sam.post(lot('/done'));
    assert.deepStrictEqual([r.status, r.body.status], [200, 'done']);
    assert.strictEqual((await cal.get(lot())).status, 404, 'done lots are gone for others');
    // A new lot after it was done, then a block hides it; take-down.
    await sam.put(lot()).send({ slots });
    await models.UserBlock.create({ blockerId: beaId, blockedId: (await models.Post.findByPk(postId)).userId });
    assert.strictEqual((await bea.get(lot())).status, 404);
    assert.strictEqual((await bea.get('/donations/nearby').query({ lat: 40.75, lng: -73.98, radius: 1 })).body.results.length, 0);
    assert.strictEqual((await bea.post(lot('/claim')).send({ slot: slots[0] })).status, 404);
    assert.strictEqual((await sam.delete(lot())).status, 204);
    assert.strictEqual((await cal.get(lot())).status, 404);
    // Past slots drop the lot from nearby.
    await sam.put(lot()).send({ slots: slotsFrom(now, 1) });
    now = new Date(now.getTime() + 4 * H);
    assert.strictEqual((await cal.get('/donations/nearby').query({ lat: 40.75, lng: -73.98, radius: 1 })).body.results.length, 0);
    await push.idle();
  });
});
