const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Sequelize, DataTypes } = require('sequelize');
const models = require('../models');
const scans = require('../lib/scans');
const { guardDestructive, checkTestDb, describeDb, UnsafeDatabaseError } = require('../lib/testDbGuard');

// ScanDedupe cleanup must work on real databases, where the guard refuses
// delete-everything destroys. A SQLite file OUTSIDE the temp directory is
// treated by the guard exactly like a live database, so the real model and
// the real guard can be exercised without Postgres.
describe('scan dedupe cleanup (guard-safe)', () => {
  const file = path.join(__dirname, '..', '.scan-cleanup-' + process.pid + '.sqlite');
  let db; let Dedupe;
  before(async () => {
    assert.ok(!file.startsWith(os.tmpdir() + path.sep), 'the file must be outside tmp for this test to mean anything');
    db = new Sequelize({ dialect: 'sqlite', storage: file, logging: false });
    Dedupe = require('../models/scandedupe')(db, DataTypes);
    await db.sync(); // non-destructive: allowed everywhere
    guardDestructive(db, {});
  });
  after(async () => { await db.close(); fs.rmSync(file, { force: true }); });
  const seed = async (days) => { await Dedupe.destroy({ where: { day: { [Sequelize.Op.not]: null } } }); for (const [i, day] of days.entries()) await Dedupe.create({ day, hash: 'h' + i + '-' + day }); };
  const left = async () => (await Dedupe.findAll({ raw: true, order: [['day', 'ASC']] })).map((r) => r.day);

  it('this database is one the guard treats as real', async () => {
    assert.strictEqual(checkTestDb(describeDb(db), {}).ok, false);
    await assert.rejects(Dedupe.destroy({ where: {} }), UnsafeDatabaseError, 'the old empty-where purge would be refused here');
  });

  it('staleWhere is never empty', () => {
    for (const first of [true, false]) {
      const w = scans.staleWhere(first, '2026-10-18');
      assert.ok(Reflect.ownKeys(w).length > 0 && Reflect.ownKeys(w.day).length > 0, JSON.stringify(first));
    }
  });

  it('after a restart, removes every row (today and a "future" day too) on the guarded database', async () => {
    await seed(['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19']);
    await Dedupe.destroy({ where: scans.staleWhere(true, '2026-10-18') });
    assert.deepStrictEqual(await left(), []);
  });

  it('on a day change, removes only rows not from the new day', async () => {
    await seed(['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-18']);
    await Dedupe.destroy({ where: scans.staleWhere(false, '2026-10-18') });
    assert.deepStrictEqual(await left(), ['2026-10-18', '2026-10-18']);
  });

  it('purgeStale logs a failed cleanup (name and message, no connection details) and resolves', async () => {
    const orig = models.ScanDedupe.destroy;
    const logged = [];
    const origErr = console.error;
    models.ScanDedupe.destroy = () => Promise.reject(new UnsafeDatabaseError('deleting rows', { dialect: 'postgres', host: 'db.example.com', port: 5432, database: 'rapid_garage_live' }, 'example'));
    console.error = (...a) => logged.push(a.join(' '));
    try {
      assert.strictEqual(await scans.purgeStale(true, '2026-10-18'), null);
    } finally { models.ScanDedupe.destroy = orig; console.error = origErr; }
    assert.strictEqual(logged.length, 1);
    assert.match(logged[0], /^\[scans\] dedupe cleanup failed \(after restart\): UnsafeDatabaseError: Refusing deleting rows on postgres db\.example\.com:5432\/rapid_garage_live/);
  });

  it('purgeStale really cleans the app database (first salt and day change)', async () => {
    await models.sequelize.sync({ force: true });
    for (const [i, day] of ['2026-10-17', '2026-10-18'].entries()) await models.ScanDedupe.create({ day, hash: 'x' + i });
    await scans.purgeStale(false, '2026-10-18');
    assert.deepStrictEqual((await models.ScanDedupe.findAll({ raw: true })).map((r) => r.day), ['2026-10-18']);
    await scans.purgeStale(true, '2026-10-18');
    assert.strictEqual(await models.ScanDedupe.count(), 0);
  });
});
