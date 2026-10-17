const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const secretBox = require('../lib/secretBox');
const { setSetting } = require('../lib/features');
const backfill = require('../scripts/geocode-backfill');

const PW = 'correct-horse';
const CENTER = { lat: 40.758, lng: -73.9855 }; // Times Square
const MI_PER_DEG = (Math.PI / 180) * geo.EARTH_RADIUS_MI; // ~69.09 mi per degree of latitude
const north = (miles) => ({ lat: CENTER.lat + miles / MI_PER_DEG, lng: CENTER.lng });

// Fake geocoder: street "N mi" -> a point N miles north of CENTER.
const PLACES = {
  'times square': CENTER,
  '10036': CENTER,
};
let calls;
function fakeProvider(address, key) {
  calls.push({ address, key });
  const m = address.match(/^(\d+(?:\.\d+)?) mi\b/);
  if (m) return Promise.resolve(Object.assign({ status: 'ok' }, north(Number(m[1]))));
  const k = address.toLowerCase().split(',')[0].trim();
  if (PLACES[k]) return Promise.resolve(Object.assign({ status: 'ok' }, PLACES[k]));
  if (k === 'boom') return Promise.reject(new Error('network down'));
  return Promise.resolve({ status: 'not_found' });
}

describe('map search + geocoding', function () {
  this.timeout(20000);
  let alice;

  before(() => { process.env.KEY_ENCRYPTION_SECRET = 'test-encryption-secret-123456'; });
  after(() => {
    geo.setProvider(null);
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_GEOCODING_API_KEY;
    delete process.env.GEOCODE_SEARCH_PER_MINUTE;
    delete process.env.KEY_ENCRYPTION_SECRET;
  });

  beforeEach(async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-server-key';
    delete process.env.GOOGLE_GEOCODING_API_KEY;
    delete process.env.GEOCODE_SEARCH_PER_MINUTE;
    calls = [];
    geo.setProvider(fakeProvider);
    geo.resetRateLimits();
    await models.sequelize.sync({ force: true });
    alice = request.agent(app);
    await alice.post('/signup').send({ email: 'alice@example.com', password: PW, firstName: 'A' });
  });

  const makePost = (street, extra) => alice.post('/post').send(Object.assign({ title: 'Sale ' + street, street, city: 'New York', zipCode: '10036' }, extra));
  async function seedRing() {
    for (const mi of [1, 8, 20, 40, 100]) {
      const r = await makePost(mi + ' mi St');
      assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    }
  }
  const search = (qs) => request(app).get('/search').query(qs);

  describe('distance math', () => {
    it('haversine matches known distances', () => {
      const nyc = { lat: 40.7128, lng: -74.006 };
      const la = { lat: 34.0522, lng: -118.2437 };
      assert.ok(Math.abs(geo.haversineMiles(nyc, la) - 2445) < 5, String(geo.haversineMiles(nyc, la)));
      assert.strictEqual(geo.haversineMiles(nyc, nyc), 0);
      assert.ok(Math.abs(geo.haversineMiles(CENTER, north(10)) - 10) < 1e-9);
    });

    it('bounding box contains every point on the radius circle', () => {
      for (const c of [CENTER, { lat: 64.8, lng: -147.7 }, { lat: -33.9, lng: 18.4 }]) {
        const box = geo.boundingBox(c, 50);
        for (let deg = 0; deg < 360; deg += 15) {
          const b = toRad(deg); const d = 50 / geo.EARTH_RADIUS_MI; const la = toRad(c.lat);
          const lat2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
          const lng2 = toRad(c.lng) + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat2));
          const p = { lat: lat2 * 180 / Math.PI, lng: lng2 * 180 / Math.PI };
          assert.ok(p.lat >= box.minLat && p.lat <= box.maxLat, 'lat out of box at ' + deg);
          assert.ok(box.lngRanges.some(([a, z]) => p.lng >= a && p.lng <= z), 'lng out of box at ' + deg);
        }
      }
    });

    it('bounding box wraps the antimeridian', () => {
      const box = geo.boundingBox({ lat: 0, lng: 179.9 }, 50);
      assert.strictEqual(box.lngRanges.length, 2);
      assert.strictEqual(box.lngRanges[1][0], -180);
    });
  });
  const toRad = (d) => d * Math.PI / 180;

  describe('geocoding on save', () => {
    it('stores coordinates with the server key, which never reaches clients', async () => {
      const r = await makePost('8 mi St');
      assert.ok(Math.abs(r.body.lat - north(8).lat) < 1e-9);
      assert.strictEqual(r.body.geocodeStatus, 'ok');
      assert.strictEqual(calls[0].key, 'test-server-key');
      assert.ok(!JSON.stringify(r.body).includes('test-server-key'));
    });

    it('ignores client-supplied lat/lng', async () => {
      delete process.env.GOOGLE_MAPS_API_KEY;
      const r = await makePost('1 mi St', { lat: 1, lng: 2 });
      assert.strictEqual(r.body.lat, null);
    });

    it('without any key the post is saved without coordinates and excluded from distance search', async () => {
      delete process.env.GOOGLE_MAPS_API_KEY;
      const r = await makePost('1 mi St');
      assert.strictEqual(r.status, 201);
      assert.strictEqual(r.body.lat, null);
      assert.strictEqual(r.body.geocodeStatus, 'no_key');
      assert.strictEqual(calls.length, 0);
      const s = await search({ lat: CENTER.lat, lng: CENTER.lng, radius: 50 });
      assert.strictEqual(s.body.total, 0);
    });

    it('a geocoder failure still saves the post', async () => {
      const r = await makePost('boom');
      assert.strictEqual(r.status, 201);
      assert.strictEqual(r.body.geocodeStatus, 'error');
    });

    it('uses the owner\'s own key only when BYOK is enabled', async () => {
      delete process.env.GOOGLE_MAPS_API_KEY;
      await models.User.update({ mapsKeyEncrypted: secretBox.encrypt('user-own-key-1234'), mapsKeyLast4: '1234' }, { where: { email: 'alice@example.com' } });
      const r = await makePost('1 mi St');
      assert.strictEqual(r.body.geocodeStatus, 'ok');
      assert.strictEqual(calls[0].key, 'user-own-key-1234');
      await setSetting('userMapsKeys', false);
      const r2 = await makePost('8 mi St');
      assert.strictEqual(r2.body.geocodeStatus, 'no_key');
    });

    it('re-geocodes when the address changes', async () => {
      const r = await makePost('1 mi St');
      const u = await alice.put('/post/' + r.body.id).send({ street: '20 mi St' });
      assert.ok(Math.abs(u.body.lat - north(20).lat) < 1e-9);
      const n = calls.length;
      await alice.put('/post/' + r.body.id).send({ title: 'New title' });
      assert.strictEqual(calls.length, n);
    });
  });

  describe('GET /search', () => {
    it('filters by radius and sorts by distance', async () => {
      await seedRing();
      const expect = { 5: [1], 10: [1, 8], 25: [1, 8, 20], 50: [1, 8, 20, 40] };
      for (const radius of [5, 10, 25, 50]) {
        const s = await search({ lat: CENTER.lat, lng: CENTER.lng, radius });
        assert.strictEqual(s.status, 200, JSON.stringify(s.body));
        assert.strictEqual(s.body.mode, 'distance');
        assert.deepStrictEqual(s.body.results.map((p) => Math.round(p.distanceMiles)), expect[radius]);
        assert.ok(Array.isArray(s.body.results[0].photos));
      }
    });

    it('excludes bounding-box corners that are outside the radius', async () => {
      // ~9.5 mi north and ~9.5 mi east: inside the 10-mile box, ~13.4 mi away.
      await models.Post.create({ title: 'corner', zipCode: '10001', userId: 1, lat: north(9.5).lat, lng: CENTER.lng + 9.5 / (MI_PER_DEG * Math.cos(toRad(CENTER.lat))) });
      const s = await search({ lat: CENTER.lat, lng: CENTER.lng, radius: 10 });
      assert.strictEqual(s.body.total, 0);
      assert.strictEqual((await search({ lat: CENTER.lat, lng: CENTER.lng, radius: 25 })).body.total, 1);
    });

    it('paginates', async () => {
      await seedRing();
      const p1 = await search({ lat: CENTER.lat, lng: CENTER.lng, radius: 50, pageSize: 3 });
      const p2 = await search({ lat: CENTER.lat, lng: CENTER.lng, radius: 50, pageSize: 3, page: 2 });
      assert.strictEqual(p1.body.total, 4);
      assert.strictEqual(p1.body.totalPages, 2);
      assert.deepStrictEqual(p1.body.results.map((p) => Math.round(p.distanceMiles)), [1, 8, 20]);
      assert.deepStrictEqual(p2.body.results.map((p) => Math.round(p.distanceMiles)), [40]);
      const p3 = await search({ lat: CENTER.lat, lng: CENTER.lng, radius: 50, pageSize: 3, page: 3 });
      assert.deepStrictEqual(p3.body.results, []);
    });

    it('geocodes a typed address or zip as the center', async () => {
      await seedRing();
      const s = await search({ q: 'Times Square', radius: 10 });
      assert.strictEqual(s.body.center.source, 'geocoded');
      assert.strictEqual(s.body.total, 2);
      assert.strictEqual((await search({ q: 'nowhere-at-all', radius: 10 })).status, 404);
    });

    it('validates inputs', async () => {
      const bad = [
        {}, { radius: 10 }, { lat: CENTER.lat }, { lat: 91, lng: 0 }, { lat: 0, lng: -181 }, { lat: 'abc', lng: 1 },
        { lat: 1, lng: 1, radius: 7 }, { lat: 1, lng: 1, radius: '10mi' }, { lat: 1, lng: 1, page: 0 },
        { lat: 1, lng: 1, page: 1.5 }, { lat: 1, lng: 1, pageSize: 51 }, { q: 'x'.repeat(201) },
      ];
      for (const qs of bad) {
        const r = await search(qs);
        assert.strictEqual(r.status, 400, 'expected 400 for ' + JSON.stringify(qs));
        assert.strictEqual(r.body.error.code, 'bad_request');
      }
      assert.strictEqual((await request(app).get('/search?q=a&q=b')).status, 400);
    });

    it('without a key, typed text falls back to zip/text matching with a notice', async () => {
      await seedRing();
      delete process.env.GOOGLE_MAPS_API_KEY;
      await makePost('Elm St', { zipCode: '07030', city: 'Hoboken' });
      const z = await search({ q: '07030', radius: 10 });
      assert.strictEqual(z.status, 200);
      assert.strictEqual(z.body.mode, 'text');
      assert.strictEqual(z.body.notice.code, 'no_key');
      assert.strictEqual(z.body.total, 1);
      assert.strictEqual(z.body.results[0].distanceMiles, null);
      const t = await search({ q: 'hoboken' });
      assert.strictEqual(t.body.total, 1);
      // Browser-location search needs no key.
      assert.strictEqual((await search({ lat: CENTER.lat, lng: CENTER.lng, radius: 25 })).body.total, 3);
    });

    it('rate-limits search geocoding per client', async () => {
      process.env.GEOCODE_SEARCH_PER_MINUTE = '2';
      const a = await search({ q: '1 mi north' });
      const b = await search({ q: '2 mi north' });
      const c = await search({ q: '3 mi north' });
      assert.strictEqual(a.body.mode, 'distance');
      assert.strictEqual(b.body.mode, 'distance');
      assert.strictEqual(c.body.mode, 'text');
      assert.strictEqual(c.body.notice.code, 'rate_limited');
      assert.strictEqual(calls.length, 2);
    });
  });

  describe('backfill script', () => {
    it('geocodes posts that have no coordinates once a key exists', async () => {
      delete process.env.GOOGLE_MAPS_API_KEY;
      await makePost('1 mi St');
      await makePost('20 mi St');
      await makePost('nowhere');
      await models.Post.create({ title: 'old', zipCode: '10036', street: '8 mi St', userId: 1 }); // never tried
      const quiet = () => {};
      const dry = await backfill.run({ dryRun: true, log: quiet, delayMs: 0 });
      assert.strictEqual(dry.total, 4);
      assert.strictEqual(await models.Post.count({ where: { geocodeStatus: 'ok' } }), 0);
      process.env.GOOGLE_MAPS_API_KEY = 'test-server-key';
      const res = await backfill.run({ log: quiet, delayMs: 0 });
      assert.strictEqual(res.ok, 3);
      assert.strictEqual(res.not_found, 1);
      const s = await search({ lat: CENTER.lat, lng: CENTER.lng, radius: 25 });
      assert.strictEqual(s.body.total, 3);
      // not_found is only retried with --retry.
      assert.strictEqual((await backfill.run({ log: quiet, delayMs: 0 })).total, 0);
      assert.strictEqual((await backfill.run({ retry: true, log: quiet, delayMs: 0 })).total, 1);
    });
  });
});
