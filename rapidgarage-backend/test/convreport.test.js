const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');

const PW = 'correct-horse';

describe('conversation reports + admin access', function () {
  this.timeout(30000);
  let seller, buyer, other, admin, sellerId, buyerId, adminId, postId, convId;

  async function user(email, firstName, lastName) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName, lastName });
    assert.strictEqual(r.status, 201);
    return [agent, r.body.id];
  }

  beforeEach(async () => {
    delete process.env.REPORT_MAX_PER_HOUR;
    await models.sequelize.sync({ force: true });
    [seller, sellerId] = await user('seller@example.com', 'Sam', 'Seller');
    [buyer, buyerId] = await user('buyer@example.com', 'Bea', 'Buyer');
    [other] = await user('other@example.com', 'Otto', 'Other');
    [admin, adminId] = await user('admin@example.com', 'Ada', 'Admin');
    await models.User.update({ role: 'admin' }, { where: { id: adminId } });
    postId = (await seller.post('/post').send({ title: 'Bike sale', street: '1 Main St', city: 'NYC', zipCode: '10036' })).body.id;
    convId = (await buyer.post('/conversations').send({ postId })).body.id;
    await send(buyer, 'Hi, is the bike there?');
    await send(seller, 'Send me $50 by wire first or no deal');
  });
  after(() => { delete process.env.REPORT_MAX_PER_HOUR; });

  function send(agent, body) { return agent.post('/conversations/' + convId + '/messages').send({ body }); }
  const report = (agent, body) => agent.post('/conversations/' + convId + '/report').send(Object.assign({ reason: 'scam' }, body));
  const adminView = () => admin.get('/admin/conversations/' + convId);
  const moderate = (body) => admin.post('/admin/conversations/' + convId + '/moderate').send(body);

  describe('reporting', () => {
    it('either participant can report, with a reason and optional note', async () => {
      const r = await report(buyer, { note: '  asked for a wire transfer ' });
      assert.strictEqual(r.status, 201, JSON.stringify(r.body));
      const row = await models.ConversationReport.findByPk(r.body.id);
      assert.deepStrictEqual([row.reporterId, row.reportedUserId, row.note, row.status], [buyerId, sellerId, 'asked for a wire transfer', 'open']);
      assert.strictEqual((await report(seller, { reason: 'harassment' })).status, 201);
    });

    it('validates input and requires being a participant', async () => {
      assert.strictEqual((await report(buyer, { reason: 'boring' })).status, 400);
      assert.strictEqual((await report(buyer, { note: 'x'.repeat(501) })).status, 400);
      assert.strictEqual((await report(buyer, { block: 'yes' })).status, 400);
      assert.strictEqual((await report(other)).status, 404);
      assert.strictEqual((await report(admin)).status, 404);
      assert.strictEqual((await report(request(app))).status, 401);
      for (const reason of ['harassment', 'scam', 'spam', 'offensive', 'other']) {
        assert.strictEqual((await report(buyer, { reason })).status, reason === 'harassment' ? 201 : 409);
      }
    });

    it('one open report per participant; a new one after resolution', async () => {
      assert.strictEqual((await report(buyer)).status, 201);
      assert.strictEqual((await report(buyer, { reason: 'spam' })).status, 409);
      await assert.rejects(models.ConversationReport.create({ conversationId: convId, reporterId: buyerId, reportedUserId: sellerId, reason: 'spam' }), /Unique|unique/);
      await moderate({ action: 'dismiss' });
      assert.strictEqual((await report(buyer)).status, 201);
    });

    it('shares the hourly report limit with post reports', async () => {
      process.env.REPORT_MAX_PER_HOUR = '2';
      const p2 = (await seller.post('/post').send({ title: 'Other', street: 'x', city: 'y', zipCode: '10036' })).body.id;
      assert.strictEqual((await buyer.post('/post/' + p2 + '/report').send({ reason: 'spam' })).status, 201);
      assert.strictEqual((await report(buyer)).status, 201);
      const r = await report(seller);
      assert.strictEqual(r.status, 201, 'other users unaffected');
      const p3 = (await seller.post('/post').send({ title: 'Third', street: 'x', city: 'y', zipCode: '10036' })).body.id;
      const limited = await buyer.post('/post/' + p3 + '/report').send({ reason: 'spam' });
      assert.strictEqual(limited.status, 429);
    });

    it('can block the other person in the same step', async () => {
      const r = await report(buyer, { block: true });
      assert.deepStrictEqual(r.body.blocked, { byMe: true, byThem: false });
      assert.strictEqual((await send(seller, 'hello?')).status, 403);
    });

    it("participants never see other reporters or admin notes", async () => {
      await report(seller, { reason: 'harassment', note: 'seller secret note' });
      await moderate({ action: 'warn', note: 'ADMIN ONLY NOTE' });
      await report(buyer, { note: 'buyer note' });
      for (const agent of [buyer, seller]) {
        const blob = JSON.stringify([(await agent.get('/conversations/' + convId)).body, (await agent.get('/conversations')).body, (await agent.get('/conversations/' + convId + '/messages')).body]);
        assert.ok(!/ADMIN ONLY NOTE|seller secret note|buyer note|harassment/.test(blob), 'leak: ' + blob);
      }
      assert.strictEqual((await buyer.get('/conversations/' + convId)).body.conversation.reportedByMe, true);
      assert.strictEqual((await seller.get('/conversations/' + convId)).body.conversation.reportedByMe, false);
    });
  });

  describe('admin read rule', () => {
    it('404 for a never-reported conversation, exactly like a non-participant', async () => {
      const a = await adminView();
      const o = await other.get('/conversations/' + convId);
      assert.strictEqual(a.status, 404);
      assert.deepStrictEqual(a.body, o.body);
      assert.strictEqual((await admin.get('/conversations/' + convId)).status, 404, 'participant API stays closed to admins');
      assert.strictEqual((await moderate({ action: 'dismiss' })).status, 404);
      assert.strictEqual(await models.ConversationModerationEvent.count(), 0, 'nothing logged for a refused read');
      const q = await admin.get('/admin/conversation-reports');
      assert.deepStrictEqual(q.body.groups, []);
    });

    it('non-admins get 403 on every admin conversation route', async () => {
      await report(buyer);
      for (const [m, url] of [['get', '/admin/conversation-reports'], ['get', '/admin/conversation-reports/history'], ['get', '/admin/conversations/' + convId], ['post', '/admin/conversations/' + convId + '/moderate']]) {
        assert.strictEqual((await buyer[m](url).send({ action: 'dismiss' })).status, 403, url);
        assert.strictEqual((await request(app)[m](url).send({ action: 'dismiss' })).status, 401, url);
      }
    });

    it('while a report is open: all messages, before and after the report, with names and emails', async () => {
      const r = await report(buyer, { note: 'wire scam' });
      await send(seller, 'Sent after the report');
      const q = await admin.get('/admin/conversation-reports');
      assert.strictEqual(q.body.groups.length, 1);
      assert.strictEqual(q.body.groups[0].reports[0].reporter.email, 'buyer@example.com');
      assert.ok(!('messages' in q.body.groups[0]), 'the queue itself shows no message text');
      const v = await adminView();
      assert.strictEqual(v.status, 200);
      assert.strictEqual(v.body.access.mode, 'open');
      assert.deepStrictEqual(v.body.messages.map((m) => m.body), ['Hi, is the bike there?', 'Send me $50 by wire first or no deal', 'Sent after the report']);
      assert.deepStrictEqual(v.body.messages[1].sender, { id: sellerId, name: 'Sam S.', email: 'seller@example.com', messagingBanned: false, role: 'seller' });
      assert.strictEqual(v.body.reports[0].id, r.body.id);
    });

    it('logs every admin read with the admin, time and report id, and shows the trail', async () => {
      const r = await report(buyer);
      await adminView();
      const v = await adminView();
      const reads = await models.ConversationModerationEvent.findAll({ where: { type: 'read' } });
      assert.strictEqual(reads.length, 2);
      assert.deepStrictEqual([reads[0].adminId, reads[0].reportId, reads[0].conversationId], [adminId, r.body.id, convId]);
      assert.ok(reads[0].createdAt);
      const trail = v.body.events.filter((e) => e.type === 'read');
      assert.strictEqual(trail.length, 2);
      assert.strictEqual(trail[0].admin.email, 'admin@example.com');
      assert.strictEqual(trail[0].reportId, r.body.id);
    });

    it('after resolution: history view up to the resolution time only', async () => {
      await report(buyer);
      await send(seller, 'Before resolution');
      assert.strictEqual((await moderate({ action: 'dismiss', note: 'not a scam' })).body.resolved, 1);
      await new Promise((r) => setTimeout(r, 15));
      await send(seller, 'Private again after resolution');
      const v = await adminView();
      assert.strictEqual(v.status, 200);
      assert.strictEqual(v.body.access.mode, 'history');
      assert.deepStrictEqual(v.body.messages.map((m) => m.body), ['Hi, is the bike there?', 'Send me $50 by wire first or no deal', 'Before resolution']);
      assert.strictEqual(v.body.access.hiddenLaterMessages, 1);
      const last = await models.Message.findOne({ order: [['id', 'DESC']] });
      assert.strictEqual((await moderate({ action: 'remove_message', messageId: last.id })).status, 404, 'cannot act on messages outside the window');
      // A new report opens the whole conversation again.
      await report(seller, { reason: 'harassment' });
      assert.strictEqual((await adminView()).body.messages.length, 4);
      const h = await admin.get('/admin/conversation-reports/history');
      assert.deepStrictEqual(h.body.results.map((x) => [x.action, x.resolutionNote, x.reviewer.email]), [['dismissed', 'not a scam', 'admin@example.com']]);
    });
  });

  describe('admin actions', () => {
    it('warn resolves with a note and changes nothing for the users', async () => {
      await report(buyer);
      const r = await moderate({ action: 'warn', userId: sellerId, note: 'Told them off' });
      assert.strictEqual(r.status, 200);
      const rep = await models.ConversationReport.findOne();
      assert.deepStrictEqual([rep.status, rep.action, rep.resolutionNote, rep.reviewerId], ['actioned', 'warned', 'Told them off', adminId]);
      assert.strictEqual((await send(seller, 'still can send')).status, 201);
      const ev = await models.ConversationModerationEvent.findOne({ where: { type: 'warn' } });
      assert.deepStrictEqual([ev.targetUserId, ev.note, ev.reportId], [sellerId, 'Told them off', rep.id]);
    });

    it('ban stops sending and starting conversations, keeps reading; unban lifts it', async () => {
      await report(buyer);
      assert.strictEqual((await moderate({ action: 'ban' })).status, 400, 'needs a participant');
      assert.strictEqual((await moderate({ action: 'ban', userId: adminId })).status, 400);
      const r = await moderate({ action: 'ban', userId: sellerId, note: 'Scammer' });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.resolved, 1);
      assert.strictEqual(r.body.participants.find((p) => p.id === sellerId).messagingBanned, true);
      const s = await send(seller, 'trying');
      assert.strictEqual(s.status, 403);
      assert.strictEqual(s.body.error.code, 'messaging_banned');
      const p2 = (await buyer.post('/post').send({ title: 'Buyer sells', street: 'x', city: 'y', zipCode: '10036' })).body.id;
      assert.strictEqual((await seller.post('/conversations').send({ postId: p2 })).body.error.code, 'messaging_banned');
      const view = await seller.get('/conversations/' + convId);
      assert.strictEqual(view.status, 200, 'banned users can still read');
      assert.deepStrictEqual([view.body.conversation.canSend, view.body.conversation.messagingBanned], [false, true]);
      assert.strictEqual((await seller.get('/me')).body.user.messagingBanned, true);
      assert.strictEqual((await send(buyer, 'the other side can still write')).status, 201);
      assert.strictEqual((await moderate({ action: 'unban', userId: sellerId })).status, 200, 'history access allows lifting the ban');
      assert.strictEqual((await send(seller, 'back')).status, 201);
      const types = (await models.ConversationModerationEvent.findAll({ order: [['id', 'ASC']] })).map((e) => e.type);
      assert.deepStrictEqual(types, ['ban', 'unban']);
    });

    it('remove_message soft-deletes: participants see a placeholder, admins keep the text', async () => {
      await report(buyer);
      const target = await models.Message.findOne({ where: { senderId: sellerId } });
      const r = await moderate({ action: 'remove_message', messageId: target.id, note: 'scam bait' });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.body.resolved, 0, 'removing a message does not resolve the report');
      for (const agent of [buyer, seller]) {
        const t = await agent.get('/conversations/' + convId);
        const m = t.body.messages.find((x) => x.id === target.id);
        assert.deepStrictEqual([m.removed, m.body], [true, null]);
        assert.ok(!JSON.stringify(t.body).includes('wire first'));
        const list = (await agent.get('/conversations')).body.results[0];
        assert.ok(!JSON.stringify(list).includes('wire first'));
      }
      const v = await adminView();
      const am = v.body.messages.find((x) => x.id === target.id);
      assert.deepStrictEqual([am.removed, am.body], [true, 'Send me $50 by wire first or no deal']);
      assert.ok(await models.Message.findByPk(target.id), 'row kept');
      const ev = v.body.events.find((e) => e.type === 'remove_message');
      assert.deepStrictEqual([ev.messageId, ev.note, ev.targetUser.id], [target.id, 'scam bait', sellerId]);
      assert.strictEqual((await moderate({ action: 'remove_message', messageId: 99999 })).status, 404);
    });

    it('validates actions', async () => {
      await report(buyer);
      assert.strictEqual((await moderate({ action: 'nuke' })).status, 400);
      assert.strictEqual((await moderate({ action: 'dismiss', note: 'x'.repeat(501) })).status, 400);
      assert.strictEqual((await admin.post('/admin/conversations/abc/moderate').send({ action: 'dismiss' })).status, 400);
    });
  });

  describe('post reports are unaffected', () => {
    it('still queue, resolve and show in history; the tab count includes conversation reports', async () => {
      assert.strictEqual((await buyer.post('/post/' + postId + '/report').send({ reason: 'spam' })).status, 201);
      await report(buyer);
      const q = await admin.get('/admin/reports');
      assert.strictEqual(q.body.groups.length, 1);
      assert.strictEqual(q.body.conversationOpenCount, 1);
      assert.strictEqual((await admin.post('/admin/posts/' + postId + '/moderate').send({ action: 'hide' })).body.resolved, 1);
      assert.strictEqual((await admin.get('/admin/reports/history')).body.total, 1);
      assert.strictEqual(await models.ConversationReport.count({ where: { status: 'open' } }), 1, 'post moderation leaves conversation reports alone');
    });
  });
});
