// Fixed-window counters behind every rate limit (lib/rateLimit.js, password
// reset, AI drafts and key attempts).
//
//   RATE_LIMIT_STORE=memory  (default) per process: right for one instance
//   RATE_LIMIT_STORE=db      table RateCounters, shared by every instance and
//                            kept across restarts. One atomic upsert per hit
//                            (INSERT ... ON CONFLICT DO UPDATE ... RETURNING,
//                            Postgres and SQLite 3.35+).
//
// In the database, keys are SHA-256 hashes, so the table never holds an
// email address or IP. Expired rows are swept every 10 minutes.
const crypto = require('crypto');
const { Op, QueryTypes } = require('sequelize');

function models() { return require('../models'); }

const kind = () => (String(process.env.RATE_LIMIT_STORE || '').trim().toLowerCase() === 'db' ? 'db' : 'memory');

// ---- memory -------------------------------------------------------------
const MAX_KEYS = 50000;
const mem = new Map();
function memSweep(now) {
  for (const [k, v] of mem) if (v.resetAt <= now) mem.delete(k);
  while (mem.size >= MAX_KEYS) mem.delete(mem.keys().next().value);
}

// ---- database -----------------------------------------------------------
const hash = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');
let sweeper = null;
function startSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => {
    models().RateCounter.destroy({ where: { resetAt: { [Op.lt]: new Date(Date.now() - 3600000) } } })
      .catch((err) => console.error('Rate counter sweep failed:', err && err.message));
  }, 10 * 60000);
  if (sweeper.unref) sweeper.unref();
}

const toMs = (v) => (v instanceof Date ? v.getTime() : new Date(String(v).replace(' +00:00', 'Z').replace(' ', 'T')).getTime());

async function dbHit(key, windowMs, now) {
  startSweeper();
  const m = models();
  const table = m.RateCounter.getTableName();
  // SQLite stores dates as UTC text ("YYYY-MM-DD HH:MM:SS.SSS +00:00", as the
  // models write them) and compares them as text; Postgres takes real dates.
  const sqlite = m.sequelize.getDialect() === 'sqlite';
  const at = (ms) => (sqlite ? new Date(ms).toISOString().replace('T', ' ').replace('Z', ' +00:00') : new Date(ms));
  const nowDate = at(now);
  const reset = at(now + windowMs);
  const rows = await m.sequelize.query(
    // The WITH prefix is a no-op; it stops Sequelize's SQLite driver from treating
    // this as a plain INSERT (which would drop the RETURNING row).
    'WITH rg_noop AS (SELECT 1) INSERT INTO "' + table + '" ("key", "count", "resetAt", "createdAt", "updatedAt") VALUES (:key, 1, :reset, :now, :now) '
    + 'ON CONFLICT ("key") DO UPDATE SET '
    + '"count" = CASE WHEN "' + table + '"."resetAt" <= :now THEN 1 ELSE "' + table + '"."count" + 1 END, '
    + '"resetAt" = CASE WHEN "' + table + '"."resetAt" <= :now THEN :reset ELSE "' + table + '"."resetAt" END, '
    + '"updatedAt" = :now RETURNING "count", "resetAt"',
    { replacements: { key: hash(key), reset, now: nowDate }, type: QueryTypes.SELECT },
  );
  const row = rows[0];
  return { count: Number(row.count), resetAt: toMs(row.resetAt) };
}

// ---- API ------------------------------------------------------------------
// Count one hit on `key` in a window of `windowMs`. Resolves to { count, resetAt }.
async function hit(key, windowMs, now) {
  const t = now || Date.now();
  if (kind() === 'db') return dbHit(key, windowMs, t);
  let e = mem.get(key);
  if (!e || e.resetAt <= t) {
    if (!e && mem.size >= MAX_KEYS) memSweep(t);
    e = { count: 0, resetAt: t + windowMs };
    mem.set(key, e);
  }
  e.count++;
  return { count: e.count, resetAt: e.resetAt };
}

// The current window for `key`, or null when there is none (or it ended).
async function peek(key, now) {
  const t = now || Date.now();
  if (kind() === 'db') {
    const row = await models().RateCounter.findByPk(hash(key));
    return row && row.resetAt.getTime() > t ? { count: row.count, resetAt: row.resetAt.getTime() } : null;
  }
  const e = mem.get(key);
  return e && e.resetAt > t ? { count: e.count, resetAt: e.resetAt } : null;
}

async function remove(key) {
  if (kind() === 'db') { await models().RateCounter.destroy({ where: { key: hash(key) } }); return; }
  mem.delete(key);
}

// Undo one hit (a failed AI call shouldn't use up a draft).
async function decrement(key) {
  if (kind() === 'db') {
    await models().RateCounter.decrement('count', { where: { key: hash(key), count: { [Op.gt]: 0 } } });
    return;
  }
  const e = mem.get(key);
  if (e && e.count > 0) e.count--;
}

// Tests: forget everything (memory now; the DB table when RATE_LIMIT_STORE=db).
function reset() {
  mem.clear();
  if (kind() === 'db') return models().RateCounter.destroy({ where: { resetAt: { [Op.ne]: null } } }).catch(() => null);
  return Promise.resolve();
}

module.exports = { kind, hit, peek, remove, decrement, reset, hash };
