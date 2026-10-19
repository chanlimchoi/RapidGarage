const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const sharp = require('sharp');
const app = require('../app');
const models = require('../models');
const mailer = require('../lib/mailer');
const LocalStorage = require('../lib/storage/local');
const { setStorage } = require('../lib/storage');
const { setSetting } = require('../lib/features');
const aiItems = require('../lib/aiItems');
const userAiKey = require('../lib/userAiKey');

const PW = 'correct-horse';
const KEY = 'sk-ant-api03-' + 'A'.repeat(40) + 'wxyz';
const ONE_TIME = 'sk-ant-api03-' + 'B'.repeat(40) + 'once';
const ENV = ['ANTHROPIC_API_KEY', 'KEY_ENCRYPTION_SECRET', 'AI_KEY_ATTEMPTS_PER_HOUR', 'AI_ITEMS_PER_DAY_OWN_KEY', 'ALLOW_KEYS_OVER_HTTP'];

describe('bring your own AI key', function () {
  this.timeout(30000);
  let dir, alice, bob, aliceId, postId, keysUsed, siteCalls, sent, logs, verifyResult;
  const reply = { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ items: [{ name: 'Lamp', price_cents: 500, photo: 1 }] }) }] };
  const site = { beta: { messages: { create: async () => { siteCalls++; return reply; } } } };
  let ownBehavior = 'ok';
  const factory = (apiKey) => {
    keysUsed.push(apiKey);
    return { beta: { messages: { create: async () => {
      if (ownBehavior === 'reject') {
        const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
        throw new Anthropic.AuthenticationError(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'invalid x-api-key', new Headers());
      }
      return reply;
    } } } };
  };
  const suggest = (agent, body) => agent.post('/post/' + postId + '/items/suggest').send(body || {});
  const saveKey = (agent, key, currentPassword) => agent.put('/me/ai-key').send({ key, currentPassword });

  // Every value in every table, as one string.
  async function wholeDatabase() {
    const qi = models.sequelize.getQueryInterface();
    const tables = await qi.showAllTables();
    let out = '';
    for (const t of tables) {
      const name = typeof t === 'string' ? t : t.tableName;
      const [rows] = await models.sequelize.query('SELECT * FROM "' + name + '"');
      out += JSON.stringify(rows);
    }
    return out;
  }
  const sessions = () => JSON.stringify(app.locals.sessionStore.store.sessions || {});

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-byok-'));
    setStorage(new LocalStorage(dir));
  });
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    ENV.forEach((k) => delete process.env[k]);
    aiItems.setClient(null);
    aiItems.setKeyClientFactory(null);
    userAiKey.setVerifier(null);
    mailer.setTransport(null);
  });

  let origLog, origError, origWarn;
  beforeEach(async () => {
    ENV.forEach((k) => delete process.env[k]);
    process.env.KEY_ENCRYPTION_SECRET = 'test-encryption-secret-0123456789';
    keysUsed = []; siteCalls = 0; sent = []; logs = []; ownBehavior = 'ok'; verifyResult = 'ok';
    aiItems.setClient(null);
    aiItems.setKeyClientFactory(factory);
    aiItems.resetBudgets();
    userAiKey.resetAttempts();
    userAiKey.setVerifier(async () => verifyResult);
    mailer.setTransport({ sendMail: async (m) => { sent.push(m); return {}; } });
    // Capture every console line so we can prove keys never reach the logs.
    origLog = console.log; origError = console.error; origWarn = console.warn;
    const cap = (...a) => logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x, Object.getOwnPropertyNames(x || {})))).join(' '));
    console.log = cap; console.error = cap; console.warn = cap;
    await models.sequelize.sync({ force: true });
    alice = request.agent(app); bob = request.agent(app);
    aliceId = (await alice.post('/signup').send({ email: 'alice@example.com', password: PW, firstName: 'Alice' })).body.id;
    await bob.post('/signup').send({ email: 'bob@example.com', password: PW, firstName: 'Bob' });
    postId = (await alice.post('/post').send({ title: 'Sale', zipCode: '10001' })).body.id;
    const img = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#a33' } }).jpeg().toBuffer();
    await alice.post('/post/' + postId + '/photos').attach('photos', img, 'a.jpg');
  });
  afterEach(() => {
    console.log = origLog; console.error = origError; console.warn = origWarn;
    const all = logs.join('\n');
    assert.ok(!all.includes(KEY) && !all.includes(ONE_TIME), 'a key reached the logs');
  });

  describe('saved key', () => {
    it('needs the password, a valid key and a working key; then shows only the last 4', async () => {
      assert.strictEqual((await saveKey(alice, KEY, 'wrong-pass')).status, 400);
      assert.strictEqual((await saveKey(alice, 'sk-nope', PW)).status, 400);
      verifyResult = 'rejected';
      assert.strictEqual((await saveKey(alice, KEY, PW)).body.error.code, 'own_key_rejected');
      verifyResult = 'unavailable';
      assert.strictEqual((await saveKey(alice, KEY, PW)).status, 503);
      verifyResult = 'ok';
      const r = await saveKey(alice, KEY, PW);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.deepStrictEqual([r.body.hasKey, r.body.last4], [true, 'wxyz']);
      assert.ok(!JSON.stringify(r.body).includes(KEY));
      assert.strictEqual(r.headers['cache-control'], 'no-store');

      // Nowhere readable: /me, the admin user list, the status endpoint.
      const me = await alice.get('/me');
      assert.strictEqual(me.body.user.hasAiKey, true);
      for (const body of [me.body, (await alice.get('/me/ai-key')).body]) assert.ok(!JSON.stringify(body).includes(KEY));
      // A notice email, which names only the last 4.
      assert.strictEqual(sent.length, 1);
      assert.ok(sent[0].text.includes('wxyz') && !sent[0].text.includes(KEY));
    });

    it('is stored only as ciphertext bound to its owner', async () => {
      await saveKey(alice, KEY, PW);
      const row = await models.User.scope('withAiKey').findByPk(aliceId);
      assert.ok(/^v2:/.test(row.aiKeyEncrypted));
      assert.ok(!(await wholeDatabase()).includes(KEY), 'plain key in the database');
      assert.strictEqual(await userAiKey.load(aliceId), KEY);
      // Copying the ciphertext onto Bob's row doesn't give Bob a key.
      const bobId = (await models.User.findOne({ where: { email: 'bob@example.com' } })).id;
      await models.User.update({ aiKeyEncrypted: row.aiKeyEncrypted, aiKeyLast4: 'wxyz' }, { where: { id: bobId } });
      assert.strictEqual(await userAiKey.load(bobId), null);
      // A different KEY_ENCRYPTION_SECRET can't read it either.
      process.env.KEY_ENCRYPTION_SECRET = 'another-secret-entirely-0123456789';
      assert.strictEqual(await userAiKey.load(aliceId), null);
    });

    it('is used for that person\'s drafts only, and deleting erases it', async () => {
      await saveKey(alice, KEY, PW);
      const r = await suggest(alice);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.keySource, 'saved');
      assert.deepStrictEqual(keysUsed, [KEY]);
      assert.strictEqual(siteCalls, 0);

      const del = await alice.delete('/me/ai-key');
      assert.deepStrictEqual([del.status, del.body.hasKey], [200, false]);
      const row = await models.User.scope('withAiKey').findByPk(aliceId);
      assert.deepStrictEqual([row.aiKeyEncrypted, row.aiKeyLast4], [null, null]);
      assert.strictEqual(sent.length, 2, 'removal notice');
      assert.strictEqual((await suggest(alice)).body.error.code, 'needs_key', 'no site key, no saved key');
    });

    it('needs KEY_ENCRYPTION_SECRET to save', async () => {
      delete process.env.KEY_ENCRYPTION_SECRET;
      assert.strictEqual((await saveKey(alice, KEY, PW)).status, 503);
      assert.strictEqual((await request(app).get('/config')).body.userAiKeySave, false);
    });
  });

  describe('one-time key', () => {
    it('is used for exactly one call and stored nowhere', async () => {
      const r = await suggest(alice, { oneTimeKey: ONE_TIME });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.keySource, 'one_time');
      assert.deepStrictEqual(keysUsed, [ONE_TIME]);
      assert.ok(!r.text.includes(ONE_TIME), 'echoed back');
      assert.ok(!(await wholeDatabase()).includes(ONE_TIME), 'in the database');
      assert.ok(!sessions().includes(ONE_TIME), 'in a session');
      assert.strictEqual((await alice.get('/me/ai-key')).body.hasKey, false, 'not saved');
      // The next draft doesn't reuse it.
      assert.strictEqual((await suggest(alice)).body.error.code, 'needs_key');
      assert.deepStrictEqual(keysUsed, [ONE_TIME]);
    });

    it('a rejected key says so, and still leaves no trace', async () => {
      ownBehavior = 'reject';
      const r = await suggest(alice, { oneTimeKey: ONE_TIME });
      assert.strictEqual(r.status, 400);
      assert.strictEqual(r.body.error.code, 'own_key_rejected');
      assert.ok(!r.text.includes(ONE_TIME));
      assert.ok(!(await wholeDatabase()).includes(ONE_TIME));
    });

    it('rejects malformed keys and is only for the seller', async () => {
      assert.strictEqual((await suggest(alice, { oneTimeKey: 'hello' })).status, 400);
      assert.strictEqual((await suggest(bob, { oneTimeKey: ONE_TIME })).status, 403);
      assert.deepStrictEqual(keysUsed, []);
    });

    it('wins over a saved key and the site key', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-site';
      aiItems.setClient(site);
      await saveKey(alice, KEY, PW);
      assert.strictEqual((await suggest(alice, { oneTimeKey: ONE_TIME })).body.keySource, 'one_time');
      assert.strictEqual((await suggest(alice)).body.keySource, 'saved');
      await alice.delete('/me/ai-key');
      assert.strictEqual((await suggest(alice)).body.keySource, 'site');
      assert.deepStrictEqual(keysUsed, [ONE_TIME, KEY]);
      assert.strictEqual(siteCalls, 1);
    });
  });

  it('only travels over HTTPS in production', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const r = await suggest(alice, { oneTimeKey: ONE_TIME });
      assert.strictEqual(r.status, 400);
      assert.ok(/HTTPS/.test(r.body.error.message));
      assert.strictEqual((await saveKey(alice, KEY, PW)).status, 400);
      assert.deepStrictEqual(keysUsed, []);
    } finally { process.env.NODE_ENV = prev; }
  });

  it('limits key attempts per account', async () => {
    process.env.AI_KEY_ATTEMPTS_PER_HOUR = '2';
    verifyResult = 'rejected';
    await saveKey(alice, KEY, PW);
    await suggest(alice, { oneTimeKey: 'sk-ant-api03-' + 'C'.repeat(40) });
    const r = await saveKey(alice, KEY, PW);
    assert.strictEqual(r.status, 429);
  });

  it('the admin switch turns own keys off without touching the site key', async () => {
    await setSetting('userAiKeys', false);
    assert.strictEqual((await alice.get('/me/ai-key')).status, 404);
    assert.strictEqual((await suggest(alice, { oneTimeKey: ONE_TIME })).status, 404);
    const cfg = (await request(app).get('/config')).body;
    assert.deepStrictEqual([cfg.aiItems, cfg.userAiKeys], [false, false]);
    process.env.ANTHROPIC_API_KEY = 'sk-site';
    aiItems.setClient(site);
    assert.strictEqual((await suggest(alice)).body.keySource, 'site');
  });

  it('secretBox v1 values (Maps keys) still decrypt', () => {
    const box = require('../lib/secretBox');
    assert.strictEqual(box.decrypt(box.encrypt('AIzaTest')), 'AIzaTest');
    assert.throws(() => box.decrypt(box.encrypt('x', 'ai-key:user:1')), /context/);
  });
});
