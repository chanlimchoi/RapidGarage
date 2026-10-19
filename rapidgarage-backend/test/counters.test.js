const assert = require('assert');
const request = require('supertest');
const { createApp } = require('../app');
const models = require('../models');
const counters = require('../lib/counters');
const rateLimit = require('../lib/rateLimit');

describe('shared rate-limit counters (RATE_LIMIT_STORE=db)', function () {
  this.timeout(30000);
  beforeEach(async () => {
    process.env.RATE_LIMIT_STORE = 'db';
    await models.sequelize.sync({ force: true });
  });
  after(() => {
    delete process.env.RATE_LIMIT_STORE;
    delete process.env.RATE_LIMIT;
    delete process.env.LOGIN_MAX_FAILURES;
  });

  it('counts atomically under concurrent hits', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => counters.hit('k', 60000)));
    assert.deepStrictEqual(results.map((r) => r.count).sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i + 1));
    assert.strictEqual((await counters.peek('k')).count, 25);
  });

  it('starts a new window once the old one ends', async () => {
    const t = Date.now();
    await counters.hit('w', 1000, t);
    await counters.hit('w', 1000, t + 10);
    const next = await counters.hit('w', 1000, t + 2000);
    assert.strictEqual(next.count, 1);
    assert.ok(next.resetAt >= t + 2900);
    assert.strictEqual(await counters.peek('w', t + 5000), null);
  });

  it('decrements, removes, and stores only hashes', async () => {
    await counters.hit('login-pair|alice@example.com|203.0.113.7', 60000);
    await counters.hit('login-pair|alice@example.com|203.0.113.7', 60000);
    await counters.decrement('login-pair|alice@example.com|203.0.113.7');
    assert.strictEqual((await counters.peek('login-pair|alice@example.com|203.0.113.7')).count, 1);
    const rows = await models.RateCounter.findAll({ raw: true });
    assert.strictEqual(rows.length, 1);
    assert.ok(/^[0-9a-f]{64}$/.test(rows[0].key));
    assert.ok(!JSON.stringify(rows).includes('alice') && !JSON.stringify(rows).includes('203.0.113'));
    await counters.remove('login-pair|alice@example.com|203.0.113.7');
    assert.strictEqual(await counters.peek('login-pair|alice@example.com|203.0.113.7'), null);
  });

  it('locks out repeated failed logins through the shared store', async () => {
    process.env.RATE_LIMIT = 'on';
    process.env.LOGIN_MAX_FAILURES = '2';
    await rateLimit.resetAll();
    const app = createApp(Object.assign({}, process.env, { TRUST_PROXY: '1' }));
    await request(app).post('/signup').set('X-Forwarded-For', '198.51.100.50').send({ email: 'a@example.com', password: 'correct-horse', firstName: 'A' });
    const login = (pw) => request(app).post('/login').set('X-Forwarded-For', '198.51.100.51').send({ email: 'a@example.com', password: pw });
    assert.strictEqual((await login('nope-nope')).status, 401);
    assert.strictEqual((await login('nope-nope')).status, 401);
    assert.strictEqual((await login('correct-horse')).status, 429);
    assert.ok(await models.RateCounter.count() > 0, 'kept in the database');
  });
});
