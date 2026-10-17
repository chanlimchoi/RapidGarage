const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const alerts = require('../lib/alerts');
const wanted = require('../lib/wanted');
const mailer = require('../lib/mailer');
const schedule = require('../lib/schedule');
const { setSetting } = require('../lib/features');

const PW = 'correct-horse';
const C = { lat: 40.758, lng: -73.9855 };
const DAY = 86400000;
// "<n> mi St" geocodes n miles due north of C.
function fakeProvider(address) {
  const m = /([\d.]+) mi St/.exec(address);
  if (!m) return Promise.resolve({ status: 'not_found' });
  return Promise.resolve({ status: 'ok', lat: C.lat + Number(m[1]) / 69.0, lng: C.lng });
}
const ENV = ['WANTED_MAX_ACTIVE', 'WANTED_MAX_PER_DAY', 'ALERT_DIGEST_MINUTES', 'ALERT_DAILY_MAX_EMAILS', 'APP_BASE_URL', 'ENABLE_WANTED_POSTS', 'REPORT_AUTO_HIDE_THRESHOLD'];

describe('wanted posts', function () {
  this.timeout(30000);
  let bea, beaId, sam, samId, tom, tomId, admin, adminId, sent, now;

  async function user(email, firstName, lastName) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName, lastName });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return [agent, r.body.id];
  }
  const transport = { sendMail: async (msg) => { sent.push(msg); return { messageId: 'x' + sent.length }; } };
  const base = (extra) => Object.assign({ title: 'Kids bike', areaLabel: 'Hell\'s Kitchen', lat: C.lat, lng: C.lng, radiusMiles: 5 }, extra);
  async function want(agent, extra) {
    const r = await agent.post('/wanted').send(base(extra));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return r.body;
  }
  async function sale(agent, mi, extra) {
    const r = await agent.post('/post').send(Object.assign({ title: 'Moving sale', description: 'Lots of stuff', street: mi + ' mi St', city: 'New York', state: 'NY', zipCode: '10036' }, extra));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    await alerts.idle();
    return r.body;
  }
  async function item(agent, post, body) {
    const r = await agent.post('/post/' + post.id + '/items').send(body);
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    await alerts.idle();
    return r.body;
  }
  const matches = (where) => models.WantedMatch.findAll({ where: where || {}, order: [['id', 'ASC']], raw: true });
  const noEmails = (body) => assert.ok(!/@example\.com/.test(JSON.stringify(body)), 'no email address in ' + JSON.stringify(body).slice(0, 200));

  beforeEach(async () => {
    ENV.forEach((k) => delete process.env[k]);
    process.env.GOOGLE_MAPS_API_KEY = 'test-server-key';
    process.env.APP_BASE_URL = 'https://garage.example';
    process.env.ALERT_DIGEST_MINUTES = '0';
    geo.setProvider(fakeProvider);
    geo.resetRateLimits();
    sent = [];
    mailer.setTransport(transport);
    now = new Date();
    schedule.setClock(() => now);
    await models.sequelize.sync({ force: true });
    [bea, beaId] = await user('bea@example.com', 'Bea', 'Banks');
    [sam, samId] = await user('sam@example.com', 'Sam', 'Stone');
    [tom, tomId] = await user('tom@example.com', 'Tom', 'Tran');
    [admin, adminId] = await user('ada@example.com', 'Ada', 'Admin');
    await models.User.update({ role: 'admin' }, { where: { id: adminId } });
  });
  after(() => {
    ENV.forEach((k) => delete process.env[k]);
    delete process.env.GOOGLE_MAPS_API_KEY;
    geo.setProvider(null);
    mailer.setTransport(null);
    schedule.setClock(null);
  });

  describe('posting', () => {
    it('requires login and validates the fields', async () => {
      assert.strictEqual((await request(app).post('/wanted').send(base())).status, 401);
      assert.strictEqual((await request(app).get('/wanted/mine')).status, 401);
      const bad = await bea.post('/wanted').send({ title: 'x', areaLabel: '', radiusMiles: 99, maxPriceCents: -1, category: 'boats', days: 91 });
      assert.strictEqual(bad.status, 400);
      ['title', 'areaLabel', 'radiusMiles', 'maxPriceCents', 'category', 'days', 'location'].forEach((k) => assert.ok(bad.body.error.details[k], k));
      const stop = await bea.post('/wanted').send(base({ title: 'Looking for any' }));
      assert.strictEqual(stop.status, 400);
      assert.ok(stop.body.error.details.keywords);
      assert.strictEqual((await bea.post('/wanted').send(base({ maxPriceCents: 12.5 }))).status, 400);
    });

    it('creates with defaults: 30-day expiry, rounded public point, "First L.", no email', async () => {
      const w = await want(bea, { keywords: 'Bikes, kids', category: 'sports', maxPriceCents: 4000, details: '20 inch is perfect' });
      assert.strictEqual(w.status, 'active');
      assert.deepStrictEqual(w.keywords, ['bike', 'kid']);
      assert.deepStrictEqual(w.matchWords, ['bike', 'kid']);
      assert.strictEqual(Math.round((new Date(w.expiresAt) - now) / DAY), 30);
      assert.deepStrictEqual(w.approx, { lat: 40.76, lng: -73.99 });
      assert.strictEqual(w.lat, undefined);
      assert.strictEqual(w.poster.name, 'Bea B.');
      assert.strictEqual(w.mine, true);
      assert.strictEqual(w.emailEnabled, true);
      noEmails(w);
      const pub = await request(app).get('/wanted/' + w.id);
      assert.strictEqual(pub.status, 200);
      assert.strictEqual(pub.body.emailEnabled, undefined);
      assert.strictEqual(pub.body.hidden, undefined);
      assert.strictEqual(pub.body.matches, undefined);
      assert.strictEqual(pub.body.canContact, false);
      const ninety = await want(bea, { title: 'Desk', days: 90 });
      assert.strictEqual(Math.round((new Date(ninety.expiresAt) - now) / DAY), 90);
    });

    it('geocodes an address like sale alerts (and never stores it)', async () => {
      const r = await bea.post('/wanted').send({ title: 'Guitar', areaLabel: 'Midtown', address: '2 mi St, New York', radiusMiles: 3 });
      assert.strictEqual(r.status, 201, JSON.stringify(r.body));
      const row = await models.WantedPost.findByPk(r.body.id, { raw: true });
      assert.ok(Math.abs(row.lat - (C.lat + 2 / 69)) < 1e-9);
      assert.ok(!JSON.stringify(row).includes('mi St'));
      const nf = await bea.post('/wanted').send({ title: 'Guitar', areaLabel: 'Midtown', address: 'nowhere', radiusMiles: 3 });
      assert.strictEqual(nf.status, 400);
    });

    it('caps active wanted posts per user; found and expired ones do not count', async () => {
      process.env.WANTED_MAX_ACTIVE = '2';
      const a = await want(bea, { title: 'Lamp' });
      const b = await want(bea, { title: 'Rug' });
      const full = await bea.post('/wanted').send(base({ title: 'Mirror' }));
      assert.strictEqual(full.status, 409);
      assert.strictEqual(full.body.error.code, 'limit_reached');
      assert.strictEqual((await bea.post('/wanted/' + a.id + '/fulfill')).body.status, 'fulfilled');
      await want(bea, { title: 'Mirror' });
      // Reopening a found one would go over the cap.
      assert.strictEqual((await bea.post('/wanted/' + a.id + '/renew').send({ days: 10 })).status, 409);
      await models.WantedPost.update({ expiresAt: new Date(now.getTime() - 1000) }, { where: { id: b.id } });
      await want(bea, { title: 'Vase' });
      const mine = await bea.get('/wanted/mine');
      assert.deepStrictEqual(mine.body.results.map((w) => w.status).sort(), ['active', 'active', 'expired', 'fulfilled']);
      assert.strictEqual(mine.body.limits.maxActive, 2);
      assert.strictEqual(mine.body.limits.active, 2);
    });

    it('owners edit, renew (max 90 days), mark found and delete; others cannot', async () => {
      const w = await want(bea);
      assert.strictEqual((await sam.put('/wanted/' + w.id).send({ title: 'Mine now' })).status, 403);
      assert.strictEqual((await sam.post('/wanted/' + w.id + '/renew')).status, 403);
      assert.strictEqual((await sam.post('/wanted/' + w.id + '/fulfill')).status, 403);
      assert.strictEqual((await sam.delete('/wanted/' + w.id)).status, 403);
      const e = await bea.put('/wanted/' + w.id).send({ title: 'Kids scooter', keywords: '', maxPriceCents: 2500, radiusMiles: 10, emailEnabled: false });
      assert.strictEqual(e.status, 200, JSON.stringify(e.body));
      assert.strictEqual(e.body.title, 'Kids scooter');
      assert.deepStrictEqual(e.body.matchWords, ['kid', 'scooter']);
      assert.strictEqual(e.body.emailEnabled, false);
      assert.strictEqual((await bea.put('/wanted/' + w.id).send({ days: 5 })).status, 400);
      assert.strictEqual((await bea.post('/wanted/' + w.id + '/renew').send({ days: 91 })).status, 400);
      now = new Date(now.getTime() + 40 * DAY);
      assert.strictEqual((await bea.get('/wanted/' + w.id)).body.status, 'expired');
      const r = await bea.post('/wanted/' + w.id + '/renew').send({ days: 90 });
      assert.strictEqual(r.body.status, 'active');
      assert.strictEqual(Math.round((new Date(r.body.expiresAt) - now) / DAY), 90);
      assert.strictEqual((await bea.post('/wanted/' + w.id + '/fulfill')).body.status, 'fulfilled');
      assert.strictEqual((await bea.post('/wanted/' + w.id + '/renew')).body.status, 'active');
      assert.strictEqual((await bea.delete('/wanted/' + w.id)).status, 204);
      assert.strictEqual((await bea.get('/wanted/' + w.id)).status, 404);
    });
  });

  describe('board', () => {
    it('lists open wanted posts only, with search, category and area filters', async () => {
      const bike = await want(bea, { category: 'sports', details: 'blue please' });
      const desk = await want(tom, { title: 'Standing desk', category: 'furniture', lat: C.lat + 30 / 69 });
      const found = await want(tom, { title: 'Old radio' });
      await tom.post('/wanted/' + found.id + '/fulfill');
      const expired = await want(tom, { title: 'Camera' });
      await models.WantedPost.update({ expiresAt: new Date(now.getTime() - 1) }, { where: { id: expired.id } });
      const all = await request(app).get('/wanted');
      assert.strictEqual(all.status, 200);
      assert.strictEqual(all.body.enabled, true);
      assert.deepStrictEqual(all.body.results.map((w) => w.id), [desk.id, bike.id]);
      noEmails(all.body);
      assert.deepStrictEqual(all.body.results.map((w) => w.poster.name), ['Tom T.', 'Bea B.']);
      assert.deepStrictEqual((await request(app).get('/wanted?q=blue')).body.results.map((w) => w.id), [bike.id]);
      assert.deepStrictEqual((await request(app).get('/wanted?q=desks')).body.results.map((w) => w.id), [desk.id]);
      assert.deepStrictEqual((await request(app).get('/wanted?category=furniture')).body.results.map((w) => w.id), [desk.id]);
      assert.strictEqual((await request(app).get('/wanted?category=boats')).status, 400);
      const near = await request(app).get('/wanted?lat=' + C.lat + '&lng=' + C.lng + '&radius=10');
      assert.deepStrictEqual(near.body.results.map((w) => w.id), [bike.id]);
      assert.ok(near.body.results[0].distanceMiles < 1);
      assert.strictEqual((await request(app).get('/wanted?lat=1&lng=2&radius=7')).status, 400);
    });

    it('hides wanted posts between people who blocked each other (either way)', async () => {
      const w = await want(bea);
      await models.UserBlock.create({ blockerId: beaId, blockedId: samId });
      assert.deepStrictEqual((await sam.get('/wanted')).body.results, []);
      assert.strictEqual((await tom.get('/wanted')).body.results.length, 1);
      const page = await sam.get('/wanted/' + w.id);
      assert.strictEqual(page.body.blocked, true);
      assert.strictEqual(page.body.canContact, false);
    });
  });

  describe('matching', () => {
    it('a new sale that matches words, price and area is recorded once and emailed once', async () => {
      const w = await want(bea, { maxPriceCents: 3000 });
      await sale(sam, 1, { title: 'Kids bikes and toys', priceMin: 10, priceMax: 40 });
      await sale(sam, 1, { title: 'Kids bike', priceMin: 50 }); // too expensive
      await sale(sam, 9, { title: 'Kids bike', priceMin: 5 }); // outside 5 mi
      await sale(sam, 1, { title: 'Bike rack', priceMin: 5 }); // not every word
      const m = await matches();
      assert.strictEqual(m.length, 1);
      assert.strictEqual(m[0].wantedId, w.id);
      assert.strictEqual(m[0].status, 'pending');
      assert.strictEqual(m[0].itemId, null);
      // Editing the sale does not tell her again.
      const postId = m[0].postId;
      await sam.put('/post/' + postId).send({ description: 'Kids bike, helmet' });
      await alerts.idle();
      assert.strictEqual((await matches()).length, 1);
      const s = await alerts.processQueue();
      assert.strictEqual(s.wanted.emails, 1);
      assert.strictEqual(sent.length, 1);
      const mail = sent[0];
      assert.strictEqual(mail.to, 'bea@example.com');
      assert.strictEqual(mail.subject, 'A sale has something you want: Kids bike');
      assert.ok(mail.text.includes('https://garage.example/post/' + postId));
      assert.ok(mail.text.includes('Sam S.'));
      assert.ok(!mail.text.includes('sam@example.com') && !mail.html.includes('sam@example.com'));
      assert.ok(/\/alerts\/unsubscribe\?w=\d+&t=/.test(mail.text));
      assert.ok(/^<https:\/\/garage\.example\/api\/wanted\/unsubscribe\?w=/.test(mail.headers['List-Unsubscribe']));
      assert.strictEqual((await alerts.processQueue()).wanted.emails, 0, 'nothing sent twice');
      assert.strictEqual((await models.AlertDigest.findOne({ raw: true })).kind, 'wanted');
    });

    it('matches sale items by name and price in cents, including items added later', async () => {
      await want(bea, { title: 'Road bike', maxPriceCents: 2550, category: 'sports' });
      const post = await sale(sam, 1, { title: 'Garage sale' });
      assert.strictEqual((await matches()).length, 0);
      await item(sam, post, { name: 'Road bike helmet', price: '30' }); // over the max
      await item(sam, post, { name: 'Road bike', price: '' }); // no price: can't tell
      assert.strictEqual((await matches()).length, 0);
      const it = await item(sam, post, { name: 'Vintage road bike', price: '25.50' });
      const m = await matches();
      assert.strictEqual(m.length, 1);
      assert.strictEqual(m[0].itemId, it.id);
      await alerts.processQueue();
      assert.ok(sent[0].text.includes('Item: Vintage road bike $25.50'), sent[0].text);
    });

    it('category narrows a match', async () => {
      await want(bea, { title: 'Table', category: 'kitchen' });
      await sale(sam, 1, { title: 'Table saw', description: 'Tools' });
      assert.strictEqual((await matches()).length, 0);
      await sale(sam, 1, { title: 'Kitchen table', description: 'Dishes too' });
      assert.strictEqual((await matches()).length, 1);
    });

    it('skips own sales, blocked sellers, closed wanted posts, hidden sales until unhidden', async () => {
      const w = await want(bea);
      await sale(bea, 1, { title: 'Kids bike' });
      await models.UserBlock.create({ blockerId: samId, blockedId: beaId });
      await sale(sam, 1, { title: 'Kids bike' });
      assert.strictEqual((await matches()).length, 0);
      const t2 = await want(tom, { title: 'Kids bike' });
      await tom.post('/wanted/' + t2.id + '/fulfill');
      const hiddenSale = await sale(admin, 1, { title: 'Moving' });
      await models.Post.update({ hidden: true }, { where: { id: hiddenSale.id } });
      await admin.put('/post/' + hiddenSale.id).send({ title: 'Kids bike' });
      await alerts.idle();
      assert.strictEqual((await matches({ wantedId: w.id })).length, 0);
      const un = await admin.post('/admin/posts/' + hiddenSale.id + '/moderate').send({ action: 'unhide' });
      assert.strictEqual(un.status, 200);
      await alerts.idle();
      const m = await matches({ wantedId: w.id });
      assert.deepStrictEqual(m.map((r) => [r.wantedId, r.postId]), [[w.id, hiddenSale.id]]);
      // Tom's found post never matched anything new; his back-filled list is in-app only.
      assert.ok((await matches({ wantedId: t2.id })).every((r) => r.status === 'skipped'));
    });

    it('lists sales that already match when posting (in the app, without email)', async () => {
      const p = await sale(sam, 1, { title: 'Kids bike sale' });
      await sale(sam, 20, { title: 'Kids bike sale' });
      const w = await want(bea);
      assert.strictEqual(w.matches.length, 1);
      assert.strictEqual(w.matches[0].post.id, p.id);
      assert.strictEqual(w.matches[0].post.seller.name, 'Sam S.');
      noEmails(w.matches);
      assert.strictEqual((await matches())[0].status, 'skipped');
      await alerts.processQueue();
      assert.strictEqual(sent.length, 0);
    });

    it('in-app: new matches show on the nav count until the buyer opens the wanted post', async () => {
      const w = await want(bea);
      await sale(sam, 1, { title: 'Kids bike' });
      await sale(tom, 2, { title: 'kids BIKE!' });
      assert.strictEqual((await bea.get('/conversations/unread')).body.wantedMatches, 2);
      assert.strictEqual((await bea.get('/wanted/mine')).body.results[0].newMatches, 2);
      const page = await bea.get('/wanted/' + w.id);
      assert.strictEqual(page.body.matches.length, 2);
      assert.ok(page.body.matches.every((x) => x.isNew));
      assert.strictEqual((await bea.get('/conversations/unread')).body.wantedMatches, 0);
      // A match whose sale is later hidden drops out of the list.
      await models.Post.update({ hidden: true }, { where: { userId: tomId } });
      assert.strictEqual((await bea.get('/wanted/' + w.id)).body.matches.length, 1);
    });

    it('email off: matches still show in the app but are not emailed', async () => {
      const w = await want(bea, { emailEnabled: false });
      await sale(sam, 1, { title: 'Kids bike' });
      assert.strictEqual((await matches())[0].lastError, 'email_off');
      await alerts.processQueue();
      assert.strictEqual(sent.length, 0);
      assert.strictEqual((await bea.get('/wanted/' + w.id)).body.matches.length, 1);
    });

    it('shares the alert digest interval and daily cap', async () => {
      process.env.ALERT_DIGEST_MINUTES = '15';
      await want(bea);
      await models.AlertDigest.create({ userId: beaId, postCount: 1, sentAt: new Date(), kind: 'alert' });
      await sale(sam, 1, { title: 'Kids bike' });
      const s = await alerts.processQueue();
      assert.strictEqual(s.wanted.deferred, 1);
      assert.strictEqual(sent.length, 0);
      process.env.ALERT_DIGEST_MINUTES = '0';
      process.env.ALERT_DAILY_MAX_EMAILS = '1';
      assert.strictEqual((await alerts.processQueue()).wanted.deferred, 1);
      process.env.ALERT_DAILY_MAX_EMAILS = '2';
      assert.strictEqual((await alerts.processQueue()).wanted.emails, 1);
    });

    it('without SMTP: logs and skips (the match still shows in the app)', async () => {
      mailer.setTransport(null);
      const w = await want(bea);
      await sale(sam, 1, { title: 'Kids bike' });
      const s = await alerts.processQueue();
      assert.strictEqual(s.wanted.reason, 'smtp_not_configured');
      assert.strictEqual((await matches())[0].lastError, 'smtp_not_configured');
      assert.strictEqual((await bea.get('/wanted/' + w.id)).body.matches.length, 1);
    });

    it('signed unsubscribe link turns email off; bad tokens get one answer', async () => {
      const w = await want(bea);
      const t = wanted.unsubscribeToken(w);
      const bad = await request(app).post('/wanted/unsubscribe').send({ w: w.id, t: t.slice(0, -2) + 'AA' });
      assert.strictEqual(bad.status, 400);
      assert.strictEqual((await request(app).post('/wanted/unsubscribe').send({ w: 999, t })).status, 400);
      // An alert's token for the same id is not a wanted token.
      assert.strictEqual((await request(app).post('/wanted/unsubscribe').send({ w: w.id, t: alerts.unsubscribeToken(w.id) })).status, 400);
      const ok = await request(app).post('/wanted/unsubscribe?w=' + w.id + '&t=' + encodeURIComponent(t)).type('form').send('List-Unsubscribe=One-Click');
      assert.strictEqual(ok.status, 200);
      assert.strictEqual(ok.body.wanted.emailEnabled, false);
      assert.strictEqual((await models.WantedPost.findByPk(w.id)).emailEnabled, false);
    });
  });

  describe('contacting the buyer', () => {
    it('a seller messages the wanted post\'s author; the author sees it once sent', async () => {
      const w = await want(bea);
      const c = await sam.post('/conversations').send({ wantedId: w.id });
      assert.strictEqual(c.status, 201, JSON.stringify(c.body));
      assert.strictEqual((await sam.post('/conversations').send({ wantedId: w.id })).body.id, c.body.id);
      const conv = await models.Conversation.findByPk(c.body.id);
      assert.strictEqual(conv.buyerId, beaId);
      assert.strictEqual(conv.sellerId, samId);
      assert.strictEqual(conv.postId, null);
      assert.strictEqual((await sam.get('/conversations')).body.results.length, 1);
      assert.strictEqual((await bea.get('/conversations')).body.results.length, 0);
      assert.strictEqual((await sam.post('/conversations/' + c.body.id + '/messages').send({ body: 'I have one, 20 inch.' })).status, 201);
      const list = await bea.get('/conversations');
      assert.strictEqual(list.body.results.length, 1);
      const s = list.body.results[0];
      assert.strictEqual(s.role, 'buyer');
      assert.deepStrictEqual(s.post, { id: w.id, wanted: true, title: 'Kids bike', status: 'available', canView: true, thumbUrl: null });
      assert.strictEqual(s.other.name, 'Sam S.');
      noEmails(list.body);
      assert.strictEqual((await bea.get('/conversations/unread')).body.count, 1);
      const one = await bea.get('/conversations/' + c.body.id);
      assert.strictEqual(one.body.conversation.post.wanted, true);
      // No holds in a wanted conversation.
      const h = await sam.get('/conversations/' + c.body.id + '/holds');
      assert.strictEqual(h.status, 200);
      assert.strictEqual(h.body.canRequest, false);
      assert.strictEqual((await bea.get('/wanted/' + w.id)).status, 200);
      assert.strictEqual((await sam.get('/wanted/' + w.id)).body.conversationId, c.body.id);
    });

    it('no new conversations for own, blocked, hidden, expired or found wanted posts', async () => {
      const w = await want(bea);
      assert.strictEqual((await bea.post('/conversations').send({ wantedId: w.id })).status, 403);
      assert.strictEqual((await sam.post('/conversations').send({ wantedId: 'x' })).status, 400);
      assert.strictEqual((await sam.post('/conversations').send({ wantedId: 999 })).status, 404);
      await models.UserBlock.create({ blockerId: beaId, blockedId: tomId });
      assert.strictEqual((await tom.post('/conversations').send({ wantedId: w.id })).body.error.code, 'blocked');
      const existing = await sam.post('/conversations').send({ wantedId: w.id });
      assert.strictEqual(existing.status, 201);
      await models.WantedPost.update({ expiresAt: new Date(now.getTime() - 1) }, { where: { id: w.id } });
      const [, eveId] = await user('eve@example.com', 'Eve', 'Ng');
      const eve = request.agent(app);
      await eve.post('/login').send({ email: 'eve@example.com', password: PW });
      assert.ok(eveId);
      const late = await eve.post('/conversations').send({ wantedId: w.id });
      assert.strictEqual(late.status, 409);
      assert.strictEqual(late.body.error.code, 'wanted_closed');
      // Already talking: still reachable.
      assert.strictEqual((await sam.post('/conversations').send({ wantedId: w.id })).status, 200);
      await bea.post('/wanted/' + w.id + '/renew');
      await bea.post('/wanted/' + w.id + '/fulfill');
      assert.strictEqual((await eve.post('/conversations').send({ wantedId: w.id })).body.error.code, 'wanted_closed');
      await bea.post('/wanted/' + w.id + '/renew');
      await admin.post('/admin/wanted/' + w.id + '/moderate').send({ action: 'hide' });
      assert.strictEqual((await eve.post('/conversations').send({ wantedId: w.id })).status, 404);
    });
  });

  describe('reports and moderation', () => {
    it('reports like posts; admins hide, unhide and delete; queue shows names only', async () => {
      const w = await want(bea, { details: 'Selling fake tickets' });
      assert.strictEqual((await bea.post('/wanted/' + w.id + '/report').send({ reason: 'spam' })).status, 403);
      assert.strictEqual((await sam.post('/wanted/' + w.id + '/report').send({ reason: 'nope' })).status, 400);
      assert.strictEqual((await sam.post('/wanted/' + w.id + '/report').send({ reason: 'scam', note: 'Asks for gift cards' })).status, 201);
      assert.strictEqual((await sam.post('/wanted/' + w.id + '/report').send({ reason: 'scam' })).status, 409);
      assert.strictEqual((await sam.get('/wanted/' + w.id)).body.reportedByMe, true);
      assert.strictEqual((await sam.get('/admin/wanted/reports')).status, 403);
      const q = await admin.get('/admin/wanted/reports');
      assert.strictEqual(q.status, 200);
      assert.strictEqual(q.body.groups.length, 1);
      assert.strictEqual(q.body.groups[0].reports[0].reporter.name, 'Sam S.');
      assert.strictEqual(q.body.groups[0].wanted.poster.name, 'Bea B.');
      noEmails(q.body);
      const hide = await admin.post('/admin/wanted/' + w.id + '/moderate').send({ action: 'hide', note: 'scam' });
      assert.strictEqual(hide.status, 200);
      assert.strictEqual(hide.body.resolved, 1);
      assert.deepStrictEqual((await request(app).get('/wanted')).body.results, []);
      assert.strictEqual((await sam.get('/wanted/' + w.id)).status, 404);
      const own = await bea.get('/wanted/' + w.id);
      assert.strictEqual(own.body.hidden, true);
      assert.strictEqual(own.body.hiddenSource, 'moderator');
      await sale(sam, 1, { title: 'Kids bike' });
      assert.strictEqual((await matches()).length, 0, 'hidden wanted posts do not match');
      const q2 = await admin.get('/admin/wanted/reports');
      assert.deepStrictEqual(q2.body.hidden.map((x) => x.id), [w.id]);
      await admin.post('/admin/wanted/' + w.id + '/moderate').send({ action: 'unhide' });
      assert.strictEqual((await request(app).get('/wanted')).body.results.length, 1);
      const del = await admin.post('/admin/wanted/' + w.id + '/moderate').send({ action: 'delete' });
      assert.strictEqual(del.body.wanted, null);
      assert.strictEqual(await models.WantedPost.count(), 0);
      const w2 = await want(tom, { title: 'Desk' });
      assert.strictEqual((await admin.delete('/wanted/' + w2.id)).status, 204);
    });

    it('optional auto-hide after N distinct reporters, same as posts', async () => {
      process.env.REPORT_AUTO_HIDE_THRESHOLD = '2';
      const w = await want(bea);
      await sam.post('/wanted/' + w.id + '/report').send({ reason: 'spam' });
      assert.strictEqual((await models.WantedPost.findByPk(w.id)).hidden, false);
      await tom.post('/wanted/' + w.id + '/report').send({ reason: 'spam' });
      const row = await models.WantedPost.findByPk(w.id);
      assert.strictEqual(row.hidden, true);
      assert.strictEqual(row.hiddenSource, 'auto');
    });

    it('wanted reports share the hourly report budget with other reports', async () => {
      process.env.REPORT_MAX_PER_HOUR = '1';
      try {
        const w = await want(bea);
        const p = await sale(bea, 1, { title: 'Lamp' });
        assert.strictEqual((await sam.post('/post/' + p.id + '/report').send({ reason: 'spam' })).status, 201);
        assert.strictEqual((await sam.post('/wanted/' + w.id + '/report').send({ reason: 'spam' })).status, 429);
      } finally { delete process.env.REPORT_MAX_PER_HOUR; }
    });
  });

  describe('admin switch', () => {
    it('turning wanted posts off empties the board and stops posting, contacting and matching', async () => {
      const w = await want(bea);
      await setSetting('wantedPosts', false);
      assert.strictEqual((await request(app).get('/config')).body.wantedPosts, false);
      const board = await request(app).get('/wanted');
      assert.deepStrictEqual([board.body.enabled, board.body.results], [false, []]);
      assert.strictEqual((await bea.post('/wanted').send(base({ title: 'Lamp' }))).body.error.code, 'feature_disabled');
      assert.strictEqual((await sam.get('/wanted/' + w.id)).status, 404);
      assert.strictEqual((await bea.get('/wanted/' + w.id)).status, 200, 'the owner can still manage it');
      assert.strictEqual((await sam.post('/conversations').send({ wantedId: w.id })).body.error.code, 'feature_disabled');
      await sale(sam, 1, { title: 'Kids bike' });
      assert.strictEqual((await matches()).length, 0);
      await setSetting('wantedPosts', true);
      await models.WantedMatch.create({ wantedId: w.id, userId: beaId, postId: 1, status: 'pending' });
      await setSetting('wantedPosts', false);
      const s = await alerts.processQueue();
      assert.strictEqual(s.wanted.reason, 'wanted_disabled');
      assert.strictEqual(sent.length, 0);
    });
  });

  describe('matching rules (unit)', () => {
    it('words: stop words dropped, plurals folded, max 5, CJK kept', () => {
      assert.deepStrictEqual(wanted.wordsOf("Looking for a kid's bikes, 20 inch!"), ['kid', 'bike', '20', 'inch']);
      assert.deepStrictEqual(wanted.wordsOf('유아용 자전거'), ['유아용', '자전거']);
      assert.deepStrictEqual(wanted.wordsOf('a b c d e f g h i j').length, 0);
      assert.strictEqual(wanted.wordsOf('one two three four five six seven').length, 5);
      assert.deepStrictEqual(wanted.wordsOf('glass'), ['glass']);
    });
    it('sale price rule in cents mirrors the search price filter', () => {
      assert.ok(wanted.salePriceFits({ isFree: true }, 0));
      assert.ok(wanted.salePriceFits({ priceMin: 5 }, 500));
      assert.ok(!wanted.salePriceFits({ priceMin: 5 }, 499));
      assert.ok(wanted.salePriceFits({ priceMin: null, priceMax: 50 }, 100));
      assert.ok(!wanted.salePriceFits({ priceMin: null, priceMax: null }, 100));
      assert.ok(wanted.salePriceFits({}, null));
    });
    it('sold items never match', () => {
      const w = { title: 'Crib' };
      assert.strictEqual(wanted.matchSale(w, { title: 'Sale' }, [{ id: 1, name: 'Crib', sold: true }]), null);
      assert.deepStrictEqual(wanted.matchSale(w, { title: 'Sale' }, [{ id: 1, name: 'Crib', sold: false }]), { itemId: 1 });
    });
  });
});
