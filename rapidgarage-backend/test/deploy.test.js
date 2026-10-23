const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const request = require('supertest');
const { createApp } = require('../app');
const models = require('../models');
const runtime = require('../lib/runtime');
const security = require('../lib/security');
const { sslOption } = require('../lib/dbSsl');
const { createHealthRouter, pendingMigrations, migrationFiles } = require('../lib/health');
const { NONCE_PLACEHOLDER } = require('../lib/frontend');
const { assertTestDb } = require('../lib/testDbGuard');

const ROOT = path.join(__dirname, '..', '..');
const baseEnv = (extra) => Object.assign({}, process.env, { NODE_ENV: 'test', SESSION_SECRET: 'test-secret' }, extra || {});
const nonceOf = (csp) => (/'nonce-([^']+)'/.exec(csp) || [])[1];

function fakeBuild() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-build-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><head><meta property="csp-nonce" nonce="${NONCE_PLACEHOLDER}"><script type="module" src="/assets/app-abc123.js" nonce="${NONCE_PLACEHOLDER}"></script><link rel="stylesheet" href="/assets/app-abc123.css" nonce="${NONCE_PLACEHOLDER}"></head><body><div id="root"></div></body></html>`);
  fs.writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dir, 'assets', 'app-abc123.css'), 'body{}');
  fs.writeFileSync(path.join(dir, 'sw.js'), 'self.addEventListener("fetch",()=>{})');
  fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), '{"name":"RapidGarage"}');
  fs.writeFileSync(path.join(dir, 'favicon.ico'), 'x');
  return dir;
}

describe('Production readiness', function () {
  this.timeout(30000);
  before(() => models.sequelize.sync({ force: true }));

  describe('runtime settings', () => {
    it('TRUST_PROXY: hop counts, off, lists; 1 in production by default, off otherwise', () => {
      assert.strictEqual(runtime.trustProxy({ NODE_ENV: 'production' }), 1);
      assert.strictEqual(runtime.trustProxy({ NODE_ENV: 'development' }), false);
      assert.strictEqual(runtime.trustProxy({ TRUST_PROXY: '2' }), 2);
      assert.strictEqual(runtime.trustProxy({ NODE_ENV: 'production', TRUST_PROXY: 'false' }), false);
      assert.strictEqual(runtime.trustProxy({ TRUST_PROXY: 'true' }), true);
      assert.deepStrictEqual(runtime.trustProxy({ TRUST_PROXY: 'loopback, 10.0.0.0/8' }), ['loopback', '10.0.0.0/8']);
    });
    it('COOKIE_SECURE: true for https production, auto for other production, off in dev; explicit wins', () => {
      assert.strictEqual(runtime.cookieSecure({ NODE_ENV: 'production', APP_BASE_URL: 'https://sales.example.com' }), true);
      assert.strictEqual(runtime.cookieSecure({ NODE_ENV: 'production', APP_BASE_URL: 'http://localhost:8080' }), 'auto');
      assert.strictEqual(runtime.cookieSecure({ NODE_ENV: 'development', APP_BASE_URL: 'https://x.example' }), false);
      assert.strictEqual(runtime.cookieSecure({ NODE_ENV: 'production', APP_BASE_URL: 'https://x.example', COOKIE_SECURE: 'auto' }), 'auto');
      assert.strictEqual(runtime.cookieSecure({ COOKIE_SECURE: 'true' }), true);
      assert.strictEqual(runtime.hsts({ NODE_ENV: 'production', APP_BASE_URL: 'https://x.example' }), true);
      assert.strictEqual(runtime.hsts({ NODE_ENV: 'production', APP_BASE_URL: 'http://x.example' }), false);
      assert.strictEqual(runtime.hsts({ NODE_ENV: 'production', APP_BASE_URL: 'https://x.example', HSTS: 'off' }), false);
    });
    it('refuses a weak SESSION_SECRET in production and warns about missing settings', () => {
      const weak = runtime.checkConfig({ NODE_ENV: 'production', SESSION_SECRET: 'CHANGE_ME_long_random_string_xxxxxxxxxx' });
      assert.strictEqual(weak.errors.length, 1);
      assert.match(weak.warnings.join(' '), /APP_BASE_URL is not set/);
      const ok = runtime.checkConfig({ NODE_ENV: 'production', SESSION_SECRET: 'a'.repeat(40), APP_BASE_URL: 'https://x.example', KEY_ENCRYPTION_SECRET: 'k', SMTP_HOST: 'smtp' });
      assert.deepStrictEqual(ok, { errors: [], warnings: [] });
      assert.deepStrictEqual(runtime.checkConfig({ NODE_ENV: 'development' }), { errors: [], warnings: [] });
    });
    it('DATABASE_SSL: off / verify (+CA) / no-verify; nonsense is an error', () => {
      assert.strictEqual(sslOption({}), null);
      assert.strictEqual(sslOption({ DATABASE_SSL: 'off' }), null);
      assert.deepStrictEqual(sslOption({ DATABASE_SSL: 'no-verify' }), { rejectUnauthorized: false });
      assert.deepStrictEqual(sslOption({ DATABASE_SSL: 'verify', DATABASE_SSL_CA: 'A\\nB' }), { rejectUnauthorized: true, ca: 'A\nB' });
      assert.throws(() => sslOption({ DATABASE_SSL: 'maybe' }), /DATABASE_SSL/);
    });
    it('config.js: production is quiet and passes TLS options to Sequelize', () => {
      const file = require.resolve('../config/config.js');
      const saved = { s: process.env.DATABASE_SSL, l: process.env.DB_LOG_SQL };
      try {
        process.env.DATABASE_SSL = 'no-verify'; delete process.env.DB_LOG_SQL;
        delete require.cache[file];
        const cfg = require(file);
        assert.strictEqual(cfg.production.logging, false);
        assert.deepStrictEqual(cfg.production.dialectOptions, { ssl: { rejectUnauthorized: false } });
        assert.strictEqual(cfg.development.logging, undefined, 'development keeps SQL logging');
        // Tests use SQLite unless TEST_DATABASE_URL points them at a Postgres test DB.
        assert.strictEqual(cfg.test.dialect, process.env.TEST_DATABASE_URL ? 'postgres' : 'sqlite');
      } finally {
        if (saved.s === undefined) delete process.env.DATABASE_SSL; else process.env.DATABASE_SSL = saved.s;
        if (saved.l !== undefined) process.env.DB_LOG_SQL = saved.l;
        delete require.cache[file]; require(file);
      }
    });
  });

  describe('health checks', () => {
    const app = createApp(baseEnv());
    it('/healthz is liveness only; /readyz checks the database; both under /api too', async () => {
      const h = await request(app).get('/healthz');
      assert.strictEqual(h.status, 200);
      assert.strictEqual(h.body.status, 'ok');
      assert.strictEqual(h.headers['cache-control'], 'no-store');
      const r = await request(app).get('/readyz');
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.body, { status: 'ready', checks: { database: 'ok' } });
      assert.strictEqual((await request(app).get('/api/healthz')).status, 200);
    });
    it('reports pending migrations as not ready, then ready once all are recorded', async () => {
      const qi = models.sequelize.getQueryInterface();
      await qi.createTable('SequelizeMeta', { name: { type: models.Sequelize.STRING, primaryKey: true } });
      const files = migrationFiles();
      await qi.bulkInsert('SequelizeMeta', files.slice(0, -2).map((name) => ({ name })));
      const env = baseEnv({ READYZ_CHECK_MIGRATIONS: 'true' });
      const express = require('express');
      const a = express(); a.use(createHealthRouter({ sequelize: models.sequelize, app: a, env }));
      const r = await request(a).get('/readyz');
      assert.strictEqual(r.status, 503);
      assert.deepStrictEqual(r.body, { status: 'not_ready', checks: { database: 'ok', migrations: '2 pending' } });
      assert.deepStrictEqual(await pendingMigrations(models.sequelize), files.slice(-2));
      await qi.bulkInsert('SequelizeMeta', files.slice(-2).map((name) => ({ name })));
      const b = express(); b.use(createHealthRouter({ sequelize: models.sequelize, app: b, env }));
      const ok = await request(b).get('/readyz');
      assert.strictEqual(ok.status, 200);
      assert.strictEqual(ok.body.checks.migrations, 'ok');
      assertTestDb(models.sequelize, process.env, 'dropping SequelizeMeta');
      await qi.dropTable('SequelizeMeta');
    });
    it('a failing database gives 503 without leaking the error; draining gives 503', async () => {
      const express = require('express');
      const a = express();
      const errors = [];
      const orig = console.error; console.error = (...m) => errors.push(m.join(' '));
      try {
        a.use(createHealthRouter({ sequelize: { query: () => Promise.reject(new Error('password authentication failed for user "secret"')) }, app: a, env: baseEnv() }));
        const r = await request(a).get('/readyz');
        assert.strictEqual(r.status, 503);
        assert.deepStrictEqual(r.body, { status: 'not_ready', checks: { database: 'unavailable' } });
        assert.ok(!JSON.stringify(r.body).includes('password'));
      } finally { console.error = orig; }
      assert.strictEqual(errors.length, 1, 'details go to the log');
      a.locals.draining = true;
      const d = await request(a).get('/readyz');
      assert.strictEqual(d.status, 503);
      assert.strictEqual(d.body.status, 'draining');
    });
    it('/healthz/proxy only exists with DEBUG_PROXY and reflects TRUST_PROXY', async () => {
      assert.strictEqual((await request(app).get('/healthz/proxy')).status, 404);
      const dbg = createApp(baseEnv({ DEBUG_PROXY: 'true', TRUST_PROXY: '1' }));
      const r = await request(dbg).get('/healthz/proxy').set('X-Forwarded-For', '198.51.100.9').set('X-Forwarded-Proto', 'https');
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.ip, '198.51.100.9');
      assert.strictEqual(r.body.secure, true);
      const off = createApp(baseEnv({ DEBUG_PROXY: 'true', TRUST_PROXY: 'false' }));
      const r2 = await request(off).get('/healthz/proxy').set('X-Forwarded-For', '198.51.100.9').set('X-Forwarded-Proto', 'https');
      assert.notStrictEqual(r2.body.ip, '198.51.100.9', 'spoofed header ignored without a trusted proxy');
      assert.strictEqual(r2.body.secure, false);
    });
  });

  describe('security headers', () => {
    const app = createApp(baseEnv());
    it('API responses: no-script CSP, nosniff, referrer kept for Maps keys, no X-Powered-By, no HSTS over http', async () => {
      const r = await request(app).get('/healthz');
      assert.strictEqual(r.headers['content-security-policy'], security.BASE_POLICY);
      assert.match(r.headers['content-security-policy'], /default-src 'none'/);
      assert.strictEqual(r.headers['x-content-type-options'], 'nosniff');
      assert.strictEqual(r.headers['referrer-policy'], 'strict-origin-when-cross-origin');
      assert.match(r.headers['permissions-policy'], /geolocation=\(self\)/);
      assert.match(r.headers['permissions-policy'], /camera=\(\)/);
      assert.strictEqual(r.headers['x-powered-by'], undefined);
      assert.strictEqual(r.headers['strict-transport-security'], undefined);
      assert.strictEqual(r.headers['cross-origin-opener-policy'], 'same-origin');
    });
    it('page policy: strict nonce + strict-dynamic, Google Maps hosts for images/connect/fonts, no framing', () => {
      const p = security.pagePolicy('abc', {});
      assert.match(p, /script-src 'nonce-abc' 'strict-dynamic'/);
      assert.ok(!/script-src[^;]*'unsafe-inline'/.test(p), 'no inline scripts');
      for (const host of ['https://\\*.googleapis.com', 'https://\\*.gstatic.com', '\\*.google.com']) {
        assert.match(p, new RegExp('img-src[^;]*' + host));
        assert.match(p, new RegExp('connect-src[^;]*' + host));
      }
      assert.match(p, /font-src[^;]*https:\/\/fonts.gstatic.com/);
      assert.match(p, /frame-ancestors 'none'/);
      assert.match(p, /object-src 'none'/);
      assert.ok(!/upgrade-insecure-requests/.test(p));
      assert.match(security.pagePolicy('n', { NODE_ENV: 'production', APP_BASE_URL: 'https://x.example' }), /upgrade-insecure-requests/);
    });
    it('CSP_REPORT_ONLY switches the header name; existing route headers still win', async () => {
      const ro = createApp(baseEnv({ CSP_REPORT_ONLY: 'true' }));
      const r = await request(ro).get('/healthz');
      assert.ok(r.headers['content-security-policy-report-only']);
      assert.strictEqual(r.headers['content-security-policy'], undefined);
      const s = await request(app).get('/s/zzzzzzzz');
      assert.strictEqual(s.status, 404);
      assert.strictEqual(s.headers['referrer-policy'], 'no-referrer', 'short links keep their stricter policy');
    });
  });

  describe('single process: frontend + API on one port', () => {
    let dir, app;
    before(async () => {
      await models.sequelize.sync({ force: true });
      dir = fakeBuild();
      app = createApp(baseEnv({ SERVE_FRONTEND_DIR: dir, APP_BASE_URL: 'https://sales.example.com', FRONTEND_ORIGIN: '' }));
    });
    after(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('serves index.html with a fresh nonce matching its CSP, never cached', async () => {
      const a = await request(app).get('/');
      const b = await request(app).get('/index.html');
      for (const r of [a, b]) {
        assert.strictEqual(r.status, 200);
        assert.match(r.headers['content-type'], /text\/html/);
        assert.strictEqual(r.headers['cache-control'], 'no-cache');
        const n = nonceOf(r.headers['content-security-policy']);
        assert.ok(n && n.length >= 16);
        assert.strictEqual(r.text.split(`nonce="${n}"`).length - 1, 3, 'meta, script and link all carry it');
        assert.ok(!r.text.includes(NONCE_PLACEHOLDER));
      }
      assert.notStrictEqual(nonceOf(a.headers['content-security-policy']), nonceOf(b.headers['content-security-policy']));
    });
    it('client routes fall back to the app; missing files and non-GET do not', async () => {
      for (const p of ['/post/5', '/post/5/print', '/saved', '/signup', '/admin']) {
        const r = await request(app).get(p).set('Accept', 'text/html');
        assert.strictEqual(r.status, 200, p);
        assert.match(r.text, /<div id="root">/);
      }
      assert.strictEqual((await request(app).head('/saved')).status, 200);
      const missing = await request(app).get('/assets/app-old999.js');
      assert.strictEqual(missing.status, 404);
      assert.ok(!/id="root"/.test(missing.text), 'a stale chunk is never answered with HTML');
      assert.strictEqual((await request(app).post('/post/5').send({})).status, 404);
      assert.strictEqual((await request(app).get('/saved').set('Accept', 'application/json')).status, 404);
    });
    it('static headers: sw.js no-cache + worker CSP, manifest type, hashed assets immutable', async () => {
      const sw = await request(app).get('/sw.js');
      assert.strictEqual(sw.status, 200);
      assert.match(sw.headers['content-type'], /^text\/javascript/);
      assert.strictEqual(sw.headers['cache-control'], 'no-cache');
      assert.strictEqual(sw.headers['service-worker-allowed'], '/');
      assert.strictEqual(sw.headers['content-security-policy'], security.WORKER_POLICY);
      assert.match(sw.headers['content-security-policy'], /connect-src 'self'/);
      const m = await request(app).get('/manifest.webmanifest');
      assert.match(m.headers['content-type'], /^application\/manifest\+json/);
      assert.strictEqual(m.headers['cache-control'], 'no-cache');
      const js = await request(app).get('/assets/app-abc123.js');
      assert.strictEqual(js.headers['cache-control'], 'public, max-age=31536000, immutable');
      assert.strictEqual((await request(app).get('/favicon.ico')).headers['cache-control'], 'public, max-age=3600');
    });
    it('the API lives under /api (sessions, JSON 404s) and QR links at /s', async () => {
      const agent = request.agent(app);
      const s = await agent.post('/api/signup').send({ email: 'one@port.example', password: 'correct-horse', firstName: 'Una', lastName: 'Port' });
      assert.strictEqual(s.status, 201, JSON.stringify(s.body));
      const me = await agent.get('/api/me');
      assert.strictEqual(me.status, 200);
      const p = await agent.post('/api/post').send({ title: 'One port sale', street: '1 Main St', city: 'Albany', state: 'NY', zipCode: '12207',
        schedule: { timeZone: 'America/New_York', days: [{ date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), start: '08:00', end: '12:00' }] } });
      assert.strictEqual(p.status, 201, JSON.stringify(p.body));
      const code = (await models.Post.findByPk(p.body.id)).shortCode;
      const go = await request(app).get('/s/' + code).set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
      assert.strictEqual(go.status, 302);
      const nf = await request(app).get('/api/nope');
      assert.strictEqual(nf.status, 404);
      assert.deepStrictEqual(nf.body, { error: { code: 'not_found', message: 'Not found.' } });
      const gone = await request(app).get('/s/zzzzzzzz');
      assert.strictEqual(gone.status, 404);
      assert.match(gone.text, /isn.t available/);
      assert.strictEqual(gone.headers['content-security-policy'], security.BASE_POLICY);
      assert.strictEqual((await request(app).get('/api/uploads/posts/1/nope.webp')).status, 404);
    });
    it('defaults FRONTEND_ORIGIN to APP_BASE_URL in single-origin mode', () => {
      const env = baseEnv({ SERVE_FRONTEND_DIR: dir, APP_BASE_URL: 'https://sales.example.com/', FRONTEND_ORIGIN: '' });
      createApp(env);
      assert.strictEqual(env.FRONTEND_ORIGIN, 'https://sales.example.com');
    });
    it('refuses a build without index.html or without the nonce placeholder', () => {
      const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-empty-'));
      assert.throws(() => createApp(baseEnv({ SERVE_FRONTEND_DIR: empty })), /no index.html/);
      fs.writeFileSync(path.join(empty, 'index.html'), '<script src="/a.js"></script>');
      assert.throws(() => createApp(baseEnv({ SERVE_FRONTEND_DIR: empty })), /nonce placeholder/);
      fs.rmSync(empty, { recursive: true, force: true });
    });
  });

  describe('session cookies behind a TLS proxy', () => {
    const quiet = (fn) => async () => { const w = console.warn; console.warn = () => {}; try { await fn(); } finally { console.warn = w; } };
    const prodEnv = (extra) => baseEnv(Object.assign({ NODE_ENV: 'production', SESSION_STORE: 'memory', APP_BASE_URL: 'https://sales.example.com', TRUST_PROXY: '1' }, extra));
    let n = 0;
    const signup = (app, proto) => {
      n += 1;
      let r = request(app).post('/signup').send({ email: `c${n}@cookie.example`, password: 'correct-horse', firstName: 'Cee', lastName: 'Kie' });
      if (proto) r = r.set('X-Forwarded-Proto', proto);
      return r;
    };
    before(() => models.sequelize.sync({ force: true }));
    it('https production: Secure, HttpOnly, SameSite=Lax cookie only on HTTPS (via the trusted proxy), plus HSTS', quiet(async () => {
      const app = createApp(prodEnv());
      const s = await signup(app, 'https');
      assert.strictEqual(s.status, 201);
      const c = (s.headers['set-cookie'] || []).join(';');
      assert.match(c, /connect\.sid=/);
      assert.match(c, /Secure/);
      assert.match(c, /HttpOnly/);
      assert.match(c, /SameSite=Lax/);
      assert.match(s.headers['strict-transport-security'], /max-age=15552000/);
      const plain = await signup(app, null);
      assert.strictEqual(plain.headers['set-cookie'], undefined, 'never sent over plain http');
    }));
    it('COOKIE_SECURE=auto follows X-Forwarded-Proto; an untrusted proxy header is ignored', quiet(async () => {
      const auto = createApp(prodEnv({ COOKIE_SECURE: 'auto', APP_BASE_URL: 'http://localhost:8080' }));
      assert.match((await signup(auto, 'https')).headers['set-cookie'].join(';'), /Secure/);
      assert.ok(!/Secure/.test((await signup(auto, null)).headers['set-cookie'].join(';')));
      const untrusted = createApp(prodEnv({ COOKIE_SECURE: 'auto', APP_BASE_URL: 'http://localhost:8080', TRUST_PROXY: 'false' }));
      assert.ok(!/Secure/.test((await signup(untrusted, 'https')).headers['set-cookie'].join(';')), 'X-Forwarded-Proto from a client is not trusted');
    }));
  });

  describe('deployment files', () => {
    it('.env.production.example documents every environment variable the backend reads', () => {
      const example = fs.readFileSync(path.join(ROOT, '.env.production.example'), 'utf8');
      const documented = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
      const used = new Set();
      const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((f) => {
        const p = path.join(d, f.name);
        if (f.isDirectory()) return walk(p);
        if (!p.endsWith('.js')) return;
        const src = fs.readFileSync(p, 'utf8');
        for (const m of src.matchAll(/(?:process\.env|\benv|\be|\))\.([A-Z][A-Z0-9_]{2,})\b/g)) used.add(m[1]);
        for (const m of src.matchAll(/\b(?:num|int|envInt|envNum|flag|readInt|intEnv|numEnv)\(\s*['"]([A-Z][A-Z0-9_]+)['"]/g)) used.add(m[1]);
      });
      const backend = path.join(__dirname, '..');
      ['app.js'].forEach((f) => { const src = fs.readFileSync(path.join(backend, f), 'utf8'); for (const m of src.matchAll(/(?:process\.env|\be)\.([A-Z][A-Z0-9_]{2,})\b/g)) used.add(m[1]); });
      ['lib', 'controllers', 'middlewares', 'models', 'config', 'scripts'].forEach((d) => walk(path.join(backend, d)));
      // Quoted names read through helpers (e.g. limits read with a default).
      const quoted = execFileSync('grep', ['-rhoE', "['\"](ALERTS?_[A-Z_]+|[A-Z]+_MAX_PER_[A-Z]+|REPORT_[A-Z_]+|SESSION_[A-Z_]+|ENABLE_[A-Z_]+|GEOCODE_[A-Z_]+)['\"]", 'lib', 'controllers'], { cwd: backend }).toString();
      quoted.split('\n').filter(Boolean).forEach((q) => used.add(q.replace(/['"]/g, '')));
      // One-off cleanup script option; test-only database settings (README > Testing),
      // which must never be set in production.
      const notConfig = new Set(['ORPHAN_POST_OWNER_ID', 'TEST_DATABASE_URL', 'TEST_SQLITE_FILE', 'RG_ALLOW_TEST_PG']);
      const missing = [...used].filter((v) => !documented.has(v) && !notConfig.has(v)).sort();
      assert.deepStrictEqual(missing, [], 'undocumented: ' + missing.join(', '));
      for (const req of ['APP_BASE_URL', 'SESSION_SECRET', 'DATABASE_URL', 'SMTP_HOST', 'GOOGLE_MAPS_API_KEY', 'GOOGLE_GEOCODING_API_KEY', 'KEY_ENCRYPTION_SECRET', 'TRUST_PROXY', 'POSTGRES_PASSWORD']) assert.ok(documented.has(req), req);
    });
    it('shell scripts parse', () => {
      for (const f of ['rapidgarage-backend/scripts/backup-db.sh', 'docker/entrypoint.sh']) execFileSync('sh', ['-n', path.join(ROOT, f)]);
    });
    describe('backup-db.sh (with stand-in pg_dump/pg_restore)', () => {
      let tmp, bin, dest;
      beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-backup-'));
        bin = path.join(tmp, 'bin'); dest = path.join(tmp, 'out');
        fs.mkdirSync(bin);
        fs.writeFileSync(path.join(bin, 'pg_dump'), '#!/bin/sh\nfor a; do case "$a" in --file=*) f="${a#--file=}";; --dbname=*) d="${a#--dbname=}";; esac; done\n[ -n "$FAIL_DUMP" ] && exit 3\nprintf "PGDMP-fake %s" "$d" > "$f"\n', { mode: 0o755 });
        fs.writeFileSync(path.join(bin, 'pg_restore'), '#!/bin/sh\nhead -c 5 "$2" | grep -q PGDMP\n', { mode: 0o755 });
        fs.mkdirSync(path.join(tmp, 'uploads', 'posts', '1'), { recursive: true });
        fs.writeFileSync(path.join(tmp, 'uploads', 'posts', '1', 'a.webp'), 'img');
      });
      afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));
      const run = (extra) => spawnSync('sh', [path.join(ROOT, 'rapidgarage-backend/scripts/backup-db.sh')], {
        env: Object.assign({ PATH: bin + ':' + process.env.PATH, BACKUP_DIR: dest, DATABASE_URL: 'postgres://u:s3cret@db/x', BACKUP_UPLOADS_DIR: path.join(tmp, 'uploads') }, extra || {}),
      });
      it('writes a private, verified dump plus an uploads tarball, and never prints the URL', () => {
        const r = run();
        assert.strictEqual(r.status, 0, r.stderr.toString());
        const files = fs.readdirSync(dest).sort();
        assert.strictEqual(files.length, 2);
        assert.match(files[0], /^rapidgarage-\d{8}-\d{6}Z\.dump$/);
        assert.match(files[1], /^uploads-\d{8}-\d{6}Z\.tar\.gz$/);
        for (const f of files) assert.strictEqual(fs.statSync(path.join(dest, f)).mode & 0o777, 0o600, f);
        assert.ok(!r.stdout.toString().includes('s3cret'));
        assert.match(execFileSync('tar', ['-tzf', path.join(dest, files[1])]).toString(), /posts\/1\/a\.webp/);
      });
      it('fails loudly and leaves no partial file when pg_dump fails', () => {
        const r = run({ FAIL_DUMP: '1' });
        assert.notStrictEqual(r.status, 0);
        assert.deepStrictEqual(fs.existsSync(dest) ? fs.readdirSync(dest) : [], []);
      });
      it('prunes backups older than BACKUP_KEEP_DAYS', () => {
        fs.mkdirSync(dest);
        const old = path.join(dest, 'rapidgarage-20200101-000000Z.dump');
        const keep = path.join(dest, 'notes.txt');
        fs.writeFileSync(old, 'x'); fs.writeFileSync(keep, 'x');
        const t = new Date(Date.now() - 30 * 86400000); fs.utimesSync(old, t, t);
        assert.strictEqual(run({ BACKUP_KEEP_DAYS: '14' }).status, 0);
        assert.ok(!fs.existsSync(old));
        assert.ok(fs.existsSync(keep), 'only backup files are pruned');
      });
    });
    it('release.js refuses to run without DATABASE_URL', () => {
      const env = Object.assign({}, process.env); delete env.DATABASE_URL;
      const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'release.js')], { env, cwd: os.tmpdir() });
      assert.strictEqual(r.status, 2);
      assert.match(r.stderr.toString(), /DATABASE_URL is not set/);
    });
  });
});
