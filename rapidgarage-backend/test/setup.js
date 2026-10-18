// Mocha root setup (see .mocharc.js). It runs before any test file is loaded, so
// also before any test can connect to or wipe a database.
//
// Tests must run with NODE_ENV=test: then config/config.js ignores DATABASE_URL
// and uses in-memory SQLite (or TEST_DATABASE_URL, see the README). NODE_ENV
// unset means test; any other value (e.g. development from a live .env) is
// refused. The database the models actually point at is then checked with
// lib/testDbGuard.js.
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'test';
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'test-secret';

const { assertTestDb, describeUrl, label, OPT_IN } = require('../lib/testDbGuard');

function refuse(msg) {
  const err = new Error('\n\n  REFUSING TO RUN TESTS: ' + msg + '\n');
  err.name = 'UnsafeDatabaseError';
  throw err;
}

if (process.env.NODE_ENV !== 'test') {
  const url = process.env.DATABASE_URL;
  refuse('NODE_ENV is "' + process.env.NODE_ENV + '", not "test". With any other NODE_ENV the models use DATABASE_URL'
    + (url ? ' (' + label(describeUrl(url)) + ')' : '') + ', which may be a real database. Run `npm test`, or set NODE_ENV=test (Postgres test DBs: TEST_DATABASE_URL + ' + OPT_IN + '=1).');
}

// A DATABASE_URL (or libpq PG* variables) from the shell or a .env must not
// reach anything a test starts: the Postgres session store, scripts run as
// child processes, `pg` defaults. Empty strings rather than delete: dotenv
// never overwrites a key that exists, so a later dotenv.config() (app.js,
// models) can't bring the real value back. Tests that need a URL pass their own.
for (const k of ['DATABASE_URL', 'PGHOST', 'PGHOSTADDR', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGPASSFILE', 'PGSERVICE', 'PGSERVICEFILE']) process.env[k] = '';

let models;
try { models = require('../models'); } catch (e) { refuse('could not load the models: ' + e.message); }
try { assertTestDb(models.sequelize, process.env, 'to run tests'); } catch (e) { refuse(e.message); }

// Re-check before the first test, in case something swapped the environment.
exports.mochaHooks = {
  beforeAll() { assertTestDb(models.sequelize, process.env, 'to run tests'); },
};
