const assert = require('assert');
const models = require('../models');
const live = require('../lib/live');

// Cross-instance live events need a real Postgres (CI runs this; SQLite skips it).
const pg = models.sequelize.getDialect() === 'postgres';

(pg ? describe : describe.skip)('live events across instances (Postgres LISTEN/NOTIFY)', function () {
  this.timeout(20000);
  // A stand-in for an open /live response.
  function fakeStream() {
    const chunks = [];
    const handlers = {};
    const res = {
      status() { return res; }, set() { return res; }, flushHeaders() {},
      write(c) { chunks.push(c); return true; }, end() { (handlers.close || []).forEach((f) => f()); },
      on(ev, f) { (handlers[ev] = handlers[ev] || []).push(f); return res; },
    };
    const req = { on: res.on };
    return { req, res, text: () => chunks.join('') };
  }
  before(async () => { process.env.LIVE_BROADCAST = 'postgres'; assert.strictEqual(await live.startBroadcast(), true); });
  after(async () => { live.closeAll(); await live.stopBroadcast(); delete process.env.LIVE_BROADCAST; });

  it('delivers an event published with NOTIFY to the local stream', async () => {
    const s = fakeStream();
    assert.strictEqual(live.connect(4242, s.req, s.res), true);
    live.emit(4242, 'badges', {});
    const t0 = Date.now();
    while (!s.text().includes('event: badges') && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));
    assert.ok(s.text().includes('event: badges'), 'arrived through Postgres');
    s.res.end();
  });
});
