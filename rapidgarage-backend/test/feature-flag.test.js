const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');

const KEY = 'AIzaSyFlagTest-user-key-000000000009876';
const SERVER_KEY = 'AIzaSyFlagTest-server-key-0000000000001';

// ENABLE_USER_MAPS_KEYS is the initial default; with no admin-saved setting, it decides.
describe('per-user Maps keys flag (ENABLE_USER_MAPS_KEYS default, no saved setting)', function () {
  this.timeout(10000);
  let alice;
  let aliceId;

  before(() => { process.env.KEY_ENCRYPTION_SECRET = 'flag-test-encryption-secret-1234'; });
  after(() => {
    delete process.env.KEY_ENCRYPTION_SECRET;
    delete process.env.ENABLE_USER_MAPS_KEYS;
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  beforeEach(async () => {
    delete process.env.ENABLE_USER_MAPS_KEYS;
    delete process.env.GOOGLE_MAPS_API_KEY;
    await models.sequelize.sync({ force: true });
    alice = request.agent(app);
    aliceId = (await alice.post('/signup').send({ email: 'alice@example.com', password: 'correct-horse', firstName: 'A' })).body.id;
    assert.strictEqual((await alice.put('/me/maps-key').send({ key: KEY })).status, 200);
  });

  describe('on', () => {
    for (const value of [undefined, '', 'true', '1', 'yes']) {
      it('is on when ENABLE_USER_MAPS_KEYS=' + JSON.stringify(value), async () => {
        if (value === undefined) delete process.env.ENABLE_USER_MAPS_KEYS;
        else process.env.ENABLE_USER_MAPS_KEYS = value;
        const cfg = await request(app).get('/config');
        assert.strictEqual(cfg.status, 200);
        assert.strictEqual(cfg.body.userMapsKeys, true);
        assert.strictEqual(typeof cfg.body.googleLogin, 'boolean');
        assert.strictEqual((await alice.get('/me/maps-key')).body.last4, '9876');
        assert.deepStrictEqual((await alice.get('/maps/key')).body, { key: KEY, source: 'user' });
      });
    }
  });

  describe('off', () => {
    for (const value of ['false', 'FALSE', '0', 'off', 'no']) {
      it('is off when ENABLE_USER_MAPS_KEYS=' + value, async () => {
        process.env.ENABLE_USER_MAPS_KEYS = value;
        assert.strictEqual((await request(app).get('/config')).body.userMapsKeys, false);
      });
    }

    beforeEach(() => { process.env.ENABLE_USER_MAPS_KEYS = 'false'; });

    it('user key endpoints return 404 feature_disabled and do not read or write', async () => {
      for (const res of [
        await alice.get('/me/maps-key'),
        await alice.put('/me/maps-key').send({ key: 'AIzaSyAnotherKey-should-not-save-00000' }),
        await alice.delete('/me/maps-key'),
        await request(app).get('/me/maps-key'),
      ]) {
        assert.strictEqual(res.status, 404, res.req.method + ' ' + res.req.path);
        assert.strictEqual(res.body.error.code, 'feature_disabled');
        assert.ok(!JSON.stringify(res.body).includes(KEY));
      }
      const row = await models.User.scope('withMapsKey').findByPk(aliceId);
      assert.ok(row.mapsKeyEncrypted && row.mapsKeyEncrypted.startsWith('v1:'), 'stored key kept');
      assert.strictEqual(row.mapsKeyLast4, '9876', 'not replaced by the PUT');
    });

    it('the map never uses the stored user key; neutral message with no server key', async () => {
      const res = await alice.get('/maps/key');
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error.code, 'no_maps_key');
      assert.ok(!/settings/i.test(res.body.error.message), 'should not prompt users to add a key');
      assert.ok(!JSON.stringify(res.body).includes(KEY));
      assert.ok(!/settings/i.test((await request(app).get('/maps/key')).body.error.message));
    });

    it('the map uses the server key when set', async () => {
      process.env.GOOGLE_MAPS_API_KEY = SERVER_KEY;
      assert.deepStrictEqual((await alice.get('/maps/key')).body, { key: SERVER_KEY, source: 'server' });
    });

    it('turning it back on restores the saved key', async () => {
      process.env.ENABLE_USER_MAPS_KEYS = 'true';
      assert.deepStrictEqual((await alice.get('/maps/key')).body, { key: KEY, source: 'user' });
    });
  });
});
