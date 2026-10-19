'use strict';
// Single-writer guard for the in-process background passes (the sale-alert
// outbox worker and the hold/meetup sweeps). Every instance runs those timers,
// so with more than one instance the same pass runs several times over.
//
// The passes are already safe to run twice: emails go through an atomic row
// claim (status='pending' -> 'sending' with a claimToken) and the sweeps are
// idempotent expiries, so nothing is sent or expired twice. This guard just
// stops the duplicated work: a Postgres advisory lock elects one instance per
// pass. Each pass takes the lock for its duration, so failover is automatic --
// the next tick of any instance retries.
//
// On a single-instance database (SQLite in development/tests) there is nothing
// to coordinate, so the work runs directly.
//
// lib/alerts.js notes: the lock is taken per pass and released in a finally, so
// a killed instance frees it as soon as its connection drops.

// Arbitrary but stable id; the two-argument form is avoided so the bigint
// overload is chosen explicitly.
const LOCK_KEY = 799111357;

const TRY = 'SELECT pg_try_advisory_lock($1::bigint) AS ok';
const UNLOCK = 'SELECT pg_advisory_unlock($1::bigint)';

function endQuietly(client) {
  if (!client || typeof client.end !== 'function') return undefined;
  return client.end().catch(() => {});
}

// A dedicated pg client (not from the Sequelize pool) so the lock is held on a
// session we control for exactly the length of the pass.
function makePgClient(sequelize) {
  const pg = require('pg');
  const cfg = (sequelize && sequelize.config) || {};
  const opts = {};
  const envVar = cfg.use_env_variable;
  if (envVar && process.env[envVar]) {
    opts.connectionString = process.env[envVar];
  } else if (cfg.connectionString) {
    opts.connectionString = cfg.connectionString;
  } else {
    opts.host = cfg.host;
    opts.port = cfg.port;
    opts.user = cfg.username;
    opts.password = cfg.password;
    opts.database = cfg.database;
  }
  const ssl = cfg.dialectOptions && cfg.dialectOptions.ssl;
  if (ssl) opts.ssl = ssl;
  return new pg.Client(opts);
}

// Run `fn` only if this instance can take the worker lock. Returns fn()'s
// result, or undefined when another instance is already running the pass.
//
// opts (tests): { sequelize, makeClient }
async function withLock(fn, opts) {
  opts = opts || {};
  const sequelize = opts.sequelize || require('../models').sequelize;
  const dialect = opts.dialect || (sequelize && sequelize.getDialect());
  if (dialect !== 'postgres') return fn();

  const makeClient = opts.makeClient || makePgClient;
  let client = null;
  let held = false;
  try {
    client = makeClient(sequelize);
    await client.connect();
    const res = await client.query(TRY, [LOCK_KEY]);
    held = !!(res.rows && res.rows[0] && res.rows[0].ok);
  } catch (err) {
    // Fail open: a broken lock must not stop alerts going out, and the row
    // claims above already make a duplicate pass harmless.
    console.error('worker lock unavailable, running without it: ' + (err && (err.code || err.message)));
    held = true;
    client = null;
  }

  if (!held) {
    await endQuietly(client);
    return undefined;
  }
  try {
    return await fn();
  } finally {
    if (client) await client.query(UNLOCK, [LOCK_KEY]).catch(() => {});
    await endQuietly(client);
  }
}

module.exports = { withLock, LOCK_KEY };
