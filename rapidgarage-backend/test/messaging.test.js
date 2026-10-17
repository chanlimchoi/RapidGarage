const assert = require('assert');
const request = require('supertest');
const sharp = require('sharp');
const fs = require('fs');
const os = require('os');
const path = require('path');
const app = require('../app');
const models = require('../models');
const LocalStorage = require('../lib/storage/local');
const { setStorage } = require('../lib/storage');

const PW = 'correct-horse';
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

describe('messaging', function () {
  this.timeout(30000);
  let seller, buyer, other, admin, anon, sellerId, buyerId, adminId, postId, post2Id, dir;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rg-msg-'));
    setStorage(new LocalStorage(dir));
  });
  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.MESSAGE_MAX_PER_MINUTE;
    delete process.env.CONVERSATION_MAX_PER_HOUR;
  });

  async function user(email, firstName, lastName) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName, lastName });
    assert.strictEqual(r.status, 201);
    return [agent, r.body.id];
  }

  beforeEach(async () => {
    delete process.env.MESSAGE_MAX_PER_MINUTE;
    delete process.env.CONVERSATION_MAX_PER_HOUR;
    await models.sequelize.sync({ force: true });
    [seller, sellerId] = await user('seller@example.com', 'Sam', 'seller');
    [buyer, buyerId] = await user('buyer@example.com', 'Bea', 'Buyerson');
    [other] = await user('other@example.com', 'Otto', 'Other');
    [admin, adminId] = await user('admin@example.com', 'Ada', 'Admin');
    await models.User.update({ role: 'admin' }, { where: { id: adminId } });
    anon = request(app);
    postId = (await seller.post('/post').send({ title: 'Bike sale', street: '1 Main St', city: 'NYC', zipCode: '10036' })).body.id;
    post2Id = (await seller.post('/post').send({ title: 'Lamp sale', street: '2 Main St', city: 'NYC', zipCode: '10036' })).body.id;
  });

  const start = (agent, id) => agent.post('/conversations').send({ postId: id || postId });
  const send = (agent, convId, body) => agent.post('/conversations/' + convId + '/messages').send({ body });
  const unread = async (agent) => (await agent.get('/conversations/unread')).body.count;

  async function thread() {
    const c = await start(buyer);
    assert.strictEqual(c.status, 201, JSON.stringify(c.body));
    return c.body.id;
  }

  describe('starting conversations', () => {
    it('requires login', async () => {
      assert.strictEqual((await start(anon)).status, 401);
      assert.strictEqual((await anon.get('/conversations')).status, 401);
      assert.strictEqual((await anon.get('/conversations/unread')).status, 401);
    });

    it('creates one conversation per post, buyer and seller, and reuses it', async () => {
      const a = await start(buyer);
      assert.strictEqual(a.status, 201);
      assert.strictEqual(a.body.created, true);
      const b = await start(buyer);
      assert.strictEqual(b.status, 200);
      assert.deepStrictEqual([b.body.id, b.body.created], [a.body.id, false]);
      const otherPost = await start(buyer, post2Id);
      assert.notStrictEqual(otherPost.body.id, a.body.id, 'different post, different conversation');
      const otherBuyer = await start(other);
      assert.notStrictEqual(otherBuyer.body.id, a.body.id);
      assert.strictEqual(await models.Conversation.count(), 3);
    });

    it('the database also enforces one conversation per (post, buyer, seller)', async () => {
      await models.Conversation.create({ postId, buyerId, sellerId });
      await assert.rejects(models.Conversation.create({ postId, buyerId, sellerId }), /Unique|unique/);
    });

    it("can't message yourself, a missing post or a bad id", async () => {
      assert.strictEqual((await start(seller)).status, 403);
      assert.strictEqual((await start(buyer, 99999)).status, 404);
      assert.strictEqual((await buyer.post('/conversations').send({ postId: 'x' })).status, 400);
      assert.strictEqual((await buyer.post('/conversations').send({})).status, 400);
    });

    it('rate-limits new conversations', async () => {
      process.env.CONVERSATION_MAX_PER_HOUR = '1';
      assert.strictEqual((await start(buyer)).status, 201);
      const r = await start(buyer, post2Id);
      assert.strictEqual(r.status, 429);
      assert.strictEqual(r.body.error.code, 'rate_limited');
      assert.strictEqual((await start(buyer)).status, 200, 'reusing an existing one is not limited');
    });
  });

  describe('sending and reading', () => {
    it('only participants can read or send (404 for everyone else, admins included)', async () => {
      const id = await thread();
      await send(buyer, id, 'Hi!');
      for (const agent of [other, admin]) {
        assert.strictEqual((await agent.get('/conversations/' + id)).status, 404);
        assert.strictEqual((await agent.get('/conversations/' + id + '/messages')).status, 404);
        assert.strictEqual((await send(agent, id, 'sneaky')).status, 404);
        assert.strictEqual((await agent.post('/conversations/' + id + '/block')).status, 404);
        assert.deepStrictEqual((await agent.get('/conversations')).body.results, []);
      }
      assert.strictEqual((await anon.get('/conversations/' + id)).status, 401);
      assert.strictEqual((await buyer.get('/conversations/abc')).status, 400);
      assert.strictEqual((await buyer.get('/conversations/99999')).status, 404);
      assert.strictEqual(await models.Message.count(), 1);
    });

    it('validates the body: 1-2000 characters of text, trimmed', async () => {
      const id = await thread();
      for (const bad of ['', '   \n ', null, 42, { a: 1 }, 'x'.repeat(2001)]) {
        const r = await send(buyer, id, bad);
        assert.strictEqual(r.status, 400, JSON.stringify(bad));
        assert.ok(r.body.error.details.body);
      }
      const ok = await send(buyer, id, '  ' + 'x'.repeat(2000) + '  ');
      assert.strictEqual(ok.status, 201);
      assert.strictEqual(ok.body.body.length, 2000);
      const html = await send(buyer, id, '<script>alert(1)</script>\r\nline two');
      assert.strictEqual(html.body.body, '<script>alert(1)</script>\nline two', 'stored verbatim as plain text');
    });

    it('tracks unread counts and read state per participant', async () => {
      const id = await thread();
      assert.strictEqual((await seller.get('/conversations')).body.results.length, 0, 'seller sees nothing until a message arrives');
      await send(buyer, id, 'Is the bike still there?');
      await send(buyer, id, 'I can come at 5');
      assert.strictEqual(await unread(seller), 2);
      assert.strictEqual(await unread(buyer), 0, 'your own messages are never unread');
      let list = (await seller.get('/conversations')).body;
      assert.strictEqual(list.unreadTotal, 2);
      assert.strictEqual(list.results[0].unreadCount, 2);
      assert.strictEqual(list.results[0].role, 'seller');
      assert.strictEqual(list.results[0].lastMessage.body, 'I can come at 5');
      assert.strictEqual(list.results[0].post.title, 'Bike sale');
      const t = await seller.get('/conversations/' + id);
      assert.strictEqual(t.status, 200);
      assert.deepStrictEqual(t.body.messages.map((m) => [m.body, m.mine]), [['Is the bike still there?', false], ['I can come at 5', false]]);
      assert.strictEqual(t.body.conversation.canSend, true);
      assert.strictEqual(await unread(seller), 0, 'opening the thread marks it read');
      const reply = await send(seller, id, 'Yes! See you at 5.');
      assert.strictEqual(reply.status, 201);
      assert.strictEqual(await unread(buyer), 1);
      assert.strictEqual(await unread(seller), 0);
      // Polling for new messages also marks them read.
      const firstId = t.body.messages[1].id;
      const poll = await buyer.get('/conversations/' + id + '/messages?after=' + firstId);
      assert.deepStrictEqual(poll.body.messages.map((m) => m.body), ['Yes! See you at 5.']);
      assert.strictEqual(await unread(buyer), 0);
      list = (await buyer.get('/conversations')).body;
      assert.strictEqual(list.results[0].lastMessage.mine, false);
    });

    it('paginates messages (newest page first, then older with before=)', async () => {
      const id = await thread();
      const rows = [];
      for (let i = 1; i <= 35; i++) rows.push({ conversationId: id, senderId: buyerId, body: 'm' + i });
      await models.Message.bulkCreate(rows);
      const first = await seller.get('/conversations/' + id);
      assert.strictEqual(first.body.messages.length, 30);
      assert.strictEqual(first.body.hasMore, true);
      assert.strictEqual(first.body.messages[0].body, 'm6');
      assert.strictEqual(first.body.messages[29].body, 'm35');
      const older = await seller.get('/conversations/' + id + '/messages?before=' + first.body.messages[0].id);
      assert.deepStrictEqual(older.body.messages.map((m) => m.body), ['m1', 'm2', 'm3', 'm4', 'm5']);
      assert.strictEqual(older.body.hasMore, false);
      assert.strictEqual((await seller.get('/conversations/' + id + '/messages?before=x')).status, 400);
    });

    it('rate-limits sending', async () => {
      process.env.MESSAGE_MAX_PER_MINUTE = '3';
      const id = await thread();
      for (let i = 0; i < 3; i++) assert.strictEqual((await send(buyer, id, 'hi ' + i)).status, 201);
      const r = await send(buyer, id, 'one too many');
      assert.strictEqual(r.status, 429);
      assert.strictEqual(r.body.error.code, 'rate_limited');
      assert.ok(r.headers['retry-after']);
      assert.strictEqual((await send(seller, id, 'seller is separate')).status, 201);
    });
  });

  describe('blocking', () => {
    it('stops messages both ways, and unblocking restores them', async () => {
      const id = await thread();
      await send(buyer, id, 'hello');
      const b = await seller.post('/conversations/' + id + '/block');
      assert.strictEqual(b.status, 200);
      assert.deepStrictEqual(b.body.blocked, { byMe: true, byThem: false });
      let r = await send(buyer, id, 'are you there?');
      assert.strictEqual(r.status, 403);
      assert.strictEqual(r.body.error.code, 'blocked');
      assert.strictEqual((await send(seller, id, 'bye')).status, 403);
      const view = await buyer.get('/conversations/' + id);
      assert.strictEqual(view.status, 200, 'still readable');
      assert.deepStrictEqual([view.body.conversation.canSend, view.body.conversation.blocked.byThem], [false, true]);
      assert.strictEqual((await start(buyer, post2Id)).status, 403, "can't start a new one with them either");
      assert.strictEqual((await seller.post('/conversations/' + id + '/block')).status, 200, 'blocking twice is fine');
      assert.strictEqual(await models.UserBlock.count(), 1);
      assert.strictEqual((await seller.delete('/conversations/' + id + '/block')).body.blocked.byMe, false);
      assert.strictEqual((await send(buyer, id, 'back again')).status, 201);
    });

    it("the blocked person can't lift it", async () => {
      const id = await thread();
      await seller.post('/conversations/' + id + '/block');
      await send(buyer, id, 'x');
      await buyer.delete('/conversations/' + id + '/block');
      assert.strictEqual((await send(buyer, id, 'still blocked')).status, 403);
    });
  });

  describe('hidden and deleted posts', () => {
    it("existing conversations stay readable, new ones can't start on hidden posts", async () => {
      const id = await thread();
      await send(buyer, id, 'hi');
      await admin.post('/admin/posts/' + postId + '/moderate').send({ action: 'hide' });
      const view = await buyer.get('/conversations/' + id);
      assert.strictEqual(view.status, 200);
      assert.deepStrictEqual([view.body.conversation.post.status, view.body.conversation.post.canView], ['hidden', false]);
      assert.strictEqual((await send(buyer, id, 'still here?')).status, 201);
      assert.strictEqual((await start(buyer)).status, 200, 'reopening an existing conversation is allowed');
      assert.strictEqual((await start(other)).status, 404, 'a hidden post looks missing to others');
      const sellerView = await seller.get('/conversations/' + id);
      assert.deepStrictEqual([sellerView.body.conversation.post.status, sellerView.body.conversation.post.canView], ['hidden', true]);
    });

    it('admins (who can see hidden posts) still cannot start a new conversation on one', async () => {
      await admin.post('/admin/posts/' + postId + '/moderate').send({ action: 'hide' });
      const r = await start(admin);
      assert.strictEqual(r.status, 403);
      assert.strictEqual(r.body.error.code, 'post_unavailable');
    });

    it('a deleted post leaves the conversation readable and marked deleted', async () => {
      const id = await thread();
      await send(buyer, id, 'hi');
      assert.strictEqual((await seller.delete('/post/' + postId)).status, 204);
      const view = await buyer.get('/conversations/' + id);
      assert.strictEqual(view.status, 200);
      assert.deepStrictEqual([view.body.conversation.post.status, view.body.conversation.post.title], ['deleted', 'Bike sale']);
      assert.strictEqual(view.body.messages.length, 1);
      assert.strictEqual((await start(buyer)).status, 404);
    });
  });

  describe('privacy', () => {
    it('never exposes email addresses, only first name and last initial', async () => {
      const img = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#0f0' } }).jpeg().toBuffer();
      await seller.post('/post/' + postId + '/photos').attach('photos', img, 'a.jpg');
      const id = await thread();
      await send(buyer, id, 'hi there');
      await send(seller, id, 'hello');
      const responses = [
        await buyer.get('/conversations'), await seller.get('/conversations'),
        await buyer.get('/conversations/' + id), await seller.get('/conversations/' + id),
        await buyer.get('/conversations/' + id + '/messages'), await seller.post('/conversations/' + id + '/block'),
        await buyer.get('/profile/' + sellerId), await anon.get('/profile/' + buyerId),
      ];
      for (const r of responses) {
        assert.ok(!EMAIL_RE.test(JSON.stringify(r.body)), 'email leaked: ' + JSON.stringify(r.body));
        assert.ok(!/password|Buyerson/.test(JSON.stringify(r.body)), 'private field leaked');
      }
      const list = (await seller.get('/conversations')).body.results[0];
      assert.deepStrictEqual(list.other, { id: buyerId, name: 'Bea B.' });
      assert.ok(list.post.thumbUrl, 'thumbnail included');
      const fromBuyer = (await buyer.get('/conversations')).body.results[0];
      assert.deepStrictEqual(fromBuyer.other, { id: sellerId, name: 'Sam S.' });
    });
  });
});
