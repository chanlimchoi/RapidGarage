const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const alerts = require('../lib/alerts');
const mailer = require('../lib/mailer');
const { setSetting } = require('../lib/features');

const PW = 'correct-horse';
const C = { lat: 40.758, lng: -73.9855 };
// "<n> mi St, ..." geocodes n miles due north of C.
function fakeProvider(address) {
  const m = /([\d.]+) mi St/.exec(address);
  if (!m) return Promise.resolve({ status: 'not_found' });
  return Promise.resolve({ status: 'ok', lat: C.lat + Number(m[1]) / 69.0, lng: C.lng });
}

const ENV = ['ALERTS_MAX_PER_USER', 'ALERT_DIGEST_MINUTES', 'ALERT_DAILY_MAX_EMAILS', 'ALERT_MAX_POSTS_PER_EMAIL', 'APP_BASE_URL',
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'ENABLE_SALE_ALERTS', 'ALERT_TOKEN_SECRET'];

describe('sale alerts', function () {
  this.timeout(30000);
  let alice, bob, carol, aliceId, bobId, carolId, sent, failNext;

  async function user(email, firstName, lastName) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName, lastName });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return [agent, r.body.id];
  }
  const transport = {
    sendMail: async (msg) => {
      if (failNext) { failNext--; const e = new Error('boom'); e.code = 'ECONNREFUSED'; throw e; }
      sent.push(msg);
      return { messageId: 'x' + sent.length };
    },
  };
  const near = { lat: C.lat, lng: C.lng, radiusMiles: 10 };
  const createAlert = (agent, body) => agent.post('/alerts').send(Object.assign({}, near, body));
  async function publish(agent, mi, extra) {
    const r = await agent.post('/post').send(Object.assign({ title: 'Sale at ' + mi + ' mi', street: mi + ' mi St', city: 'New York', state: 'NY', zipCode: '10036' }, extra));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    await alerts.idle();
    return r.body;
  }
  const pending = () => models.AlertNotification.findAll({ order: [['id', 'ASC']], raw: true });

  beforeEach(async () => {
    ENV.forEach((k) => delete process.env[k]);
    process.env.GOOGLE_MAPS_API_KEY = 'test-server-key';
    process.env.APP_BASE_URL = 'https://garage.example';
    process.env.ALERT_DIGEST_MINUTES = '0';
    geo.setProvider(fakeProvider);
    geo.resetRateLimits();
    sent = [];
    failNext = 0;
    mailer.setTransport(transport);
    await models.sequelize.sync({ force: true });
    [alice, aliceId] = await user('alice@example.com', 'Alice', 'Anders');
    [bob, bobId] = await user('bob@example.com', 'Bob', 'Brown');
    [carol, carolId] = await user('carol@example.com', 'Carol', 'Cruz');
  });
  after(() => {
    ENV.forEach((k) => delete process.env[k]);
    delete process.env.GOOGLE_MAPS_API_KEY;
    geo.setProvider(null);
    mailer.setTransport(null);
  });

  describe('CRUD + validation', () => {
    it('requires login', async () => {
      assert.strictEqual((await request(app).get('/alerts')).status, 401);
      assert.strictEqual((await request(app).post('/alerts').send(near)).status, 401);
    });

    it('creates, lists, edits, toggles and deletes; never exposes userId', async () => {
      const r = await createAlert(alice, { label: 'Home', maxPrice: 20 });
      assert.strictEqual(r.status, 201, JSON.stringify(r.body));
      assert.strictEqual(r.body.label, 'Home');
      assert.strictEqual(r.body.maxPrice, 20);
      assert.strictEqual(r.body.enabled, true);
      assert.strictEqual(r.body.userId, undefined);
      const list = await alice.get('/alerts');
      assert.strictEqual(list.headers['cache-control'], 'no-store');
      assert.strictEqual(list.body.results.length, 1);
      assert.strictEqual(list.body.limit, 5);
      assert.strictEqual(list.body.globallyEnabled, true);
      assert.deepStrictEqual(list.body.radius, { min: 1, max: 50 });
      assert.strictEqual((await bob.get('/alerts')).body.results.length, 0);
      const id = r.body.id;
      const up = await alice.put('/alerts/' + id).send({ radiusMiles: 25, freeOnly: true, label: 'Near home' });
      assert.strictEqual(up.status, 200);
      assert.strictEqual(up.body.radiusMiles, 25);
      assert.strictEqual(up.body.freeOnly, true);
      assert.strictEqual(up.body.maxPrice, null, 'free only clears max price');
      assert.strictEqual((await alice.put('/alerts/' + id).send({ enabled: false })).body.enabled, false);
      // Someone else's alert looks missing.
      assert.strictEqual((await bob.put('/alerts/' + id).send({ enabled: true })).status, 404);
      assert.strictEqual((await bob.delete('/alerts/' + id)).status, 404);
      assert.strictEqual((await alice.delete('/alerts/' + id)).status, 204);
      assert.strictEqual((await alice.get('/alerts')).body.results.length, 0);
    });

    it('validates location, radius, price, booleans and label', async () => {
      const bad = async (body, field) => {
        const r = await alice.post('/alerts').send(body);
        assert.strictEqual(r.status, 400, JSON.stringify(body));
        assert.ok(r.body.error.details[field], field + ' ' + JSON.stringify(r.body));
      };
      await bad({ radiusMiles: 5 }, 'location');
      await bad({ lat: 91, lng: 0, radiusMiles: 5 }, 'location');
      await bad({ lat: C.lat, radiusMiles: 5 }, 'location');
      await bad(Object.assign({}, near, { radiusMiles: 0 }), 'radiusMiles');
      await bad(Object.assign({}, near, { radiusMiles: 51 }), 'radiusMiles');
      await bad(Object.assign({}, near, { radiusMiles: 2.5 }), 'radiusMiles');
      await bad(Object.assign({}, near, { maxPrice: -1 }), 'maxPrice');
      await bad(Object.assign({}, near, { maxPrice: 'cheap' }), 'maxPrice');
      await bad(Object.assign({}, near, { freeOnly: 'yes' }), 'freeOnly');
      await bad(Object.assign({}, near, { label: 'x'.repeat(81) }), 'label');
      assert.strictEqual((await createAlert(alice, { radiusMiles: 1 })).status, 201);
      assert.strictEqual((await createAlert(alice, { radiusMiles: 50 })).status, 201);
      assert.strictEqual((await alice.put('/alerts/abc').send({})).status, 400);
    });

    it('geocodes an address (default label) and explains when lookup is unavailable', async () => {
      const r = await alice.post('/alerts').send({ address: '3 mi St, New York', radiusMiles: 5 });
      assert.strictEqual(r.status, 201, JSON.stringify(r.body));
      assert.strictEqual(r.body.label, '3 mi St, New York');
      assert.ok(Math.abs(r.body.lat - (C.lat + 3 / 69)) < 1e-9);
      const nf = await alice.post('/alerts').send({ address: 'Nowhere', radiusMiles: 5 });
      assert.strictEqual(nf.status, 400);
      delete process.env.GOOGLE_MAPS_API_KEY;
      const nk = await alice.post('/alerts').send({ address: '4 mi St', radiusMiles: 5 });
      assert.strictEqual(nk.status, 400);
      assert.strictEqual(nk.body.error.code, 'geocode_unavailable');
    });

    it('enforces the per-user limit (ALERTS_MAX_PER_USER, default 5)', async () => {
      for (let i = 0; i < 5; i++) assert.strictEqual((await createAlert(alice, { label: 'A' + i })).status, 201);
      const r = await createAlert(alice, { label: 'too many' });
      assert.strictEqual(r.status, 409);
      assert.strictEqual(r.body.error.code, 'limit_reached');
      assert.strictEqual((await createAlert(bob)).status, 201, 'limit is per user');
      process.env.ALERTS_MAX_PER_USER = '2';
      assert.strictEqual((await createAlert(bob)).status, 201);
      assert.strictEqual((await createAlert(bob)).status, 409);
    });
  });

  describe('matching', () => {
    it('matches by radius and skips the author', async () => {
      await createAlert(alice, { radiusMiles: 5 });
      await createAlert(carol, { radiusMiles: 20 });
      await createAlert(bob, { radiusMiles: 50 }); // the author
      await publish(bob, 8);
      const rows = await pending();
      assert.deepStrictEqual(rows.map((r) => r.userId), [carolId]);
      assert.strictEqual(rows[0].status, 'pending');
      assert.strictEqual(rows[0].distanceMiles, 8);
      await publish(bob, 2);
      assert.deepStrictEqual((await pending()).map((r) => r.userId).sort(), [aliceId, carolId, carolId].sort());
      await publish(bob, 60);
      assert.strictEqual((await pending()).length, 3, 'outside every radius');
    });

    it('one notification per user per post; the nearest alert wins', async () => {
      const far = (await createAlert(alice, { lat: C.lat + 5 / 69, lng: C.lng, radiusMiles: 30, label: 'far' })).body;
      const close = (await createAlert(alice, { lat: C.lat + 2 / 69, lng: C.lng, radiusMiles: 30, label: 'close' })).body;
      await publish(bob, 2);
      const rows = await pending();
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].alertId, close.id);
      assert.notStrictEqual(rows[0].alertId, far.id);
      // Editing the post's address re-matches without duplicating.
      const p = await models.Post.findOne();
      await bob.put('/post/' + p.id).send({ street: '3 mi St' });
      await alerts.idle();
      assert.strictEqual((await pending()).length, 1);
    });

    it('applies max price and free-only like search', async () => {
      await createAlert(alice, { maxPrice: 10 });
      await createAlert(carol, { freeOnly: true });
      await publish(bob, 1, { isFree: true });
      await publish(bob, 1, { priceMin: 5, priceMax: 50 }); // from $5: <= 10 for alice
      await publish(bob, 1, { priceMin: 20 }); // too pricey for both
      await publish(bob, 1, { priceMax: 40 }); // "up to $40" matches max-price filters
      const rows = await pending();
      const posts = await models.Post.findAll({ order: [['id', 'ASC']] });
      const forUser = (id) => rows.filter((r) => r.userId === id).map((r) => r.postId).sort((a, b) => a - b);
      assert.deepStrictEqual(forUser(aliceId), [posts[0].id, posts[1].id, posts[3].id]);
      assert.deepStrictEqual(forUser(carolId), [posts[0].id]);
    });

    it('ignores disabled alerts and posts without coordinates', async () => {
      const a = (await createAlert(alice)).body;
      await alice.put('/alerts/' + a.id).send({ enabled: false });
      await createAlert(carol);
      await publish(bob, 1);
      await bob.post('/post').send({ title: 'No coords', street: 'Unknown', city: 'X', zipCode: '10036' });
      await alerts.idle();
      assert.deepStrictEqual((await pending()).map((r) => r.userId), [carolId]);
    });

    it('excludes users who blocked the author or were blocked by them', async () => {
      await createAlert(alice);
      await createAlert(carol);
      await models.UserBlock.create({ blockerId: aliceId, blockedId: bobId });
      await models.UserBlock.create({ blockerId: bobId, blockedId: carolId });
      await publish(bob, 1);
      assert.strictEqual((await pending()).length, 0);
    });

    it('never matches hidden posts', async () => {
      await createAlert(alice);
      const post = await models.Post.create({ title: 'Hidden', street: '1 mi St', city: 'NY', zipCode: '10036', userId: bobId, lat: C.lat, lng: C.lng, hidden: true });
      assert.strictEqual(await alerts.enqueueForPost(post), 0);
      assert.strictEqual((await pending()).length, 0);
    });

    it('does nothing while alerts are turned off site-wide', async () => {
      await createAlert(alice);
      await setSetting('saleAlerts', false);
      await publish(bob, 1);
      assert.strictEqual((await pending()).length, 0);
      const r = await createAlert(alice);
      assert.strictEqual(r.status, 403);
      assert.strictEqual(r.body.error.code, 'feature_disabled');
      const list = await alice.get('/alerts');
      assert.strictEqual(list.body.globallyEnabled, false);
      assert.strictEqual(list.body.results.length, 1, 'existing alerts stay listed');
    });

    it('a matching failure never breaks post creation', async () => {
      await createAlert(alice);
      const orig = models.SaleAlert.findAll;
      models.SaleAlert.findAll = () => Promise.reject(new Error('db down'));
      const errs = console.error;
      console.error = () => {};
      try {
        const r = await bob.post('/post').send({ title: 'Still works', street: '1 mi St', city: 'NY', zipCode: '10036' });
        assert.strictEqual(r.status, 201);
        await alerts.idle();
      } finally {
        models.SaleAlert.findAll = orig;
        console.error = errs;
      }
    });
  });

  describe('delivery', () => {
    it('emails titles, prices, distance, links and "First L." — never other users\' emails', async () => {
      await createAlert(alice, { label: 'Home' });
      const p1 = await publish(bob, 1, { priceMin: 5, priceMax: 50, title: 'Tools <and> toys' });
      const p2 = await publish(bob, 3, { isFree: true, title: 'Free stuff' });
      const s = await alerts.processQueue();
      assert.strictEqual(s.emails, 1);
      assert.strictEqual(s.sent, 2);
      assert.strictEqual(sent.length, 1);
      const m = sent[0];
      assert.strictEqual(m.to, 'alice@example.com');
      assert.strictEqual(m.subject, '2 new garage sales near you');
      for (const body of [m.text, m.html]) {
        assert.ok(body.includes('https://garage.example/post/' + p1.id));
        assert.ok(body.includes('https://garage.example/post/' + p2.id));
        assert.ok(body.includes('$5–$50'));
        assert.ok(body.includes('Free'));
        assert.ok(body.includes('1 mi away') && body.includes('3 mi away'));
        assert.ok(body.includes('Bob B.'));
        assert.ok(!body.includes('Brown'), 'no last name');
        assert.ok(!/bob@example\.com|carol@example\.com/.test(body), 'no other emails');
        assert.ok(body.includes('https://garage.example/settings#alerts'));
        assert.ok(body.includes('https://garage.example/alerts/unsubscribe?a='));
      }
      assert.ok(m.text.includes('Tools <and> toys'));
      assert.ok(m.html.includes('Tools &lt;and&gt; toys') && !m.html.includes('<and>'), 'html escaped');
      assert.ok(/^<https:\/\/garage\.example\/api\/alerts\/unsubscribe\?a=\d+&t=.+>$/.test(m.headers['List-Unsubscribe']));
      assert.strictEqual(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
      const rows = await pending();
      assert.ok(rows.every((r) => r.status === 'sent' && r.sentAt && r.digestId));
      assert.strictEqual((await alerts.processQueue()).emails, 0, 'nothing sent twice');
    });

    it('one post gets a specific subject', async () => {
      await createAlert(alice);
      await publish(bob, 1, { title: 'Big yard sale' });
      await alerts.processQueue();
      assert.strictEqual(sent[0].subject, 'New garage sale near you: Big yard sale');
    });

    it('re-checks at send time: hidden/deleted posts, disabled alerts and new blocks are dropped', async () => {
      const a = (await createAlert(alice)).body;
      await createAlert(carol);
      const p1 = await publish(bob, 1);
      const p2 = await publish(bob, 2);
      await models.Post.update({ hidden: true }, { where: { id: p1.id } });
      await models.Post.destroy({ where: { id: p2.id } });
      const p3 = await publish(bob, 3);
      await models.UserBlock.create({ blockerId: carolId, blockedId: bobId });
      await alice.put('/alerts/' + a.id).send({ enabled: false });
      const s = await alerts.processQueue();
      assert.strictEqual(sent.length, 0, JSON.stringify(s));
      const rows = await pending();
      assert.ok(rows.every((r) => r.status === 'skipped'), JSON.stringify(rows));
      const why = rows.filter((r) => r.postId === p3.id).map((r) => r.lastError).sort();
      assert.deepStrictEqual(why, ['alert_disabled', 'blocked']);
    });

    it('digests: at most one email per ALERT_DIGEST_MINUTES', async () => {
      process.env.ALERT_DIGEST_MINUTES = '15';
      await createAlert(alice);
      await publish(bob, 1);
      assert.strictEqual((await alerts.processQueue()).emails, 1);
      await publish(bob, 2);
      await publish(bob, 3);
      const s = await alerts.processQueue();
      assert.strictEqual(s.emails, 0);
      assert.strictEqual(s.deferred, 1);
      const later = new Date(Date.now() + 16 * 60000);
      const s2 = await alerts.processQueue(later);
      assert.strictEqual(s2.emails, 1);
      assert.strictEqual(sent.length, 2);
      assert.strictEqual(sent[1].subject, '2 new garage sales near you');
    });

    it('daily cap: no more than ALERT_DAILY_MAX_EMAILS per rolling 24h; the rest waits', async () => {
      process.env.ALERT_DAILY_MAX_EMAILS = '2';
      await createAlert(alice);
      for (let i = 1; i <= 3; i++) { await publish(bob, i); await alerts.processQueue(); }
      assert.strictEqual(sent.length, 2);
      assert.strictEqual((await pending()).filter((r) => r.status === 'pending').length, 1);
      await alerts.processQueue(new Date(Date.now() + 25 * 3600000));
      assert.strictEqual(sent.length, 3);
    });

    it('caps posts per email (ALERT_MAX_POSTS_PER_EMAIL)', async () => {
      process.env.ALERT_MAX_POSTS_PER_EMAIL = '2';
      await createAlert(alice);
      for (let i = 1; i <= 3; i++) await publish(bob, i);
      await alerts.processQueue();
      assert.strictEqual(sent[0].subject, '2 new garage sales near you');
      assert.strictEqual((await pending()).filter((r) => r.status === 'pending').length, 1);
    });

    it('retries failures with backoff and gives up after 5 attempts', async () => {
      await createAlert(alice);
      await publish(bob, 1);
      const errs = console.error;
      console.error = () => {};
      try {
        failNext = 99;
        let now = Date.now();
        await alerts.processQueue(new Date(now));
        let row = (await pending())[0];
        assert.strictEqual(row.status, 'pending');
        assert.strictEqual(row.attempts, 1);
        assert.strictEqual(row.lastError, 'ECONNREFUSED');
        assert.ok(new Date(row.nextAttemptAt) > new Date(now));
        assert.strictEqual((await alerts.processQueue(new Date(now))).emails, 0, 'waits for backoff');
        for (let i = 0; i < 4; i++) { now += 3600000; await alerts.processQueue(new Date(now)); }
        row = (await pending())[0];
        assert.strictEqual(row.status, 'failed');
        assert.strictEqual(row.attempts, 5);
        // A recovered transport sends the next sale normally.
        failNext = 0;
        await publish(bob, 2);
        assert.strictEqual((await alerts.processQueue(new Date(now))).emails, 1);
      } finally {
        console.error = errs;
      }
    });

    it('one failed send then success', async () => {
      await createAlert(alice);
      await publish(bob, 1);
      const errs = console.error;
      console.error = () => {};
      try {
        failNext = 1;
        await alerts.processQueue();
        await alerts.processQueue(new Date(Date.now() + 3 * 60000));
      } finally { console.error = errs; }
      assert.strictEqual(sent.length, 1);
      assert.strictEqual((await pending())[0].status, 'sent');
    });

    it('without SMTP_HOST: logs, skips and the app keeps working', async () => {
      mailer.setTransport(null);
      assert.strictEqual(mailer.isConfigured(), false);
      await createAlert(alice);
      const p = await publish(bob, 1);
      assert.strictEqual(p.title, 'Sale at 1 mi');
      const logs = [];
      const log = console.log;
      console.log = (...a) => logs.push(a.join(' '));
      let s;
      try { s = await alerts.processQueue(); } finally { console.log = log; }
      assert.strictEqual(s.reason, 'smtp_not_configured');
      assert.strictEqual(s.skipped, 1);
      assert.ok(logs.some((l) => /SMTP is not configured/.test(l)));
      assert.strictEqual((await pending())[0].lastError, 'smtp_not_configured');
      await assert.rejects(mailer.send({ to: 'x@example.com' }), (e) => e.code === 'smtp_not_configured');
      process.env.SMTP_HOST = 'smtp.example.com';
      assert.strictEqual(mailer.isConfigured(), true);
      assert.deepStrictEqual(mailer.smtpConfig().port, 587);
      process.env.SMTP_PORT = '465';
      assert.strictEqual(mailer.smtpConfig().secure, true);
      assert.strictEqual(mailer.smtpConfig().auth, undefined);
    });

    it('turning alerts off site-wide skips the queue', async () => {
      await createAlert(alice);
      await publish(bob, 1);
      await setSetting('saleAlerts', false);
      const s = await alerts.processQueue();
      assert.strictEqual(s.reason, 'alerts_disabled');
      assert.strictEqual(sent.length, 0);
      assert.strictEqual((await pending())[0].lastError, 'alerts_disabled');
    });

    it('expires notifications older than 7 days', async () => {
      await createAlert(alice);
      await publish(bob, 1);
      await alerts.processQueue(new Date(Date.now() + 8 * 86400000));
      assert.strictEqual(sent.length, 0);
      assert.strictEqual((await pending())[0].lastError, 'expired');
    });
  });

  describe('unsubscribe', () => {
    it('signed token disables only that alert without login', async () => {
      const a = (await createAlert(alice, { label: 'Home' })).body;
      const b = (await createAlert(alice, { label: 'Work' })).body;
      await publish(bob, 1);
      const row = await models.SaleAlert.findByPk(a.id);
      const t = alerts.unsubscribeToken(row);
      assert.ok(alerts.unsubscribeUrl(row).startsWith('https://garage.example/alerts/unsubscribe?a=' + a.id + '&t='));
      const r = await request(app).post('/alerts/unsubscribe').send({ a: a.id, t });
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.body, { ok: true, alert: { id: a.id, label: 'Home', radiusMiles: 10, enabled: false } });
      assert.strictEqual(r.headers['cache-control'], 'no-store');
      assert.strictEqual((await models.SaleAlert.findByPk(a.id)).enabled, false);
      assert.strictEqual((await models.SaleAlert.findByPk(b.id)).enabled, true);
      // Idempotent.
      assert.strictEqual((await request(app).post('/alerts/unsubscribe').send({ a: a.id, t })).status, 200);
    });

    it('rejects bad or mismatched tokens', async () => {
      const a = (await createAlert(alice)).body;
      const c = (await createAlert(carol)).body;
      const ta = alerts.unsubscribeToken(await models.SaleAlert.findByPk(a.id));
      const bad = async (body) => {
        const r = await request(app).post('/alerts/unsubscribe').send(body);
        assert.strictEqual(r.status, 400, JSON.stringify(body));
        assert.strictEqual(r.body.error.code, 'invalid_token');
      };
      await bad({});
      await bad({ a: a.id });
      await bad({ a: 'x', t: ta });
      await bad({ a: a.id, t: ta.slice(0, -2) + 'AA' });
      await bad({ a: c.id, t: ta });
      await bad({ a: a.id, t: 42 });
      // A token from another secret is invalid.
      process.env.ALERT_TOKEN_SECRET = 'different';
      await bad({ a: a.id, t: ta });
      delete process.env.ALERT_TOKEN_SECRET;
      assert.strictEqual((await models.SaleAlert.findByPk(a.id)).enabled, true);
      assert.strictEqual((await models.SaleAlert.findByPk(c.id)).enabled, true);
    });

    it('supports RFC 8058 one-click POST (query string, form body) and deleted alerts', async () => {
      const a = (await createAlert(alice)).body;
      await publish(bob, 1);
      const row = await models.SaleAlert.findByPk(a.id);
      const t = alerts.unsubscribeToken(row);
      const r = await request(app).post('/alerts/unsubscribe?a=' + a.id + '&t=' + encodeURIComponent(t))
        .type('form').send('List-Unsubscribe=One-Click');
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual((await models.SaleAlert.findByPk(a.id)).enabled, false);
      assert.strictEqual((await pending())[0].lastError, 'unsubscribed');
      await alice.delete('/alerts/' + a.id);
      const g = await request(app).post('/alerts/unsubscribe').send({ a: a.id, t });
      assert.deepStrictEqual(g.body, { ok: true, gone: true });
    });
  });

  describe('unsubscribe responses are uniform', () => {
    const MISSING = 987654;
    const post = (body, query) => request(app).post('/alerts/unsubscribe' + (query || '')).send(body || {});
    const oneClick = (a, t) => request(app).post('/alerts/unsubscribe?a=' + encodeURIComponent(a) + '&t=' + encodeURIComponent(t))
      .type('form').send('List-Unsubscribe=One-Click');
    const shape = (r) => ({ status: r.status, body: r.body, cache: r.headers['cache-control'], type: r.headers['content-type'] });
    function tamper(t) { return (t[0] === 'A' ? 'B' : 'A') + t.slice(1); }

    let existing, valid, reference;
    beforeEach(async () => {
      existing = (await createAlert(alice, { label: 'Home' })).body;
      valid = alerts.unsubscribeToken(existing.id);
      reference = shape(await post({ a: MISSING, t: 'x' }));
      assert.strictEqual(reference.status, 400);
      assert.deepStrictEqual(reference.body, { error: { code: 'invalid_token', message: 'This unsubscribe link is invalid.' } });
      assert.strictEqual(reference.cache, 'no-store');
    });

    it('an invalid token gets the identical response for existing and nonexistent alerts (page and one-click)', async () => {
      const otherAlertToken = alerts.unsubscribeToken(existing.id + 1);
      const cases = [
        ['wrong token', 'x'],
        ['tampered', tamper(valid)],
        ['another alert\'s token', otherAlertToken],
        ['empty', ''],
        ['too long', valid + 'A'],
        ['padded', valid + '='],
        ['non-base64url', valid.slice(0, -1) + '+'],
      ];
      for (const [name, t] of cases) {
        for (const id of [existing.id, MISSING]) {
          assert.deepStrictEqual(shape(await post({ a: id, t })), reference, 'page: ' + name + ' id ' + id);
          assert.deepStrictEqual(shape(await oneClick(id, t)), reference, 'one-click: ' + name + ' id ' + id);
        }
      }
      // Missing pieces and malformed ids look the same too.
      for (const body of [{}, { a: existing.id }, { a: MISSING }, { t: valid }, { a: 'abc', t: valid }, { a: 0, t: valid }, { a: -1, t: valid }, { a: existing.id, t: 42 }]) {
        assert.deepStrictEqual(shape(await post(body)), reference, JSON.stringify(body));
      }
      assert.deepStrictEqual(shape(await request(app).post('/alerts/unsubscribe').type('form').send('List-Unsubscribe=One-Click')), reference);
      assert.strictEqual((await models.SaleAlert.findByPk(existing.id)).enabled, true, 'nothing was turned off');
    });

    it('checks the token before touching the database', async () => {
      const orig = models.SaleAlert.findByPk;
      let lookups = 0;
      models.SaleAlert.findByPk = function () { lookups++; return orig.apply(this, arguments); };
      try {
        await post({ a: existing.id, t: tamper(valid) });
        await oneClick(MISSING, 'x');
        assert.strictEqual(lookups, 0);
        await post({ a: existing.id, t: valid });
        assert.strictEqual(lookups, 1);
      } finally {
        models.SaleAlert.findByPk = orig;
      }
    });

    it('a valid token still works on both endpoints, and is "gone" for deleted or never-created alerts', async () => {
      const r = await post({ a: existing.id, t: valid });
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.body, { ok: true, alert: { id: existing.id, label: 'Home', radiusMiles: 10, enabled: false } });
      assert.strictEqual((await models.SaleAlert.findByPk(existing.id)).enabled, false);

      const second = (await createAlert(alice, { label: 'Work' })).body;
      const r2 = await oneClick(second.id, alerts.unsubscribeToken(second.id));
      assert.strictEqual(r2.status, 200);
      assert.strictEqual(r2.body.alert.enabled, false);

      await alice.delete('/alerts/' + existing.id);
      for (const res of [await post({ a: existing.id, t: valid }), await oneClick(existing.id, valid), await post({ a: MISSING, t: alerts.unsubscribeToken(MISSING) })]) {
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(res.body, { ok: true, gone: true });
      }
    });

    it('tokens come from the alert id and the secret only', async () => {
      const row = await models.SaleAlert.findByPk(existing.id);
      assert.strictEqual(alerts.unsubscribeToken(row), valid);
      assert.ok(alerts.verifyToken(existing.id, valid));
      assert.ok(!alerts.verifyToken(existing.id, tamper(valid)));
      assert.ok(!alerts.verifyToken(existing.id + 1, valid));
      assert.ok(!alerts.verifyToken(existing.id, undefined));
      assert.ok(alerts.unsubscribeUrl(row).endsWith('?a=' + existing.id + '&t=' + valid));
      process.env.ALERT_TOKEN_SECRET = 'rotated';
      try {
        assert.ok(!alerts.verifyToken(existing.id, valid), 'rotating the secret invalidates links');
        assert.deepStrictEqual(shape(await post({ a: existing.id, t: valid })), reference);
      } finally {
        delete process.env.ALERT_TOKEN_SECRET;
      }
    });
  });

  describe('admin + config', () => {
    it('exposes saleAlerts in /config and lets admins toggle it', async () => {
      assert.strictEqual((await request(app).get('/config')).body.saleAlerts, true);
      process.env.ENABLE_SALE_ALERTS = 'false';
      assert.strictEqual((await request(app).get('/config')).body.saleAlerts, false);
      delete process.env.ENABLE_SALE_ALERTS;
      await models.User.update({ role: 'admin' }, { where: { id: carolId } });
      assert.strictEqual((await alice.put('/admin/settings').send({ saleAlerts: false })).status, 403);
      const r = await carol.put('/admin/settings').send({ saleAlerts: false });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.saleAlerts, false);
      assert.strictEqual((await request(app).get('/config')).body.saleAlerts, false);
      assert.strictEqual((await carol.put('/admin/settings').send({ saleAlerts: 'off' })).status, 400);
      await carol.put('/admin/settings').send({ saleAlerts: true });
      assert.strictEqual((await createAlert(alice)).status, 201);
    });
  });
});
