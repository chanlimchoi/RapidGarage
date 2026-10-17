// Liveness (/healthz) and readiness (/readyz) for load balancers and hosts.
//   /healthz  the process is up and serving; never touches the database, so a
//             slow database does not get the container killed.
//   /readyz   send traffic here? The database answers within 3s and no
//             migration is pending; 503 while shutting down.
// Both return small JSON without error details (those go to the log).
const fs = require('fs');
const path = require('path');
const express = require('express');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const TIMEOUT_MS = 3000;
const CACHE_MS = 2000;

function withTimeout(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout after ' + ms + 'ms')), ms); })])
    .finally(() => clearTimeout(t));
}

function migrationFiles(dir) {
  return fs.readdirSync(dir || MIGRATIONS_DIR).filter((f) => f.endsWith('.js')).sort();
}

// Names of migration files not yet recorded in SequelizeMeta.
async function pendingMigrations(sequelize, dir) {
  const files = migrationFiles(dir);
  let done = [];
  try {
    const [rows] = await sequelize.query('SELECT name FROM "SequelizeMeta"');
    done = rows.map((r) => r.name);
  } catch (err) {
    return files; // no SequelizeMeta table: nothing migrated yet
  }
  const set = new Set(done);
  return files.filter((f) => !set.has(f));
}

function checkMigrations(env) {
  const v = String((env || process.env).READYZ_CHECK_MIGRATIONS || '').trim().toLowerCase();
  if (v) return !/^(0|false|off|no)$/.test(v);
  return (env || process.env).NODE_ENV !== 'test'; // tests build the schema with sync()
}

function createHealthRouter({ sequelize, app, migrationsDir, env }) {
  const router = express.Router();
  let cached = null;

  async function readiness() {
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.result;
    const checks = {};
    let ok = true;
    try {
      await withTimeout(sequelize.query('SELECT 1'), TIMEOUT_MS);
      checks.database = 'ok';
    } catch (err) {
      console.error('readyz: database check failed:', err.message);
      checks.database = 'unavailable';
      ok = false;
    }
    if (ok && checkMigrations(env)) {
      try {
        const pending = await withTimeout(pendingMigrations(sequelize, migrationsDir), TIMEOUT_MS);
        checks.migrations = pending.length ? pending.length + ' pending' : 'ok';
        if (pending.length) ok = false;
      } catch (err) {
        console.error('readyz: migration check failed:', err.message);
        checks.migrations = 'unknown';
        ok = false;
      }
    }
    const result = { ok, checks };
    cached = { at: Date.now(), result };
    return result;
  }

  router.get('/healthz', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  });

  router.get('/readyz', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (app && app.locals.draining) return res.status(503).json({ status: 'draining', checks: {} });
    const r = await readiness();
    res.status(r.ok ? 200 : 503).json({ status: r.ok ? 'ready' : 'not_ready', checks: r.checks });
  });

  // DEBUG_PROXY=true: GET /healthz/proxy shows the caller how the app sees
  // them (their own IP and whether the request counts as HTTPS), to check
  // TRUST_PROXY after deploying behind a new host. Off by default.
  if (/^(1|true|on|yes)$/i.test(String((env || process.env).DEBUG_PROXY || ''))) {
    router.get('/healthz/proxy', (req, res) => {
      res.set('Cache-Control', 'no-store');
      const xff = req.get('x-forwarded-for');
      res.json({
        ip: req.ip,
        protocol: req.protocol,
        secure: req.secure,
        forwardedForHops: xff ? xff.split(',').length : 0,
        trustProxy: String(req.app.get('trust proxy')),
      });
    });
  }

  router.resetCache = () => { cached = null; };
  return router;
}

module.exports = { createHealthRouter, pendingMigrations, migrationFiles };
