const assert = require('assert');
const models = require('../models');
const { withLock } = require('../lib/workerLock');

// A stand-in for lib/workerLock's pg client, so the acquire/skip/unlock paths
// can be exercised without a real Postgres server.
function fakeClient(ok) {
  const calls = { connect: 0, unlock: 0, end: 0 };
  return {
    calls,
    connect: async () => { calls.connect++; },
    query: async (sql) => {
      if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ ok }] };
      if (/pg_advisory_unlock/.test(sql)) { calls.unlock++; return { rows: [{}] }; }
      return { rows: [] };
    },
    end: async () => { calls.end++; },
  };
}

const pgSeq = { getDialect: () => 'postgres' };

describe('worker lock', function () {
  this.timeout(10000);

  it('runs the work directly on a single-instance database', async () => {
    const out = await withLock(() => 'ran', { dialect: 'sqlite' });
    assert.strictEqual(out, 'ran');
  });

  it('runs the work when it takes the lock, then unlocks', async () => {
    const client = fakeClient(true);
    let ran = 0;
    const out = await withLock(() => { ran++; return 42; }, { sequelize: pgSeq, makeClient: () => client });
    assert.strictEqual(out, 42);
    assert.strictEqual(ran, 1);
    assert.strictEqual(client.calls.connect, 1);
    assert.strictEqual(client.calls.unlock, 1);
    assert.strictEqual(client.calls.end, 1);
  });

  it('skips the work when another instance holds the lock', async () => {
    const client = fakeClient(false);
    let ran = 0;
    const out = await withLock(() => { ran++; }, { sequelize: pgSeq, makeClient: () => client });
    assert.strictEqual(out, undefined);
    assert.strictEqual(ran, 0);
    assert.strictEqual(client.calls.unlock, 0);
    assert.strictEqual(client.calls.end, 1);
  });

  it('runs the work anyway if the lock cannot be reached (fail open)', async () => {
    const orig = console.error;
    console.error = () => {};
    try {
      let ran = 0;
      const out = await withLock(() => { ran++; return 'ok'; }, {
        sequelize: pgSeq,
        makeClient: () => ({ connect: async () => { throw new Error('no db'); }, query: async () => ({ rows: [] }), end: async () => {} }),
      });
      assert.strictEqual(out, 'ok');
      assert.strictEqual(ran, 1);
    } finally {
      console.error = orig;
    }
  });

  it('lets only one of two concurrent passes run', async function () {
    if (models.sequelize.getDialect() !== 'postgres') return this.skip();
    let ran = 0;
    const work = () => new Promise((resolve) => setTimeout(() => { ran++; resolve(); }, 300));
    await Promise.all([withLock(work), withLock(work)]);
    assert.strictEqual(ran, 1);
  });
});
