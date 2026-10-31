const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const push = require('../lib/push');
const schedule = require('../lib/schedule');
const earlyBird = require('../lib/earlyBird');

const PW = 'correct-horse';
const H = 3600000;
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);

describe('early-bird access', function () {
  this.timeout(30000);
  let sam, fol, sav, oth, blk, samId, folId, savId, othId, blkId, post, start, now, sent;

  async function user(email, first) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: 'Test' });
    assert.strictEqual(r.status, 201);
    return [agent, r.body.id];
  }

  after(() => { push.setSender(null); geo.setProvider(null); schedule.setClock(null); });
  beforeEach(async () => {
    geo.setProvider(() => Promise.resolve({ status: 'ok', lat: 40.75, lng: -73.98 }));
    await models.sequelize.sync({ force: true });
    sent = [];
    push.setSender(async (s, payload) => {
      const row = await models.PushSubscription.findOne({ where: { endpoint: s.endpoint }, attributes: ['userId'], raw: true });
      sent.push({ userId: row && row.userId, payload: JSON.parse(payload) });
      return { statusCode: 201 };
    });
    // A sale tomorrow 09:00-13:00 New York time; the clock starts the evening before.
    const day = ymd(new Date(Date.now() + 36 * H));
    start = schedule.zonedToUtc(day, '09:00', 'America/New_York');
    now = new Date(start.getTime() - 12 * H);
    schedule.setClock(() => now);
    [sam, samId] = await user('sam@example.com', 'Sam');
    [fol, folId] = await user('fol@example.com', 'Fol');
    [sav, savId] = await user('sav@example.com', 'Sav');
    [oth, othId] = await user('oth@example.com', 'Oth');
    [blk, blkId] = await user('blk@example.com', 'Blk');
    const r = await sam.post('/post').send({ title: 'Estate sale', street: '1 Main St', city: 'New York', state: 'NY', zipCode: '10036', earlyMinutes: 60,
      schedule: { timeZone: 'America/New_York', days: [{ date: day, start: '09:00', end: '13:00' }] } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    post = r.body;
    assert.ok((await fol.put('/follows/' + samId).send({})).status < 300);
    assert.ok((await sav.put('/saved/' + post.id).send({})).status < 300);
    assert.ok((await blk.put('/saved/' + post.id).send({})).status < 300);
    await blk.post('/conversations').send({ postId: post.id }).then((c) => blk.post('/conversations/' + c.body.id + '/block').send({}));
    for (const [agent, i] of [[fol, 1], [sav, 2], [oth, 3], [blk, 4]]) {
      await agent.post('/push/subscriptions').send({ endpoint: 'https://fcm.googleapis.com/fcm/send/e' + i, keys: { p256dh: 'B' + 'x'.repeat(86), auth: 'a'.repeat(22) } });
    }
  });

  it('validates the setting, and never leaks the time to people without access', async () => {
    assert.ok(!('earlyMinutes' in post), 'not in the plain post JSON');
    for (const bad of [10, 200, 50, 'soon', -15]) {
      assert.strictEqual((await sam.put('/post/' + post.id).send({ earlyMinutes: bad })).status, 400, String(bad));
    }
    const own = (await sam.get('/post/' + post.id)).body.earlyBird;
    assert.deepStrictEqual([own.minutes, own.active, own.startsAt, own.until], [60, false, new Date(start.getTime() - H).toISOString(), start.toISOString()]);
    assert.strictEqual((await fol.get('/post/' + post.id)).body.earlyBird.forYou, true, 'follower');
    assert.strictEqual((await sav.get('/post/' + post.id)).body.earlyBird.forYou, true, 'saver');
    for (const agent of [oth, blk, request(app)]) {
      const p = (await agent.get('/post/' + post.id)).body;
      assert.deepStrictEqual(p.earlyBird, { offered: true, forYou: false });
      assert.ok(!JSON.stringify(p).includes(new Date(start.getTime() - H).toISOString()), 'no early time');
      assert.ok(!('earlyMinutes' in p));
    }
    const list = (await request(app).get('/allPosts')).body;
    assert.ok(list.length && !('earlyMinutes' in list[0]) && !list[0].earlyBird);
    // Turning it off.
    assert.strictEqual((await sam.put('/post/' + post.id).send({ earlyMinutes: null })).status, 200);
    assert.strictEqual((await fol.get('/post/' + post.id)).body.earlyBird, undefined);
    assert.deepStrictEqual(earlyBird.validate({ earlyMinutes: '90' }).values, { earlyMinutes: 90 });
  });

  it('when the window opens: followers and savers get one bell + push; others, blocked and the seller do not', async () => {
    assert.deepStrictEqual(await earlyBird.processDue(now), { sales: 0, told: 0 }, 'too early');
    now = new Date(start.getTime() - 50 * 60000);
    const s = await earlyBird.processDue(now);
    assert.deepStrictEqual(s, { sales: 1, told: 2 });
    await push.idle();
    assert.deepStrictEqual(sent.map((x) => x.userId).sort(), [folId, savId].sort());
    assert.ok(sent.every((x) => x.payload.title === 'Early-bird access is open' && x.payload.url === '/post/' + post.id));
    const bell = (await fol.get('/notifications')).body.results[0];
    assert.deepStrictEqual([bell.kind, bell.data.until, bell.data.minutes], ['early_bird', start.toISOString(), 60]);
    for (const agent of [oth, blk, sam]) assert.ok(!(await agent.get('/notifications')).body.results.some((n) => n.kind === 'early_bird'));
    // Once only.
    sent = [];
    assert.strictEqual((await earlyBird.processDue(new Date(now.getTime() + 5 * 60000))).told, 0);
    await push.idle();
    assert.deepStrictEqual(sent, []);
    // During the window: active for people with access; still nothing for others.
    assert.strictEqual((await fol.get('/post/' + post.id)).body.earlyBird.active, true);
    assert.deepStrictEqual((await oth.get('/post/' + post.id)).body.earlyBird, { offered: true, forYou: false });
    // After the start it's an ordinary open sale: no window left.
    now = new Date(start.getTime() + 10 * 60000);
    assert.strictEqual((await fol.get('/post/' + post.id)).body.earlyBird.startsAt, null);
    assert.strictEqual((await oth.get('/post/' + post.id)).body.earlyBird, undefined);
    void sam; void othId; void blkId;
  });

  it('hidden sales never announce early access', async () => {
    await models.Post.update({ hidden: true }, { where: { id: post.id } });
    now = new Date(start.getTime() - 30 * 60000);
    assert.deepStrictEqual(await earlyBird.processDue(now), { sales: 0, told: 0 });
  });
});
