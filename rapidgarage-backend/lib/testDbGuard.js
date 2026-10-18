// Keeps tests, and anything destructive, away from real databases.
//
// The rules: a database is "throwaway" only if it is
//   - SQLite in memory, or a SQLite file inside the OS temp directory, or
//   - Postgres whose database name ends in _test or _e2e, AND the run opted in
//     with RG_ALLOW_TEST_PG=1.
// Everything else (any other Postgres database, another dialect, a SQLite file
// elsewhere) is treated as real and refused.
//
// Used in two places:
//   - test/setup.js (loaded by .mocharc.js for every mocha run, including
//     `npx mocha test/x.test.js`) refuses to run the tests at all;
//   - models/index.js wraps every destructive call (sync({ force/alter }),
//     drop, truncate, destroy({ truncate } or { where: {} }), dropAllTables, dropAllSchemas) so
//     it throws before any SQL runs, whatever the caller, also in production.
// Error messages name the dialect, host, port and database, never the user or password.
const os = require('os');
const path = require('path');
const fs = require('fs');

const TEST_PG_NAME = /_(test|e2e)$/i;
const OPT_IN = 'RG_ALLOW_TEST_PG';

// { dialect, host, port, database, storage } of a Sequelize instance (no I/O).
function describeDb(sequelize) {
  const c = (sequelize && sequelize.config) || {};
  const o = (sequelize && sequelize.options) || {};
  return {
    dialect: (sequelize && sequelize.getDialect && sequelize.getDialect()) || o.dialect || 'unknown',
    host: c.host || o.host || '',
    port: c.port || o.port || '',
    database: c.database || '',
    storage: o.storage === undefined ? '' : String(o.storage),
  };
}

// Same shape from a connection URL, without user or password (no I/O).
function describeUrl(url) {
  try {
    const u = new URL(url);
    return { dialect: u.protocol.replace(/:$/, '').replace(/^postgresql$/, 'postgres'), host: u.hostname, port: u.port, database: decodeURIComponent(u.pathname.replace(/^\//, '')), storage: '' };
  } catch (e) { return { dialect: 'unknown', host: '?', port: '', database: '?', storage: '' }; }
}

// "postgres db.example.com:5432/rapid_garage_live", "sqlite :memory:".
function label(info) {
  if (info.dialect === 'sqlite') return 'sqlite ' + (info.storage && info.storage !== ':memory:' ? info.storage : ':memory:');
  return info.dialect + ' ' + (info.host || 'localhost') + (info.port ? ':' + info.port : '') + '/' + (info.database || '?');
}

function realTmp() { try { return fs.realpathSync(os.tmpdir()); } catch (e) { return os.tmpdir(); } }
function inTmp(file) {
  const abs = path.resolve(file);
  let real = abs;
  try { real = fs.realpathSync(path.dirname(abs)) + path.sep + path.basename(abs); } catch (e) { /* not created yet */ }
  return [os.tmpdir(), realTmp()].some((t) => real === t || real.startsWith(t + path.sep) || abs.startsWith(t + path.sep));
}

// { ok: true } or { ok: false, reason }.
function checkTestDb(info, env) {
  const e = env || process.env;
  if (info.dialect === 'sqlite') {
    const s = info.storage;
    if (!s || s === ':memory:' || /^file::memory:/.test(s)) return { ok: true };
    if (inTmp(s)) return { ok: true };
    return { ok: false, reason: 'the SQLite file is outside the temp directory (' + os.tmpdir() + ')' };
  }
  if (info.dialect === 'postgres') {
    if (!TEST_PG_NAME.test(info.database || '')) return { ok: false, reason: 'the Postgres database name does not end in _test or _e2e' };
    if (e[OPT_IN] !== '1') return { ok: false, reason: 'Postgres for tests needs the explicit opt-in ' + OPT_IN + '=1' };
    return { ok: true };
  }
  return { ok: false, reason: 'only SQLite or an opted-in Postgres test database are allowed (got ' + info.dialect + ')' };
}

const HELP = 'Tests may only use SQLite (in memory or a temp file), or a throwaway Postgres database whose name ends in _test or _e2e with '
  + OPT_IN + '=1. Run the suite with `npm test` (NODE_ENV=test, in-memory SQLite); for Postgres set TEST_DATABASE_URL to a *_test database and '
  + OPT_IN + '=1.';

class UnsafeDatabaseError extends Error {
  constructor(what, info, reason) {
    super('Refusing ' + what + ' on ' + label(info) + ': ' + reason + '. ' + HELP);
    this.name = 'UnsafeDatabaseError';
    this.code = 'unsafe_database';
    this.database = { dialect: info.dialect, host: info.host, port: info.port, database: info.database };
  }
}

function assertTestDb(sequelize, env, what) {
  const info = describeDb(sequelize);
  const r = checkTestDb(info, env);
  if (!r.ok) throw new UnsafeDatabaseError(what || 'to run tests', info, r.reason);
  return info;
}

// Wrap the destructive methods of a Sequelize instance and its models so they
// throw (as a rejected promise) unless the database is a throwaway one.
function guardDestructive(sequelize, env) {
  if (!sequelize || sequelize.__rgGuarded) return sequelize;
  const check = (what) => assertTestDb(sequelize, env || process.env, what);
  const wrap = (obj, name, when, what) => {
    const orig = obj[name];
    if (typeof orig !== 'function') return;
    obj[name] = async function guarded(...args) {
      if (!when || when(args[0] || {})) check(what + ' (' + name + ')');
      return orig.apply(this, args);
    };
  };
  const destructiveSync = (o) => !!(o && (o.force || o.alter));
  wrap(sequelize, 'sync', destructiveSync, 'a destructive sync');
  wrap(sequelize, 'drop', null, 'dropping all tables');
  wrap(sequelize, 'truncate', null, 'truncating all tables');
  const qi = sequelize.getQueryInterface();
  wrap(qi, 'dropAllTables', null, 'dropping all tables');
  wrap(qi, 'dropAllSchemas', null, 'dropping all schemas');
  wrap(qi, 'dropAllEnums', null, 'dropping all enums');
  for (const model of Object.values(sequelize.models)) {
    wrap(model, 'sync', destructiveSync, 'a destructive sync of ' + model.name);
    wrap(model, 'drop', null, 'dropping ' + model.name);
    wrap(model, 'truncate', null, 'truncating ' + model.name);
    // destroy({ truncate }) or destroy({ where: {} }): every row of the table.
    wrap(model, 'destroy', (o) => !!o.truncate || (!!o.where && typeof o.where === 'object' && Reflect.ownKeys(o.where).length === 0), 'deleting every row of ' + model.name);
  }
  Object.defineProperty(sequelize, '__rgGuarded', { value: true });
  return sequelize;
}

module.exports = { describeDb, describeUrl, checkTestDb, assertTestDb, guardDestructive, label, UnsafeDatabaseError, TEST_PG_NAME, OPT_IN };
