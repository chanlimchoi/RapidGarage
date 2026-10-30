const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const alerts = require('../lib/alerts');
const push = require('../lib/push');
const geo = require('../lib/geo');

const C = { lat: 40.758, lng: -73.9855 };
const fakeProvider = () => Promise.resolve({ status: 'ok', lat: C.lat, lng: C.lng });

const PW = 'correct-horse';
const P256DH = 'B' + 'x'.repeat(86);
const AUTH = 'a'.repeat(22);
const FCM = (n) => 'https://fcm.googleapis.com/fcm/send/device-' + n;

describe('push for offers and saved-search matches', function () {
  this.timeout(30000);
  let sam, bea, samId, beaId, sent;
  const sub = (endpoint) => ({ endpoint, keys: { p256dh: P256DH, auth: AUTH } });
  async function user(email, firstName, lastName) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName, lastName });
    return [agent, r.body.id];
  }
  const ENV = ['GOOGLE_MAPS_API_KEY'];
  const saved = {};
  before(() => ENV.forEach((k) => { saved[k] = process.env[k]; }));
  const to = (id) => sent.filter((s) => s.userId === id).map((s) => s.payload);

  beforeEach(async () => {
    sent = [];
    process.env.GOOGLE_MAPS_API_KEY = 'test-server-key';
    geo.setProvider(fakeProvider);
    geo.resetRateLimits();
    await models.sequelize.sync({ force: true });
    [sam, samId] = await user('sam@example.com', 'Sam', 'Seller');
    [bea, beaId] = await user('bea@example.com', 'Bea', 'Buyer');
    push.setSender(async (s, payload) => {
      const row = await models.PushSubscription.findOne({ where: { endpoint: s.endpoint }, attributes: ['userId'], raw: true });
      sent.push({ userId: row && row.userId, payload: JSON.parse(payload) });
      return { statusCode: 201 };
    });
    await sam.post('/push/subscriptions').send(sub(FCM(1)));
    await bea.post('/push/subscriptions').send(sub(FCM(2)));
  });
  after(() => {
    push.setSender(null);
    geo.setProvider(null);
    ENV.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  });

  it('settings list offers and searches, on by default, and save each one', async () => {
    const s = (await bea.get('/push/settings')).body;
    assert.deepStrictEqual(s.prefs, { messages: true, follows: true, reminders: true, offers: true, searches: true });
    const r = await bea.put('/push/settings').send({ offers: false });
    assert.strictEqual(r.body.prefs.offers, false);
    assert.strictEqual(r.body.prefs.searches, true);
    assert.strictEqual((await bea.put('/push/settings').send({ searches: 'no' })).status, 400);
  });

  it('an offer, a counter and an acceptance use the offers switch; plain hold steps stay messages', async () => {
    const post = (await sam.post('/post').send({ title: 'Moving sale', zipCode: '10001' })).body;
    await alerts.idle();
    const desk = (await sam.post('/post/' + post.id + '/items').send({ name: 'Desk', price: '40' })).body;
    const mug = (await sam.post('/post/' + post.id + '/items').send({ name: 'Mug', price: '5' })).body;
    const conv = (await bea.post('/conversations').send({ postId: post.id })).body.id;
    await push.idle(); sent = [];

    const hold = (await bea.post('/conversations/' + conv + '/holds').send({ itemId: desk.id, offerCents: 3000 })).body;
    await push.idle();
    assert.deepStrictEqual(to(samId).map((p) => p.title), ['New offer from Bea B.']);
    assert.strictEqual(to(samId)[0].url, '/messages/' + conv);
    assert.strictEqual(to(samId)[0].body, 'About “Moving sale”. Open RapidGarage to read it.');

    await sam.post('/holds/' + hold.id + '/counter').send({ offerCents: 3500 });
    await push.idle();
    assert.deepStrictEqual(to(beaId).map((p) => p.title), ['Sam S. sent a counteroffer']);

    // Offers off: the next offer step doesn't buzz Sam, but a plain hold request (no amount) is a message.
    await sam.put('/push/settings').send({ offers: false });
    sent = [];
    await bea.post('/holds/' + hold.id + '/agree').send({});
    await bea.post('/conversations/' + conv + '/holds').send({ itemId: mug.id });
    await push.idle();
    assert.deepStrictEqual(to(samId).map((p) => p.title), ['New message from Bea B.']);
  });

  it('a new sale matching a saved search pushes once, naming the search, and respects the switch', async () => {
    assert.ok((await bea.post('/alerts').send({ lat: C.lat, lng: C.lng, radiusMiles: 5, label: 'Near home' })).status < 300);
    await push.idle(); sent = [];

    const p = (await sam.post('/post').send({ title: 'Garage clear-out', street: '1 Main St', city: 'New York', state: 'NY', zipCode: '10036' })).body;
    await alerts.idle(); await push.idle();
    assert.deepStrictEqual(to(beaId), [{ title: 'New match for “Near home”', body: 'Garage clear-out', url: '/post/' + p.id, tag: 'search-' + p.id }]);
    assert.ok(!JSON.stringify(to(beaId)).includes('lat'), 'no location on the lock screen');

    // An edit re-checks the match but doesn't push again.
    await sam.put('/post/' + p.id).send({ title: 'Garage clear-out, more stuff' });
    await alerts.idle(); await push.idle();
    assert.strictEqual(to(beaId).length, 1);

    await bea.put('/push/settings').send({ searches: false });
    await sam.post('/post').send({ title: 'Another one', street: '2 Main St', city: 'New York', state: 'NY', zipCode: '10036' });
    await alerts.idle(); await push.idle();
    assert.strictEqual(to(beaId).length, 1);
    // The bell still has it.
    const bell = (await bea.get('/notifications')).body;
    assert.ok(JSON.stringify(bell).includes('Another one'));
  });
});
