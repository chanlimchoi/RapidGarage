const assert = require('assert');
const http = require('http');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const alerts = require('../lib/alerts');
const push = require('../lib/push');
const live = require('../lib/live');

const PW = 'correct-horse';
const P256DH = 'B' + 'x'.repeat(86); // 87 chars, like a real uncompressed P-256 key
const AUTH = 'a'.repeat(22);
const FCM = (n) => 'https://fcm.googleapis.com/fcm/send/device-' + n;

describe('push notifications and live updates', function () {
  this.timeout(30000);
  let alice, bob, aliceId, bobId, sent, failWith;
  const sub = (endpoint) => ({ endpoint, keys: { p256dh: P256DH, auth: AUTH } });

  async function user(email, firstName, lastName) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName, lastName });
    return [agent, r.body.id];
  }
  async function conversation() {
    const post = (await alice.post('/post').send({ title: 'Bikes', zipCode: '10001' })).body;
    await alerts.idle();
    return (await bob.post('/conversations').send({ postId: post.id })).body;
  }

  beforeEach(async () => {
    sent = []; failWith = null;
    push.setSender(async (s, payload, opts) => {
      if (failWith) { const e = new Error('push failed'); e.statusCode = failWith; throw e; }
      sent.push({ endpoint: s.endpoint, payload: JSON.parse(payload), opts });
      return { statusCode: 201 };
    });
    await models.sequelize.sync({ force: true });
    [alice, aliceId] = await user('alice@example.com', 'Alice', 'Anders');
    [bob, bobId] = await user('bob@example.com', 'Bob', 'Brown');
  });
  after(() => push.setSender(null));

  describe('subscriptions', () => {
    it('accepts only known push services and well-formed keys', async () => {
      const bad = ['http://fcm.googleapis.com/x', 'https://evil.example/x', 'https://fcm.googleapis.com.evil.example/x', 'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://169.254.169.254/latest'];
      for (const endpoint of bad) assert.strictEqual((await alice.post('/push/subscriptions').send(sub(endpoint))).status, 400, endpoint);
      assert.strictEqual((await alice.post('/push/subscriptions').send({ endpoint: FCM(1), keys: { p256dh: 'short', auth: AUTH } })).status, 400);
      for (const ok of [FCM(1), 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://web.push.apple.com/abc', 'https://wns2-par02p.notify.windows.com/w/?token=abc']) {
        assert.strictEqual((await alice.post('/push/subscriptions').send(sub(ok))).status, 201, ok);
      }
      assert.strictEqual((await alice.get('/push/settings')).body.devices, 4);
      assert.strictEqual((await request(app).post('/push/subscriptions').send(sub(FCM(9)))).status, 401);
    });

    it('moves a device to the account that subscribed last, caps devices, and unsubscribes', async () => {
      await alice.post('/push/subscriptions').send(sub(FCM(1)));
      await bob.post('/push/subscriptions').send(sub(FCM(1)));
      assert.strictEqual((await alice.get('/push/settings')).body.devices, 0);
      assert.strictEqual((await bob.get('/push/settings')).body.devices, 1);
      for (let i = 2; i <= 12; i++) await bob.post('/push/subscriptions').send(sub(FCM(i)));
      assert.strictEqual((await bob.get('/push/settings')).body.devices, push.MAX_PER_USER);
      await bob.delete('/push/subscriptions').send({ endpoint: FCM(12) });
      assert.strictEqual((await bob.get('/push/settings')).body.devices, push.MAX_PER_USER - 1);
    });
  });

  it('notifies the other person about a new message without its text', async () => {
    await alice.post('/push/subscriptions').send(sub(FCM(1)));
    const conv = await conversation();
    await bob.post('/conversations/' + conv.id + '/messages').send({ body: 'My secret offer is $40' });
    await push.idle();
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].payload.title, 'New message from Bob B.');
    assert.strictEqual(sent[0].payload.url, '/messages/' + conv.id);
    assert.ok(!JSON.stringify(sent[0]).includes('secret offer'), 'message text on the lock screen');
    assert.strictEqual(sent[0].opts.urgency, 'high');
  });

  it('respects the per-kind choices and deletes subscriptions the push service says are gone', async () => {
    await alice.post('/push/subscriptions').send(sub(FCM(1)));
    await alice.put('/push/settings').send({ messages: false });
    const conv = await conversation();
    await bob.post('/conversations/' + conv.id + '/messages').send({ body: 'hi' });
    await push.idle();
    assert.strictEqual(sent.length, 0);
    assert.strictEqual((await alice.put('/push/settings').send({ messages: 'yes' })).status, 400);

    await alice.put('/push/settings').send({ messages: true });
    failWith = 410;
    await bob.post('/conversations/' + conv.id + '/messages').send({ body: 'hi again' });
    await push.idle();
    assert.strictEqual(await models.PushSubscription.count(), 0);
  });

  it('pushes new sales to followers who allow it', async () => {
    await bob.post('/push/subscriptions').send(sub(FCM(2)));
    await bob.put('/follows/' + aliceId).send({});
    await alice.post('/post').send({ title: 'Vintage lamps', zipCode: '10001' });
    await alerts.idle();
    await push.idle();
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].payload.title, 'Alice A. posted a new sale');
    assert.strictEqual(sent[0].payload.body, 'Vintage lamps');
  });

  it('sends a test notification, rate-limited', async () => {
    await alice.post('/push/subscriptions').send(sub(FCM(1)));
    const r = await alice.post('/push/test');
    assert.deepStrictEqual(r.body, { delivered: 1 });
    for (let i = 0; i < 4; i++) await alice.post('/push/test');
    assert.strictEqual((await alice.post('/push/test')).status, 429);
  });

  it('is off without VAPID keys', async () => {
    push.setSender(null);
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    assert.strictEqual((await alice.get('/push/settings')).body.available, false);
    assert.strictEqual((await alice.post('/push/subscriptions').send(sub(FCM(1)))).status, 404);
  });

  describe('live stream', () => {
    let server, base, cookie;
    before((done) => { server = app.listen(0, () => { base = 'http://127.0.0.1:' + server.address().port; done(); }); });
    after((done) => { live.closeAll(); server.close(done); });

    // Opens /live with Alice's cookie; resolves with the response and a reader.
    function open() {
      return new Promise((resolve, reject) => {
        const req = http.get(base + '/live', { headers: { Cookie: cookie, Accept: 'text/event-stream' } }, (res) => {
          let buf = '';
          const waiters = [];
          res.setEncoding('utf8');
          res.on('data', (c) => { buf += c; waiters.splice(0).forEach((w) => w()); });
          const until = (re) => new Promise((ok) => { const check = () => (re.test(buf) ? ok(buf) : waiters.push(check)); check(); });
          resolve({ res, req, until, text: () => buf });
        });
        req.on('error', reject);
      });
    }

    beforeEach(async () => {
      const r = await request(app).post('/login').send({ email: 'alice@example.com', password: PW });
      cookie = r.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
    });

    it('streams message events (ids only) and skips push while a tab is open', async () => {
      await alice.post('/push/subscriptions').send(sub(FCM(1)));
      const conv = await conversation();
      const s = await open();
      assert.strictEqual(s.res.statusCode, 200);
      assert.ok(/text\/event-stream/.test(s.res.headers['content-type']));
      await s.until(/event: hello/);
      assert.strictEqual(live.isConnected(aliceId), true);
      await bob.post('/conversations/' + conv.id + '/messages').send({ body: 'Is the bike still there?' });
      const text = await s.until(/event: badges/);
      assert.ok(text.includes('event: message\ndata: {"conversationId":' + conv.id + '}'));
      assert.ok(!text.includes('bike still there'), 'message text in the stream');
      await push.idle();
      assert.strictEqual(sent.length, 0, 'no push while the tab is open');
      s.req.destroy();
      await new Promise((r) => setTimeout(r, 50));
      assert.strictEqual(live.isConnected(aliceId), false);
    });

    it('needs login and caps connections per person', async () => {
      const anon = await new Promise((resolve) => http.get(base + '/live', resolve));
      assert.strictEqual(anon.statusCode, 401);
      anon.resume();
      const streams = [];
      for (let i = 0; i < live.PER_USER + 2; i++) { const s = await open(); await s.until(/hello/); streams.push(s); }
      await new Promise((r) => setTimeout(r, 50));
      assert.strictEqual(live.stats().connections, live.PER_USER);
      streams.forEach((s) => s.req.destroy());
    });
  });
});
