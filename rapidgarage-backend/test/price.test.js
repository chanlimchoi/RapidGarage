const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const { validatePrice, PRICE_CAP } = require('../lib/price');

const PW = 'correct-horse';
const CENTER = { lat: 40.758, lng: -73.9855 };
const MI_PER_DEG = (Math.PI / 180) * geo.EARTH_RADIUS_MI;

describe('post prices', function () {
  this.timeout(20000);
  let alice;

  before(() => { delete process.env.GOOGLE_MAPS_API_KEY; delete process.env.GOOGLE_GEOCODING_API_KEY; });

  beforeEach(async () => {
    geo.resetRateLimits();
    await models.sequelize.sync({ force: true });
    alice = request.agent(app);
    await alice.post('/signup').send({ email: 'alice@example.com', password: PW, firstName: 'A' });
  });

  const base = { title: 'Sale', street: '1 Main St', city: 'NYC', zipCode: '10036' };
  const create = (price) => alice.post('/post').send(Object.assign({}, base, price));

  describe('validation', () => {
    it('accepts free, single price, range, max-only, min-only and no price', async () => {
      const cases = [
        [{ isFree: true }, { isFree: true, priceMin: null, priceMax: null }],
        [{ priceMin: 5, priceMax: 5 }, { isFree: false, priceMin: 5, priceMax: 5 }],
        [{ priceMin: '5', priceMax: '50' }, { isFree: false, priceMin: 5, priceMax: 50 }],
        [{ priceMax: 50 }, { isFree: false, priceMin: null, priceMax: 50 }],
        [{ priceMin: 0 }, { isFree: false, priceMin: 0, priceMax: null }],
        [{ priceMin: '', priceMax: null, isFree: false }, { isFree: false, priceMin: null, priceMax: null }],
        [{}, { isFree: false, priceMin: null, priceMax: null }],
        [{ priceMin: PRICE_CAP, priceMax: PRICE_CAP }, { isFree: false, priceMin: PRICE_CAP, priceMax: PRICE_CAP }],
      ];
      for (const [input, expected] of cases) {
        const r = await create(input);
        assert.strictEqual(r.status, 201, JSON.stringify(input) + ' ' + JSON.stringify(r.body));
        assert.deepStrictEqual({ isFree: r.body.isFree, priceMin: r.body.priceMin, priceMax: r.body.priceMax }, expected, JSON.stringify(input));
      }
    });

    it('rejects negative, fractional, non-numeric and over-cap prices, min > max, and free + price', async () => {
      const cases = [
        [{ priceMin: -1 }, 'priceMin', /negative/],
        [{ priceMax: '-5' }, 'priceMax', /negative/],
        [{ priceMin: 4.5 }, 'priceMin', /whole dollars/],
        [{ priceMin: 'five' }, 'priceMin', /number/],
        [{ priceMin: '$5' }, 'priceMin', /number/],
        [{ priceMax: true }, 'priceMax', /number/],
        [{ priceMax: PRICE_CAP + 1 }, 'priceMax', /100,000 or less/],
        [{ priceMin: 1e21 }, 'priceMin', /or less/],
        [{ priceMin: 50, priceMax: 5 }, 'priceMax', /at least the lowest/],
        [{ isFree: true, priceMax: 10 }, 'isFree', /free sale/],
        [{ isFree: true, priceMin: 0 }, 'isFree', /free sale/],
        [{ isFree: 'yes' }, 'isFree', /true or false/],
      ];
      for (const [input, field, re] of cases) {
        const r = await create(input);
        assert.strictEqual(r.status, 400, JSON.stringify(input));
        assert.ok(re.test(r.body.error.details[field]), JSON.stringify(input) + ' -> ' + JSON.stringify(r.body.error.details));
      }
      assert.strictEqual(await models.Post.count(), 0);
    });

    it('checks cross-field rules against the stored post on partial updates', async () => {
      const p = (await create({ priceMin: 10, priceMax: 20 })).body;
      let r = await alice.put('/post/' + p.id).send({ priceMin: 30 });
      assert.strictEqual(r.status, 400);
      assert.ok(r.body.error.details.priceMax);
      r = await alice.put('/post/' + p.id).send({ isFree: true });
      assert.strictEqual(r.status, 400);
      assert.ok(r.body.error.details.isFree);
      r = await alice.put('/post/' + p.id).send({ isFree: true, priceMin: null, priceMax: null });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.deepStrictEqual([r.body.isFree, r.body.priceMin, r.body.priceMax], [true, null, null]);
      r = await alice.put('/post/' + p.id).send({ title: 'Renamed' });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.isFree, true);
    });

    it('validatePrice only returns fields that were sent', () => {
      assert.deepStrictEqual(validatePrice({ title: 'x' }), { errors: {}, values: {} });
      assert.deepStrictEqual(validatePrice({ priceMax: '7' }).values, { priceMax: 7 });
    });
  });

  describe('serialization', () => {
    it('GET /post/:id, /allPosts and /search return priceMin, priceMax and isFree', async () => {
      const p = (await create({ priceMin: 5, priceMax: 50 })).body;
      await models.Post.update({ lat: CENTER.lat, lng: CENTER.lng }, { where: { id: p.id } });
      const one = (await request(app).get('/post/' + p.id)).body;
      const all = (await request(app).get('/allPosts')).body[0];
      const s = (await request(app).get('/search').query({ lat: CENTER.lat, lng: CENTER.lng })).body.results[0];
      for (const body of [one, all, s]) {
        assert.strictEqual(body.priceMin, 5);
        assert.strictEqual(body.priceMax, 50);
        assert.strictEqual(body.isFree, false);
      }
    });
  });

  describe('search filter', () => {
    // [miles north of CENTER, price]
    const SEED = [
      [1, { isFree: true }],
      [2, { priceMin: 5, priceMax: 5 }],
      [3, { priceMin: 20, priceMax: 200 }],
      [4, { priceMax: 50 }],
      [6, { priceMin: 100 }],
      [7, {}],
      [30, { isFree: true }],
    ];
    beforeEach(async () => {
      for (const [mi, price] of SEED) {
        const r = await create(Object.assign({ title: mi + ' mi' }, price));
        await models.Post.update({ lat: CENTER.lat + mi / MI_PER_DEG, lng: CENTER.lng }, { where: { id: r.body.id } });
      }
    });
    const titles = async (qs) => {
      const r = await request(app).get('/search').query(Object.assign({ lat: CENTER.lat, lng: CENTER.lng }, qs));
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      return r.body.results.map((p) => p.title);
    };

    it('maxPrice keeps free, low-priced and "up to" sales, still sorted by distance within the radius', async () => {
      assert.deepStrictEqual(await titles({ radius: 10 }), ['1 mi', '2 mi', '3 mi', '4 mi', '6 mi', '7 mi']);
      assert.deepStrictEqual(await titles({ radius: 10, maxPrice: 10 }), ['1 mi', '2 mi', '4 mi']);
      assert.deepStrictEqual(await titles({ radius: 10, maxPrice: 20 }), ['1 mi', '2 mi', '3 mi', '4 mi']);
      assert.deepStrictEqual(await titles({ radius: 10, maxPrice: 0 }), ['1 mi', '4 mi']);
      assert.deepStrictEqual(await titles({ radius: 50, maxPrice: 100 }), ['1 mi', '2 mi', '3 mi', '4 mi', '6 mi', '30 mi']);
      assert.deepStrictEqual(await titles({ radius: 5, maxPrice: 100 }), ['1 mi', '2 mi', '3 mi', '4 mi']);
    });

    it('free=true returns only free sales', async () => {
      assert.deepStrictEqual(await titles({ radius: 50, free: 'true' }), ['1 mi', '30 mi']);
      assert.deepStrictEqual(await titles({ radius: 10, free: 'true', maxPrice: 1000 }), ['1 mi']);
      assert.strictEqual((await titles({ radius: 10, free: 'false' })).length, 6);
    });

    it('paginates the filtered results', async () => {
      const r = await request(app).get('/search').query({ lat: CENTER.lat, lng: CENTER.lng, radius: 10, maxPrice: 20, pageSize: 3, page: 2 });
      assert.strictEqual(r.body.total, 4);
      assert.deepStrictEqual(r.body.results.map((p) => p.title), ['4 mi']);
      assert.deepStrictEqual(r.body.filter, { maxPrice: 20, freeOnly: false });
    });

    it('applies to the no-key text fallback too', async () => {
      const r = await request(app).get('/search').query({ q: '10036', maxPrice: 10 });
      assert.strictEqual(r.body.mode, 'text');
      assert.deepStrictEqual(r.body.results.map((p) => p.title).sort(), ['1 mi', '2 mi', '30 mi', '4 mi']);
    });

    it('validates maxPrice and free', async () => {
      for (const qs of [{ maxPrice: -1 }, { maxPrice: 2.5 }, { maxPrice: 'cheap' }, { maxPrice: PRICE_CAP + 1 }, { free: 'maybe' }]) {
        const r = await request(app).get('/search').query(Object.assign({ lat: 1, lng: 1 }, qs));
        assert.strictEqual(r.status, 400, JSON.stringify(qs));
        assert.ok(r.body.error.details.maxPrice || r.body.error.details.free);
      }
    });
  });
});
