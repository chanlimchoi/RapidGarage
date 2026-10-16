const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const passport = require('../middlewares/authentication');
const secretBox = require('../lib/secretBox');

const KEY_A = 'AIzaSyA-test-key-for-alice-000000001234';
const KEY_B = 'AIzaSyB-test-key-for-bob-0000000005678';

function profile(id, email, verified, extra) {
  return Object.assign({
    id, displayName: 'G User', name: { givenName: 'G', familyName: 'User' },
    emails: [{ value: email }], _json: { sub: id, email, email_verified: verified },
  }, extra);
}

function assertNoSecret(res, secret) {
  const text = JSON.stringify(res.body) + (res.text || '');
  assert.ok(!text.includes(secret), 'response leaked the key: ' + res.req.path);
  assert.ok(!text.includes('mapsKeyEncrypted'), 'response leaked ciphertext field');
  assert.ok(!text.includes('v1:'), 'response leaked ciphertext');
}

describe('Google sign-in + BYOK Maps key', function () {
  this.timeout(10000);
  let alice;
  let bob;
  let aliceId;

  before(() => { process.env.KEY_ENCRYPTION_SECRET = 'test-encryption-secret-123456'; });
  after(() => {
    delete process.env.KEY_ENCRYPTION_SECRET;
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  beforeEach(async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    await models.sequelize.sync({ force: true });
    alice = request.agent(app);
    bob = request.agent(app);
    aliceId = (await alice.post('/signup').send({ email: 'alice@example.com', password: 'correct-horse', firstName: 'Alice' })).body.id;
    await bob.post('/signup').send({ email: 'bob@example.com', password: 'correct-horse', firstName: 'Bob' });
  });

  describe('account linking (mocked Google profile verification)', () => {
    it('creates a new passwordless user for a verified new email', async () => {
      const { user, reason } = await passport.handleGoogleProfile(profile('g-1', 'New@Gmail.com', true));
      assert.strictEqual(reason, 'created');
      assert.strictEqual(user.email, 'new@gmail.com');
      const row = await models.User.scope('withPassword').findById(user.id);
      assert.strictEqual(row.get('password'), null);
      assert.strictEqual(row.get('googleId'), 'g-1');
      // A Google-only account cannot be logged into with a local password.
      const res = await request(app).post('/login').send({ email: 'new@gmail.com', password: 'anything-at-all' });
      assert.strictEqual(res.status, 401);
    });

    it('links to an existing local account by verified email; local login still works', async () => {
      const { user, reason } = await passport.handleGoogleProfile(profile('g-2', 'ALICE@example.com', true));
      assert.strictEqual(reason, 'linked');
      assert.strictEqual(user.id, aliceId);
      const again = await passport.handleGoogleProfile(profile('g-2', 'renamed@example.com', true));
      assert.strictEqual(again.reason, 'existing');
      assert.strictEqual(again.user.id, aliceId);
      const local = await request(app).post('/login').send({ email: 'alice@example.com', password: 'correct-horse' });
      assert.strictEqual(local.status, 200);
    });

    it('refuses unverified emails (no create, no link)', async () => {
      const r1 = await passport.handleGoogleProfile(profile('g-3', 'alice@example.com', false));
      assert.strictEqual(r1.user, null);
      assert.strictEqual(r1.reason, 'email_not_verified');
      const r2 = await passport.handleGoogleProfile(profile('g-4', 'stranger@example.com', 'false'));
      assert.strictEqual(r2.user, null);
      const alice = await models.User.findById(aliceId);
      assert.strictEqual(alice.get('googleId'), null);
      assert.strictEqual(await models.User.count(), 2);
    });

    it('refuses to relink an account already tied to another Google account', async () => {
      await passport.handleGoogleProfile(profile('g-5', 'alice@example.com', true));
      const r = await passport.handleGoogleProfile(profile('g-6', 'alice@example.com', true));
      assert.strictEqual(r.user, null);
      assert.strictEqual(r.reason, 'linked_to_other_google_account');
    });

    it('rejects profiles with no id', async () => {
      const r = await passport.handleGoogleProfile({ emails: [{ value: 'x@y.z' }], _json: { email_verified: true } });
      assert.strictEqual(r.user, null);
    });
  });

  describe('Google OAuth routes', () => {
    it('are 404 with a JSON error when not configured', async () => {
      const p = await request(app).get('/auth/providers');
      assert.deepStrictEqual(p.body, { local: true, google: false });
      const r = await request(app).get('/auth/google');
      assert.strictEqual(r.status, 404);
      assert.strictEqual(r.body.error.code, 'not_found');
    });

    it('redirect to Google with state when configured', async () => {
      process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
      process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
      const p = await request(app).get('/auth/providers');
      assert.strictEqual(p.body.google, true);
      const r = await request(app).get('/auth/google');
      assert.strictEqual(r.status, 302);
      const url = new URL(r.headers.location);
      assert.strictEqual(url.hostname, 'accounts.google.com');
      assert.strictEqual(url.searchParams.get('client_id'), 'test-client.apps.googleusercontent.com');
      assert.ok(url.searchParams.get('state'), 'CSRF state parameter expected');
      assert.ok(url.searchParams.get('scope').includes('email'));
      // A callback with no code/state is rejected back to the login page.
      const cb = await request(app).get('/auth/google/callback?error=access_denied');
      assert.strictEqual(cb.status, 302);
      assert.ok(cb.headers.location.includes('/login?googleError='));
    });
  });

  describe('per-user Maps key', () => {
    it('requires login', async () => {
      assert.strictEqual((await request(app).get('/me/maps-key')).status, 401);
      assert.strictEqual((await request(app).put('/me/maps-key').send({ key: KEY_A })).status, 401);
      assert.strictEqual((await request(app).delete('/me/maps-key')).status, 401);
    });

    it('validates the key format', async () => {
      const r = await alice.put('/me/maps-key').send({ key: 'not-a-key' });
      assert.strictEqual(r.status, 400);
      assert.strictEqual((await alice.put('/me/maps-key').send({ key: 123 })).status, 400);
    });

    it('saves encrypted, shows only the last 4, replaces and deletes', async () => {
      const saved = await alice.put('/me/maps-key').send({ key: KEY_A });
      assert.strictEqual(saved.status, 200);
      assert.deepStrictEqual(saved.body, { hasKey: true, last4: '1234' });
      assertNoSecret(saved, KEY_A);
      assert.strictEqual(saved.headers['cache-control'], 'no-store');

      const row = await models.User.scope('withMapsKey').findById(aliceId);
      assert.ok(row.mapsKeyEncrypted.startsWith('v1:'));
      assert.ok(!row.mapsKeyEncrypted.includes(KEY_A), 'stored in plaintext');
      assert.strictEqual(secretBox.decrypt(row.mapsKeyEncrypted), KEY_A);

      assert.deepStrictEqual((await alice.get('/me/maps-key')).body, { hasKey: true, last4: '1234' });
      const replaced = await alice.put('/me/maps-key').send({ key: KEY_B });
      assert.strictEqual(replaced.body.last4, '5678');
      assert.strictEqual((await alice.get('/maps/key')).body.key, KEY_B);

      assert.strictEqual((await alice.delete('/me/maps-key')).status, 204);
      assert.deepStrictEqual((await alice.get('/me/maps-key')).body, { hasKey: false, last4: null });
      assert.strictEqual((await alice.get('/maps/key')).status, 404);
    });

    it('ciphertext uses a fresh IV each time and fails closed on tampering', () => {
      const a = secretBox.encrypt(KEY_A);
      const b = secretBox.encrypt(KEY_A);
      assert.notStrictEqual(a, b);
      const parts = a.split(':');
      parts[3] = Buffer.from('tampered').toString('base64');
      assert.throws(() => secretBox.decrypt(parts.join(':')));
    });

    it('returns 503 when the server has no encryption secret', async () => {
      const saved = process.env.KEY_ENCRYPTION_SECRET;
      delete process.env.KEY_ENCRYPTION_SECRET;
      try {
        const r = await alice.put('/me/maps-key').send({ key: KEY_A });
        assert.strictEqual(r.status, 503);
        assert.strictEqual(r.body.error.code, 'not_configured');
      } finally {
        process.env.KEY_ENCRYPTION_SECRET = saved;
      }
    });

    it('only the owner gets their key; others get the server key or a prompt', async () => {
      await alice.put('/me/maps-key').send({ key: KEY_A });
      const own = await alice.get('/maps/key');
      assert.deepStrictEqual(own.body, { key: KEY_A, source: 'user' });
      assert.strictEqual(own.headers['cache-control'], 'no-store');

      const other = await bob.get('/maps/key');
      assert.strictEqual(other.status, 404);
      assert.strictEqual(other.body.error.code, 'no_maps_key');
      assertNoSecret(other, KEY_A);
      const anon = await request(app).get('/maps/key');
      assert.strictEqual(anon.status, 404);
      assertNoSecret(anon, KEY_A);

      process.env.GOOGLE_MAPS_API_KEY = 'AIzaServerFallbackKey000000000000000';
      assert.deepStrictEqual((await bob.get('/maps/key')).body, { key: 'AIzaServerFallbackKey000000000000000', source: 'server' });
      assert.strictEqual((await request(app).get('/maps/key')).body.source, 'server');
      assert.strictEqual((await alice.get('/maps/key')).body.source, 'user', 'user key wins over server key');
    });

    it('never appears in /me, login, profile, or post responses', async () => {
      await alice.put('/me/maps-key').send({ key: KEY_A });
      const me = await alice.get('/me');
      assertNoSecret(me, KEY_A);
      assert.strictEqual(me.body.user.hasMapsKey, true);
      assert.strictEqual(me.body.user.mapsKeyLast4, '1234');
      assert.ok(!('googleId' in me.body.user));
      assertNoSecret(await request(app).post('/login').send({ email: 'alice@example.com', password: 'correct-horse' }), KEY_A);
      assertNoSecret(await request(app).get('/profile/' + aliceId), KEY_A);
      const post = await alice.post('/post').send({ title: 'Sale', zipCode: '10001' });
      assertNoSecret(post, KEY_A);
      assertNoSecret(await request(app).get('/allPosts'), KEY_A);
      const withUser = await models.Post.findOne({ include: [models.User] });
      assert.ok(!JSON.stringify(withUser.toJSON()).includes('v1:'));
    });
  });
});
