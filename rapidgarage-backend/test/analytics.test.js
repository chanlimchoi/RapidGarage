const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const analytics = require('../lib/analytics');

const PW = 'correct-horse';
const DAY = 86400000;

describe('admin analytics', function () {
  this.timeout(30000);
  let admin, alice, aliceId;

  async function user(email, role) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: email[0].toUpperCase() + email.slice(1, 4), lastName: 'Zed' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    if (role) await models.User.update({ role }, { where: { id: r.body.id } });
    return [agent, r.body.id];
  }
  // Move a row's createdAt into the past (timestamps are otherwise always "now").
  const backdate = (model, id, daysAgo) => models.sequelize.query('UPDATE "' + model.getTableName() + '" SET "createdAt" = ? WHERE id = ?', { replacements: [new Date(Date.now() - daysAgo * DAY).toISOString(), id] });
  const day = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);

  beforeEach(async () => {
    await models.sequelize.sync({ force: true });
    [admin] = await user('admin@example.com', 'admin');
    [alice, aliceId] = await user('alice@example.com');
  });

  it('is for admins only and validates the range', async () => {
    assert.strictEqual((await request(app).get('/admin/analytics')).status, 401);
    assert.strictEqual((await alice.get('/admin/analytics')).status, 403);
    assert.strictEqual((await admin.get('/admin/analytics?days=12')).status, 400);
    for (const d of [7, 30, 90]) {
      const r = await admin.get('/admin/analytics?days=' + d);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.metrics.signups.series.length, d);
      assert.strictEqual(r.body.to, day(0));
    }
  });

  it('counts this period, the previous one, and fills every day', async () => {
    const [bob, bobId] = await user('bob@example.com');
    await backdate(models.User, bobId, 10); // previous 7-day period
    const p1 = (await alice.post('/post').send({ title: 'Lamps', city: 'Austin', state: 'TX', zipCode: '78701' })).body;
    const p2 = (await alice.post('/post').send({ title: 'Books', city: 'Austin', state: 'TX', zipCode: '78701' })).body;
    const p3 = (await bob.post('/post').send({ title: 'Bikes', city: 'Dallas', state: 'TX', zipCode: '75201' })).body;
    await backdate(models.Post, p3.id, 3);
    const conv = (await bob.post('/conversations').send({ postId: p1.id })).body;
    await bob.post('/conversations/' + conv.id + '/messages').send({ body: 'Still available?' });
    await models.PostViewDay.bulkCreate([
      { postId: p1.id, day: day(0), count: 5 }, { postId: p1.id, day: day(1), count: 3 },
      { postId: p2.id, day: day(2), count: 4 }, { postId: p2.id, day: day(9), count: 7 },
    ]);
    await models.PostScanDay.create({ postId: p1.id, day: day(0), count: 2 });

    const r = (await admin.get('/admin/analytics?days=7')).body;
    assert.deepStrictEqual([r.metrics.signups.total, r.metrics.signups.previous], [2, 1]);
    assert.strictEqual(r.metrics.posts.total, 3);
    assert.strictEqual(r.metrics.posts.series.find((d) => d.date === day(3)).count, 1);
    assert.strictEqual(r.metrics.messages.total, 1);
    assert.strictEqual(r.metrics.conversations.total, 1);
    assert.deepStrictEqual([r.metrics.views.total, r.metrics.views.previous], [12, 7]);
    assert.strictEqual(r.metrics.views.series.find((d) => d.date === day(0)).count, 5);
    assert.strictEqual(r.metrics.scans.total, 2);
    assert.deepStrictEqual(r.totals, { users: 3, activeSales: 3, openReports: 0 });
    assert.deepStrictEqual(r.topCities, [{ city: 'Austin', state: 'TX', sales: 2 }, { city: 'Dallas', state: 'TX', sales: 1 }]);
    assert.deepStrictEqual(r.topSales.map((s) => [s.title, s.views, s.seller]), [['Lamps', 8], ['Books', 4]].map(([t, v]) => [t, v, 'Alic Z.']));
    // Aggregates only: no emails or message text anywhere.
    const body = JSON.stringify(r);
    for (const secret of ['@example.com', 'Still available']) assert.ok(!body.includes(secret), secret);
  });

  it('a hidden sale is not active and the window is UTC days', async () => {
    const p = (await alice.post('/post').send({ title: 'x', zipCode: '10001' })).body;
    await models.Post.update({ hidden: true }, { where: { id: p.id } });
    assert.strictEqual((await analytics.summary(30)).totals.activeSales, 0);
    const w = analytics.windowOf(7, new Date('2026-10-18T23:30:00Z'));
    assert.deepStrictEqual([w.dates[0], w.dates[6], w.dates.length], ['2026-10-12', '2026-10-18', 7]);
    assert.strictEqual(w.prevStart.toISOString(), '2026-10-05T00:00:00.000Z');
  });
});
