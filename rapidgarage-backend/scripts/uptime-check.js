#!/usr/bin/env node
// Uptime alerts: checks the site's readiness URL every minute and tells you
// when it goes down (after a few failures in a row), every hour while it stays
// down, and when it recovers. Run it somewhere other than the server it
// watches if you can (a second machine, or a hosted monitor pointed at
// /readyz; see DEPLOY.md), since a dead host can't report its own death.
//
//   node scripts/uptime-check.js          keep checking (Docker: profile "uptime")
//   node scripts/uptime-check.js --once   one check, exit code 0 (up) or 1 (down)
//
// Settings (environment):
//   UPTIME_URLS               comma-separated; default APP_BASE_URL + /readyz
//   UPTIME_INTERVAL_SECONDS   60
//   UPTIME_TIMEOUT_MS         10000
//   UPTIME_FAILURES           3 failed checks in a row before an alert
//   UPTIME_REMIND_MINUTES     60 (0: no reminders)
//   UPTIME_WEBHOOK_URL        https URL; gets { text, content } JSON (Slack, Discord, ...)
//   UPTIME_ALERT_EMAIL        also email this address (needs the SMTP_* settings)
require('dotenv').config();

function intEnv(env, name, dflt, min) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min ? n : dflt;
}

function settings(env) {
  const e = env || process.env;
  let urls = String(e.UPTIME_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!urls.length && String(e.APP_BASE_URL || '').trim()) urls = [String(e.APP_BASE_URL).trim().replace(/\/+$/, '') + '/readyz'];
  const webhook = String(e.UPTIME_WEBHOOK_URL || '').trim();
  return {
    urls,
    intervalMs: intEnv(e, 'UPTIME_INTERVAL_SECONDS', 60, 10) * 1000,
    timeoutMs: intEnv(e, 'UPTIME_TIMEOUT_MS', 10000, 1000),
    failures: intEnv(e, 'UPTIME_FAILURES', 3, 1),
    remindMs: intEnv(e, 'UPTIME_REMIND_MINUTES', 60, 0) * 60000,
    webhook: /^https:\/\//i.test(webhook) ? webhook : null,
    webhookRejected: !!webhook && !/^https:\/\//i.test(webhook),
    email: String(e.UPTIME_ALERT_EMAIL || '').trim() || null,
  };
}

// One check: { ok, status?, ms, error? }. Never throws.
async function check(url, timeoutMs, fetchImpl) {
  const f = fetchImpl || fetch;
  const start = Date.now();
  try {
    const res = await f(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'RapidGarage-uptime' } });
    return { ok: res.status >= 200 && res.status < 300, status: res.status, ms: Date.now() - start };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, error: err && err.name === 'TimeoutError' ? 'timeout' : String((err && (err.cause && err.cause.code)) || (err && err.name) || 'error') };
  }
}

const describe = (r) => (r.status ? 'HTTP ' + r.status : r.error || 'no answer');
const minutes = (ms) => Math.max(1, Math.round(ms / 60000));

// The state machine: per URL, consecutive failures, when it went down, when we
// last alerted. notify(kind, url, text) is called for 'down', 'still_down' and 'up'.
function createMonitor(opts) {
  const state = new Map(opts.urls.map((u) => [u, { fails: 0, downSince: null, alertedAt: null }]));
  async function tick(now) {
    const t = now || Date.now();
    const results = await Promise.all(opts.urls.map((u) => check(u, opts.timeoutMs, opts.fetch)));
    for (let i = 0; i < opts.urls.length; i++) {
      const url = opts.urls[i];
      const r = results[i];
      const s = state.get(url);
      if (r.ok) {
        if (s.alertedAt) await opts.notify('up', url, 'RapidGarage is back up: ' + url + ' (down about ' + minutes(t - s.downSince) + ' min).');
        s.fails = 0; s.downSince = null; s.alertedAt = null;
        continue;
      }
      s.fails++;
      if (!s.downSince) s.downSince = t;
      if (!s.alertedAt && s.fails >= opts.failures) {
        s.alertedAt = t;
        await opts.notify('down', url, 'RapidGarage is DOWN: ' + url + ' failed ' + s.fails + ' checks in a row (' + describe(r) + ').');
      } else if (s.alertedAt && opts.remindMs && t - s.alertedAt >= opts.remindMs) {
        s.alertedAt = t;
        await opts.notify('still_down', url, 'RapidGarage is still down: ' + url + ' for about ' + minutes(t - s.downSince) + ' min (' + describe(r) + ').');
      }
    }
    return results;
  }
  return { tick, state };
}

// Sends to the webhook and/or email; logs either way. Failures to notify are logged, never thrown.
function notifier(cfg, deps) {
  const d = deps || {};
  return async (kind, url, text) => {
    console.log('[uptime] ' + text);
    const jobs = [];
    if (cfg.webhook) {
      jobs.push((d.fetch || fetch)(cfg.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(10000) })
        .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); }));
    }
    if (cfg.email) {
      const mailer = d.mailer || require('../lib/mailer');
      jobs.push(mailer.send({ to: cfg.email, subject: text.split(':')[0], text: text + '\n\nChecked at ' + new Date().toISOString() + '.' }));
    }
    const out = await Promise.allSettled(jobs);
    out.forEach((o) => { if (o.status === 'rejected') console.error('[uptime] could not send the ' + kind + ' alert: ' + ((o.reason && (o.reason.code || o.reason.message)) || 'error')); });
  };
}

async function main() {
  const cfg = settings(process.env);
  if (!cfg.urls.length) { console.error('[uptime] Set UPTIME_URLS or APP_BASE_URL.'); process.exit(2); }
  if (process.argv.includes('--once')) {
    const results = await Promise.all(cfg.urls.map((u) => check(u, cfg.timeoutMs)));
    results.forEach((r, i) => console.log((r.ok ? 'up   ' : 'DOWN ') + cfg.urls[i] + ' ' + describe(r) + ' ' + r.ms + 'ms'));
    // exitCode, not exit(): exiting while sockets close trips a libuv assertion on Windows.
    process.exitCode = results.every((r) => r.ok) ? 0 : 1;
    return;
  }
  if (cfg.webhookRejected) console.warn('[uptime] UPTIME_WEBHOOK_URL must be https; ignoring it.');
  if (!cfg.webhook && !cfg.email) console.warn('[uptime] No UPTIME_WEBHOOK_URL or UPTIME_ALERT_EMAIL: alerts are only logged.');
  const monitor = createMonitor(Object.assign({}, cfg, { notify: notifier(cfg) }));
  console.log('[uptime] watching ' + cfg.urls.length + ' URL(s) every ' + cfg.intervalMs / 1000 + 's; alert after ' + cfg.failures + ' failures');
  const loop = () => monitor.tick().catch((err) => console.error('[uptime] check failed:', err && err.message));
  loop();
  const timer = setInterval(loop, cfg.intervalMs);
  const stop = () => { clearInterval(timer); process.exit(0); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

if (require.main === module) main();

module.exports = { settings, check, createMonitor, notifier };
