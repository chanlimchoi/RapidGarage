const assert = require('assert');
const request = require('supertest');
const express = require('express');
const app = require('../app');
const models = require('../models');
const counters = require('../lib/counters');
const errorTracking = require('../lib/errorTracking');
const { serverError } = require('../lib/http');
const uptime = require('../scripts/uptime-check');

describe('error tracking and uptime alerts', function () {
  this.timeout(20000);
  let captured;
  const reporter = { capture: (err, ctx) => captured.push({ err, ctx }) };

  beforeEach(async () => {
    captured = [];
    await counters.reset();
    await models.sequelize.sync({ force: true });
  });
  afterEach(() => errorTracking.setReporter(null));

  describe('server errors', () => {
    it('serverError and the final error handler report the error with the route, never the body', async () => {
      errorTracking.setReporter(reporter);
      const mini = express();
      mini.use(express.json());
      mini.post('/boom/:id', (req, res) => serverError(res, new Error('db exploded')));
      mini.get('/thrown', () => { throw new Error('thrown'); });
      mini.use((err, req, res, next) => { errorTracking.capture(err, { req }); res.status(500).end(); });
      const r = await request(mini).post('/boom/7?x=1').send({ password: 'hunter2' });
      assert.strictEqual(r.status, 500);
      assert.strictEqual(r.body.error.message, 'Something went wrong.');
      assert.strictEqual(captured.length, 1);
      assert.strictEqual(captured[0].err.message, 'db exploded');
      assert.strictEqual(captured[0].ctx.req.method, 'POST');
      await request(mini).get('/thrown');
      assert.strictEqual(captured[1].err.message, 'thrown');
    });

    it('is off without SENTRY_DSN: /config says so and client reports are dropped', async () => {
      assert.strictEqual(errorTracking.init({}), false);
      assert.strictEqual((await request(app).get('/config')).body.errorReporting, false);
      const r = await request(app).post('/client-errors').send({ kind: 'error', message: 'x' });
      assert.strictEqual(r.status, 204);
    });

    it('scrubs emails, API keys, tokens and database credentials; drops request details', () => {
      const s = errorTracking.scrub('user bea@example.com key sk-ant-api03-abc_DEF-123 auth Bearer abc.def.ghi db postgres://rg:pw@db:5432/rg AKIAABCDEFGHIJKLMNOP');
      for (const secret of ['bea@example.com', 'sk-ant-api03', 'abc.def.ghi', 'rg:pw', 'AKIAABCDEFGHIJKLMNOP']) assert.ok(!s.includes(secret), secret + ' in ' + s);
      const ev = errorTracking.beforeSend({
        request: { method: 'POST', url: 'https://x.example/login?email=bea@example.com', headers: { cookie: 'sid=1' }, data: '{"password":"p"}', cookies: { sid: '1' } },
        user: { id: 3, email: 'bea@example.com', ip_address: '1.2.3.4' },
        server_name: 'host-1',
        exception: { values: [{ value: 'failed for bea@example.com', stacktrace: { frames: [{ function: 'f', vars: { password: 'p' } }] } }] },
        breadcrumbs: [{ category: 'http', message: 'GET /x' }, { category: 'app', message: 'mail to bea@example.com', data: { a: 1 } }],
      });
      assert.deepStrictEqual(ev.request, { method: 'POST', url: 'https://x.example/login' });
      assert.deepStrictEqual(ev.user, { id: '3' });
      assert.strictEqual(ev.server_name, undefined);
      assert.strictEqual(ev.exception.values[0].value, 'failed for [email]');
      assert.strictEqual(ev.exception.values[0].stacktrace.frames[0].vars, undefined);
      assert.deepStrictEqual(ev.breadcrumbs.map((b) => [b.category, b.message, b.data]), [['app', 'mail to [email]', undefined]]);
    });
  });

  describe('client errors', () => {
    it('forwards valid reports (path without query), ignores junk and rate-limits per IP', async () => {
      errorTracking.setReporter(reporter);
      assert.strictEqual((await request(app).get('/config')).body.errorReporting, true);
      const send = (body) => request(app).post('/client-errors').set('X-Forwarded-For', '203.0.113.9').send(body);
      assert.strictEqual((await send({ kind: 'render', message: 'Cannot read x', stack: 'at Post (post.js:1)', path: '/post/5?t=secret#x', release: 'abc' })).status, 204);
      await new Promise((r) => setImmediate(r));
      assert.strictEqual(captured.length, 1);
      const c = captured[0];
      assert.strictEqual(c.err.name, 'ClientError');
      assert.strictEqual(c.err.message, 'Cannot read x');
      assert.strictEqual(c.err.stack, 'at Post (post.js:1)');
      assert.deepStrictEqual([c.ctx.source, c.ctx.tags.kind, c.ctx.tags.page], ['client', 'render', '/post/5']);
      await send({ kind: 'bogus', message: 'x' });
      await send({ kind: 'error' });
      await send({ kind: 'error', message: 'y', path: 'https://evil.example/' });
      await new Promise((r) => setImmediate(r));
      assert.strictEqual(captured.length, 2);
      assert.strictEqual(captured[1].ctx.tags.page, undefined, 'only in-app paths');
      process.env.CLIENT_ERRORS_PER_HOUR = '3';
      for (let i = 0; i < 5; i++) await send({ kind: 'error', message: 'spam ' + i });
      await new Promise((r) => setImmediate(r));
      delete process.env.CLIENT_ERRORS_PER_HOUR;
      // 2 valid reports were already counted (the junk ones return before counting).
      assert.strictEqual(captured.length, 3);
    });
  });

  describe('uptime alerts', () => {
    const resp = (status) => ({ status, ok: status >= 200 && status < 300 });

    it('settings: defaults to APP_BASE_URL/readyz, only https webhooks', () => {
      const s = uptime.settings({ APP_BASE_URL: 'https://garage.example/', UPTIME_WEBHOOK_URL: 'http://hooks.example/x' });
      assert.deepStrictEqual(s.urls, ['https://garage.example/readyz']);
      assert.deepStrictEqual([s.webhook, s.webhookRejected, s.failures, s.intervalMs, s.remindMs], [null, true, 3, 60000, 3600000]);
      const t = uptime.settings({ UPTIME_URLS: 'https://a.example/readyz, https://b.example/healthz', UPTIME_WEBHOOK_URL: 'https://hooks.example/x', UPTIME_FAILURES: '2' });
      assert.deepStrictEqual([t.urls.length, t.webhook, t.failures], [2, 'https://hooks.example/x', 2]);
    });

    it('alerts after N failures in a row, reminds while down, and says when it recovers', async () => {
      const notes = [];
      let status = 200;
      const m = uptime.createMonitor({ urls: ['https://g.example/readyz'], timeoutMs: 1000, failures: 3, remindMs: 3600000,
        fetch: async () => { if (status === 0) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); return resp(status); },
        notify: async (kind, url, text) => notes.push([kind, text]) });
      let t = 0;
      const tick = (ms) => m.tick(t += (ms || 60000));
      await tick();
      status = 503; await tick(); await tick();
      assert.strictEqual(notes.length, 0, 'two failures: not yet');
      status = 200; await tick();
      assert.strictEqual(notes.length, 0, 'a blip never alerts');
      status = 0; await tick(); await tick(); await tick();
      assert.deepStrictEqual(notes.map((n) => n[0]), ['down']);
      assert.ok(/DOWN.*3 checks.*ECONNREFUSED/.test(notes[0][1]), notes[0][1]);
      await tick(); // a minute later: no repeat
      assert.strictEqual(notes.length, 1);
      await tick(3600000);
      assert.deepStrictEqual(notes.map((n) => n[0]), ['down', 'still_down']);
      status = 200; await tick();
      assert.deepStrictEqual(notes.map((n) => n[0]), ['down', 'still_down', 'up']);
      assert.ok(/back up.*down about 6\d min/.test(notes[2][1]), notes[2][1]);
    });

    it('notifies by webhook and email, and survives a failing channel', async () => {
      const posts = [];
      const mails = [];
      const notify = uptime.notifier({ webhook: 'https://hooks.example/x', email: 'ops@example.com' }, {
        fetch: async (url, opts) => { posts.push([url, JSON.parse(opts.body)]); return resp(500); },
        mailer: { send: async (m) => { mails.push(m); } },
      });
      const errs = [];
      const orig = console.error;
      const log = console.log;
      console.error = (...a) => errs.push(a.join(' '));
      console.log = () => {};
      try { await notify('down', 'https://g.example/readyz', 'RapidGarage is DOWN: https://g.example/readyz failed 3 checks in a row (HTTP 503).'); } finally { console.error = orig; console.log = log; }
      assert.deepStrictEqual(posts[0][1], { text: 'RapidGarage is DOWN: https://g.example/readyz failed 3 checks in a row (HTTP 503).', content: 'RapidGarage is DOWN: https://g.example/readyz failed 3 checks in a row (HTTP 503).' });
      assert.strictEqual(mails[0].to, 'ops@example.com');
      assert.strictEqual(mails[0].subject, 'RapidGarage is DOWN');
      assert.ok(errs.some((e) => /could not send the down alert: HTTP 500/.test(e)));
      assert.ok(!errs.join(' ').includes('hooks.example'), 'never logs the webhook URL');
    });
  });
});
