const assert = require('assert');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { Sequelize, DataTypes } = require('sequelize');
const models = require('../models');
const { checkTestDb, assertTestDb, describeDb, describeUrl, guardDestructive, UnsafeDatabaseError } = require('../lib/testDbGuard');

// Nothing listens on port 1, so even a broken guard could not reach a database.
const LIVE = 'postgres://rg_live:hunter2-secret@127.0.0.1:1/rapid_garage_live';
const pg = (url) => new Sequelize(url, { dialect: 'postgres', logging: false, pool: { max: 1, acquire: 2000 } });
const sqlite = (storage) => new Sequelize({ dialect: 'sqlite', storage, logging: false });

describe('test database guard', () => {
  describe('checkTestDb / assertTestDb', () => {
    it('allows in-memory SQLite and a SQLite file in the temp directory', () => {
      assert.ok(checkTestDb(describeDb(sqlite(':memory:')), {}).ok);
      assert.ok(checkTestDb({ dialect: 'sqlite', storage: '' }, {}).ok);
      assert.ok(checkTestDb(describeDb(sqlite(path.join(os.tmpdir(), 'rg-x.sqlite'))), {}).ok);
    });
    it('refuses a SQLite file outside the temp directory', () => {
      const r = checkTestDb(describeDb(sqlite('/workspace/data/app.sqlite')), {});
      assert.strictEqual(r.ok, false);
      assert.match(r.reason, /outside the temp directory/);
    });
    it('refuses a live-like Postgres database, even with the opt-in, and names host and database but not the password', () => {
      const db = pg(LIVE);
      for (const env of [{}, { RG_ALLOW_TEST_PG: '1' }, { NODE_ENV: 'development' }]) {
        assert.throws(() => assertTestDb(db, env), (e) => {
          assert.ok(e instanceof UnsafeDatabaseError);
          assert.match(e.message, /postgres 127\.0\.0\.1:1\/rapid_garage_live/);
          assert.match(e.message, /does not end in _test or _e2e/);
          assert.ok(!/hunter2|rg_live:/.test(e.message), 'no credentials in the message');
          return true;
        });
      }
    });
    it('allows a Postgres *_test / *_e2e database only with RG_ALLOW_TEST_PG=1', () => {
      for (const name of ['rapidgarage_test', 'rg_e2e', 'RG_TEST']) {
        const db = pg('postgres://u:pw@127.0.0.1:1/' + name);
        assert.throws(() => assertTestDb(db, {}), /needs the explicit opt-in RG_ALLOW_TEST_PG=1/);
        assert.throws(() => assertTestDb(db, { RG_ALLOW_TEST_PG: 'true' }), /RG_ALLOW_TEST_PG=1/);
        assert.strictEqual(assertTestDb(db, { RG_ALLOW_TEST_PG: '1' }).database, name);
      }
      for (const name of ['rapid_garage_live', 'test', 'my_test_db', 'prod_e2e_backup', 'rapidgarage']) {
        assert.throws(() => assertTestDb(pg('postgres://u:pw@127.0.0.1:1/' + name), { RG_ALLOW_TEST_PG: '1' }), /_test or _e2e/, name);
      }
    });
    it('refuses other dialects', () => {
      assert.strictEqual(checkTestDb({ dialect: 'mysql', database: 'x_test' }, { RG_ALLOW_TEST_PG: '1' }).ok, false);
    });
    it('describes a URL without credentials', () => {
      assert.deepStrictEqual(describeUrl(LIVE), { dialect: 'postgres', host: '127.0.0.1', port: '1', database: 'rapid_garage_live', storage: '' });
    });
  });

  describe('destructive calls are guarded', () => {
    let live;
    before(() => {
      live = pg(LIVE);
      live.define('Thing', { name: DataTypes.STRING });
      guardDestructive(live, {});
    });
    after(() => live.close());
    const refused = (p) => assert.rejects(p, (e) => { assert.ok(e instanceof UnsafeDatabaseError, e.message); assert.ok(!/hunter2/.test(e.message)); return true; });
    it('sync({ force }) / sync({ alter }), drop, truncate on the instance', async () => {
      await refused(live.sync({ force: true }));
      await refused(live.sync({ alter: true }));
      await refused(live.sync({ force: true, hooks: false }));
      await refused(live.drop());
      await refused(live.truncate({ cascade: true }));
      await refused(live.getQueryInterface().dropAllTables());
    });
    it('model sync({ force }), drop, truncate and delete-everything destroy', async () => {
      const T = live.models.Thing;
      await refused(T.sync({ force: true }));
      await refused(T.drop());
      await refused(T.truncate());
      await refused(T.destroy({ truncate: true }));
      await refused(T.destroy({ where: {} }));
    });
    it('leaves normal queries alone (they just fail to connect here)', async () => {
      await assert.rejects(live.models.Thing.destroy({ where: { id: 1 } }), (e) => !(e instanceof UnsafeDatabaseError));
    });
    it('the app models are guarded and, on the in-memory test DB, allowed', async () => {
      assert.strictEqual(models.sequelize.__rgGuarded, true);
      // In-memory SQLite by default; a *_test Postgres when TEST_DATABASE_URL is set (CI).
      assert.strictEqual(describeDb(models.sequelize).dialect, process.env.TEST_DATABASE_URL ? 'postgres' : 'sqlite');
      await models.sequelize.sync({ force: true });
      await models.Subscriber.destroy({ where: {} });
    });
  });

  describe('every mocha run (.mocharc.js -> test/setup.js)', function () {
    this.timeout(30000);
    const backend = path.join(__dirname, '..');
    const mocha = path.join(backend, 'node_modules', 'mocha', 'bin', 'mocha.js');
    // A clean environment: only what each case sets (plus PATH/HOME), so the
    // parent's variables can't leak in.
    const run = (env) => {
      const r = spawnSync(process.execPath, [mocha, 'test/fixtures/guard-probe.js'], { cwd: backend, env: Object.assign({ PATH: process.env.PATH, HOME: os.tmpdir() }, env), encoding: 'utf8' });
      return { status: r.status, out: r.stdout + r.stderr };
    };
    it('refuses NODE_ENV=development with a live DATABASE_URL (a direct `npx mocha` run)', () => {
      const r = run({ NODE_ENV: 'development', DATABASE_URL: LIVE });
      assert.notStrictEqual(r.status, 0);
      assert.match(r.out, /REFUSING TO RUN TESTS: NODE_ENV is "development"/);
      assert.match(r.out, /postgres 127\.0\.0\.1:1\/rapid_garage_live/);
      assert.ok(!/hunter2/.test(r.out), 'no password in the output');
      assert.ok(!/PROBE_DB=/.test(r.out), 'no test ran');
    });
    it('refuses NODE_ENV=production too', () => {
      assert.notStrictEqual(run({ NODE_ENV: 'production', DATABASE_URL: LIVE }).status, 0);
    });
    it('with NODE_ENV unset or test, ignores DATABASE_URL and uses in-memory SQLite', () => {
      for (const env of [{ DATABASE_URL: LIVE }, { NODE_ENV: 'test', DATABASE_URL: LIVE, PGDATABASE: 'rapid_garage_live' }]) {
        const r = run(env);
        assert.strictEqual(r.status, 0, r.out);
        assert.match(r.out, /PROBE_DB=sqlite :memory:/);
      }
    });
    it('refuses a live-like TEST_DATABASE_URL even with the opt-in', () => {
      const r = run({ NODE_ENV: 'test', TEST_DATABASE_URL: LIVE, RG_ALLOW_TEST_PG: '1' });
      assert.notStrictEqual(r.status, 0);
      assert.match(r.out, /Refusing to run tests on postgres 127\.0\.0\.1:1\/rapid_garage_live/);
      assert.ok(!/hunter2/.test(r.out));
    });
    it('refuses a *_test Postgres without RG_ALLOW_TEST_PG=1, and allows it with', () => {
      const url = 'postgres://u:pw@127.0.0.1:1/rapidgarage_test';
      const no = run({ NODE_ENV: 'test', TEST_DATABASE_URL: url });
      assert.notStrictEqual(no.status, 0);
      assert.match(no.out, /needs the explicit opt-in RG_ALLOW_TEST_PG=1/);
      const yes = run({ NODE_ENV: 'test', TEST_DATABASE_URL: url, RG_ALLOW_TEST_PG: '1' });
      assert.strictEqual(yes.status, 0, yes.out);
      assert.match(yes.out, /PROBE_DB=postgres 127\.0\.0\.1:1\/rapidgarage_test/);
    });
    it('refuses a SQLite file outside the temp directory', () => {
      const r = run({ NODE_ENV: 'test', TEST_SQLITE_FILE: path.join(backend, 'not-a-test.sqlite') });
      assert.notStrictEqual(r.status, 0);
      assert.match(r.out, /outside the temp directory/);
    });
  });
});
