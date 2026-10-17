#!/usr/bin/env node
'use strict';
// Release step: run before (re)starting the app on a new version.
//   1. wait for the database (up to RELEASE_DB_WAIT_SECONDS, default 60)
//   2. existing database: the read-only data precheck (scripts/db-precheck.js);
//      a fresh, empty database skips it
//   3. sequelize-cli db:migrate
// Exits non-zero on any failure so the host aborts the deploy and keeps the
// previous version running. Used by the Docker entrypoint (RUN_MIGRATIONS) and
// by release/pre-deploy commands (Fly release_command, Render preDeployCommand).
// Never prints DATABASE_URL.
require('dotenv').config();
const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');
const { sslOption } = require('../lib/dbSsl');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const waitS = parseInt(process.env.RELEASE_DB_WAIT_SECONDS, 10);
  const deadline = Date.now() + (Number.isFinite(waitS) ? waitS : 60) * 1000;
  const ssl = sslOption();
  for (let attempt = 1; ; attempt++) {
    const c = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, ...(ssl ? { ssl } : {}) });
    try {
      await c.connect();
      return c;
    } catch (err) {
      try { await c.end(); } catch (_) { /* ignore */ }
      if (Date.now() >= deadline) throw new Error('database not reachable: ' + err.message);
      if (attempt === 1) console.log('release: waiting for the database...');
      await sleep(2000);
    }
  }
}

function run(args) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env: process.env });
  return r.status === null ? 1 : r.status;
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error('release: DATABASE_URL is not set'); return 2; }
  const c = await connect();
  let fresh;
  try {
    const r = await c.query("SELECT to_regclass('public.\"Users\"') AS t");
    fresh = r.rows[0].t === null;
  } finally {
    await c.end();
  }
  if (fresh) {
    console.log('release: empty database, skipping the data precheck');
  } else {
    console.log('release: data precheck');
    const code = run([path.join(ROOT, 'scripts', 'db-precheck.js'), 'precheck']);
    if (code !== 0) { console.error('release: precheck failed; not migrating (see above, then npm run db:cleanup)'); return code; }
  }
  console.log('release: migrating');
  const code = run([require.resolve('sequelize-cli/lib/sequelize'), 'db:migrate']);
  if (code !== 0) { console.error('release: migration failed'); return code; }
  console.log('release: done');
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code), (err) => { console.error('release: ' + err.message); process.exit(1); });
}
