const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const sharp = require('sharp');
const app = require('../app');
const models = require('../models');
const mailer = require('../lib/mailer');
const alerts = require('../lib/alerts');
const emailVerify = require('../lib/emailVerify');
const LocalStorage = require('../lib/storage/local');
const { setStorage } = require('../lib/storage');

const PW = 'correct-horse';

describe('account: email verification, export, deletion', function () {
  this.timeout(30000);
  let sent, dir;
  async function signup(email, firstName) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName, lastName: 'Zed' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    await emailVerify.idle();
    return [agent, r.body.id];
  }
  const linkIn = (msg) => decodeURIComponent(/verify-email\?t=([A-Za-z0-9_%-]+)/.exec(msg.text)[1]);

  before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-acct-')); setStorage(new LocalStorage(dir)); });
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); mailer.setTransport(null); delete process.env.REQUIRE_EMAIL_VERIFICATION; });
  beforeEach(async () => {
    sent = [];
    mailer.setTransport({ sendMail: async (m) => { sent.push(m); return {}; } });
    process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
    await require('../lib/counters').reset();
    await models.sequelize.sync({ force: true });
  });

  describe('email verification', () => {
    it('sends a link at signup and blocks posting and messaging until confirmed', async () => {
      const [alice] = await signup('alice@example.com', 'Alice');
      assert.strictEqual(sent.length, 1);
      assert.ok(/verify-email\?t=/.test(sent[0].text));
      const me = await alice.get('/me');
      assert.strictEqual(me.body.user.emailVerifiedAt, null);
      assert.strictEqual((await request(app).get('/config')).body.emailVerification, true);

      const blocked = await alice.post('/post').send({ title: 'Sale', zipCode: '10001' });
      assert.strictEqual(blocked.status, 403);
      assert.strictEqual(blocked.body.error.code, 'email_unverified');
      assert.strictEqual((await alice.post('/wanted').send({ title: 'Crib' })).status, 403);

      // Confirming works without being logged in (the link may open elsewhere).
      const ok = await request(app).post('/verify-email/confirm').send({ token: linkIn(sent[0]) });
      assert.deepStrictEqual(ok.body, { verified: true });
      assert.ok((await alice.get('/me')).body.user.emailVerifiedAt);
      assert.strictEqual((await alice.post('/post').send({ title: 'Sale', zipCode: '10001' })).status, 201);
      // Links work once.
      assert.strictEqual((await request(app).post('/verify-email/confirm').send({ token: linkIn(sent[0]) })).body.error.code, 'invalid_token');
    });

    it('resends (rate-limited), and expired or malformed links fail', async () => {
      const [alice, id] = await signup('alice@example.com', 'Alice');
      for (let i = 0; i < 4; i++) assert.strictEqual((await alice.post('/verify-email/send')).status, 200);
      assert.strictEqual((await alice.post('/verify-email/send')).status, 429);
      await emailVerify.idle();
      await models.EmailVerification.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { userId: id } });
      assert.strictEqual((await request(app).post('/verify-email/confirm').send({ token: linkIn(sent[1]) })).status, 400);
      assert.strictEqual((await request(app).post('/verify-email/confirm').send({ token: 'x' })).status, 400);
    });

    it('is not enforced when turned off or without SMTP; a password reset verifies', async () => {
      process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
      const [bob] = await signup('bob@example.com', 'Bob');
      assert.strictEqual((await bob.post('/post').send({ title: 'Sale', zipCode: '10001' })).status, 201);
      process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
      mailer.setTransport(null);
      assert.strictEqual((await bob.post('/post').send({ title: 'Sale 2', zipCode: '10001' })).status, 201, 'no SMTP: not enforced');

      mailer.setTransport({ sendMail: async (m) => { sent.push(m); return {}; } });
      await request(app).post('/password-reset').send({ email: 'bob@example.com' });
      await require('../lib/passwordReset').idle();
      const token = decodeURIComponent(/reset-password\?t=([A-Za-z0-9_%-]+)/.exec(sent[sent.length - 1].text)[1]);
      await request(app).post('/password-reset/confirm').send({ token, password: 'battery-staple' });
      assert.ok((await models.User.findOne({ where: { email: 'bob@example.com' } })).emailVerifiedAt);
    });
  });

  describe('export', () => {
    it('downloads my data without secrets, with the other person as First L.', async () => {
      process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
      const [alice, aliceId] = await signup('alice@example.com', 'Alice');
      const [bob] = await signup('bob@example.com', 'Bob');
      const post = (await alice.post('/post').send({ title: 'Lamps', zipCode: '10001' })).body;
      await alerts.idle();
      const conv = (await bob.post('/conversations').send({ postId: post.id })).body;
      await bob.post('/conversations/' + conv.id + '/messages').send({ body: 'Hi Alice' });
      const r = await alice.get('/me/export');
      assert.strictEqual(r.status, 200);
      assert.ok(/attachment; filename="rapidgarage-data-/.test(r.headers['content-disposition']));
      const data = JSON.parse(r.text);
      assert.strictEqual(data.format, 'rapidgarage-export-v1');
      assert.strictEqual(data.profile.id, aliceId);
      assert.deepStrictEqual(data.sales.map((s) => s.title), ['Lamps']);
      assert.strictEqual(data.conversations[0].with, 'Bob Z.');
      assert.strictEqual(data.conversations[0].messages[0].body, 'Hi Alice');
      const text = r.text;
      for (const secret of ['password', '$2a$', 'bob@example.com', 'aiKeyEncrypted', 'tokenHash', 'endpoint']) assert.ok(!text.includes(secret), secret);
      for (let i = 0; i < 2; i++) await alice.get('/me/export');
      assert.strictEqual((await alice.get('/me/export')).status, 429);
    });
  });

  describe('deletion', () => {
    it('needs the password and DELETE, removes photos and every row, and ends the session', async () => {
      process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
      const [alice, aliceId] = await signup('alice@example.com', 'Alice');
      const [bob, bobId] = await signup('bob@example.com', 'Bob');
      const post = (await alice.post('/post').send({ title: 'Lamps', zipCode: '10001' })).body;
      await alerts.idle();
      const img = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#a33' } }).jpeg().toBuffer();
      await alice.post('/post/' + post.id + '/photos').attach('photos', img, 'a.jpg');
      const conv = (await bob.post('/conversations').send({ postId: post.id })).body;
      await bob.post('/conversations/' + conv.id + '/messages').send({ body: 'hi' });
      await bob.put('/follows/' + aliceId).send({});
      await alice.post('/saved/' + post.id).send({}).catch(() => null);
      const filesBefore = fs.readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.webp'));
      assert.ok(filesBefore.length >= 2);

      assert.strictEqual((await alice.delete('/me').send({ currentPassword: PW })).status, 400, 'needs DELETE');
      assert.strictEqual((await alice.delete('/me').send({ currentPassword: 'nope-nope', confirm: 'DELETE' })).status, 400, 'needs the password');
      const r = await alice.delete('/me').send({ currentPassword: PW, confirm: 'DELETE' });
      assert.strictEqual(r.status, 204, JSON.stringify(r.body));
      assert.strictEqual((await alice.get('/me')).status, 401, 'session ended');
      assert.strictEqual(await models.User.count({ where: { id: aliceId } }), 0);
      assert.strictEqual(await models.Post.count({ where: { userId: aliceId } }), 0);
      assert.strictEqual(await models.Conversation.count(), 0);
      assert.strictEqual(await models.Message.count(), 0);
      assert.strictEqual(await models.Follow.count(), 0);
      assert.strictEqual(await models.PostPhoto.count(), 0);
      assert.strictEqual(fs.readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.webp')).length, 0, 'photo files removed');
      assert.ok(sent.some((m) => m.to === 'alice@example.com' && /deleted/i.test(m.subject)));
      assert.strictEqual(await models.User.count({ where: { id: bobId } }), 1, 'other people are untouched');
      assert.strictEqual((await request(app).post('/login').send({ email: 'alice@example.com', password: PW })).status, 401);
    });

    it('refuses to delete the last admin', async () => {
      process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
      const [admin, id] = await signup('admin@example.com', 'Ada');
      await models.User.update({ role: 'admin' }, { where: { id } });
      const r = await admin.delete('/me').send({ currentPassword: PW, confirm: 'DELETE' });
      assert.strictEqual(r.status, 409);
      assert.strictEqual(await models.User.count({ where: { id } }), 1);
    });
  });
});
