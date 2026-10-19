const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const schedule = require('../lib/schedule');
const alerts = require('../lib/alerts');
const mailer = require('../lib/mailer');

const PW = 'correct-horse';
const C = { lat: 40.758, lng: -73.9855 };
const NY = 'America/New_York';
// Wednesday 2026-10-21, 12:00 in New York (16:00 UTC).
const WED_NOON = new Date('2026-10-21T16:00:00Z');

describe('sale dates & times', function () {
  this.timeout(30000);
  let alice, bob, admin, aliceId, sent;
  let clock = WED_NOON;

  async function user(email, role) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: email.split('@')[0], lastName: 'Zed' });
    assert.strictEqual(r.status, 201);
    if (role) await models.User.update({ role }, { where: { id: r.body.id } });
    return [agent, r.body.id];
  }
  const sched = (days, tz) => ({ timeZone: tz || NY, days: days.map(([date, start, end]) => ({ date, start, end })) });
  async function sale(title, days, extra) {
    const body = Object.assign({ title, street: '1 Main St', city: 'New York', zipCode: '10036' }, days ? { schedule: sched(days) } : {}, extra);
    const r = await alice.post('/post').send(body);
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    await alerts.idle();
    return r.body;
  }
  const titles = (res) => (Array.isArray(res.body) ? res.body : res.body.results).map((p) => p.title).sort();

  before(() => {
    schedule.setClock(() => clock);
    geo.setProvider(async () => ({ status: 'ok', lat: C.lat, lng: C.lng }));
  });
  after(() => {
    schedule.setClock(null);
    geo.setProvider(null);
    mailer.setTransport(null);
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.ALERT_DIGEST_MINUTES;
  });
  beforeEach(async () => {
    clock = WED_NOON;
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    process.env.ALERT_DIGEST_MINUTES = '0';
    geo.resetRateLimits();
    sent = [];
    mailer.setTransport({ sendMail: async (m) => { sent.push(m); return {}; } });
    await models.sequelize.sync({ force: true });
    [alice, aliceId] = await user('alice@example.com');
    [bob] = await user('bob@example.com');
    [admin] = await user('admin@example.com', 'admin');
  });

  describe('time zones', () => {
    it('converts local times to UTC across DST changes', () => {
      assert.strictEqual(schedule.zonedToUtc('2026-10-24', '08:00', NY).toISOString(), '2026-10-24T12:00:00.000Z'); // EDT
      assert.strictEqual(schedule.zonedToUtc('2026-11-07', '08:00', NY).toISOString(), '2026-11-07T13:00:00.000Z'); // EST
      // 02:30 doesn't exist on 2026-03-08 in New York: moves forward to 03:30 EDT.
      assert.strictEqual(schedule.zonedToUtc('2026-03-08', '02:30', NY).toISOString(), '2026-03-08T07:30:00.000Z');
      // 01:30 happens twice on 2026-11-01: the first (EDT) one.
      assert.strictEqual(schedule.zonedToUtc('2026-11-01', '01:30', NY).toISOString(), '2026-11-01T05:30:00.000Z');
      assert.strictEqual(schedule.zonedToUtc('2026-07-04', '09:00', 'Asia/Kolkata').toISOString(), '2026-07-04T03:30:00.000Z');
      assert.strictEqual(schedule.zonedToUtc('2026-07-04', '09:00', 'Pacific/Auckland').toISOString(), '2026-07-03T21:00:00.000Z');
    });
  });

  describe('saving', () => {
    it('stores days in the sale\'s time zone and derives startDate/endDate', async () => {
      const p = await sale('Two-day sale', [['2026-10-25', '09:00', '13:00'], ['2026-10-24', '08:00', '14:30']]);
      assert.deepStrictEqual(p.schedule, {
        timeZone: NY,
        days: [
          { date: '2026-10-24', start: '08:00', end: '14:30', startsAt: '2026-10-24T12:00:00.000Z', endsAt: '2026-10-24T18:30:00.000Z' },
          { date: '2026-10-25', start: '09:00', end: '13:00', startsAt: '2026-10-25T13:00:00.000Z', endsAt: '2026-10-25T17:00:00.000Z' },
        ],
      });
      assert.strictEqual(new Date(p.startDate).toISOString(), '2026-10-24T12:00:00.000Z');
      assert.strictEqual(new Date(p.endDate).toISOString(), '2026-10-25T17:00:00.000Z');
      assert.strictEqual(p.timeZone, NY);
      assert.strictEqual(p.saleDays, undefined, 'raw rows are not exposed');
      assert.deepStrictEqual((await request(app).get('/post/' + p.id)).body.schedule, p.schedule);

      // Replace with one day in another zone, then clear.
      const up = await alice.put('/post/' + p.id).send({ schedule: sched([['2026-10-31', '10:00', '12:00']], 'America/Los_Angeles') });
      assert.strictEqual(up.status, 200);
      assert.deepStrictEqual(up.body.schedule.days.map((d) => d.startsAt), ['2026-10-31T17:00:00.000Z']);
      assert.strictEqual(await models.SaleDay.count(), 1);
      const cleared = await alice.put('/post/' + p.id).send({ schedule: null });
      assert.strictEqual(cleared.body.schedule, null);
      assert.strictEqual(cleared.body.startDate, null);
      assert.strictEqual(cleared.body.timeZone, null);
      assert.strictEqual(await models.SaleDay.count(), 0);
    });

    it('validates the schedule', async () => {
      const bad = async (schedule, field) => {
        const r = await alice.post('/post').send({ title: 'x', street: '1 Main St', city: 'NY', zipCode: '10036', schedule });
        assert.strictEqual(r.status, 400, JSON.stringify(schedule));
        assert.ok(r.body.error.details[field], field + ': ' + JSON.stringify(r.body.error.details));
      };
      await bad(sched([['2026-10-24', '08:00', '12:00']], 'Mars/Olympus'), 'timeZone');
      await bad(sched([['2026-02-30', '08:00', '12:00']]), 'days.0');
      await bad(sched([['2026-10-24', '8am', '12:00']]), 'days.0');
      await bad(sched([['2026-10-24', '12:00', '12:00']]), 'days.0');
      await bad(sched([['2026-10-24', '20:00', '02:00']]), 'days.0');
      await bad(sched([['2026-10-24', '08:00', '12:00'], ['2026-10-24', '13:00', '14:00']]), 'days.1');
      await bad(sched([['2028-01-01', '08:00', '12:00']]), 'days.0');
      await bad(sched(Array.from({ length: 15 }, (_, i) => ['2026-11-' + String(i + 1).padStart(2, '0'), '08:00', '09:00'])), 'schedule');
      await bad({ days: 'saturday' }, 'schedule');
      await bad('saturday', 'schedule');
      // A brand-new sale can't be entirely in the past...
      await bad(sched([['2026-10-20', '08:00', '12:00']]), 'schedule');
      // ...but an edit may keep days that already happened.
      const p = await sale('Ongoing', [['2026-10-21', '08:00', '18:00']]);
      const r = await alice.put('/post/' + p.id).send({ schedule: sched([['2026-10-20', '08:00', '12:00'], ['2026-10-21', '08:00', '18:00']]) });
      assert.strictEqual(r.status, 200);
      // Missing timeZone falls back to DEFAULT_TIME_ZONE (America/New_York).
      const d = await alice.post('/post').send({ title: 'tz', street: '1 Main', city: 'NY', zipCode: '10036', schedule: { days: [{ date: '2026-10-24', start: '08:00', end: '09:00' }] } });
      assert.strictEqual(d.body.schedule.timeZone, NY);
    });

    it('legacy startDate/endDate still work and replace a day schedule', async () => {
      const p = await sale('Days', [['2026-10-24', '08:00', '12:00']]);
      const r = await alice.put('/post/' + p.id).send({ startDate: '2026-10-30T14:00:00.000Z', endDate: '2026-10-30T20:00:00.000Z' });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.schedule, null);
      assert.strictEqual(await models.SaleDay.count(), 0);
    });
  });

  describe('ended sales', () => {
    let gone, later, undated, legacyOld;
    beforeEach(async () => {
      gone = await sale('Ends today 2pm', [['2026-10-21', '09:00', '14:00']]);
      later = await sale('Saturday', [['2026-10-24', '08:00', '13:00']]);
      undated = await sale('No dates');
      legacyOld = await sale('Legacy old', null, { startDate: '2026-10-21T06:00:00.000Z' }); // + 12h = 18:00Z
      clock = new Date('2026-10-21T19:00:00Z'); // 3pm NY: the first and legacy sales are over
    });

    it('drop out of recent, zip, search (distance + text) and other people\'s seller lists', async () => {
      const keep = ['No dates', 'Saturday'];
      assert.deepStrictEqual(titles(await request(app).get('/allPosts')), keep);
      assert.deepStrictEqual(titles(await bob.get('/allPosts')), keep);
      assert.deepStrictEqual(titles(await alice.get('/allPosts')), keep, 'even the owner\'s browse list');
      assert.deepStrictEqual(titles(await request(app).get('/all/10036')), keep);
      assert.deepStrictEqual(titles(await request(app).get('/search?lat=' + C.lat + '&lng=' + C.lng)), keep);
      delete process.env.GOOGLE_MAPS_API_KEY;
      const text = await request(app).get('/search?q=Main');
      assert.strictEqual(text.body.mode, 'text');
      assert.deepStrictEqual(titles(text), keep);
      assert.deepStrictEqual(titles(await bob.get('/allbyuserId/' + aliceId)), keep);
    });

    it('stay visible to the owner and admins (seller list) and by direct link', async () => {
      const all = ['Ends today 2pm', 'Legacy old', 'No dates', 'Saturday'];
      assert.deepStrictEqual(titles(await alice.get('/allbyuserId/' + aliceId)), all);
      assert.deepStrictEqual(titles(await admin.get('/allbyuserId/' + aliceId)), all);
      const r = await bob.get('/post/' + gone.id);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.schedule.days[0].end, '14:00');
      assert.ok(schedule.isEnded(Object.assign({}, r.body, { saleDays: r.body.schedule.days })));
      assert.ok(!schedule.isEnded(later));
      assert.ok(!schedule.isEnded(undated));
      assert.ok(schedule.isEnded(legacyOld));
    });
  });

  describe('filters', () => {
    beforeEach(async () => {
      await sale('Open now', [['2026-10-21', '09:00', '14:00']]);
      await sale('Tonight', [['2026-10-21', '17:00', '20:00']]);
      await sale('Saturday', [['2026-10-24', '08:00', '13:00']]);
      await sale('Sunday', [['2026-10-25', '10:00', '15:00']]);
      await sale('Next week', [['2026-10-28', '10:00', '15:00']]);
      await sale('Fri + Sat', [['2026-10-23', '08:00', '12:00'], ['2026-10-24', '08:00', '12:00']]);
      await sale('Legacy now', null, { startDate: '2026-10-21T15:00:00.000Z', endDate: '2026-10-21T22:00:00.000Z' });
      await sale('No dates');
    });
    const near = (when) => request(app).get('/search?lat=' + C.lat + '&lng=' + C.lng + (when ? '&when=' + when : ''));

    it('today, this weekend and open now (search and recent)', async () => {
      assert.deepStrictEqual(titles(await near('now')), ['Legacy now', 'Open now']);
      assert.deepStrictEqual(titles(await near('today')), ['Legacy now', 'Open now', 'Tonight']);
      assert.deepStrictEqual(titles(await near('weekend')), ['Fri + Sat', 'Saturday', 'Sunday']);
      assert.strictEqual(titles(await near()).length, 8);
      assert.deepStrictEqual(titles(await request(app).get('/allPosts?when=today')), ['Legacy now', 'Open now', 'Tonight']);
      assert.deepStrictEqual((await near('weekend')).body.filter, { maxPrice: null, freeOnly: false, when: 'weekend' });
      const bad = await near('tomorrow');
      assert.strictEqual(bad.status, 400);
      assert.ok(bad.body.error.details.when);
      assert.strictEqual((await request(app).get('/allPosts?when=yesterday')).status, 400);
    });

    it('"this weekend" on Saturday means today + Sunday, and on Sunday just today', async () => {
      clock = new Date('2026-10-24T18:00:00Z'); // Sat 2pm NY: Saturday's 8-1 sale is over
      assert.deepStrictEqual(titles(await near('weekend')), ['Sunday']);
      clock = new Date('2026-10-24T14:00:00Z'); // Sat 10am
      assert.deepStrictEqual(titles(await near('weekend')), ['Fri + Sat', 'Saturday', 'Sunday']);
      assert.deepStrictEqual(titles(await near('now')), ['Fri + Sat', 'Saturday']);
      clock = new Date('2026-10-25T13:00:00Z'); // Sun 9am
      assert.deepStrictEqual(titles(await near('weekend')), ['Sunday']);
      assert.deepStrictEqual(titles(await near('today')), ['Sunday']);
    });

    it('uses each sale\'s own time zone for "today"', async () => {
      // 11pm Wed in Los Angeles is already Thursday in New York.
      clock = new Date('2026-10-22T06:00:00Z');
      const p = await alice.post('/post').send({ title: 'LA late', street: '1 Main', city: 'LA', zipCode: '90012', schedule: sched([['2026-10-21', '22:00', '23:30']], 'America/Los_Angeles') });
      assert.strictEqual(p.status, 201);
      assert.deepStrictEqual(titles(await near('today')).filter((t) => t === 'LA late'), ['LA late']);
    });
  });

  describe('alerts', () => {
    it('only match sales that have not ended, and drop ones that end before sending', async () => {
      await bob.post('/alerts').send({ lat: C.lat, lng: C.lng, radiusMiles: 10 });
      // Ended legacy sale (startDate long ago) never matches.
      await sale('Old', null, { startDate: '2026-10-01T12:00:00.000Z', endDate: '2026-10-01T16:00:00.000Z' });
      const soon = await sale('Ends at 1pm', [['2026-10-21', '09:00', '13:00']]);
      await sale('Saturday', [['2026-10-24', '08:00', '13:00']]);
      const rows = await models.AlertNotification.findAll({ raw: true });
      assert.strictEqual(rows.length, 2);
      clock = new Date('2026-10-21T18:00:00Z'); // 2pm: "Ends at 1pm" is over
      await alerts.processQueue(clock);
      // (alice also gets her post-sale summary for the ended sale; lib/sellerTools.js)
      const toBob = sent.filter((m) => m.to === 'bob@example.com');
      assert.strictEqual(toBob.length, 1);
      assert.ok(/Saturday/.test(toBob[0].subject), toBob[0].subject);
      const dropped = await models.AlertNotification.findOne({ where: { postId: soon.id } });
      assert.strictEqual(dropped.status, 'skipped');
      assert.strictEqual(dropped.lastError, 'post_ended');
    });
  });
});
