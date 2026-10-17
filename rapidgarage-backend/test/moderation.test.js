const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const sharp = require('sharp');
const app = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const LocalStorage = require('../lib/storage/local');
const { setStorage } = require('../lib/storage');

const PW = 'correct-horse';
const CENTER = { lat: 40.758, lng: -73.9855 };

describe('reports + moderation', function () {
  this.timeout(30000);
  let owner, bob, carol, dave, admin, anon, ownerId, adminId, postId, otherId, dir;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-mod-'));
    setStorage(new LocalStorage(dir));
    delete process.env.GOOGLE_MAPS_API_KEY;
  });
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.REPORT_AUTO_HIDE_THRESHOLD;
    delete process.env.REPORT_MAX_PER_HOUR;
  });

  async function user(email) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: email.split('@')[0] });
    assert.strictEqual(r.status, 201);
    return [agent, r.body.id];
  }

  beforeEach(async () => {
    delete process.env.REPORT_AUTO_HIDE_THRESHOLD;
    delete process.env.REPORT_MAX_PER_HOUR;
    geo.resetRateLimits();
    await models.sequelize.sync({ force: true });
    [owner, ownerId] = await user('owner@example.com');
    [bob] = await user('bob@example.com');
    [carol] = await user('carol@example.com');
    [dave] = await user('dave@example.com');
    [admin, adminId] = await user('admin@example.com');
    await models.User.update({ role: 'admin' }, { where: { id: adminId } });
    anon = request(app);
    const p = await owner.post('/post').send({ title: 'Suspicious sale', street: '1 Main St', city: 'New York', zipCode: '10036', priceMin: 5 });
    postId = p.body.id;
    const o = await owner.post('/post').send({ title: 'Normal sale', street: '2 Main St', city: 'New York', zipCode: '10036' });
    otherId = o.body.id;
    await models.Post.update({ lat: CENTER.lat, lng: CENTER.lng }, { where: {} });
  });

  const report = (agent, id, body) => agent.post('/post/' + (id || postId) + '/report').send(Object.assign({ reason: 'scam' }, body));
  const moderate = (agent, action, note, id) => agent.post('/admin/posts/' + (id || postId) + '/moderate').send({ action, note });
  const ids = (res) => (Array.isArray(res.body) ? res.body : res.body.results).map((p) => p.id).sort();

  describe('reporting', () => {
    it('lets a logged-in user report with a reason and an optional note', async () => {
      const r = await report(bob, null, { reason: 'spam', note: '  Same post every day  ' });
      assert.strictEqual(r.status, 201, JSON.stringify(r.body));
      assert.deepStrictEqual([r.body.reason, r.body.status], ['spam', 'open']);
      const row = await models.Report.findByPk(r.body.id);
      assert.strictEqual(row.note, 'Same post every day');
      assert.strictEqual(row.postTitle, 'Suspicious sale');
    });

    it('requires login, a valid reason and a short note', async () => {
      assert.strictEqual((await report(anon)).status, 401);
      assert.strictEqual((await report(bob, null, { reason: 'boring' })).status, 400);
      assert.strictEqual((await report(bob, null, { reason: undefined })).status, 400);
      const long = await report(bob, null, { note: 'x'.repeat(501) });
      assert.strictEqual(long.status, 400);
      assert.ok(long.body.error.details.note);
      assert.strictEqual((await report(bob, null, { note: 'x'.repeat(500) })).status, 201);
      for (const reason of ['spam', 'scam', 'prohibited', 'offensive', 'wrong_info', 'other']) {
        assert.strictEqual((await report(carol, otherId, { reason })).status, reason === 'spam' ? 201 : 409);
      }
    });

    it("can't report your own post or a missing one", async () => {
      assert.strictEqual((await report(owner)).status, 403);
      assert.strictEqual((await report(bob, 99999)).status, 404);
    });

    it('allows one open report per user per post, and a new one after resolution', async () => {
      assert.strictEqual((await report(bob)).status, 201);
      const dup = await report(bob, null, { reason: 'spam' });
      assert.strictEqual(dup.status, 409);
      assert.strictEqual((await report(carol)).status, 201);
      assert.strictEqual((await moderate(admin, 'dismiss')).status, 200);
      assert.strictEqual((await report(bob)).status, 201);
      assert.strictEqual(await models.Report.count({ where: { reporterId: 2 } }), 2);
    });

    it('the database also enforces one open report per user per post', async () => {
      await models.Report.create({ postId, reporterId: 2, reason: 'spam' });
      await assert.rejects(models.Report.create({ postId, reporterId: 2, reason: 'scam' }), /Unique|unique/);
    });

    it('rate-limits reports per user per hour', async () => {
      process.env.REPORT_MAX_PER_HOUR = '2';
      const extra = [];
      for (let i = 0; i < 2; i++) extra.push((await owner.post('/post').send({ title: 'p' + i, street: 'x', city: 'y', zipCode: '10036' })).body.id);
      assert.strictEqual((await report(bob, extra[0])).status, 201);
      assert.strictEqual((await report(bob, extra[1])).status, 201);
      const limited = await report(bob, postId);
      assert.strictEqual(limited.status, 429);
      assert.strictEqual(limited.body.error.code, 'rate_limited');
      assert.strictEqual((await report(carol, postId)).status, 201, 'other users unaffected');
    });
  });

  describe('admin endpoints', () => {
    it('are 403 for regular users and 401 for anonymous', async () => {
      for (const [m, url] of [['get', '/admin/reports'], ['get', '/admin/reports/history'], ['post', '/admin/posts/' + postId + '/moderate']]) {
        assert.strictEqual((await bob[m](url).send({ action: 'hide' })).status, 403, url);
        assert.strictEqual((await owner[m](url).send({ action: 'hide' })).status, 403, url);
        assert.strictEqual((await anon[m](url).send({ action: 'hide' })).status, 401, url);
      }
      const p = await models.Post.findByPk(postId);
      assert.strictEqual(p.hidden, false);
    });

    it('queue groups open reports by post with counts and reasons', async () => {
      await report(bob, null, { reason: 'scam', note: 'asked for a deposit' });
      await report(carol, null, { reason: 'scam' });
      await report(dave, null, { reason: 'spam' });
      await report(bob, otherId, { reason: 'wrong_info' });
      const q = await admin.get('/admin/reports');
      assert.strictEqual(q.status, 200);
      assert.strictEqual(q.body.groups.length, 2);
      const g = q.body.groups[0];
      assert.strictEqual(g.postId, postId);
      assert.strictEqual(g.openCount, 3);
      assert.strictEqual(g.reporterCount, 3);
      assert.deepStrictEqual(g.reasons, { scam: 2, spam: 1 });
      assert.strictEqual(g.post.title, 'Suspicious sale');
      assert.strictEqual(g.owner.email, 'owner@example.com');
      assert.strictEqual(g.reports[0].note, 'asked for a deposit');
      assert.strictEqual(g.reports[0].reporter.email, 'bob@example.com');
      assert.ok(!JSON.stringify(q.body).includes('password'));
    });

    it('dismiss closes the reports and leaves the post visible', async () => {
      await report(bob);
      const r = await moderate(admin, 'dismiss', 'Looks fine');
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.resolved, 1);
      const rep = await models.Report.findOne();
      assert.deepStrictEqual([rep.status, rep.action, rep.reviewerId, rep.resolutionNote], ['dismissed', 'dismissed', adminId, 'Looks fine']);
      assert.ok(rep.reviewedAt);
      assert.strictEqual((await admin.get('/admin/reports')).body.groups.length, 0);
      assert.ok(ids(await anon.get('/allPosts')).includes(postId));
    });

    it('hide, unhide and delete resolve reports and are recorded in history', async () => {
      await report(bob);
      await report(carol);
      let r = await moderate(admin, 'hide', 'Scam');
      assert.strictEqual(r.body.resolved, 2);
      assert.strictEqual(r.body.post.hidden, true);
      assert.strictEqual(r.body.post.hiddenSource, 'moderator');
      let q = await admin.get('/admin/reports');
      assert.deepStrictEqual(q.body.hidden.map((p) => p.id), [postId], 'hidden posts stay listed for unhiding');
      r = await moderate(admin, 'unhide');
      assert.strictEqual(r.body.post.hidden, false);
      await report(dave);
      r = await moderate(admin, 'delete', 'Removed');
      assert.strictEqual(r.status, 200);
      assert.strictEqual(await models.Post.findByPk(postId), null);
      const h = await admin.get('/admin/reports/history');
      assert.strictEqual(h.body.total, 3);
      assert.deepStrictEqual(h.body.results.map((x) => x.action).sort(), ['deleted', 'hidden', 'hidden']);
      const del = h.body.results.find((x) => x.action === 'deleted');
      assert.deepStrictEqual([del.postTitle, del.postExists, del.reviewer.email, del.resolutionNote], ['Suspicious sale', false, 'admin@example.com', 'Removed']);
      assert.strictEqual((await moderate(admin, 'hide')).status, 404);
    });

    it('validates the action and note', async () => {
      assert.strictEqual((await moderate(admin, 'ban')).status, 400);
      assert.strictEqual((await moderate(admin, 'hide', 'x'.repeat(501))).status, 400);
      assert.strictEqual((await admin.post('/admin/posts/abc/moderate').send({ action: 'hide' })).status, 400);
    });

    it('deleting a post with photos removes the files', async () => {
      const img = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#f00' } }).jpeg().toBuffer();
      assert.strictEqual((await owner.post('/post/' + postId + '/photos').attach('photos', img, 'a.jpg')).status, 201);
      assert.strictEqual(fs.readdirSync(path.join(dir, 'posts', String(postId))).length, 2);
      await moderate(admin, 'delete');
      assert.strictEqual(fs.readdirSync(path.join(dir, 'posts', String(postId))).length, 0);
      assert.strictEqual(await models.PostPhoto.count({ where: { postId } }), 0);
    });

    it('owner deleting a reported post closes its open reports', async () => {
      await report(bob);
      assert.strictEqual((await owner.delete('/post/' + postId)).status, 204);
      const rep = await models.Report.findOne();
      assert.deepStrictEqual([rep.status, rep.action, rep.reviewerId], ['actioned', 'deleted', null]);
      assert.strictEqual((await admin.get('/admin/reports')).body.groups.length, 0);
    });
  });

  describe('hidden post visibility', () => {
    beforeEach(async () => {
      await report(bob);
      await moderate(admin, 'hide');
    });

    const paths = () => [
      '/allPosts',
      '/all/10036',
      '/allbyuserId/' + ownerId,
      '/search?lat=' + CENTER.lat + '&lng=' + CENTER.lng + '&radius=5',
      '/search?q=10036',
      '/search?lat=' + CENTER.lat + '&lng=' + CENTER.lng + '&radius=5&maxPrice=10',
    ];

    it('is excluded from every listing and search path for anonymous and other users', async () => {
      for (const agent of [anon, bob]) {
        for (const p of paths()) {
          const r = await agent.get(p);
          assert.strictEqual(r.status, 200, p);
          assert.ok(!ids(r).includes(postId), 'hidden post leaked in ' + p);
          if (!p.includes('maxPrice')) assert.ok(ids(r).includes(otherId), 'visible post missing in ' + p);
        }
      }
      assert.strictEqual((await anon.get('/post/' + postId)).status, 404);
      assert.strictEqual((await bob.get('/post/' + postId)).status, 404);
      assert.strictEqual((await carol.post('/post/' + postId + '/report').send({ reason: 'spam' })).status, 404);
    });

    it('is still visible to the owner (flagged hidden) and to admins', async () => {
      for (const agent of [owner, admin]) {
        for (const p of paths()) assert.ok(ids(await agent.get(p)).includes(postId), p);
      }
      const own = await owner.get('/post/' + postId);
      assert.strictEqual(own.status, 200);
      assert.strictEqual(own.body.hidden, true);
      assert.strictEqual(own.body.hiddenSource, 'moderator');
      assert.ok(!('hiddenBy' in own.body), 'who hid it is admin-only');
    });

    it('unhiding brings it back everywhere', async () => {
      await moderate(admin, 'unhide');
      for (const p of paths()) {
        if (!p.includes('maxPrice')) assert.ok(ids(await anon.get(p)).includes(postId), p);
      }
    });
  });

  describe('auto-hide', () => {
    it('is off unless REPORT_AUTO_HIDE_THRESHOLD is set', async () => {
      await report(bob); await report(carol); await report(dave);
      assert.strictEqual((await models.Post.findByPk(postId)).hidden, false);
    });

    it('hides a post once N distinct users have open reports', async () => {
      process.env.REPORT_AUTO_HIDE_THRESHOLD = '2';
      await report(bob);
      assert.strictEqual((await models.Post.findByPk(postId)).hidden, false);
      const r = await report(carol);
      assert.ok(!('hidden' in r.body), 'reporter is not told the outcome');
      const p = await models.Post.findByPk(postId);
      assert.deepStrictEqual([p.hidden, p.hiddenSource, p.hiddenBy], [true, 'auto', null]);
      assert.ok(!ids(await anon.get('/allPosts')).includes(postId));
      const q = await admin.get('/admin/reports');
      assert.strictEqual(q.body.groups[0].post.hiddenSource, 'auto');
      assert.strictEqual(q.body.autoHideThreshold, 2);
      await moderate(admin, 'unhide', 'False alarm');
      assert.strictEqual((await models.Post.findByPk(postId)).hidden, false);
      await report(dave);
      assert.strictEqual((await models.Post.findByPk(postId)).hidden, false, 'old resolved reports do not count');
    });

    it('ignores invalid thresholds', async () => {
      process.env.REPORT_AUTO_HIDE_THRESHOLD = 'zero';
      await report(bob);
      process.env.REPORT_AUTO_HIDE_THRESHOLD = '0';
      await report(carol);
      assert.strictEqual((await models.Post.findByPk(postId)).hidden, false);
    });
  });
});
