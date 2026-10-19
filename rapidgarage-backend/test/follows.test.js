const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const alerts = require('../lib/alerts');
const follows = require('../lib/follows');
const mailer = require('../lib/mailer');

const PW = 'correct-horse';
const ENV = ['APP_BASE_URL', 'ALERT_DIGEST_MINUTES', 'FOLLOWS_MAX_PER_USER'];

describe('following sellers', function () {
  this.timeout(30000);
  let buyer, seller, other, buyerId, sellerId, otherId, sent;
  const transport = { sendMail: async (msg) => { sent.push(msg); return { messageId: 'x' }; } };

  async function user(email, firstName, lastName, extra) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send(Object.assign({ email, password: PW, firstName, lastName }, extra));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return [agent, r.body.id];
  }
  async function publish(agent, title) {
    const r = await agent.post('/post').send({ title, city: 'Austin', state: 'TX', zipCode: '78701' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    await alerts.idle();
    return r.body;
  }

  beforeEach(async () => {
    ENV.forEach((k) => delete process.env[k]);
    process.env.APP_BASE_URL = 'https://garage.example';
    process.env.ALERT_DIGEST_MINUTES = '0';
    sent = [];
    mailer.setTransport(transport);
    await models.sequelize.sync({ force: true });
    [buyer, buyerId] = await user('buyer@example.com', 'Bea', 'Buyer');
    [seller, sellerId] = await user('seller@example.com', 'Sam', 'Seller');
    [other, otherId] = await user('other@example.com', 'Oli', 'Other');
  });
  after(() => {
    ENV.forEach((k) => delete process.env[k]);
    mailer.setTransport(null);
  });

  it('follows, reports status, lists and unfollows', async () => {
    assert.deepStrictEqual((await request(app).get('/follows/' + sellerId)).body, { following: false, notify: false, followers: 0 });
    const r = await buyer.put('/follows/' + sellerId).send({});
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body, { following: true, notify: true, followers: 1 });
    // Idempotent, and notify can be switched.
    assert.deepStrictEqual((await buyer.put('/follows/' + sellerId).send({ notify: false })).body, { following: true, notify: false, followers: 1 });
    assert.strictEqual((await request(app).get('/follows/' + sellerId)).body.followers, 1);

    await publish(seller, 'Big sale');
    const list = await buyer.get('/follows');
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.body.results.length, 1);
    assert.deepStrictEqual(list.body.results[0].seller, { id: sellerId, name: 'Sam S.' });
    assert.strictEqual(list.body.results[0].currentSales, 1);
    assert.ok(!JSON.stringify(list.body).includes('seller@example.com'), 'never exposes emails');

    assert.deepStrictEqual((await buyer.delete('/follows/' + sellerId)).body, { following: false, notify: false, followers: 0 });
    assert.deepStrictEqual((await buyer.get('/follows')).body.results, []);
  });

  it('validates', async () => {
    assert.strictEqual((await request(app).put('/follows/' + sellerId).send({})).status, 401);
    assert.strictEqual((await request(app).get('/follows')).status, 401);
    assert.strictEqual((await buyer.put('/follows/' + buyerId).send({})).status, 400);
    assert.strictEqual((await buyer.put('/follows/99999').send({})).status, 404);
    assert.strictEqual((await buyer.put('/follows/abc').send({})).status, 404);
    assert.strictEqual((await buyer.put('/follows/' + sellerId).send({ notify: 'yes' })).status, 400);
    process.env.FOLLOWS_MAX_PER_USER = '1';
    assert.strictEqual((await buyer.put('/follows/' + sellerId).send({})).status, 200);
    assert.strictEqual((await buyer.put('/follows/' + otherId).send({})).status, 409);
  });

  it('feeds only followed sellers\' current sales into /allPosts?following=1', async () => {
    await publish(seller, 'Followed sale');
    await publish(other, 'Someone else');
    assert.strictEqual((await request(app).get('/allPosts?following=1')).status, 401);
    assert.deepStrictEqual((await buyer.get('/allPosts?following=1')).body, []);
    await buyer.put('/follows/' + sellerId).send({});
    const feed = await buyer.get('/allPosts?following=1');
    assert.deepStrictEqual(feed.body.map((p) => p.title), ['Followed sale']);
    assert.strictEqual((await buyer.get('/allPosts?following=maybe')).status, 400);
  });

  it('emails followers about new sales, with a working one-click stop link', async () => {
    await buyer.put('/follows/' + sellerId).send({});
    await other.put('/follows/' + sellerId).send({ notify: false });
    const post = await publish(seller, 'Vintage tools');
    await alerts.processQueue();
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].to, 'buyer@example.com');
    assert.strictEqual(sent[0].subject, 'Sam S. posted a new sale: Vintage tools');
    assert.ok(sent[0].text.includes('https://garage.example/post/' + post.id));
    assert.ok(!sent[0].text.includes('seller@example.com'));

    const m = /alerts\/unsubscribe\?f=(\d+)&t=([^\s]+)/.exec(sent[0].text);
    assert.ok(m, sent[0].text);
    assert.strictEqual((await request(app).post('/follows/unsubscribe').send({ f: m[1], t: 'x'.repeat(43) })).status, 400);
    const off = await request(app).post('/follows/unsubscribe').send({ f: m[1], t: decodeURIComponent(m[2]) });
    assert.strictEqual(off.status, 200);
    assert.deepStrictEqual(off.body.seller, { id: sellerId, name: 'Sam S.' });
    assert.strictEqual((await buyer.get('/follows/' + sellerId)).body.notify, false);

    await publish(seller, 'Another one');
    await alerts.processQueue();
    assert.strictEqual(sent.length, 1, 'no more emails after stopping');
    // Edits don't notify.
    await buyer.put('/follows/' + sellerId).send({ notify: true });
    await seller.put('/post/' + post.id).send({ title: 'Vintage tools (more added)' });
    await alerts.idle();
    await alerts.processQueue();
    assert.strictEqual(sent.length, 1);
  });

  it('writes the email in the follower\'s language and bundles several sales', async () => {
    const [es] = await user('es@example.com', 'Eva', 'E', { locale: 'es' });
    await es.put('/follows/' + sellerId).send({});
    await es.put('/follows/' + otherId).send({});
    await publish(seller, 'Uno');
    await publish(other, 'Dos');
    await alerts.processQueue();
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].subject, '2 ventas nuevas de personas que sigues');
    assert.strictEqual(sent[0].headers['Content-Language'], 'es');
  });

  it('blocking ends following both ways and is refused afterwards', async () => {
    await buyer.put('/follows/' + sellerId).send({});
    const post = await publish(seller, 'Sale');
    const conv = await buyer.post('/conversations').send({ postId: post.id });
    assert.ok([200, 201].includes(conv.status), JSON.stringify(conv.body));
    assert.strictEqual((await seller.post('/conversations/' + conv.body.id + '/block')).status, 200);
    assert.strictEqual((await buyer.get('/follows/' + sellerId)).body.following, false);
    assert.strictEqual((await buyer.put('/follows/' + sellerId).send({})).status, 403);
    assert.strictEqual(await follows.enqueueForPost(post), 0);
  });

  it('skips queued emails for hidden or deleted sales', async () => {
    await buyer.put('/follows/' + sellerId).send({});
    const post = await publish(seller, 'Soon hidden');
    await models.Post.update({ hidden: true }, { where: { id: post.id } });
    await alerts.processQueue();
    assert.strictEqual(sent.length, 0);
    const row = await models.FollowNotification.findOne();
    assert.strictEqual(row.status, 'skipped');
    assert.strictEqual(row.lastError, 'post_hidden');
  });
});
