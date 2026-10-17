const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');

const PW = 'correct-horse';

describe('ratings after a chat', function () {
  this.timeout(30000);
  let seller, buyer, other, admin, sellerId, buyerId, postId, conv;

  async function user(email, first, last, role) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: last });
    assert.strictEqual(r.status, 201);
    if (role) await models.User.update({ role }, { where: { id: r.body.id } });
    return [agent, r.body.id];
  }
  const say = (agent, id, body) => agent.post('/conversations/' + id + '/messages').send({ body: body || 'hi' });
  const rate = (agent, body, id) => agent.put('/ratings/conversations/' + (id || conv)).send(body);

  beforeEach(async () => {
    await models.sequelize.sync({ force: true });
    [seller, sellerId] = await user('sam@example.com', 'Sam', 'Seller');
    [buyer, buyerId] = await user('bea@example.com', 'Bea', 'Buyer');
    [other] = await user('otto@example.com', 'Otto', 'Other');
    [admin] = await user('admin@example.com', 'Ada', 'Admin', 'admin');
    const p = await seller.post('/post').send({ title: 'Yard sale', street: '1 Main St', city: 'NYC', zipCode: '10001' });
    postId = p.body.id;
    const c = await buyer.post('/conversations').send({ postId });
    assert.ok(c.status === 201 || c.status === 200, JSON.stringify(c.body));
    conv = c.body.id;
  });

  it('needs a message from each side first', async () => {
    let s = await buyer.get('/ratings/conversations/' + conv);
    assert.deepStrictEqual([s.body.canRate, s.body.reason], [false, 'needs_messages']);
    await say(buyer, conv);
    assert.strictEqual((await rate(buyer, { stars: 5 })).status, 403);
    assert.strictEqual((await rate(buyer, { stars: 5 })).body.error.code, 'needs_messages');
    await say(seller, conv, 'hello back');
    s = await buyer.get('/ratings/conversations/' + conv);
    assert.strictEqual(s.body.canRate, true);
    assert.deepStrictEqual(s.body.other, { id: sellerId, name: 'Sam S.' });
  });

  it('rates once per conversation, editable, with an optional comment', async () => {
    await say(buyer, conv); await say(seller, conv);
    const r = await rate(buyer, { stars: 4, comment: '  Friendly,   on time ' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.deepStrictEqual([r.body.mine.stars, r.body.mine.comment, r.body.mine.raterRole, r.body.mine.mine], [4, 'Friendly, on time', 'buyer', true]);
    const e = await rate(buyer, { stars: 5, comment: '' });
    assert.strictEqual(e.status, 200);
    assert.deepStrictEqual([e.body.mine.stars, e.body.mine.comment], [5, null]);
    assert.strictEqual(await models.Rating.count(), 1);
    // The seller rates the buyer separately and sees the buyer's rating of them.
    const s = await rate(seller, { stars: 3 });
    assert.strictEqual(s.status, 201);
    assert.strictEqual(s.body.theirs.stars, 5);
    assert.strictEqual(s.body.mine.raterRole, 'seller');
    // Delete mine.
    const d = await buyer.delete('/ratings/conversations/' + conv);
    assert.strictEqual(d.body.mine, null);
    assert.strictEqual(await models.Rating.count(), 1);
  });

  it('validates stars and comments', async () => {
    await say(buyer, conv); await say(seller, conv);
    for (const stars of [0, 6, 2.5, '5', null]) assert.strictEqual((await rate(buyer, { stars })).status, 400, String(stars));
    const long = await rate(buyer, { stars: 3, comment: 'x'.repeat(281) });
    assert.ok(long.body.error.details.comment);
    assert.ok((await rate(buyer, { stars: 3, comment: 7 })).body.error.details.comment);
  });

  it('only participants; nobody rates themselves', async () => {
    await say(buyer, conv); await say(seller, conv);
    assert.strictEqual((await request(app).put('/ratings/conversations/' + conv).send({ stars: 5 })).status, 401);
    assert.strictEqual((await rate(other, { stars: 1 })).status, 404);
    assert.strictEqual((await rate(admin, { stars: 1 })).status, 404);
    assert.strictEqual((await other.get('/ratings/conversations/' + conv)).status, 404);
    // A self-conversation can't exist (you can't message yourself), so a rating is always of the other person.
    await rate(buyer, { stars: 5 });
    const row = await models.Rating.findOne();
    assert.strictEqual(row.raterId, buyerId);
    assert.strictEqual(row.rateeId, sellerId);
    assert.notStrictEqual(row.raterId, row.rateeId);
  });

  it('blocked either way: no new ratings and no edits', async () => {
    await say(buyer, conv); await say(seller, conv);
    await rate(buyer, { stars: 2 });
    await seller.post('/conversations/' + conv + '/block');
    let s = await buyer.get('/ratings/conversations/' + conv);
    assert.deepStrictEqual([s.body.canRate, s.body.reason], [false, 'blocked']);
    assert.strictEqual((await rate(buyer, { stars: 1 })).body.error.code, 'blocked');
    assert.strictEqual((await rate(seller, { stars: 1 })).body.error.code, 'blocked');
    await seller.delete('/conversations/' + conv + '/block');
    await buyer.post('/conversations/' + conv + '/block');
    assert.strictEqual((await rate(buyer, { stars: 1 })).status, 403);
    // The existing rating stays (blocking can't be used to erase it).
    s = await request(app).get('/ratings/users/' + sellerId);
    assert.strictEqual(s.body.summary.count, 1);
  });

  it('shows average and count on the profile, post seller and conversations, without emails', async () => {
    await say(buyer, conv); await say(seller, conv);
    await rate(buyer, { stars: 5, comment: 'Great lamp' });
    const c2 = (await other.post('/conversations').send({ postId })).body.id;
    await say(other, c2); await say(seller, c2);
    await rate(other, { stars: 4 }, c2);
    const p = await request(app).get('/ratings/users/' + sellerId);
    assert.deepStrictEqual(p.body.user, { id: sellerId, name: 'Sam S.' });
    assert.deepStrictEqual(p.body.summary, { average: 4.5, count: 2 });
    assert.deepStrictEqual(p.body.distribution, { 1: 0, 2: 0, 3: 0, 4: 1, 5: 1 });
    assert.deepStrictEqual(p.body.ratings.map((r) => [r.stars, r.rater.name, r.raterRole]).sort(), [[4, 'Otto O.', 'buyer'], [5, 'Bea B.', 'buyer']]);
    assert.ok(!/@example\.com/.test(JSON.stringify(p.body)), 'no emails');
    const post = await request(app).get('/post/' + postId);
    assert.deepStrictEqual(post.body.seller, { id: sellerId, name: 'Sam S.', rating: { average: 4.5, count: 2 } });
    assert.ok(!/@example\.com/.test(JSON.stringify(post.body)));
    const list = await buyer.get('/conversations');
    assert.deepStrictEqual(list.body.results[0].otherRating, { average: 4.5, count: 2 });
    const none = await request(app).get('/ratings/users/' + buyerId);
    assert.deepStrictEqual(none.body.summary, { average: null, count: 0 });
    assert.strictEqual((await request(app).get('/ratings/users/9999')).status, 404);
  });

  it('ratings are reportable; admins remove abusive comments', async () => {
    await say(buyer, conv); await say(seller, conv);
    await rate(buyer, { stars: 1, comment: 'Total idiot' });
    const id = (await models.Rating.findOne()).id;
    assert.strictEqual((await request(app).post('/ratings/' + id + '/report').send({ reason: 'harassment' })).status, 401);
    assert.strictEqual((await buyer.post('/ratings/' + id + '/report').send({ reason: 'harassment' })).status, 403, 'not your own');
    assert.strictEqual((await seller.post('/ratings/' + id + '/report').send({ reason: 'nope' })).status, 400);
    const r = await seller.post('/ratings/' + id + '/report').send({ reason: 'harassment', note: 'Insulting' });
    assert.strictEqual(r.status, 201);
    assert.strictEqual((await seller.post('/ratings/' + id + '/report').send({ reason: 'harassment' })).status, 409);
    assert.strictEqual((await other.post('/ratings/' + id + '/report').send({ reason: 'offensive' })).status, 201);
    assert.strictEqual((await seller.get('/ratings/users/' + sellerId)).body.ratings[0].reportedByMe, true);
    // Admin queue.
    assert.strictEqual((await seller.get('/admin/ratings/reports')).status, 403);
    const q = await admin.get('/admin/ratings/reports');
    assert.strictEqual(q.body.openCount, 2);
    assert.strictEqual(q.body.groups[0].rating.comment, 'Total idiot');
    assert.strictEqual(q.body.groups[0].rater.email, 'bea@example.com');
    const m = await admin.post('/admin/ratings/' + id + '/moderate').send({ action: 'remove_comment', note: 'Abusive' });
    assert.strictEqual(m.status, 200, JSON.stringify(m.body));
    assert.strictEqual(m.body.resolved, 2);
    const pub = await request(app).get('/ratings/users/' + sellerId);
    assert.deepStrictEqual([pub.body.ratings[0].stars, pub.body.ratings[0].comment, pub.body.ratings[0].commentRemoved], [1, null, true]);
    assert.strictEqual((await admin.get('/admin/ratings/reports')).body.openCount, 0);
    const rep = await models.RatingReport.findAll();
    assert.ok(rep.every((x) => x.status === 'actioned' && x.action === 'comment_removed'));
    // The rater can still change stars but can't put a comment back.
    const lock = await rate(buyer, { stars: 2, comment: 'Still an idiot' });
    assert.strictEqual(lock.body.error.code, 'comment_locked');
    const ok = await rate(buyer, { stars: 2 });
    assert.strictEqual(ok.status, 200);
    assert.deepStrictEqual([ok.body.mine.stars, ok.body.mine.commentLocked], [2, true]);
  });

  it('admins can dismiss reports or remove a rating entirely', async () => {
    await say(buyer, conv); await say(seller, conv);
    await rate(buyer, { stars: 1, comment: 'Meh' });
    const id = (await models.Rating.findOne()).id;
    await seller.post('/ratings/' + id + '/report').send({ reason: 'fake' });
    const d = await admin.post('/admin/ratings/' + id + '/moderate').send({ action: 'dismiss' });
    assert.strictEqual(d.body.resolved, 1);
    assert.strictEqual((await models.Rating.findByPk(id)).comment, 'Meh');
    assert.strictEqual((await admin.post('/admin/ratings/' + id + '/moderate').send({ action: 'explode' })).status, 400);
    const rm = await admin.post('/admin/ratings/' + id + '/moderate').send({ action: 'remove_rating' });
    assert.strictEqual(rm.status, 200);
    assert.strictEqual(await models.Rating.count(), 0);
    assert.strictEqual((await admin.post('/admin/ratings/999/moderate').send({ action: 'dismiss' })).status, 404);
    // Removed rating can be given again (it no longer exists).
    assert.strictEqual((await rate(buyer, { stars: 3 })).status, 201);
  });
});
