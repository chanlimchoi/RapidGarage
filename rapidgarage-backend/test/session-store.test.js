const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const { createSessionStore, sessionMaxAgeMs, pruneIntervalSeconds, storeKind } = require('../lib/sessionStore');

// Records queries instead of talking to Postgres.
function fakePool() {
  const queries = [];
  return {
    queries,
    on() {},
    query(text, params) {
      queries.push({ text, params });
      if (/^SELECT to_regclass/.test(text)) return Promise.resolve({ rows: [{ t: 'session' }] });
      if (/^SELECT sess/.test(text)) return Promise.resolve({ rows: [{ sess: { cookie: {}, passport: { user: 7 } } }] });
      return Promise.resolve({ rows: [], rowCount: 0 });
    },
    end() { this.ended = true; return Promise.resolve(); },
  };
}

describe('session store', function () {
  this.timeout(10000);

  describe('configuration', () => {
    it('uses memory in tests and Postgres everywhere else by default', () => {
      assert.strictEqual(storeKind({ NODE_ENV: 'test' }), 'memory');
      assert.strictEqual(storeKind({ NODE_ENV: 'development' }), 'postgres');
      assert.strictEqual(storeKind({ NODE_ENV: 'production' }), 'postgres');
      assert.strictEqual(storeKind({}), 'postgres');
      assert.strictEqual(storeKind({ NODE_ENV: 'production', SESSION_STORE: 'memory' }), 'memory');
      assert.throws(() => storeKind({ SESSION_STORE: 'redis' }), /SESSION_STORE/);
      assert.strictEqual(app.locals.sessionStore.kind, 'memory');
    });

    it('maxAge and prune interval come from env with sane defaults', () => {
      assert.strictEqual(sessionMaxAgeMs({}), 14 * 24 * 3600 * 1000);
      assert.strictEqual(sessionMaxAgeMs({ SESSION_MAX_AGE_DAYS: '0.5' }), 12 * 3600 * 1000);
      assert.throws(() => sessionMaxAgeMs({ SESSION_MAX_AGE_DAYS: '-1' }), /SESSION_MAX_AGE_DAYS/);
      assert.throws(() => sessionMaxAgeMs({ SESSION_MAX_AGE_DAYS: 'forever' }), /SESSION_MAX_AGE_DAYS/);
      assert.strictEqual(pruneIntervalSeconds({}), 900);
      assert.strictEqual(pruneIntervalSeconds({ SESSION_PRUNE_INTERVAL_MINUTES: '60' }), 3600);
    });

    it('postgres mode requires a postgres DATABASE_URL', () => {
      assert.throws(() => createSessionStore({ env: { NODE_ENV: 'development' } }), /DATABASE_URL/);
      assert.throws(() => createSessionStore({ env: { NODE_ENV: 'test', SESSION_STORE: 'postgres' } }), /postgres/);
    });
  });

  describe('Postgres store wiring (fake pool)', () => {
    let pool, s;
    beforeEach(() => {
      pool = fakePool();
      s = createSessionStore({ env: { NODE_ENV: 'development', DATABASE_URL: 'postgres://u:p@127.0.0.1:1/db' }, pool, pruneSessionInterval: false });
    });
    afterEach(() => s.close());

    it('is a connect-pg-simple store on the "session" table', async () => {
      assert.strictEqual(s.kind, 'postgres');
      assert.strictEqual(s.store.constructor.name, 'PGStore');
      await s.check();
      assert.deepStrictEqual(pool.queries[0].params, ['public.session']);
    });

    it('get/set/destroy hit the session table', async () => {
      const get = await new Promise((res, rej) => s.store.get('abc', (e, v) => (e ? rej(e) : res(v))));
      assert.deepStrictEqual(get.passport, { user: 7 });
      await new Promise((res, rej) => s.store.set('abc', { cookie: { expires: new Date(Date.now() + 60000) } }, (e) => (e ? rej(e) : res())));
      await new Promise((res, rej) => s.store.destroy('abc', (e) => (e ? rej(e) : res())));
      const texts = pool.queries.map((q) => q.text);
      assert.ok(/SELECT sess FROM "session" WHERE sid = \$1/.test(texts[0]), texts[0]);
      assert.ok(/INSERT INTO "session"/.test(texts[1]), texts[1]);
      assert.ok(/DELETE FROM "session" WHERE sid = \$1/.test(texts[2]), texts[2]);
      assert.strictEqual(pool.queries[2].params[0], 'abc');
      assert.ok(!texts.some((t) => /CREATE TABLE/i.test(t)), 'must not create the table at runtime');
    });

    it('prunes expired sessions', async () => {
      await new Promise((res) => s.store.pruneSessions(res));
      assert.ok(/DELETE FROM "session" WHERE expire < to_timestamp\(\$1\)/.test(pool.queries[0].text));
    });

    it('check() fails clearly when the migration has not run', async () => {
      pool.query = () => Promise.resolve({ rows: [{ t: null }] });
      await assert.rejects(s.check(), /npm run migrate/);
    });
  });

  describe('app wiring (memory store)', () => {
    beforeEach(() => models.sequelize.sync({ force: true }));
    const count = () => new Promise((res, rej) => app.locals.sessionStore.store.length((e, n) => (e ? rej(e) : res(n))));

    it('sets a persistent httpOnly SameSite=Lax cookie with the configured maxAge', async () => {
      const res = await request(app).post('/signup').send({ email: 'c@example.com', password: 'correct-horse', firstName: 'C' });
      const cookie = res.headers['set-cookie'].find((c) => c.startsWith('connect.sid='));
      assert.ok(/HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie), cookie);
      assert.ok(!/;\s*Secure/i.test(cookie), 'Secure only in production');
      const expires = new Date(/Expires=([^;]+)/.exec(cookie)[1]).getTime();
      assert.ok(Math.abs(expires - (Date.now() + sessionMaxAgeMs())) < 5000, cookie);
    });

    it('logout destroys the stored session and the old cookie stops working', async () => {
      const agent = request.agent(app);
      const before = await count();
      const res = await agent.post('/signup').send({ email: 'd@example.com', password: 'correct-horse', firstName: 'D' });
      const sid = res.headers['set-cookie'].find((c) => c.startsWith('connect.sid=')).split(';')[0];
      assert.strictEqual(await count(), before + 1);
      assert.strictEqual((await agent.get('/me')).status, 200);
      const out = await agent.post('/logout');
      assert.strictEqual(out.status, 200);
      assert.ok(out.headers['set-cookie'].some((c) => /^connect\.sid=;/.test(c)), 'cookie cleared');
      assert.strictEqual(await count(), before);
      const replay = await request(app).get('/me').set('Cookie', sid);
      assert.notStrictEqual(replay.status, 200);
    });
  });
});
