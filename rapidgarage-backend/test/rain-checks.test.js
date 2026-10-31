const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const push = require('../lib/push');
const schedule = require('../lib/schedule');
const weather = require('../lib/weather');
const rainChecks = require('../lib/rainChecks');

const PW = 'correct-horse';
const H = 3600000;
const C = { lat: 40.758, lng: -73.9855 };
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
// Calendar days after `d` in New York (24-hour steps repeat a date across DST changes).
const daysAfter = (d, n) => { const t = new Date(ymd(d) + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

describe('rain checks (Open-Meteo forecasts, postpone)', function () {
  this.timeout(30000);
  let now, sam, bea, cal, dee, beaId, calId, deeId, samId, postId, d1, calls, mode, sent;
  const saved = {};
  const ENV = ['GOOGLE_MAPS_API_KEY', 'WEATHER_ENABLED', 'OPEN_METEO_URL'];

  async function user(email, first) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: 'Test' });
    assert.strictEqual(r.status, 201);
    return [agent, r.body.id];
  }
  // A fake Open-Meteo: the sale's first day gets `mode` weather, the rest are sunny.
  function fakeMeteo(url) {
    calls.push(url);
    if (mode === 'down') return Promise.reject(new Error('ECONNREFUSED'));
    if (mode === 'junk') return Promise.resolve({ error: true });
    const time = [];
    for (let i = -1; i < 16; i++) time.push(daysAfter(now, i));
    const bad = (date) => date === d1;
    const pick = (date, wet, dry) => (bad(date) ? wet : dry);
    return Promise.resolve({ daily: {
      time,
      weather_code: time.map((d) => pick(d, mode === 'storm' ? 95 : 1, 1)),
      precipitation_probability_max: time.map((d) => pick(d, mode === 'storm' ? 90 : 5, 5)),
      precipitation_sum: time.map((d) => pick(d, mode === 'storm' ? 12.5 : 0, 0)),
      wind_speed_10m_max: time.map(() => 10),
      temperature_2m_max: time.map(() => 18),
    } });
  }

  before(() => ENV.forEach((k) => { saved[k] = process.env[k]; }));
  beforeEach(async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-server-key';
    delete process.env.WEATHER_ENABLED;
    geo.setProvider(() => Promise.resolve({ status: 'ok', lat: C.lat, lng: C.lng }));
    geo.resetRateLimits();
    calls = []; mode = 'storm'; sent = [];
    weather.setProvider(fakeMeteo);
    rainChecks.resetThrottle();
    push.setSender(async (s, payload) => {
      const row = await models.PushSubscription.findOne({ where: { endpoint: s.endpoint }, attributes: ['userId'], raw: true });
      sent.push({ userId: row && row.userId, payload: JSON.parse(payload) });
      return { statusCode: 201 };
    });
    await models.sequelize.sync({ force: true });
    now = new Date(Math.ceil(Date.now() / H) * H);
    schedule.setClock(() => now);
    [sam, samId] = await user('sam@example.com', 'Sam');
    [bea, beaId] = await user('bea@example.com', 'Bea');
    [cal, calId] = await user('cal@example.com', 'Cal');
    [dee, deeId] = await user('dee@example.com', 'Dee');
    d1 = ymd(new Date(now.getTime() + 36 * H));
    const d2 = schedule.addDays(d1, 1);
    const p = await sam.post('/post').send({ title: 'Moving sale', street: '1 Main St', city: 'New York', state: 'NY', zipCode: '10036',
      schedule: { timeZone: 'America/New_York', days: [{ date: d1, start: '08:00', end: '14:00' }, { date: d2, start: '09:00', end: '13:00' }] } });
    postId = p.body.id;
    assert.strictEqual(typeof p.body.lat, 'number');
    for (const [agent, i] of [[sam, 1], [bea, 2], [cal, 3], [dee, 4]]) {
      await agent.post('/push/subscriptions').send({ endpoint: 'https://fcm.googleapis.com/fcm/send/d' + i, keys: { p256dh: 'B' + 'x'.repeat(86), auth: 'a'.repeat(22) } });
    }
  });
  after(() => {
    weather.setProvider(null); geo.setProvider(null); push.setSender(null); schedule.setClock(null);
    ENV.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  });

  it('reads the forecast, caches it per area and judges each day', async () => {
    const r = (await request(app).get('/post/' + postId + '/weather')).body;
    assert.deepStrictEqual(r.weather.days.map((d) => [d.date, d.bad, d.reason]), [[d1, true, 'storm'], [schedule.addDays(d1, 1), false, null]]);
    assert.strictEqual(r.rainCheck, null, 'only the owner gets the prompt');
    assert.ok(calls[0].startsWith('https://api.open-meteo.com/v1/forecast?latitude=40.76&longitude=-73.99'), calls[0]);
    assert.ok(!/key=|apikey/i.test(calls[0]), 'keyless');
    const own = (await sam.get('/post/' + postId + '/weather')).body;
    assert.deepStrictEqual([own.rainCheck.date, own.rainCheck.reason, own.rainCheck.pop], [d1, 'storm', 90]);
    assert.strictEqual(calls.length, 1, 'second read comes from the cache');
    // Unit: the rules.
    assert.strictEqual(weather.assess({ code: 61, pop: 80, precip: 3, wind: 5 }).reason, 'rain');
    assert.strictEqual(weather.assess({ code: 3, pop: 30, precip: 0.2, wind: 10 }).bad, false);
    assert.strictEqual(weather.assess({ code: 73, pop: 50, precip: 2, wind: 10 }).reason, 'snow');
    assert.strictEqual(weather.assess({ code: 2, pop: 0, precip: 0, wind: 62 }).reason, 'wind');
    assert.strictEqual(weather.parseDaily({ nope: 1 }), null);
  });

  it('fails safe: unreachable or junk API means no forecast and no prompt, retried later', async () => {
    mode = 'down';
    assert.deepStrictEqual((await sam.get('/post/' + postId + '/weather')).body, { weather: null, rainCheck: null });
    assert.deepStrictEqual((await sam.get('/dashboard/rain-checks')).body, { results: [] });
    assert.strictEqual(calls.length, 1, 'a failure is remembered for a while (no hammering)');
    const s = await rainChecks.processDue(now, { force: true });
    assert.deepStrictEqual([s.flagged, s.created], [0, 0]);
    mode = 'junk';
    now = new Date(now.getTime() + 20 * 60000);
    assert.strictEqual((await sam.get('/post/' + postId + '/weather')).body.weather, null);
    // Turned off: never called.
    process.env.WEATHER_ENABLED = 'false';
    calls = [];
    assert.strictEqual((await sam.get('/post/' + postId + '/weather')).body.weather, null);
    assert.strictEqual(calls.length, 0);
    assert.strictEqual((await rainChecks.processDue(now, { force: true })).off, true);
  });

  it('prompts the seller once (bell, push, dashboard); a dismissed date stops it', async () => {
    const s = await rainChecks.processDue(now, { force: true });
    assert.deepStrictEqual([s.checked, s.flagged, s.created], [1, 1, 1]);
    await push.idle();
    const bell = (await sam.get('/notifications')).body.results;
    assert.deepStrictEqual([bell[0].kind, bell[0].data.date, bell[0].data.reason], ['rain_check', d1, 'storm']);
    assert.deepStrictEqual(sent.map((x) => [x.userId, x.payload.title]), [[samId, 'Bad weather is forecast for your sale']]);
    assert.strictEqual((await rainChecks.processDue(now, { force: true })).created, 0, 'once per sale day');
    assert.strictEqual((await rainChecks.processDue(now)).skipped, true, 'throttled');
    const dash = (await sam.get('/dashboard/rain-checks')).body.results;
    assert.deepStrictEqual(dash.map((r) => [r.postId, r.date]), [[postId, d1]]);
    assert.deepStrictEqual((await bea.get('/dashboard/rain-checks')).body.results, []);
    assert.strictEqual((await bea.post('/post/' + postId + '/rain-check/dismiss').send({ date: d1 })).status, 403);
    assert.strictEqual((await sam.post('/post/' + postId + '/rain-check/dismiss').send({ date: d1 })).status, 200);
    assert.deepStrictEqual((await sam.get('/dashboard/rain-checks')).body.results, []);
    assert.strictEqual((await sam.get('/post/' + postId + '/weather')).body.rainCheck, null);
  });

  it('postponing moves every upcoming day and tells people who saved it (not the seller, not across a block)', async () => {
    assert.ok((await bea.put('/saved/' + postId + '/reminder').send({ on: true })).status < 300);
    assert.ok((await cal.put('/saved/' + postId).send({})).status < 300);
    assert.ok((await dee.put('/saved/' + postId).send({})).status < 300);
    await dee.post('/conversations').send({ postId }).then((r) => dee.post('/conversations/' + r.body.id + '/block').send({}));
    sent = [];
    assert.strictEqual((await bea.post('/post/' + postId + '/postpone').send({ byDays: 7 })).status, 403);
    assert.strictEqual((await sam.post('/post/' + postId + '/postpone').send({ byDays: 0 })).status, 400);
    assert.strictEqual((await sam.post('/post/' + postId + '/postpone').send({ schedule: { timeZone: 'America/New_York', days: [{ date: d1, start: '07:00', end: '09:00' }] } })).status, 400, 'earlier is not a postponement');
    const r = await sam.post('/post/' + postId + '/postpone').send({ byDays: 7 });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const to = schedule.addDays(d1, 7);
    assert.deepStrictEqual(r.body.post.schedule.days.map((d) => [d.date, d.start]), [[to, '08:00'], [schedule.addDays(to, 1), '09:00']]);
    assert.deepStrictEqual([r.body.post.postponedFrom, r.body.told], [d1, 2]);
    await push.idle();
    for (const agent of [bea, cal]) {
      const n = (await agent.get('/notifications')).body.results[0];
      assert.deepStrictEqual([n.kind, n.data.from, n.data.date, n.data.start], ['sale_postponed', d1, to, '08:00']);
    }
    assert.ok(!(await dee.get('/notifications')).body.results.some((n) => n.kind === 'sale_postponed'), 'blocked');
    assert.ok(!(await sam.get('/notifications')).body.results.some((n) => n.kind === 'sale_postponed'), 'not the seller');
    assert.deepStrictEqual(sent.map((x) => x.userId).sort(), [beaId, calId].sort());
    assert.ok(sent.every((x) => x.payload.title === 'A sale you saved was postponed'));
    assert.ok(!JSON.stringify(sent).includes('@'));
    // New dates are past the bad day: no more prompt.
    assert.strictEqual((await sam.get('/post/' + postId + '/weather')).body.rainCheck, null);
    void deeId;
  });
});
