// Where express-session keeps sessions.
//   postgres (default outside tests): table "session", created by migration
//     20261017020000-create-session-table. Survives restarts and works with
//     several backend processes.
//   memory: express-session's MemoryStore. Used by the test suite; never use
//     it in production (leaks memory, logs everyone out on restart).
// SESSION_STORE=postgres|memory overrides the default.
const session = require('express-session');
const PgStoreFactory = require('connect-pg-simple');

const SESSION_TABLE = 'session';
const DAY_MS = 24 * 60 * 60 * 1000;

function positiveNumber(raw, def, name) {
  if (raw === undefined || String(raw).trim() === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(name + ' must be a positive number');
  return n;
}

// Cookie + store lifetime. SESSION_MAX_AGE_DAYS, default 14 days.
function sessionMaxAgeMs(env) {
  return Math.round(positiveNumber((env || process.env).SESSION_MAX_AGE_DAYS, 14, 'SESSION_MAX_AGE_DAYS') * DAY_MS);
}

// How often expired rows are deleted. SESSION_PRUNE_INTERVAL_MINUTES, default 15.
function pruneIntervalSeconds(env) {
  return Math.round(positiveNumber((env || process.env).SESSION_PRUNE_INTERVAL_MINUTES, 15, 'SESSION_PRUNE_INTERVAL_MINUTES') * 60);
}

function storeKind(env) {
  const e = env || process.env;
  const explicit = String(e.SESSION_STORE || '').trim().toLowerCase();
  if (explicit) {
    if (explicit !== 'postgres' && explicit !== 'memory') throw new Error('SESSION_STORE must be "postgres" or "memory"');
    return explicit;
  }
  return (e.NODE_ENV || 'development') === 'test' ? 'memory' : 'postgres';
}

// Connection string from the same config Sequelize uses (config/config.js).
function connectionString(env) {
  const e = env || process.env;
  const config = require('../config/config.js')[e.NODE_ENV || 'development'] || {};
  if (config.dialect !== 'postgres') throw new Error('SESSION_STORE=postgres needs a postgres database config');
  const url = config.use_env_variable ? e[config.use_env_variable] : null;
  if (!url) throw new Error('Missing ' + (config.use_env_variable || 'DATABASE_URL') + ' for the session store');
  return url;
}

// Returns { kind, store, close() }. `pool` may be injected (tests).
function createSessionStore(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const kind = storeKind(env);
  if (kind === 'memory') {
    if (env.NODE_ENV === 'production') console.warn('WARNING: SESSION_STORE=memory in production; sessions are lost on restart.');
    const store = new session.MemoryStore();
    return { kind, store, check: () => Promise.resolve(), close: () => Promise.resolve() };
  }
  const PgStore = PgStoreFactory(session);
  let pool = opts.pool;
  let ownPool = false;
  if (!pool) {
    // A small dedicated pg pool (same database/credentials as Sequelize) so
    // session reads never wait behind model queries in Sequelize's pool.
    const { Pool } = require('pg');
    const ssl = require('./dbSsl').sslOption(env);
    pool = new Pool({ connectionString: connectionString(env), max: 5, ...(ssl ? { ssl } : {}) });
    ownPool = true;
  }
  const store = new PgStore({
    pool,
    tableName: SESSION_TABLE,
    createTableIfMissing: false, // the migration owns the schema
    pruneSessionInterval: opts.pruneSessionInterval !== undefined ? opts.pruneSessionInterval : pruneIntervalSeconds(env),
    errorLog: (...args) => console.error('[session store]', ...args.map((a) => (a && a.message) || a)),
  });
  return {
    kind,
    store,
    // Fail fast at startup if the migration hasn't run (otherwise every login
    // would fail later with a confusing error).
    check: () => pool.query('SELECT to_regclass($1::text) AS t', ['public.' + SESSION_TABLE]).then((r) => {
      if (!r.rows[0] || !r.rows[0].t) throw new Error('Session table "' + SESSION_TABLE + '" is missing. Run `npm run migrate`.');
    }),
    close: () => Promise.resolve(store.close()).then(() => (ownPool ? pool.end() : undefined)),
  };
}

module.exports = { createSessionStore, sessionMaxAgeMs, pruneIntervalSeconds, storeKind, connectionString, SESSION_TABLE };
