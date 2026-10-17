const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const schedule = require('../lib/schedule');
const route = require('../lib/route');

const PW = 'correct-horse';
const NY = 'America/New_York';
// Wednesday 2026-10-21, 12:00 in New York.
const WED_NOON = new Date('2026-10-21T16:00:00Z');
// "<n> Main St" geocodes n * 0.01 degrees north of this point.
const BASE = { lat: 40.70, lng: -74.00 };

describe('saved sales & route', function () {
  this.timeout(30000);
  let alice, bob, carol, admin, bobId;

  async function user(email, role) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: email.split('@')[0], lastName: 'Zed' });
    assert.strictEqual(r.status, 201);
    if (role) await models.User.update({ role }, { where: { id: r.body.id } });
    return [agent, r.body.id];
  }
  async function sale(title, n, days, agent) {
    const body = { title, street: n + ' Main St', city: 'New York', state: 'NY', zipCode: '10036' };
    if (days) body.schedule = { timeZone: NY, days: days.map(([date, start, end]) => ({ date, start, end })) };
    const r = await (agent || alice).post('/post').send(body);
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return r.body;
  }
  const save = (id, agent) => (agent || bob).put('/saved/' + id);
  const WEEKEND = [['2026-10-24', '08:00', '14:00']];
  const TODAY = [['2026-10-21', '09:00', '17:00']];
  const NEXT_WEEK = [['2026-10-28', '09:00', '17:00']];

  before(() => {
    schedule.setClock(() => WED_NOON);
    geo.setProvider(async (address) => {
      const n = Number((/^(\d+) /.exec(address) || [])[1] || 0);
      return { status: 'ok', lat: BASE.lat + n * 0.01, lng: BASE.lng };
    });
  });
  after(() => {
    schedule.setClock(null);
    geo.setProvider(null);
    delete process.env.GOOGLE_MAPS_API_KEY;
  });
  beforeEach(async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    geo.resetRateLimits();
    await models.sequelize.sync({ force: true });
    [alice] = await user('alice@example.com');
    [bob, bobId] = await user('bob@example.com');
    [carol] = await user('carol@example.com');
    [admin] = await user('admin@example.com', 'admin');
  });

  describe('saving', () => {
    it('requires login', async () => {
      const p = await sale('Yard', 1, WEEKEND);
      assert.strictEqual((await request(app).put('/saved/' + p.id)).status, 401);
      assert.strictEqual((await request(app).get('/saved')).status, 401);
      assert.strictEqual((await request(app).get('/saved/route')).status, 401);
    });

    it('stars and unstars idempotently, per user', async () => {
      const p = await sale('Yard', 1, WEEKEND);
      assert.strictEqual((await save(p.id)).status, 201);
      assert.strictEqual((await save(p.id)).status, 200);
      assert.strictEqual(await models.SavedPost.count(), 1);
      assert.deepStrictEqual((await bob.get('/saved/ids')).body.ids, [p.id]);
      assert.deepStrictEqual((await carol.get('/saved/ids')).body.ids, []);
      const list = await bob.get('/saved');
      assert.strictEqual(list.headers['cache-control'], 'no-store');
      assert.deepStrictEqual(list.body.results.map((x) => x.title), ['Yard']);
      assert.strictEqual(list.body.results[0].status, 'upcoming');
      assert.strictEqual(list.body.results[0].user, undefined);
      const del = await bob.delete('/saved/' + p.id);
      assert.strictEqual(del.status, 200);
      assert.strictEqual((await bob.delete('/saved/' + p.id)).status, 200);
      assert.deepStrictEqual((await bob.get('/saved/ids')).body.ids, []);
    });

    it("rejects missing, hidden and the user's own sales", async () => {
      const p = await sale('Yard', 1, WEEKEND);
      assert.strictEqual((await save(999)).status, 404);
      assert.strictEqual((await save('abc')).status, 404);
      const own = await save(p.id, alice);
      assert.strictEqual(own.status, 400);
      assert.strictEqual(own.body.error.code, 'own_post');
      await models.Post.update({ hidden: true }, { where: { id: p.id } });
      assert.strictEqual((await save(p.id)).status, 404);
      // Admins can still see (and save) hidden sales.
      assert.strictEqual((await save(p.id, admin)).status, 201);
    });

    it('hides saved sales that were later hidden, and counts them', async () => {
      const a = await sale('Shown', 1, WEEKEND);
      const b = await sale('Gone', 2, WEEKEND);
      await save(a.id); await save(b.id);
      await models.Post.update({ hidden: true }, { where: { id: b.id } });
      const list = await bob.get('/saved');
      assert.deepStrictEqual(list.body.results.map((x) => x.title), ['Shown']);
      assert.strictEqual(list.body.unavailable, 1);
      assert.deepStrictEqual((await bob.get('/saved/ids')).body.ids, [a.id]);
      const r = await bob.get('/saved/route');
      assert.deepStrictEqual(r.body.stops.map((s) => s.post.title), ['Shown']);
      assert.strictEqual(r.body.skipped.unavailable, 1);
      // Unhidden: back again. Deleted: gone for good.
      await models.Post.update({ hidden: false }, { where: { id: b.id } });
      assert.strictEqual((await bob.get('/saved')).body.results.length, 2);
      assert.strictEqual((await alice.delete('/post/' + b.id)).status < 300, true);
      assert.strictEqual(await models.SavedPost.count({ where: { postId: b.id } }), 0);
    });

    it('keeps ended sales in the list (marked) but out of the route', async () => {
      const ended = await sale('Old', 1, [['2026-10-21', '06:00', '08:00'], ['2026-10-22', '06:00', '08:00']]);
      const next = await sale('Next', 2, WEEKEND);
      await save(ended.id); await save(next.id);
      schedule.setClock(() => new Date('2026-10-22T13:00:00Z'));
      try {
        const list = await bob.get('/saved');
        assert.deepStrictEqual(list.body.results.map((x) => [x.title, x.status]).sort(), [['Next', 'upcoming'], ['Old', 'ended']]);
        const r = await bob.get('/saved/route');
        assert.deepStrictEqual(r.body.stops.map((s) => s.post.title), ['Next']);
        assert.strictEqual(r.body.skipped.ended, 1);
      } finally { schedule.setClock(() => WED_NOON); }
    });

    it('caps how many sales one person can save', async () => {
      const p = await sale('Yard', 1, WEEKEND);
      const many = [];
      for (let i = 0; i < 200; i += 1) many.push({ userId: bobId, postId: p.id + 1000 + i });
      await models.sequelize.query('PRAGMA foreign_keys = OFF');
      await models.SavedPost.bulkCreate(many);
      await models.sequelize.query('PRAGMA foreign_keys = ON');
      const r = await save(p.id);
      assert.strictEqual(r.status, 400);
      assert.strictEqual(r.body.error.code, 'too_many');
    });
  });

  describe('route', () => {
    it('orders stops nearest-first from the given location', async () => {
      const far = await sale('Far', 9, WEEKEND);
      const near = await sale('Near', 1, WEEKEND);
      const mid = await sale('Mid', 4, WEEKEND);
      await save(far.id); await save(near.id); await save(mid.id);
      const r = await bob.get('/saved/route').query({ lat: BASE.lat, lng: BASE.lng });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.deepStrictEqual(r.body.stops.map((s) => s.post.title), ['Near', 'Mid', 'Far']);
      assert.deepStrictEqual(r.body.stops.map((s) => s.order), [1, 2, 3]);
      assert.ok(Math.abs(r.body.stops[0].legMiles - 0.7) < 0.1);
      assert.ok(Math.abs(r.body.totalMiles - 6.2) < 0.2);
      // Starting at the far end reverses it.
      const back = await bob.get('/saved/route').query({ lat: BASE.lat + 0.1, lng: BASE.lng });
      assert.deepStrictEqual(back.body.stops.map((s) => s.post.title), ['Far', 'Mid', 'Near']);
    });

    it('starts at the sale that opens first when no location is given', async () => {
      const later = await sale('Later', 5, [['2026-10-25', '08:00', '12:00']]);
      const sooner = await sale('Sooner', 9, [['2026-10-24', '08:00', '12:00']]);
      const between = await sale('Between', 1, [['2026-10-24', '10:00', '12:00']]);
      await save(later.id); await save(sooner.id); await save(between.id);
      const r = await bob.get('/saved/route');
      assert.deepStrictEqual(r.body.stops.map((s) => s.post.title), ['Sooner', 'Later', 'Between']);
      assert.strictEqual(r.body.stops[0].legMiles, null);
      assert.strictEqual(r.body.start, null);
    });

    it('among sales already open, starts with the one closing first', async () => {
      const late = await sale('ClosesLate', 1, [['2026-10-21', '08:00', '20:00']]);
      const soon = await sale('ClosesSoon', 9, [['2026-10-21', '10:00', '13:00']]);
      await save(soon.id); await save(late.id);
      const r = await bob.get('/saved/route').query({ when: 'today' });
      assert.deepStrictEqual(r.body.stops.map((s) => s.post.title), ['ClosesSoon', 'ClosesLate']);
    });

    it('filters by today / this weekend / all upcoming', async () => {
      const t = await sale('Today', 1, TODAY);
      const w = await sale('Weekend', 2, WEEKEND);
      const n = await sale('NextWeek', 3, NEXT_WEEK);
      const open = await sale('NoDates', 4, null);
      for (const p of [t, w, n, open]) await save(p.id);
      const names = async (when) => (await bob.get('/saved/route').query({ when, lat: BASE.lat, lng: BASE.lng })).body.stops.map((s) => s.post.title);
      assert.deepStrictEqual(await names('today'), ['Today']);
      assert.deepStrictEqual(await names('weekend'), ['Weekend']);
      assert.deepStrictEqual(await names('all'), ['Today', 'Weekend', 'NextWeek', 'NoDates']);
      const r = await bob.get('/saved/route').query({ when: 'weekend' });
      assert.strictEqual(r.body.skipped.notInWindow, 3);
      assert.strictEqual((await bob.get('/saved/route').query({ when: 'someday' })).status, 400);
      assert.strictEqual((await bob.get('/saved/route').query({ lat: '91', lng: '0' })).status, 400);
      assert.strictEqual((await bob.get('/saved/route').query({ lat: '40' })).status, 400);
    });

    it('skips sales without coordinates and caps the stops', async () => {
      const ids = [];
      for (let i = 1; i <= 12; i += 1) {
        geo.resetRateLimits(); // 10 geocodes/second
        ids.push((await sale('S' + i, i, WEEKEND)).id);
      }
      const nowhere = await sale('Nowhere', 50, WEEKEND);
      await models.Post.update({ lat: null, lng: null }, { where: { id: nowhere.id } });
      for (const id of ids.concat(nowhere.id)) await save(id);
      const r = await bob.get('/saved/route').query({ lat: BASE.lat, lng: BASE.lng });
      assert.strictEqual(r.body.stops.length, route.MAX_STOPS);
      assert.deepStrictEqual(r.body.stops.map((s) => s.post.title), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10']);
      assert.strictEqual(r.body.skipped.overLimit, 2);
      assert.strictEqual(r.body.skipped.noLocation, 1);
    });

    it('builds a Google Maps directions link with waypoints', async () => {
      const a = await sale('A', 1, WEEKEND);
      const b = await sale('B', 2, WEEKEND);
      const c = await sale('C', 3, WEEKEND);
      for (const p of [c, a, b]) await save(p.id);
      const r = await bob.get('/saved/route').query({ lat: BASE.lat, lng: BASE.lng });
      const u = new URL(r.body.googleMapsUrl);
      assert.strictEqual(u.origin + u.pathname, 'https://www.google.com/maps/dir/');
      assert.strictEqual(u.searchParams.get('api'), '1');
      assert.strictEqual(u.searchParams.get('origin'), BASE.lat + ',' + BASE.lng);
      assert.strictEqual(u.searchParams.get('destination'), '3 Main St, New York, NY, 10036');
      assert.strictEqual(u.searchParams.get('waypoints'), '1 Main St, New York, NY, 10036|2 Main St, New York, NY, 10036');
      assert.strictEqual(u.searchParams.get('travelmode'), 'driving');
      // No location: Google Maps starts from the phone's location.
      const noStart = new URL((await bob.get('/saved/route')).body.googleMapsUrl);
      assert.strictEqual(noStart.searchParams.get('origin'), null);
      // Nothing saved: no link.
      const empty = await carol.get('/saved/route');
      assert.deepStrictEqual(empty.body.stops, []);
      assert.strictEqual(empty.body.googleMapsUrl, null);
    });

    it('never includes anyone else\'s saved sales', async () => {
      const a = await sale('Mine', 1, WEEKEND);
      const b = await sale('Theirs', 2, WEEKEND);
      await save(a.id); await save(b.id, carol);
      const r = await bob.get('/saved/route');
      assert.deepStrictEqual(r.body.stops.map((s) => s.post.title), ['Mine']);
    });
  });
});
