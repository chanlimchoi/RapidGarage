const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const alerts = require('../lib/alerts');
const safety = require('../lib/safety');

const PW = 'correct-horse';
const DAY = 86400000;
const ENV = ['SAFETY_SELLER_REPORTERS', 'SAFETY_WINDOW_DAYS', 'SAFETY_STRIKES', 'REPORT_DISMISSED_LIMIT', 'REPORT_TRUST_MIN_HOURS', 'NO_SHOW_PER_DAY', 'REPORT_MAX_PER_HOUR', 'REPORT_AUTO_HIDE_THRESHOLD'];

describe('buyer safety: no-show and suspicious flags, repeat offenders, flag abuse', function () {
  this.timeout(30000);
  let sam, admin, anon, samId, adminId, buyers, posts;
  const saved = {};

  async function user(email, first) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: 'Test' });
    assert.strictEqual(r.status, 201);
    return [agent, r.body.id];
  }
  const report = (agent, postId, body) => agent.post('/post/' + postId + '/report').send(Object.assign({ reason: 'suspicious' }, body));
  const old = (ids) => models.User.update({ createdAt: new Date(Date.now() - 3 * DAY) }, { where: { id: ids }, silent: true });
  const visible = async (id) => !(await models.Post.findByPk(id)).hidden;

  before(() => ENV.forEach((k) => { saved[k] = process.env[k]; }));
  after(() => { geo.setProvider(null); ENV.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); });
  afterEach(() => alerts.idle());

  beforeEach(async () => {
    ENV.forEach((k) => delete process.env[k]);
    geo.setProvider(() => Promise.resolve({ status: 'ok', lat: 40.75, lng: -73.98 }));
    await models.sequelize.sync({ force: true });
    [sam, samId] = await user('sam@example.com', 'Sam');
    [admin, adminId] = await user('admin@example.com', 'Ada');
    await models.User.update({ role: 'admin' }, { where: { id: adminId } });
    buyers = [];
    for (const n of ['bea', 'cal', 'dee', 'eli']) buyers.push(await user(n + '@example.com', n[0].toUpperCase() + n.slice(1)));
    posts = [];
    for (const title of ['Bike sale', 'Tool sale', 'Toy sale']) posts.push((await sam.post('/post').send({ title, street: '1 Main St', city: 'New York', state: 'NY', zipCode: '10036' })).body.id);
    anon = request(app);
  });

  it('no-show flags need a real dealing on that sale, store only the kind of contact, and are limited', async () => {
    const [bea, beaId] = buyers[0];
    const [cal] = buyers[1];
    let r = await report(bea, posts[0], { reason: 'no_show' });
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.body.error.code, 'no_contact');
    const conv = (await bea.post('/conversations').send({ postId: posts[0] })).body.id;
    await bea.post('/conversations/' + conv + '/messages').send({ body: 'See you at 9?' });
    r = await report(bea, posts[0], { reason: 'no_show', note: 'Waited 30 minutes, nobody came.' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    const row = await models.Report.findByPk(r.body.id);
    assert.deepStrictEqual([row.reason, row.contact, row.sellerId, row.reporterId], ['no_show', 'conversation', samId, beaId]);
    // One per seller per week, even on another of their sales.
    await bea.post('/conversations').send({ postId: posts[1] });
    assert.strictEqual((await report(bea, posts[1], { reason: 'no_show' })).status, 409);
    // In the moderation queue, with the reason and contact kind; the conversation stays closed to admins.
    const q = await admin.get('/admin/reports');
    const g = q.body.groups.find((x) => x.postId === posts[0]);
    assert.deepStrictEqual([g.reasons.no_show, g.reports[0].contact], [1, 'conversation']);
    assert.strictEqual(q.body.reasons.no_show, 'Seller no-show');
    assert.strictEqual(q.body.reasons.suspicious, 'Suspicious listing');
    assert.ok(!JSON.stringify(q.body).includes('See you at 9'));
    assert.strictEqual((await admin.get('/admin/conversations/' + conv)).status, 404, 'admins read a conversation only when a participant reports it');
    // Daily cap.
    process.env.NO_SHOW_PER_DAY = '1';
    await cal.post('/conversations').send({ postId: posts[2] });
    await models.Report.update({ createdAt: new Date() }, { where: {} });
    const [dee] = buyers[2];
    await dee.post('/conversations').send({ postId: posts[2] });
    assert.strictEqual((await report(dee, posts[2], { reason: 'no_show' })).status, 201);
    await dee.post('/conversations').send({ postId: posts[1] });
    const capped = await report(dee, posts[1], { reason: 'no_show' });
    assert.strictEqual(capped.status, 429);
    assert.strictEqual(capped.headers['retry-after'], '86400');
    assert.strictEqual((await report(anon, posts[0], { reason: 'no_show' })).status, 401);
  });

  it('repeat offender: 3 trusted reporters across a seller\'s listings hide all of them, and new posts, pending review', async () => {
    await old(buyers.map((b) => b[1]));
    const [bea] = buyers[0]; const [cal] = buyers[1]; const [dee] = buyers[2];
    assert.strictEqual((await report(bea, posts[0])).status, 201);
    assert.strictEqual((await report(cal, posts[1], { reason: 'scam' })).status, 201);
    assert.ok(await visible(posts[0]) && await visible(posts[2]), 'two reporters: nothing yet');
    const r = await report(dee, posts[2]);
    assert.strictEqual(r.status, 201);
    assert.ok(!('hidden' in r.body), "reporters aren't told");
    for (const id of posts) {
      const p = await models.Post.findByPk(id);
      assert.deepStrictEqual([p.hidden, p.hiddenSource], [true, 'repeat']);
    }
    assert.ok((await models.User.findByPk(samId)).safetyHoldAt);
    // New posts start hidden while the hold lasts.
    const fresh = (await sam.post('/post').send({ title: 'New sale', street: '2 Main St', city: 'New York', zipCode: '10036' })).body;
    assert.strictEqual((await models.Post.findByPk(fresh.id)).hiddenSource, 'repeat');
    assert.ok(!(await anon.get('/allPosts')).body.some((p) => p.id === fresh.id));
    // Admin queue lists the hold.
    const q = await admin.get('/admin/reports');
    assert.strictEqual(q.body.safetyHolds.length, 1);
    assert.deepStrictEqual([q.body.safetyHolds[0].user.id, q.body.safetyHolds[0].hiddenCount, q.body.safetyHolds[0].reporters], [samId, 4, 3]);
    assert.strictEqual(q.body.safety.sellerReporters, 3);
    assert.ok(q.body.groups.every((g) => g.sellerOnHold));
    // Release: listings back, hold off, reports still open for per-post review.
    assert.strictEqual((await sam.post('/admin/users/' + samId + '/safety').send({ action: 'release' })).status, 403);
    assert.strictEqual((await admin.post('/admin/users/' + samId + '/safety').send({ action: 'nope' })).status, 400);
    const rel = await admin.post('/admin/users/' + samId + '/safety').send({ action: 'release' });
    assert.deepStrictEqual([rel.status, rel.body.posts], [200, 4]);
    assert.ok(await visible(posts[0]) && await visible(fresh.id));
    assert.strictEqual((await models.User.findByPk(samId)).safetyHoldAt, null);
    assert.strictEqual(await models.Report.count({ where: { status: 'open' } }), 3);
    assert.strictEqual((await admin.post('/admin/users/' + samId + '/safety').send({ action: 'release' })).status, 404);
  });

  it('confirm keeps listings hidden as a moderator decision and upholds their reports; new accounts and spam reports never count', async () => {
    const [bea] = buyers[0]; const [cal] = buyers[1]; const [dee] = buyers[2]; const [eli, eliId] = buyers[3];
    // Fresh accounts (under 24 h) don't count toward a seller hold.
    await report(bea, posts[0]); await report(cal, posts[1]); await report(dee, posts[2]);
    assert.strictEqual((await models.User.findByPk(samId)).safetyHoldAt, null);
    // Spam isn't a safety reason.
    await old(buyers.map((b) => b[1]));
    await models.Report.destroy({ where: {} });
    await report(bea, posts[0], { reason: 'spam' }); await report(cal, posts[1], { reason: 'spam' }); await report(dee, posts[2], { reason: 'spam' });
    assert.strictEqual((await models.User.findByPk(samId)).safetyHoldAt, null);
    await report(eli, posts[0], { reason: 'scam' });
    assert.strictEqual((await models.User.findByPk(samId)).safetyHoldAt, null, 'one safety reporter');
    process.env.SAFETY_SELLER_REPORTERS = '1';
    await models.Report.destroy({ where: { reporterId: eliId } });
    await report(eli, posts[1], { reason: 'scam' });
    assert.ok((await models.User.findByPk(samId)).safetyHoldAt);
    const c = await admin.post('/admin/users/' + samId + '/safety').send({ action: 'confirm', note: 'Confirmed scam' });
    assert.deepStrictEqual([c.status, c.body.posts], [200, 3]);
    for (const id of posts) assert.strictEqual((await models.Post.findByPk(id)).hiddenSource, 'moderator');
    assert.strictEqual(await models.Report.count({ where: { status: 'open' } }), 0);
    assert.ok((await models.User.findByPk(samId)).safetyHoldAt, 'hold stays until released');
  });

  it('strikes: with 2 upheld safety reports, the next trusted safety report hides that listing at once', async () => {
    process.env.SAFETY_SELLER_REPORTERS = '0';
    const [bea, beaId] = buyers[0];
    const [cal] = buyers[1];
    await models.Report.bulkCreate([0, 1].map((i) => ({ postId: posts[i], sellerId: samId, reporterId: beaId, reason: 'scam', status: 'actioned', action: 'hidden', reviewedAt: new Date() })));
    assert.ok(await visible(posts[2]));
    assert.strictEqual((await report(cal, posts[2])).status, 201);
    const p = await models.Post.findByPk(posts[2]);
    assert.deepStrictEqual([p.hidden, p.hiddenSource], [true, 'repeat']);
    assert.strictEqual((await models.User.findByPk(samId)).safetyHoldAt, null, 'strike hides one listing, no hold');
    void bea;
  });

  it('flag abuse: reporters whose flags keep getting dismissed never trigger auto-hide and get a smaller budget', async () => {
    process.env.REPORT_AUTO_HIDE_THRESHOLD = '1';
    process.env.REPORT_DISMISSED_LIMIT = '3';
    const [bea, beaId] = buyers[0];
    const [cal] = buyers[1];
    await models.Report.bulkCreate([1, 2, 3].map(() => ({ postId: posts[1], sellerId: samId, reporterId: beaId, reason: 'spam', status: 'dismissed', action: 'dismissed', reviewedAt: new Date(), createdAt: new Date(Date.now() - 2 * DAY) })));
    assert.deepStrictEqual(await safety.standing(beaId), { dismissed: 3, upheld: 0, untrusted: true });
    assert.strictEqual((await report(bea, posts[0])).status, 201, 'still accepted');
    assert.ok(await visible(posts[0]), 'but does not hide');
    const q = await admin.get('/admin/reports');
    assert.strictEqual(q.body.groups[0].reports[0].reporter.standing.untrusted, true);
    // Budget 2 per hour (the report above was the first).
    assert.strictEqual((await report(bea, posts[2])).status, 201);
    const third = await report(bea, posts[1]);
    assert.strictEqual(third.status, 429);
    // A trusted reporter's flag still auto-hides under the per-post threshold.
    assert.strictEqual((await report(cal, posts[0])).status, 201);
    assert.ok(!(await visible(posts[0])));
  });
});
