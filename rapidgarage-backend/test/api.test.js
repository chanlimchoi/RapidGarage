const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');

const PW = 'correct-horse';

async function signup(agent, email, extra) {
  return agent.post('/signup').send(Object.assign({ email, password: PW, firstName: 'Test' }, extra));
}

function assertError(res, status, code) {
  assert.strictEqual(res.status, status, JSON.stringify(res.body));
  assert.ok(res.body.error, 'expected { error } body');
  assert.strictEqual(res.body.error.code, code);
  assert.strictEqual(typeof res.body.error.message, 'string');
}

function assertNoPassword(obj) {
  assert.ok(!JSON.stringify(obj).includes('"password"'), 'response leaked a password field: ' + JSON.stringify(obj));
}

describe('RapidGarage API', function () {
  this.timeout(10000);
  let alice;
  let bob;
  let aliceId;

  beforeEach(async () => {
    await models.sequelize.sync({ force: true });
    alice = request.agent(app);
    bob = request.agent(app);
    const a = await signup(alice, 'alice@example.com');
    aliceId = a.body.id;
    await signup(bob, 'bob@example.com');
  });

  describe('auth', () => {
    it('signup returns 201, logs in, and hides the password', async () => {
      const agent = request.agent(app);
      const res = await signup(agent, 'Carol@Example.com');
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.email, 'carol@example.com');
      assertNoPassword(res.body);
      const me = await agent.get('/me');
      assert.strictEqual(me.status, 200);
      assert.strictEqual(me.body.user.email, 'carol@example.com');
      assertNoPassword(me.body);
    });

    it('rejects invalid signup with 400 and field details', async () => {
      const res = await request(app).post('/signup').send({ email: 'nope', password: 'short' });
      assertError(res, 400, 'bad_request');
      assert.ok(res.body.error.details.email);
      assert.ok(res.body.error.details.password);
      assert.ok(res.body.error.details.firstName);
    });

    it('rejects a duplicate email with 409', async () => {
      const res = await signup(request(app), 'ALICE@example.com');
      assertError(res, 409, 'conflict');
    });

    it('GET /me is 401 when logged out', async () => {
      assertError(await request(app).get('/me'), 401, 'unauthorized');
    });

    it('login works (case-insensitive email) and hides the password', async () => {
      const agent = request.agent(app);
      const res = await agent.post('/login').send({ email: 'Alice@Example.com', password: PW });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.user.id, aliceId);
      assertNoPassword(res.body);
      assert.strictEqual((await agent.get('/me')).status, 200);
    });

    it('wrong password and unknown email give the same 401', async () => {
      const a = await request(app).post('/login').send({ email: 'alice@example.com', password: 'wrong-password' });
      const b = await request(app).post('/login').send({ email: 'nobody@example.com', password: PW });
      assertError(a, 401, 'unauthorized');
      assertError(b, 401, 'unauthorized');
      assert.strictEqual(a.body.error.message, b.body.error.message);
    });

    it('malformed login input is a 400, not a crash', async () => {
      assertError(await request(app).post('/login').send({ email: ['x'], password: {} }), 400, 'bad_request');
      assertError(await request(app).post('/login').send({}), 400, 'bad_request');
      const bad = await request(app).post('/login').set('Content-Type', 'application/json').send('{not json');
      assertError(bad, 400, 'bad_request');
    });

    it('logout ends the session', async () => {
      assert.strictEqual((await alice.post('/logout')).status, 200);
      assertError(await alice.get('/me'), 401, 'unauthorized');
    });
  });

  describe('posts', () => {
    const valid = { title: 'Garage sale', zipCode: '10001', city: 'New York', street: '1 Main St' };

    it('requires login to create', async () => {
      assertError(await request(app).post('/post').send(valid), 401, 'unauthorized');
    });

    it('uses the session user, ignoring a body userId', async () => {
      const res = await alice.post('/post').send(Object.assign({ userId: 999 }, valid));
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.userId, aliceId);
    });

    it('validates title, zip code and dates', async () => {
      const res = await alice.post('/post').send({ title: ' ', zipCode: '1234', startDate: 'soon' });
      assertError(res, 400, 'bad_request');
      assert.ok(res.body.error.details.title);
      assert.ok(res.body.error.details.zipCode);
      assert.ok(res.body.error.details.startDate);
      const order = await alice.post('/post').send(Object.assign({}, valid, { startDate: '2026-10-20', endDate: '2026-10-19' }));
      assertError(order, 400, 'bad_request');
    });

    it('keeps leading zeros in zip codes', async () => {
      await alice.post('/post').send(Object.assign({}, valid, { zipCode: '02134' }));
      const res = await request(app).get('/all/02134');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.length, 1);
      assert.strictEqual(res.body[0].zipCode, '02134');
    });

    it('GET /post/:id returns the post, 404 if missing, 400 if malformed', async () => {
      const created = await alice.post('/post').send(valid);
      const res = await request(app).get('/post/' + created.body.id);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.title, 'Garage sale');
      assertError(await request(app).get('/post/9999'), 404, 'not_found');
      assertError(await request(app).get('/post/abc'), 400, 'bad_request');
    });

    it('only the owner can edit (403 for others, 401 logged out)', async () => {
      const { body: post } = await alice.post('/post').send(valid);
      assertError(await bob.put('/post/' + post.id).send({ title: 'Mine now' }), 403, 'forbidden');
      assertError(await request(app).put('/post/' + post.id).send({ title: 'x' }), 401, 'unauthorized');
      assertError(await alice.put('/post/' + post.id).send({ zipCode: 'bad' }), 400, 'bad_request');
      const ok = await alice.put('/post/' + post.id).send({ title: 'Updated', userId: 999 });
      assert.strictEqual(ok.status, 200);
      assert.strictEqual(ok.body.title, 'Updated');
      assert.strictEqual(ok.body.userId, aliceId);
    });

    it('only the owner can delete', async () => {
      const { body: post } = await alice.post('/post').send(valid);
      assertError(await bob.delete('/post/' + post.id), 403, 'forbidden');
      assert.strictEqual((await alice.delete('/post/' + post.id)).status, 204);
      assertError(await request(app).get('/post/' + post.id), 404, 'not_found');
      assertError(await alice.delete('/post/' + post.id), 404, 'not_found');
    });

    it('lists posts by user and validates ids', async () => {
      await alice.post('/post').send(valid);
      const res = await request(app).get('/allbyuserId/' + aliceId);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.length, 1);
      assertError(await request(app).get('/allbyuserId/x'), 400, 'bad_request');
      assertError(await request(app).get('/all/abc'), 400, 'bad_request');
    });

    it('associations work (Post belongs to User)', async () => {
      await alice.post('/post').send(valid);
      const post = await models.Post.findOne({ include: [models.User] });
      assert.strictEqual(post.User.email, 'alice@example.com');
      assertNoPassword(post.toJSON());
    });
  });

  describe('no password leakage', () => {
    it('profile hides the password and 404s for unknown users', async () => {
      const res = await request(app).get('/profile/' + aliceId);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.email, 'alice@example.com');
      assertNoPassword(res.body);
      assertError(await request(app).get('/profile/9999'), 404, 'not_found');
      assertError(await request(app).get('/profile/0'), 400, 'bad_request');
    });

    it('stores a bcrypt hash, never the plain password', async () => {
      const u = await models.User.scope('withPassword').findOne({ where: { email: 'alice@example.com' } });
      assert.ok(u.get('password').startsWith('$2'));
      assert.notStrictEqual(u.get('password'), PW);
    });
  });
});
