const assert = require('assert');
const request = require('supertest');
const { createApp } = require('../app');
const models = require('../models');
const rateLimit = require('../lib/rateLimit');
const runtime = require('../lib/runtime');

const PW = 'correct-horse';
const ENV = ['RATE_LIMIT', 'RATE_LIMIT_API_PER_MINUTE', 'RATE_LIMIT_WRITES_PER_MINUTE', 'RATE_LIMIT_AUTH_PER_15_MINUTES',
  'LOGIN_MAX_FAILURES', 'LOGIN_MAX_FAILURES_PER_EMAIL', 'MAX_CONCURRENT_REQUESTS', 'ALL_POSTS_MAX'];

describe('abuse protection', function () {
  this.timeout(30000);
  // TRUST_PROXY=1 so tests can play several clients with X-Forwarded-For.
  const app = createApp(Object.assign({}, process.env, { TRUST_PROXY: '1', FRONTEND_ORIGIN: 'https://garage.example' }));
  const from = (ip) => ({ 'X-Forwarded-For': ip });

  beforeEach(async () => {
    ENV.forEach((k) => delete process.env[k]);
    process.env.RATE_LIMIT = 'on';
    rateLimit.resetAll();
    await models.sequelize.sync({ force: true });
  });
  after(() => {
    ENV.forEach((k) => delete process.env[k]);
    rateLimit.resetAll();
  });

  it('is off under NODE_ENV=test unless RATE_LIMIT turns it on', () => {
    delete process.env.RATE_LIMIT;
    assert.strictEqual(rateLimit.enabled(), false);
    process.env.RATE_LIMIT = 'on';
    assert.strictEqual(rateLimit.enabled(), true);
  });

  it('groups IPv6 clients by /64 and unwraps v4-mapped addresses', () => {
    assert.strictEqual(rateLimit.clientKey('2001:db8:1:2:a:b:c:d'), '2001:db8:1:2::/64');
    assert.strictEqual(rateLimit.clientKey('2001:db8:1:2::9'), '2001:db8:1:2::/64');
    assert.strictEqual(rateLimit.clientKey('2001:DB8::1'), '2001:db8:0:0::/64');
    assert.strictEqual(rateLimit.clientKey('::ffff:203.0.113.9'), '203.0.113.9');
    assert.strictEqual(rateLimit.clientKey('203.0.113.9'), '203.0.113.9');
  });

  it('limits API requests per client, with Retry-After and RateLimit headers', async () => {
    process.env.RATE_LIMIT_API_PER_MINUTE = '3';
    for (let i = 0; i < 3; i++) {
      const r = await request(app).get('/config').set(from('198.51.100.1'));
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.headers['ratelimit-remaining'], String(2 - i));
    }
    const over = await request(app).get('/config').set(from('198.51.100.1'));
    assert.strictEqual(over.status, 429);
    assert.strictEqual(over.body.error.code, 'rate_limited');
    assert.ok(Number(over.headers['retry-after']) >= 1);
    // Someone else is unaffected; health checks never count.
    assert.strictEqual((await request(app).get('/config').set(from('198.51.100.2'))).status, 200);
    assert.strictEqual((await request(app).get('/healthz').set(from('198.51.100.1'))).status, 200);
  });

  it('limits writes and auth attempts separately', async () => {
    process.env.RATE_LIMIT_WRITES_PER_MINUTE = '2';
    process.env.RATE_LIMIT_AUTH_PER_15_MINUTES = '100';
    for (let i = 0; i < 2; i++) await request(app).post('/login').set(from('198.51.100.3')).send({ email: 'x@example.com', password: 'x' });
    assert.strictEqual((await request(app).post('/login').set(from('198.51.100.3')).send({ email: 'x@example.com', password: 'x' })).status, 429);
    assert.strictEqual((await request(app).get('/config').set(from('198.51.100.3'))).status, 200, 'reads still work');

    rateLimit.resetAll();
    process.env.RATE_LIMIT_WRITES_PER_MINUTE = '100';
    process.env.RATE_LIMIT_AUTH_PER_15_MINUTES = '2';
    for (let i = 0; i < 2; i++) {
      await request(app).post('/signup').set(from('198.51.100.4')).send({ email: 'u' + i + '@example.com', password: PW, firstName: 'U' });
    }
    const r = await request(app).post('/signup').set(from('198.51.100.4')).send({ email: 'u9@example.com', password: PW, firstName: 'U' });
    assert.strictEqual(r.status, 429);
    assert.ok(/sign-in attempts/.test(r.body.error.message));
  });

  describe('failed logins', () => {
    beforeEach(async () => {
      process.env.LOGIN_MAX_FAILURES = '3';
      await request(app).post('/signup').set(from('198.51.100.9')).send({ email: 'alice@example.com', password: PW, firstName: 'Alice' });
    });
    const login = (ip, password, email) => request(app).post('/login').set(from(ip)).send({ email: email || 'Alice@example.com', password });

    it('locks an (email, IP) pair after repeated failures, even for the right password', async () => {
      for (let i = 0; i < 3; i++) assert.strictEqual((await login('203.0.113.1', 'wrong-pass')).status, 401);
      const locked = await login('203.0.113.1', PW);
      assert.strictEqual(locked.status, 429);
      assert.ok(/reset your password/.test(locked.body.error.message));
      // The real owner on another network can still get in.
      assert.strictEqual((await login('203.0.113.2', PW)).status, 200);
    });

    it('a successful login clears that pair\'s failures', async () => {
      for (let i = 0; i < 2; i++) await login('203.0.113.1', 'wrong-pass');
      assert.strictEqual((await login('203.0.113.1', PW)).status, 200);
      for (let i = 0; i < 2; i++) assert.strictEqual((await login('203.0.113.1', 'wrong-pass')).status, 401);
      assert.strictEqual((await login('203.0.113.1', PW)).status, 200);
    });

    it('caps failures per email across many IPs', async () => {
      process.env.LOGIN_MAX_FAILURES_PER_EMAIL = '4';
      for (let i = 0; i < 4; i++) await login('203.0.113.' + (10 + i), 'wrong-pass');
      assert.strictEqual((await login('203.0.113.99', PW)).status, 429);
    });
  });

  it('sheds load when too many requests are in flight', async () => {
    process.env.MAX_CONCURRENT_REQUESTS = '2';
    rateLimit.inflight.count = 2;
    const r = await request(app).get('/config');
    assert.strictEqual(r.status, 503);
    assert.strictEqual(r.body.error.code, 'overloaded');
    assert.strictEqual(r.headers['retry-after'], '5');
    rateLimit.inflight.count = 0;
    assert.strictEqual((await request(app).get('/config')).status, 200);
    assert.strictEqual(rateLimit.inflight.count, 0, 'finished requests are released');
  });

  it('refuses cross-site writes but not reads or same-site writes', async () => {
    const evil = await request(app).post('/login').set('Origin', 'https://evil.example').send({ email: 'a@example.com', password: 'x' });
    assert.strictEqual(evil.status, 403);
    assert.strictEqual((await request(app).post('/login').set('Origin', 'null').send({ email: 'a@example.com', password: 'x' })).status, 403);
    assert.strictEqual((await request(app).get('/config').set('Origin', 'https://evil.example')).status, 200);
    assert.strictEqual((await request(app).post('/login').set('Origin', 'https://garage.example').send({ email: 'a@example.com', password: 'x' })).status, 401);
    assert.strictEqual((await request(app).post('/login').send({ email: 'a@example.com', password: 'x' })).status, 401, 'no Origin (non-browser) passes');
  });

  it('answers 413 for oversized bodies', async () => {
    const r = await request(app).post('/login').set('Content-Type', 'application/json').send(JSON.stringify({ email: 'a@example.com', password: 'x'.repeat(200 * 1024) }));
    assert.strictEqual(r.status, 413);
    assert.strictEqual(r.body.error.code, 'payload_too_large');
  });

  it('caps /allPosts to the newest ALL_POSTS_MAX sales', async () => {
    const agent = request.agent(app);
    await agent.post('/signup').send({ email: 'seller@example.com', password: PW, firstName: 'S' });
    for (const t of ['One', 'Two', 'Three']) {
      assert.strictEqual((await agent.post('/post').send({ title: t, zipCode: '10036' })).status, 201);
      await new Promise((r) => setTimeout(r, 15));
    }
    process.env.ALL_POSTS_MAX = '2';
    const r = await request(app).get('/allPosts');
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.body.map((p) => p.title), ['Three', 'Two']);
  });

  it('sets slow-client limits on the HTTP server', () => {
    const fake = {};
    runtime.applyHttpLimits(fake, { HTTP_HEADERS_TIMEOUT_MS: '500000', HTTP_REQUEST_TIMEOUT_MS: '60000' });
    assert.strictEqual(fake.requestTimeout, 60000);
    assert.strictEqual(fake.headersTimeout, 60000, 'never above requestTimeout');
    assert.strictEqual(fake.maxHeadersCount, 100);
    assert.deepStrictEqual(runtime.httpLimits({}).headersTimeout, 15000);
  });
});
