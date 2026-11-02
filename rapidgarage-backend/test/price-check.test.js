const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const schedule = require('../lib/schedule');
const priceCheck = require('../lib/priceCheck');

const PW = 'correct-horse';
const H = 3600000;
// Calendar-day steps (DST-safe): noon UTC of the day n days from d.
const ymd = (d) => d.toISOString().slice(0, 10);
const daysAfter = (d, n) => { const x = new Date(ymd(d) + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x; };

describe('price check while listing', function () {
  this.timeout(30000);
  let sam, samId, bea, beaId, post, now;

  async function user(email, first) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: 'Test' });
    assert.strictEqual(r.status, 201);
    return [agent, r.body.id];
  }
  async function sale(agent, title, lat, lng) {
    const p = (await agent.post('/post').send({ title, street: '1 Main St', city: 'New York', state: 'NY', zipCode: '10036' })).body;
    await models.Post.update({ lat, lng }, { where: { id: p.id } });
    return p;
  }
  const sold = (postId, list, soldAt) => models.SaleItem.bulkCreate(list.map(([name, priceCents], i) => ({ postId, name, priceCents, sold: true, soldAt: soldAt || now, position: i })));

  after(() => { schedule.setClock(null); geo.setProvider(null); delete process.env.PRICE_CHECK_MIN_SAMPLES; });
  beforeEach(async () => {
    delete process.env.PRICE_CHECK_MIN_SAMPLES;
    geo.setProvider(() => Promise.resolve({ status: 'ok', lat: 40.75, lng: -73.98 }));
    await models.sequelize.sync({ force: true });
    now = new Date(Math.floor(Date.now() / H) * H);
    schedule.setClock(() => now);
    [sam, samId] = await user('sam@example.com', 'Sam');
    [bea, beaId] = await user('bea@example.com', 'Bea');
    post = await sale(sam, 'My sale', 40.75, -73.98);
  });

  it('keywords: drops filler words, singularizes, longest first', () => {
    assert.deepStrictEqual(priceCheck.keywords("Kids' bikes (2) - great condition"), ['bike', 'kid']);
    assert.deepStrictEqual(priceCheck.keywords('A lamp'), ['lamp']);
    assert.deepStrictEqual(priceCheck.keywords('Old set of glass'), ['glass']);
    assert.deepStrictEqual(priceCheck.keywords('the 2 of'), []);
    assert.deepStrictEqual(priceCheck.keywords('자전거 판매'), ['자전거', '판매']);
    assert.deepStrictEqual(priceCheck.summarize([500, 100, 300]), { medianCents: 300, lowCents: 200, highCents: 400, minCents: 100, maxCents: 500 });
  });

  it('median and range of similar sold items nearby, using agreed offers, excluding far, old, free, hidden and own-sale items', async () => {
    const near = await sale(bea, 'Bea sale', 40.76, -73.97); // ~1 mile
    const far = await sale(bea, 'Far sale', 41.9, -87.6); // Chicago
    const hidden = await sale(bea, 'Hidden sale', 40.75, -73.98);
    await models.Post.update({ hidden: true }, { where: { id: hidden.id } });
    const bikes = await sold(near.id, [['Kids bike', 2000], ['Bike, 10 speed', 3000], ['Road bikes', 4000], ['bike helmet', 1000], ['BMX Bike', 5000], ['Free bike', 0]]);
    // One bike sold by an accepted offer of $25 instead of its $40 listing.
    const conv = await models.Conversation.create({ postId: near.id, buyerId: samId, sellerId: beaId, postTitle: near.title });
    await models.ItemHold.create({ itemId: bikes[2].id, postId: near.id, conversationId: conv.id, buyerId: samId, sellerId: beaId, status: 'completed', offerCents: 2500, expiresAt: now, decidedAt: now });
    await sold(near.id, [['Lamp', 500]]);
    await sold(near.id, [['Bike trailer', 9000]], daysAfter(now, -400)); // too old
    await sold(far.id, [['bike', 99900]]);
    await sold(hidden.id, [['bike', 88800]]);
    await sold(post.id, [['bike', 77700]]); // the seller's own sale
    await models.SaleItem.create({ postId: near.id, name: 'Unsold bike', priceCents: 6000, position: 9 });

    const r = await sam.get('/post/' + post.id + '/items/price-check').query({ name: 'Bikes' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.headers['cache-control'], 'no-store');
    // 1000, 2000, 2500, 3000, 5000
    assert.deepStrictEqual(r.body, { words: ['bike'], sample: 5, minSample: 5, radiusMiles: 25, days: 365, enough: true, basis: 'all',
      medianCents: 2500, lowCents: 2000, highCents: 3000, minCents: 1000, maxCents: 5000 });
    const text = JSON.stringify(r.body);
    assert.ok(!/Kids|BMX|Bea|helmet/.test(text), 'aggregates only');

    // Two words with too few exact matches fall back to the most specific word.
    const kb = await sam.get('/post/' + post.id + '/items/price-check').query({ name: 'kids bike' });
    assert.deepStrictEqual([kb.body.words, kb.body.basis, kb.body.sample, kb.body.enough], [['bike', 'kid'], 'broad', 5, true]);
  });

  it('no numbers below the minimum sample size (configurable); sold within lookback counts by calendar day', async () => {
    const near = await sale(bea, 'Bea sale', 40.76, -73.97);
    await sold(near.id, [['Lamp', 500], ['Desk lamp', 900]], daysAfter(now, -364));
    let r = await sam.get('/post/' + post.id + '/items/price-check').query({ name: 'lamp' });
    assert.deepStrictEqual([r.body.sample, r.body.enough, r.body.medianCents], [2, false, undefined]);
    process.env.PRICE_CHECK_MIN_SAMPLES = '2';
    r = await sam.get('/post/' + post.id + '/items/price-check').query({ name: 'lamp' });
    assert.deepStrictEqual([r.body.sample, r.body.minSample, r.body.enough, r.body.medianCents, r.body.lowCents, r.body.highCents], [2, 2, true, 700, 600, 800]);
    // Nothing to match on.
    r = await sam.get('/post/' + post.id + '/items/price-check').query({ name: 'the old' });
    assert.deepStrictEqual([r.status, r.body.words, r.body.sample, r.body.enough], [200, [], 0, false]);
  });

  it('seller only; validates the name', async () => {
    assert.strictEqual((await bea.get('/post/' + post.id + '/items/price-check').query({ name: 'lamp' })).status, 403);
    assert.strictEqual((await request(app).get('/post/' + post.id + '/items/price-check').query({ name: 'lamp' })).status, 401);
    const blank = await sam.get('/post/' + post.id + '/items/price-check');
    assert.strictEqual(blank.status, 400);
    assert.ok(blank.body.error.details.name);
    assert.strictEqual((await sam.get('/post/' + post.id + '/items/price-check').query({ name: 'x'.repeat(121) })).status, 400);
    const ko = await sam.get('/post/' + post.id + '/items/price-check').set('Accept-Language', 'ko');
    assert.strictEqual(ko.body.error.details.name, '먼저 품목 이름을 입력하세요.');
  });
});
