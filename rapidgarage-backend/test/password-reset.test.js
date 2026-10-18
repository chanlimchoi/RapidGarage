const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const mailer = require('../lib/mailer');
const reset = require('../lib/passwordReset');

const PW = 'correct-horse';
const NEW_PW = 'battery-staple';
const ENV = ['APP_BASE_URL', 'PASSWORD_RESET_TTL_MINUTES', 'PASSWORD_RESET_MAX_PER_HOUR', 'PASSWORD_RESET_MAX_PER_IP_HOUR'];

describe('password reset', function () {
  this.timeout(30000);
  let sent, failNext;
  const transport = {
    sendMail: async (msg) => {
      if (failNext) { failNext--; const e = new Error('boom'); e.code = 'ECONNREFUSED'; throw e; }
      sent.push(msg);
      return { messageId: 'x' + sent.length };
    },
  };

  async function signup(email, extra) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send(Object.assign({ email, password: PW, firstName: 'Alice' }, extra));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return agent;
  }
  async function ask(email) {
    const r = await request(app).post('/password-reset').send({ email });
    await reset.idle();
    return r;
  }
  const tokenFrom = (msg) => decodeURIComponent(/reset-password\?t=([A-Za-z0-9_%-]+)/.exec(msg.text)[1]);

  beforeEach(async () => {
    ENV.forEach((k) => delete process.env[k]);
    process.env.APP_BASE_URL = 'https://garage.example';
    sent = [];
    failNext = 0;
    mailer.setTransport(transport);
    reset.resetIpLimits();
    await models.sequelize.sync({ force: true });
  });
  after(() => {
    ENV.forEach((k) => delete process.env[k]);
    mailer.setTransport(null);
  });

  it('emails a one-time link and answers the same for unknown emails', async () => {
    await signup('alice@example.com');
    const known = await ask('Alice@Example.com ');
    const unknown = await ask('nobody@example.com');
    assert.strictEqual(known.status, 202);
    assert.strictEqual(unknown.status, 202);
    assert.deepStrictEqual(known.body, unknown.body);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].to, 'alice@example.com');
    assert.ok(sent[0].text.includes('https://garage.example/reset-password?t='));
    assert.ok(sent[0].html.includes('https://garage.example/reset-password?t='));
    // Only the hash is stored.
    const row = await models.PasswordReset.findOne();
    const token = tokenFrom(sent[0]);
    assert.notStrictEqual(row.tokenHash, token);
    assert.strictEqual(row.tokenHash, reset.hashToken(token));
  });

  it('validates the email', async () => {
    const r = await request(app).post('/password-reset').send({ email: 'nope' });
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.error.details.email);
  });

  it('says so when the server cannot send email', async () => {
    mailer.setTransport(null);
    delete process.env.SMTP_HOST;
    const r = await request(app).post('/password-reset').send({ email: 'alice@example.com' });
    assert.strictEqual(r.status, 503);
    assert.strictEqual(r.body.error.code, 'not_configured');
    assert.strictEqual((await request(app).get('/config')).body.passwordReset, false);
    mailer.setTransport(transport);
    assert.strictEqual((await request(app).get('/config')).body.passwordReset, true);
  });

  it('resets the password, logs in, and signs out other sessions', async () => {
    const other = await signup('alice@example.com');
    assert.strictEqual((await other.get('/me')).status, 200);
    await ask('alice@example.com');
    const token = tokenFrom(sent[0]);
    assert.deepStrictEqual((await request(app).post('/password-reset/check').send({ token })).body, { valid: true });

    const browser = request.agent(app);
    const r = await browser.post('/password-reset/confirm').send({ token, password: NEW_PW });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.user.email, 'alice@example.com');
    assert.strictEqual(r.body.user.authVersion, undefined);
    assert.strictEqual((await browser.get('/me')).status, 200);
    // The session that was logged in before the reset is gone.
    assert.strictEqual((await other.get('/me')).status, 401);

    assert.strictEqual((await request(app).post('/login').send({ email: 'alice@example.com', password: PW })).status, 401);
    assert.strictEqual((await request(app).post('/login').send({ email: 'alice@example.com', password: NEW_PW })).status, 200);

    // A "password changed" notice follows the reset email.
    await reset.idle();
    assert.strictEqual(sent.length, 2);
    assert.ok(/changed/i.test(sent[1].subject));
  });

  it('links work once, expire, and are voided by a newer password', async () => {
    await signup('alice@example.com');
    await ask('alice@example.com');
    await ask('alice@example.com');
    const [first, second] = sent.map(tokenFrom);
    assert.strictEqual((await request(app).post('/password-reset/confirm').send({ token: second, password: NEW_PW })).status, 200);
    // Reused, and the older outstanding link.
    for (const token of [second, first]) {
      const r = await request(app).post('/password-reset/confirm').send({ token, password: 'another-one' });
      assert.strictEqual(r.status, 400);
      assert.strictEqual(r.body.error.code, 'invalid_token');
    }

    await ask('alice@example.com');
    const third = tokenFrom(sent[sent.length - 1]);
    await models.PasswordReset.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { tokenHash: reset.hashToken(third) } });
    assert.deepStrictEqual((await request(app).post('/password-reset/check').send({ token: third })).body, { valid: false });
    assert.strictEqual((await request(app).post('/password-reset/confirm').send({ token: third, password: NEW_PW })).status, 400);
  });

  it('rejects malformed tokens and short passwords', async () => {
    assert.deepStrictEqual((await request(app).post('/password-reset/check').send({ token: 'x' })).body, { valid: false });
    assert.deepStrictEqual((await request(app).post('/password-reset/check').send({})).body, { valid: false });
    const r = await request(app).post('/password-reset/confirm').send({ token: 'a'.repeat(43), password: 'short' });
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.error.details.password);
  });

  it('limits requests per account (silently) and per IP', async () => {
    process.env.PASSWORD_RESET_MAX_PER_HOUR = '2';
    process.env.PASSWORD_RESET_MAX_PER_IP_HOUR = '4';
    await signup('alice@example.com');
    for (let i = 0; i < 3; i++) assert.strictEqual((await ask('alice@example.com')).status, 202);
    assert.strictEqual(sent.length, 2);
    assert.strictEqual((await ask('alice@example.com')).status, 202);
    const r = await ask('alice@example.com');
    assert.strictEqual(r.status, 429);
    assert.strictEqual(r.body.error.code, 'rate_limited');
  });

  it('does not count a link that failed to send', async () => {
    process.env.PASSWORD_RESET_MAX_PER_HOUR = '1';
    await signup('alice@example.com');
    failNext = 1;
    assert.strictEqual((await ask('alice@example.com')).status, 202);
    assert.strictEqual(await models.PasswordReset.count(), 0);
    await ask('alice@example.com');
    assert.strictEqual(sent.length, 1);
  });

  it('writes the email in the account language', async () => {
    await signup('alice@example.com', { locale: 'es' });
    await ask('alice@example.com');
    assert.strictEqual(sent[0].subject, 'Restablece tu contraseña de RapidGarage');
    assert.strictEqual(sent[0].headers['Content-Language'], 'es');
  });

  it('lets a Google-only account set a password by reset', async () => {
    await models.User.create({ email: 'g@example.com', googleId: 'g-1', password: null, firstName: 'Gee' });
    await ask('g@example.com');
    const r = await request(app).post('/password-reset/confirm').send({ token: tokenFrom(sent[0]), password: NEW_PW });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await request(app).post('/login').send({ email: 'g@example.com', password: NEW_PW })).status, 200);
  });

  describe('change password (logged in)', () => {
    it('needs the current password, keeps this session and ends the others', async () => {
      const here = await signup('alice@example.com');
      const there = request.agent(app);
      assert.strictEqual((await there.post('/login').send({ email: 'alice@example.com', password: PW })).status, 200);
      assert.deepStrictEqual((await here.get('/me/password')).body, { hasPassword: true });

      const wrong = await here.put('/me/password').send({ currentPassword: 'nope-nope', newPassword: NEW_PW });
      assert.strictEqual(wrong.status, 400);
      assert.ok(wrong.body.error.details.currentPassword);

      const ok = await here.put('/me/password').send({ currentPassword: PW, newPassword: NEW_PW });
      assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
      assert.strictEqual((await here.get('/me')).status, 200);
      assert.strictEqual((await there.get('/me')).status, 401);
      assert.strictEqual((await request(app).post('/login').send({ email: 'alice@example.com', password: NEW_PW })).status, 200);
    });

    it('lets a Google-only account add a password without a current one', async () => {
      await models.User.create({ email: 'g@example.com', googleId: 'g-1', password: null, firstName: 'Gee' });
      // There's no Google in tests: log in by resetting, then drop the password again.
      await ask('g@example.com');
      const agent = request.agent(app);
      await agent.post('/password-reset/confirm').send({ token: tokenFrom(sent[0]), password: NEW_PW });
      await models.User.update({ password: null }, { where: { email: 'g@example.com' }, hooks: false });
      assert.deepStrictEqual((await agent.get('/me/password')).body, { hasPassword: false });
      const r = await agent.put('/me/password').send({ newPassword: NEW_PW });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.deepStrictEqual((await agent.get('/me/password')).body, { hasPassword: true });
    });

    it('requires login', async () => {
      assert.strictEqual((await request(app).get('/me/password')).status, 401);
      assert.strictEqual((await request(app).put('/me/password').send({ newPassword: NEW_PW })).status, 401);
    });
  });

  it('keeps sessions that predate session versions', (done) => {
    const passport = require('../middlewares/authentication');
    models.User.create({ email: 'old@example.com', password: PW, firstName: 'Old' }).then((u) => {
      passport.deserializeUser(u.id, {}, (err, user) => {
        assert.ifError(err);
        assert.strictEqual(user && user.id, u.id);
        done();
      });
    }).catch(done);
  });
});
