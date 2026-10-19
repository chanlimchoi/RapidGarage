const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const alerts = require('../lib/alerts');
const geo = require('../lib/geo');
const schedule = require('../lib/schedule');
const markdown = require('../lib/markdown');

const PW = 'correct-horse';
const NY = 'America/New_York';
const C = { lat: 40.758, lng: -73.9855 };
// New York is UTC-4 in late October 2026.
const at = (iso) => new Date(iso);
const SAT_NOON = at('2026-10-24T16:00:00Z');
const SAT_1330 = at('2026-10-24T17:30:00Z');
const SAT_1530 = at('2026-10-24T19:30:00Z');

describe('last-hour markdowns', function () {
  this.timeout(30000);
  let alice, clock;
  const days = { timeZone: NY, days: [{ date: '2026-10-24', start: '08:00', end: '15:00' }, { date: '2026-10-25', start: '08:00', end: '15:00' }] };
  async function sale(extra) {
    const r = await alice.post('/post').send(Object.assign({ title: 'Sale', street: '1 Main St', city: 'New York', zipCode: '10036', schedule: days }, extra));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    await alerts.idle();
    return r.body;
  }
  const get = async (id) => (await request(app).get('/post/' + id)).body;

  before(() => {
    schedule.setClock(() => clock);
    geo.setProvider(async () => ({ status: 'ok', lat: C.lat, lng: C.lng }));
  });
  after(() => {
    schedule.setClock(null);
    geo.setProvider(null);
    delete process.env.GOOGLE_MAPS_API_KEY;
  });
  beforeEach(async () => {
    clock = SAT_NOON;
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    geo.resetRateLimits();
    await models.sequelize.sync({ force: true });
    alice = request.agent(app);
    assert.strictEqual((await alice.post('/signup').send({ email: 'alice@example.com', password: PW, firstName: 'Alice' })).status, 201);
  });

  it('validates the fields', async () => {
    const bad = async (extra, field) => {
      const r = await alice.post('/post').send(Object.assign({ title: 'x', zipCode: '10036' }, extra));
      assert.strictEqual(r.status, 400, JSON.stringify(r.body));
      assert.ok(r.body.error.details[field], field + ': ' + JSON.stringify(r.body));
    };
    await bad({ markdownPercent: 95, markdownFrom: '14:00' }, 'markdownPercent');
    await bad({ markdownPercent: 2, markdownFrom: '14:00' }, 'markdownPercent');
    await bad({ markdownPercent: 12.5, markdownFrom: '14:00' }, 'markdownPercent');
    await bad({ markdownPercent: 50, markdownFrom: '2pm' }, 'markdownFrom');
    await bad({ markdownPercent: 50 }, 'markdownFrom');
    await bad({ markdownPercent: 50, markdownFrom: '14:00', markdownLastDay: 'yes' }, 'markdownLastDay');
  });

  it('is upcoming before the start time, running after it, and ends with the day', async () => {
    const post = await sale({ markdownPercent: 50, markdownFrom: '13:00' });
    assert.deepStrictEqual(post.markdown, {
      percent: 50, from: '13:00', lastDayOnly: false, active: false,
      startsAt: '2026-10-24T17:00:00.000Z', endsAt: '2026-10-24T19:00:00.000Z',
    });
    assert.strictEqual(post.markdownPercent, undefined, 'raw columns are not serialized');
    clock = SAT_1330;
    assert.strictEqual((await get(post.id)).markdown.active, true);
    clock = SAT_1530;
    const next = (await get(post.id)).markdown;
    assert.strictEqual(next.active, false);
    assert.strictEqual(next.startsAt, '2026-10-25T17:00:00.000Z', "Sunday's markdown is next");
    clock = at('2026-10-25T20:00:00Z');
    assert.strictEqual((await get(post.id)).markdown.startsAt, null);
  });

  it('can run only on the last day', async () => {
    const post = await sale({ markdownPercent: 30, markdownFrom: '13:00', markdownLastDay: true });
    clock = SAT_1330;
    const m = (await get(post.id)).markdown;
    assert.strictEqual(m.active, false);
    assert.strictEqual(m.lastDayOnly, true);
    assert.strictEqual(m.startsAt, '2026-10-25T17:00:00.000Z');
  });

  it('a start before opening covers the whole day; one after closing covers none', async () => {
    const early = await sale({ markdownPercent: 20, markdownFrom: '06:00' });
    assert.strictEqual(early.markdown.active, true);
    assert.strictEqual(early.markdown.startsAt, '2026-10-24T12:00:00.000Z');
    const late = await sale({ markdownPercent: 20, markdownFrom: '16:00' });
    assert.strictEqual(late.markdown.active, false);
    assert.strictEqual(late.markdown.startsAt, null);
  });

  it('edits keep the other fields; clearing the percent clears the rest', async () => {
    const post = await sale({ markdownPercent: 50, markdownFrom: '13:00', markdownLastDay: true });
    let r = await alice.put('/post/' + post.id).send({ markdownPercent: 25 });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual([r.body.markdown.percent, r.body.markdown.from, r.body.markdown.lastDayOnly], [25, '13:00', true]);
    r = await alice.put('/post/' + post.id).send({ markdownPercent: null });
    assert.strictEqual(r.body.markdown, null);
    const row = await models.Post.findByPk(post.id);
    assert.deepStrictEqual([row.markdownFrom, row.markdownLastDay], [null, false]);
    r = await alice.put('/post/' + post.id).send({ markdownPercent: 40 });
    assert.strictEqual(r.status, 400, 'a percent needs a start time');
  });

  it('filters "discounts now" in /allPosts and /search', async () => {
    await sale({ title: 'Plain' });
    await sale({ title: 'Later', markdownPercent: 50, markdownFrom: '13:00' });
    await sale({ title: 'Now', markdownPercent: 50, markdownFrom: '11:00' });
    const names = (list) => list.map((p) => p.title).sort();
    assert.deepStrictEqual(names((await request(app).get('/allPosts?markdown=1')).body), ['Now']);
    assert.deepStrictEqual(names((await request(app).get('/allPosts')).body), ['Later', 'Now', 'Plain']);
    const near = await request(app).get('/search?lat=' + C.lat + '&lng=' + C.lng + '&markdown=true');
    assert.strictEqual(near.status, 200, JSON.stringify(near.body));
    assert.deepStrictEqual(names(near.body.results), ['Now']);
    assert.strictEqual(near.body.total, 1);
    assert.strictEqual((await request(app).get('/allPosts?markdown=maybe')).status, 400);
    clock = SAT_1330;
    assert.deepStrictEqual(names((await request(app).get('/allPosts?markdown=1')).body), ['Later', 'Now']);
  });

  it('rounds discounted prices down to the cent', () => {
    assert.strictEqual(markdown.discounted(999, 50), 499);
    assert.strictEqual(markdown.discounted(1000, 25), 750);
    assert.strictEqual(markdown.discounted(0, 50), 0);
    assert.strictEqual(markdown.discounted(null, 50), null);
  });
});
