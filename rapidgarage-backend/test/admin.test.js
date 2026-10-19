const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const passport = require('../middlewares/authentication');
const { applyAdminBootstrap } = require('../lib/roles');

const PW = 'correct-horse';
const KEY = 'AIzaSyAdminTest-user-key-00000000004321';

async function signup(email) {
  const agent = request.agent(app);
  const res = await agent.post('/signup').send({ email, password: PW, firstName: 'U' });
  return { agent, id: res.body.id, res };
}

async function makeAdmin(id) {
  await models.User.update({ role: 'admin' }, { where: { id } });
}

describe('admin role', function () {
  this.timeout(10000);
  before(() => { process.env.KEY_ENCRYPTION_SECRET = 'admin-test-encryption-secret-1234'; });
  after(() => {
    ['KEY_ENCRYPTION_SECRET', 'ADMIN_EMAILS', 'ADMIN_BOOTSTRAP_LOCAL', 'ENABLE_USER_MAPS_KEYS'].forEach((k) => delete process.env[k]);
  });
  beforeEach(async () => {
    ['ADMIN_EMAILS', 'ADMIN_BOOTSTRAP_LOCAL', 'ENABLE_USER_MAPS_KEYS'].forEach((k) => delete process.env[k]);
    await models.sequelize.sync({ force: true });
  });

  describe('bootstrap via ADMIN_EMAILS', () => {
    it('new users default to role "user" and /me shows the role', async () => {
      const { agent } = await signup('plain@example.com');
      assert.strictEqual((await agent.get('/me')).body.user.role, 'user');
    });

    it('a verified Google email in ADMIN_EMAILS becomes admin (case-insensitive)', async () => {
      process.env.ADMIN_EMAILS = ' Boss@Example.com , other@example.com';
      const { user } = await passport.handleGoogleProfile({
        id: 'g-admin', emails: [{ value: 'boss@example.com' }], _json: { email_verified: true }, name: {},
      });
      const promoted = await applyAdminBootstrap(user, true);
      assert.strictEqual(promoted.role, 'admin');
    });

    it('local signup/login with a listed email is NOT promoted by default (unverified email)', async () => {
      process.env.ADMIN_EMAILS = 'boss@example.com';
      const { agent, res } = await signup('boss@example.com');
      assert.strictEqual(res.body.role, 'user');
      const login = await request(app).post('/login').send({ email: 'boss@example.com', password: PW });
      assert.strictEqual(login.body.user.role, 'user');
      assert.strictEqual((await agent.get('/admin/users')).status, 403);
    });

    it('ADMIN_BOOTSTRAP_LOCAL=true allows local signup and login to promote', async () => {
      process.env.ADMIN_EMAILS = 'boss@example.com,late@example.com';
      process.env.ADMIN_BOOTSTRAP_LOCAL = 'true';
      const { res } = await signup('boss@example.com');
      assert.strictEqual(res.body.role, 'admin');
      // Existing account promoted on its next login.
      delete process.env.ADMIN_BOOTSTRAP_LOCAL;
      await signup('late@example.com');
      process.env.ADMIN_BOOTSTRAP_LOCAL = 'true';
      const login = await request(app).post('/login').send({ email: 'late@example.com', password: PW });
      assert.strictEqual(login.body.user.role, 'admin');
    });

    it('unlisted emails are never promoted', async () => {
      process.env.ADMIN_EMAILS = 'boss@example.com';
      process.env.ADMIN_BOOTSTRAP_LOCAL = 'true';
      assert.strictEqual((await signup('random@example.com')).res.body.role, 'user');
    });
  });

  describe('requireAdmin', () => {
    it('returns 401 logged out and 403 for non-admins on every admin route', async () => {
      const { agent } = await signup('user@example.com');
      const routes = [
        ['get', '/admin/users'], ['put', '/admin/users/1/role'], ['get', '/admin/settings'], ['put', '/admin/settings'],
      ];
      for (const [m, path] of routes) {
        assert.strictEqual((await request(app)[m](path).send({ role: 'admin', userMapsKeys: false })).status, 401, path);
        const r = await agent[m](path).send({ role: 'admin', userMapsKeys: false });
        assert.strictEqual(r.status, 403, path);
        assert.strictEqual(r.body.error.code, 'forbidden');
      }
      // The non-admin's attempt to self-promote did nothing.
      assert.strictEqual((await agent.get('/me')).body.user.role, 'user');
    });
  });

  describe('role management', () => {
    it('lists users without secrets and promotes/demotes', async () => {
      const admin = await signup('admin@example.com');
      await makeAdmin(admin.id);
      const other = await signup('other@example.com');
      await other.agent.put('/me/maps-key').send({ key: KEY });

      const list = await admin.agent.get('/admin/users');
      assert.strictEqual(list.status, 200);
      assert.deepStrictEqual(list.body.map((u) => u.role), ['admin', 'user']);
      const text = JSON.stringify(list.body);
      ['password', 'mapsKey', 'googleId', KEY, 'v1:'].forEach((s) => assert.ok(!text.includes(s), 'leaked ' + s));

      const up = await admin.agent.put('/admin/users/' + other.id + '/role').send({ role: 'admin' });
      assert.strictEqual(up.status, 200);
      assert.strictEqual(up.body.role, 'admin');
      assert.strictEqual((await other.agent.get('/admin/users')).status, 200, 'new admin has access');

      const down = await other.agent.put('/admin/users/' + admin.id + '/role').send({ role: 'user' });
      assert.strictEqual(down.status, 200);
      assert.strictEqual((await admin.agent.get('/admin/users')).status, 403, 'demoted admin loses access immediately');
    });

    it('validates role and id', async () => {
      const admin = await signup('admin@example.com');
      await makeAdmin(admin.id);
      assert.strictEqual((await admin.agent.put('/admin/users/' + admin.id + '/role').send({ role: 'root' })).status, 400);
      assert.strictEqual((await admin.agent.put('/admin/users/abc/role').send({ role: 'user' })).status, 400);
      assert.strictEqual((await admin.agent.put('/admin/users/999/role').send({ role: 'user' })).status, 404);
    });

    it('cannot demote the last admin (including yourself)', async () => {
      const admin = await signup('admin@example.com');
      await makeAdmin(admin.id);
      const r = await admin.agent.put('/admin/users/' + admin.id + '/role').send({ role: 'user' });
      assert.strictEqual(r.status, 409);
      assert.strictEqual(r.body.error.code, 'conflict');
      assert.strictEqual((await models.User.findByPk(admin.id)).role, 'admin');
    });
  });

  describe('app settings', () => {
    it('defaults from ENABLE_USER_MAPS_KEYS until an admin saves a value, then persists', async () => {
      const admin = await signup('admin@example.com');
      await makeAdmin(admin.id);
      const user = await signup('user@example.com');
      await user.agent.put('/me/maps-key').send({ key: KEY });

      process.env.ENABLE_USER_MAPS_KEYS = 'false';
      assert.deepStrictEqual((await admin.agent.get('/admin/settings')).body, { userMapsKeys: false, saleAlerts: true, wantedPosts: true, aiItems: true, userAiKeys: true });
      delete process.env.ENABLE_USER_MAPS_KEYS;
      assert.deepStrictEqual((await admin.agent.get('/admin/settings')).body, { userMapsKeys: true, saleAlerts: true, wantedPosts: true, aiItems: true, userAiKeys: true });

      const off = await admin.agent.put('/admin/settings').send({ userMapsKeys: false });
      assert.deepStrictEqual(off.body, { userMapsKeys: false, saleAlerts: true, wantedPosts: true, aiItems: true, userAiKeys: true });
      // Stored value wins over the env default from now on.
      process.env.ENABLE_USER_MAPS_KEYS = 'true';
      assert.strictEqual((await request(app).get('/config')).body.userMapsKeys, false);
      assert.strictEqual((await user.agent.get('/me/maps-key')).status, 404);
      assert.strictEqual((await user.agent.get('/maps/key')).status, 404);
      const row = await models.User.scope('withMapsKey').findByPk(user.id);
      assert.ok(row.mapsKeyEncrypted, 'stored key untouched while off');

      await admin.agent.put('/admin/settings').send({ userMapsKeys: true });
      assert.deepStrictEqual((await user.agent.get('/maps/key')).body, { key: KEY, source: 'user' });
      assert.strictEqual(await models.Setting.count(), 1);
    });

    it('rejects unknown settings and wrong types', async () => {
      const admin = await signup('admin@example.com');
      await makeAdmin(admin.id);
      assert.strictEqual((await admin.agent.put('/admin/settings').send({ userMapsKeys: 'no' })).status, 400);
      assert.strictEqual((await admin.agent.put('/admin/settings').send({ bogus: true })).status, 400);
      assert.strictEqual((await admin.agent.put('/admin/settings').send({})).status, 400);
    });
  });

  describe('moderation', () => {
    it('admins can delete any post but not edit it; regular users still cannot delete others\' posts', async () => {
      const admin = await signup('admin@example.com');
      await makeAdmin(admin.id);
      const owner = await signup('owner@example.com');
      const other = await signup('other@example.com');
      const p1 = (await owner.agent.post('/post').send({ title: 'Sale', zipCode: '10001' })).body;
      const p2 = (await owner.agent.post('/post').send({ title: 'Sale 2', zipCode: '10001' })).body;

      assert.strictEqual((await other.agent.delete('/post/' + p1.id)).status, 403);
      assert.strictEqual((await admin.agent.put('/post/' + p1.id).send({ title: 'x' })).status, 403);
      assert.strictEqual((await admin.agent.delete('/post/' + p1.id)).status, 204);
      assert.strictEqual((await request(app).get('/post/' + p1.id)).status, 404);
      assert.strictEqual((await owner.agent.delete('/post/' + p2.id)).status, 204, 'owners can still delete');
    });
  });
});
