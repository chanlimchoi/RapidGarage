const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const push = require('../lib/push');
const alerts = require('../lib/alerts');
const schedule = require('../lib/schedule');
const curbAlerts = require('../lib/curbAlerts');

const PW = 'correct-horse';
const H = 3600000;
const C = { lat: 40.758, lng: -73.9855 };
const MI_PER_DEG = (Math.PI / 180) * geo.EARTH_RADIUS_MI;
const north = (mi) => ({ lat: C.lat + mi / MI_PER_DEG, lng: C.lng });

describe('free stuff at the curb: quick posts and nearby alerts', function () {
  this.timeout(30000);
  let pat, nan, far, off, blk, patId, nanId, farId, offId, blkId, now, sent;
  const ENV = ['CURB_POSTS_PER_HOUR', 'CURB_POSTS_PER_DAY', 'CURB_ALERTS_PER_DAY', 'CURB_POST_HOURS', 'GOOGLE_MAPS_API_KEY'];
  const saved = {};

  async function user(email, first) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: 'Test' });
    assert.strictEqual(r.status, 201);
    return [agent, r.body.id];
  }
  const quick = (agent, body) => agent.post('/curb').send(Object.assign({ lat: C.lat, lng: C.lng }, body));

  before(() => ENV.forEach((k) => { saved[k] = process.env[k]; }));
  after(() => {
    push.setSender(null); geo.setProvider(null); schedule.setClock(null);
    ENV.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  });
  afterEach(async () => { await alerts.idle(); await push.idle(); });
  beforeEach(async () => {
    ENV.forEach((k) => delete process.env[k]);
    process.env.GOOGLE_MAPS_API_KEY = 'test-server-key';
    geo.setProvider((address) => Promise.resolve(/^5 Elm/.test(address) ? Object.assign({ status: 'ok' }, north(0.3)) : { status: 'not_found' }));
    geo.resetRateLimits();
    await models.sequelize.sync({ force: true });
    now = new Date(Math.floor(Date.now() / H) * H);
    schedule.setClock(() => now);
    sent = [];
    push.setSender(async (s, payload) => {
      const row = await models.PushSubscription.findOne({ where: { endpoint: s.endpoint }, attributes: ['userId'], raw: true });
      sent.push({ userId: row && row.userId, payload: JSON.parse(payload) });
      return { statusCode: 201 };
    });
    [pat, patId] = await user('pat@example.com', 'Pat');
    [nan, nanId] = await user('nan@example.com', 'Nan');
    [far, farId] = await user('far@example.com', 'Far');
    [off, offId] = await user('off@example.com', 'Off');
    [blk, blkId] = await user('blk@example.com', 'Blk');
    let i = 0;
    for (const a of [pat, nan, far, off, blk]) {
      i += 1;
      await a.post('/push/subscriptions').send({ endpoint: 'https://fcm.googleapis.com/fcm/send/c' + i, keys: { p256dh: 'B' + 'x'.repeat(86), auth: 'a'.repeat(22) } });
    }
  });

  it('alert settings: one per person, own place only, validated', async () => {
    assert.deepStrictEqual((await nan.get('/curb/alert')).body.alert, null);
    assert.strictEqual((await request(app).get('/curb/alert')).status, 401);
    assert.strictEqual((await nan.put('/curb/alert').send({ lat: 999, lng: 0, radiusMiles: 1 })).status, 400);
    assert.strictEqual((await nan.put('/curb/alert').send({ lat: C.lat, lng: C.lng, radiusMiles: 7 })).status, 400);
    const r = await nan.put('/curb/alert').send(Object.assign({ radiusMiles: 1 }, north(0.5)));
    assert.strictEqual(r.status, 201);
    assert.deepStrictEqual([r.body.alert.radiusMiles, r.body.alert.enabled], [1, true]);
    assert.strictEqual((await nan.put('/curb/alert').send(Object.assign({ radiusMiles: 2, enabled: false }, north(0.5)))).status, 200);
    assert.strictEqual(await models.CurbAlert.count(), 1);
    assert.strictEqual((await far.get('/curb/alert')).body.alert, null, "never someone else's");
    assert.strictEqual((await nan.delete('/curb/alert')).status, 204);
    assert.strictEqual(await models.CurbAlert.count(), 0);
  });

  it('a quick post is free now, expires after the default 4 hours, and shows like curbside leftovers meanwhile', async () => {
    const r = await quick(pat, { note: 'Bookshelf and two chairs' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const p = r.body;
    assert.deepStrictEqual([p.quickCurb, p.isFree, p.title, p.description], [true, true, 'Free at the curb', 'Bookshelf and two chairs']);
    assert.strictEqual(new Date(p.endDate).getTime() - now.getTime(), 4 * H);
    assert.strictEqual(p.curbside.state, 'active');
    const found = await request(app).get('/search').query({ lat: C.lat, lng: C.lng, radius: 5, curbside: 'true' });
    assert.deepStrictEqual(found.body.results.map((x) => x.id), [p.id]);
    assert.ok((await request(app).get('/allPosts')).body.some((x) => x.id === p.id));
    // A neighbor can say it's taken (existing curbside flow).
    assert.strictEqual((await nan.post('/post/' + p.id + '/curbside/taken').send({})).status, 200);
    // 4 hours later it is gone from lists and search on its own.
    now = new Date(now.getTime() + 4 * H + 1000);
    assert.ok(!(await request(app).get('/allPosts')).body.some((x) => x.id === p.id));
    assert.deepStrictEqual((await request(app).get('/search').query({ lat: C.lat, lng: C.lng, radius: 5 })).body.results, []);
    // Custom hours and an address instead of a device location.
    const two = await pat.post('/curb').send({ street: '5 Elm St', zipCode: '10036', hours: 2, title: 'Free lumber' });
    assert.strictEqual(two.status, 201, JSON.stringify(two.body));
    assert.ok(Math.abs(two.body.lat - north(0.3).lat) < 1e-9);
    assert.strictEqual(new Date(two.body.endDate).getTime() - now.getTime(), 2 * H);
    // Validation.
    assert.strictEqual((await pat.post('/curb').send({ note: 'x' })).status, 400, 'needs a place');
    assert.strictEqual((await pat.post('/curb').send({ street: 'Nowhere', zipCode: '99999' })).status, 400, 'unplaceable address');
    assert.strictEqual((await quick(pat, { hours: 13 })).status, 400);
    assert.strictEqual((await quick(pat, { note: 'n'.repeat(201) })).status, 400);
    assert.strictEqual((await request(app).post('/curb').send({ lat: C.lat, lng: C.lng })).status, 401);
  });

  it('the poster can end it early; nobody else can', async () => {
    const p = (await quick(pat, {})).body;
    assert.strictEqual((await nan.post('/curb/' + p.id + '/end')).status, 403);
    const ended = await pat.post('/curb/' + p.id + '/end');
    assert.strictEqual(ended.status, 200);
    assert.ok(new Date(ended.body.endDate).getTime() <= now.getTime());
    assert.notStrictEqual(ended.body.curbside && ended.body.curbside.state, 'active');
    assert.ok(!(await request(app).get('/allPosts')).body.some((x) => x.id === p.id));
    const sale = await pat.post('/post').send({ title: 'Real sale', street: '5 Elm St', city: 'New York', zipCode: '10036' });
    assert.strictEqual((await pat.post('/curb/' + sale.body.id + '/end')).status, 404, 'not a quick post');
  });

  it('posting is rate limited per hour and per day', async () => {
    process.env.CURB_POSTS_PER_HOUR = '2';
    process.env.CURB_POSTS_PER_DAY = '3';
    assert.strictEqual((await quick(pat, {})).status, 201);
    assert.strictEqual((await quick(pat, {})).status, 201);
    const r = await quick(pat, {});
    assert.strictEqual(r.status, 429);
    assert.ok(Number(r.headers['retry-after']) >= 60);
    now = new Date(now.getTime() + H + 60000);
    // createdAt is real time: move the earlier rows back an hour instead.
    await models.Post.update({ createdAt: new Date(Date.now() - 2 * H) }, { where: { userId: patId }, silent: true });
    assert.strictEqual((await quick(pat, {})).status, 201);
    assert.strictEqual((await quick(pat, {})).status, 429, 'three today');
    assert.strictEqual((await quick(nan, {})).status, 201, 'per person');
  });

  it('nearby alerts: bell + push within each radius, never the poster, the disabled, the far or blocked; capped per day', async () => {
    await nan.put('/curb/alert').send(Object.assign({ radiusMiles: 1 }, north(0.5)));
    await far.put('/curb/alert').send(Object.assign({ radiusMiles: 2 }, north(4)));
    await off.put('/curb/alert').send(Object.assign({ radiusMiles: 5, enabled: false }, north(0.2)));
    await blk.put('/curb/alert').send(Object.assign({ radiusMiles: 5 }, north(0.1)));
    await pat.put('/curb/alert').send(Object.assign({ radiusMiles: 5 }, C));
    await models.UserBlock.create({ blockerId: blkId, blockedId: patId });
    const p = (await quick(pat, { title: 'Free couch' })).body;
    await alerts.idle();
    await push.idle();
    assert.deepStrictEqual(sent.map((x) => x.userId), [nanId]);
    assert.deepStrictEqual([sent[0].payload.title, sent[0].payload.body, sent[0].payload.url], ['Free stuff at the curb, 0.5 mi away', 'Free couch', '/post/' + p.id]);
    const bell = (await nan.get('/notifications')).body.results[0];
    assert.deepStrictEqual([bell.kind, bell.post.id, bell.data.miles], ['curb_free', p.id, 0.5]);
    assert.ok(!JSON.stringify(bell).includes('@'));
    for (const a of [far, off, blk, pat]) assert.ok(!(await a.get('/notifications')).body.results.some((n) => n.kind === 'curb_free'));
    // Daily cap.
    process.env.CURB_ALERTS_PER_DAY = '2';
    await quick(nan, {}); // her own post: not to her
    await quick(far, {}).then(() => alerts.idle());
    const q2 = (await quick(off, {})).body; await alerts.idle();
    const q3 = (await quick(off, {})).body; await alerts.idle();
    const mine = (await nan.get('/notifications')).body.results.filter((n) => n.kind === 'curb_free').map((n) => n.post.id);
    assert.strictEqual(mine.length, 2, JSON.stringify(mine));
    assert.ok(mine.includes(p.id) && !mine.includes(q3.id));
    void q2; void offId; void farId;
    assert.deepStrictEqual(curbAlerts.RADII, [0.5, 1, 2, 3, 5, 10]);
  });
});
