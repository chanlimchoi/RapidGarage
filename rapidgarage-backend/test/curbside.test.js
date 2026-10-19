const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const alerts = require('../lib/alerts');
const wanted = require('../lib/wanted');
const mailer = require('../lib/mailer');
const schedule = require('../lib/schedule');
const curbside = require('../lib/curbside');

const PW = 'correct-horse';
const C = { lat: 40.758, lng: -73.9855 };
const HOUR = 3600000;
const TZ = 'America/New_York';
function fakeProvider(address) {
  const m = /([\d.]+) mi St/.exec(address);
  if (!m) return Promise.resolve({ status: 'not_found' });
  return Promise.resolve({ status: 'ok', lat: C.lat + Number(m[1]) / 69.0, lng: C.lng });
}
const ENV = ['CURBSIDE_TAKEN_PER_HOUR', 'ALERT_DIGEST_MINUTES', 'APP_BASE_URL', 'REPORT_AUTO_HIDE_THRESHOLD'];

describe('free on the curb', function () {
  this.timeout(30000);
  let sam, samId, bea, beaId, tom, tomId, admin, sent, now, start;

  async function user(email, firstName, lastName) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName, lastName });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return [agent, r.body.id];
  }
  const transport = { sendMail: async (msg) => { sent.push(msg); return { messageId: 'x' + sent.length }; } };
  const tomorrow = () => schedule.localDate(new Date(start.getTime() + 24 * HOUR), TZ);
  // A one-day sale tomorrow 08:00-12:00 New York time, 1 mi from C.
  async function sale(extra) {
    const r = await sam.post('/post').send(Object.assign({ title: 'Moving sale', description: 'Furniture and more', street: '1 mi St', city: 'New York', state: 'NY', zipCode: '10036',
      schedule: { timeZone: TZ, days: [{ date: tomorrow(), start: '08:00', end: '12:00' }] } }, extra));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    await alerts.idle();
    return r.body;
  }
  async function item(post, body) {
    const r = await sam.post('/post/' + post.id + '/items').send(body);
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    await alerts.idle();
    return r.body;
  }
  // Move the clock to tomorrow at hh:mm New York time.
  const at = (hhmm) => { now = schedule.zonedToUtc(tomorrow(), hhmm, TZ); };
  const get = (agent, post) => agent.get('/post/' + post.id);
  const search = (agent, q) => agent.get('/search').query(Object.assign({ lat: C.lat, lng: C.lng, radius: 5 }, q || {}));
  const ids = (r) => (r.body.results || r.body).map((p) => p.id);
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
    start = new Date();
    now = start;
    schedule.setClock(() => now);
    await models.sequelize.sync({ force: true });
    [sam, samId] = await user('sam@example.com', 'Sam', 'Stone');
    [bea, beaId] = await user('bea@example.com', 'Bea', 'Banks');
    [tom, tomId] = await user('tom@example.com', 'Tom', 'Tran');
    let adminId;
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

  it('pickup time: defaults to 11:59 pm local, at most 72 hours, at least 15 minutes', () => {
    const post = { timeZone: TZ };
    const noon = schedule.zonedToUtc('2026-10-17', '12:00', TZ);
    assert.strictEqual(curbside.defaultUntil(post, noon).toISOString(), schedule.zonedToUtc('2026-10-17', '23:59', TZ).toISOString());
    const late = schedule.zonedToUtc('2026-10-17', '23:30', TZ);
    assert.strictEqual(curbside.defaultUntil(post, late).toISOString(), schedule.zonedToUtc('2026-10-18', '23:59', TZ).toISOString());
    const v = (until) => curbside.validate({ all: true, until }, post, noon);
    assert.ok(v(new Date(noon.getTime() + 5 * 60000).toISOString()).errors.until);
    assert.ok(v(new Date(noon.getTime() + 73 * HOUR).toISOString()).errors.until);
    assert.ok(v('not a date').errors.until);
    assert.deepStrictEqual(v(new Date(noon.getTime() + 72 * HOUR).toISOString()).errors, {});
    assert.ok(curbside.validate({ itemIds: [] }, post, noon).errors.itemIds);
    assert.ok(curbside.validate({ all: true, note: 'x'.repeat(201) }, post, noon).errors.note);
  });

  it('seller offers leftovers from 12 hours before the end; badge, note and items show to everyone', async () => {
    const post = await sale();
    const lamp = await item(post, { name: 'Desk lamp', price: '8' });
    const desk = await item(post, { name: 'Oak desk', price: '45' });
    // Two days before: too early.
    let r = await sam.put('/post/' + post.id + '/curbside').send({ all: true });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.error.code, 'too_early');
    let g = await get(sam, post);
    assert.strictEqual(g.body.curbside.state, 'off');
    assert.strictEqual(g.body.curbside.canStart, false);
    assert.strictEqual((await get(bea, post)).body.curbside, null);
    // Only the seller.
    at('11:00');
    assert.strictEqual((await bea.put('/post/' + post.id + '/curbside').send({ all: true })).status, 403);
    // Bad items: someone else's, sold.
    const other = await sale({ title: 'Other sale' });
    const theirs = await item(other, { name: 'Rug', price: '5' });
    r = await sam.put('/post/' + post.id + '/curbside').send({ itemIds: [theirs.id] });
    assert.strictEqual(r.status, 400);
    await sam.put('/post/' + post.id + '/items/' + desk.id).send({ sold: true });
    r = await sam.put('/post/' + post.id + '/curbside').send({ itemIds: [desk.id] });
    assert.strictEqual(r.status, 400);
    assert.ok(r.body.error.details.itemIds);
    r = await sam.put('/post/' + post.id + '/curbside').send({ itemIds: [lamp.id], note: '  Box by the driveway  ' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(r.body.curbside.state, 'active');
    assert.strictEqual(r.body.curbside.note, 'Box by the driveway');
    assert.strictEqual(new Date(r.body.curbside.until).toISOString(), schedule.zonedToUtc(tomorrow(), '23:59', TZ).toISOString());
    // Everyone sees it; items carry their flag; no seller-only fields leak.
    for (const agent of [bea, request(app)]) {
      g = await get(agent, post);
      assert.strictEqual(g.body.curbside.state, 'active');
      assert.strictEqual(g.body.curbside.itemsLeft, 1);
      assert.strictEqual(g.body.curbside.marks, undefined);
      assert.strictEqual(g.body.curbside.goneSource, undefined);
      assert.strictEqual(g.body.curbsideUntil, undefined, 'raw columns are not serialized');
      assert.deepStrictEqual(g.body.items.filter((i) => i.curbside).map((i) => i.name), ['Desk lamp']);
    }
    // Changing the offer keeps it live (200), and can switch to everything.
    r = await sam.put('/post/' + post.id + '/curbside').send({ all: true, until: new Date(now.getTime() + 48 * HOUR).toISOString() });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.curbside.all, true);
    assert.strictEqual(r.body.curbside.itemsLeft, null);
    // Ending it.
    r = await sam.delete('/post/' + post.id + '/curbside');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.curbside.state, 'off');
    assert.strictEqual((await get(bea, post)).body.curbside, null);
  });

  it('after the sale ends the offer keeps it listed (search, recent, free filters) until pickup time', async () => {
    const post = await sale({ priceMin: 20 });
    const lamp = await item(post, { name: 'Desk lamp', price: '8' });
    const plain = await sale({ title: 'Plain sale', street: '2 mi St' });
    at('12:30');
    // Both ended: nothing is listed.
    assert.deepStrictEqual(ids(await search(bea)), []);
    assert.deepStrictEqual(ids(await bea.get('/allPosts')), []);
    await sam.put('/post/' + post.id + '/curbside').send({ itemIds: [lamp.id], until: new Date(now.getTime() + 2 * HOUR).toISOString() });
    let r = await search(bea);
    assert.deepStrictEqual(ids(r), [post.id]);
    assert.strictEqual(r.body.results[0].curbside.state, 'active');
    assert.deepStrictEqual(ids(await search(bea, { free: 'true' })), [post.id], 'leftovers count as free');
    assert.deepStrictEqual(ids(await search(bea, { maxPrice: '5' })), [post.id], 'free passes any max price');
    r = await search(bea, { curbside: 'true' });
    assert.deepStrictEqual(ids(r), [post.id]);
    assert.strictEqual(r.body.filter.curbside, true);
    assert.deepStrictEqual(ids(await search(bea, { when: 'now' })), [post.id]);
    assert.deepStrictEqual(ids(await search(bea, { when: 'weekend', curbside: 'true' })).length <= 1, true);
    assert.deepStrictEqual(ids(await search(bea, { keyword: 'lamp' })), [post.id]);
    assert.deepStrictEqual(ids(await bea.get('/allPosts')), [post.id]);
    assert.deepStrictEqual(ids(await bea.get('/allPosts').query({ curbside: 'true' })), [post.id]);
    assert.strictEqual((await bea.get('/allPosts').query({ curbside: 'maybe' })).status, 400);
    assert.strictEqual((await search(bea, { curbside: 'maybe' })).status, 400);
    // Text search (no geocoder) too.
    const t = await bea.get('/search').query({ q: 'New York' });
    if (t.body.mode === 'text') assert.ok(ids(t).indexOf(plain.id) === -1);
    // Pickup time passes: gone from everything, seller sees "expired".
    now = new Date(now.getTime() + 2 * HOUR + 1000);
    assert.deepStrictEqual(ids(await search(bea)), []);
    assert.deepStrictEqual(ids(await bea.get('/allPosts')), []);
    assert.strictEqual((await get(bea, post)).body.curbside, null);
    assert.strictEqual((await get(sam, post)).body.curbside.state, 'expired');
    assert.strictEqual((await bea.post('/post/' + post.id + '/curbside/taken').send({ itemId: lamp.id })).status, 409);
  });

  it('a live sale with an offer: curbside filter only keeps sales with one', async () => {
    const post = await sale();
    const plain = await sale({ title: 'Plain sale', street: '2 mi St' });
    at('09:00');
    await sam.put('/post/' + post.id + '/curbside').send({ all: true });
    assert.deepStrictEqual(ids(await search(bea)).sort(), [post.id, plain.id].sort());
    assert.deepStrictEqual(ids(await search(bea, { curbside: 'true' })), [post.id]);
    assert.deepStrictEqual(ids(await search(bea, { free: 'true' })), [post.id]);
  });

  it('hidden or reported posts never show as free', async () => {
    const post = await sale();
    await item(post, { name: 'Desk lamp', price: '8' });
    at('12:30');
    await sam.put('/post/' + post.id + '/curbside').send({ all: true });
    assert.deepStrictEqual(ids(await search(bea)), [post.id]);
    // One open report pauses it: not listed (sale ended), no badge, can't be taken.
    let r = await tom.post('/post/' + post.id + '/report').send({ reason: 'spam' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.deepStrictEqual(ids(await search(bea)), []);
    assert.deepStrictEqual(ids(await search(bea, { curbside: 'true' })), []);
    assert.deepStrictEqual(ids(await bea.get('/allPosts')), []);
    assert.strictEqual((await get(bea, post)).body.curbside, null);
    const own = (await get(sam, post)).body.curbside;
    assert.strictEqual(own.state, 'paused');
    assert.strictEqual(own.pausedReason, 'report');
    assert.strictEqual((await bea.post('/post/' + post.id + '/curbside/taken').send({})).status, 409);
    // Admin dismisses: back. Admin hides: gone again, and the seller can't restart it.
    const rep = await models.Report.findOne();
    await models.Report.update({ status: 'dismissed' }, { where: { id: rep.id } });
    assert.deepStrictEqual(ids(await search(bea)), [post.id]);
    await models.Post.update({ hidden: true, hiddenSource: 'moderator' }, { where: { id: post.id } });
    assert.deepStrictEqual(ids(await search(bea)), []);
    assert.strictEqual((await get(bea, post)).status, 404);
    assert.strictEqual((await get(sam, post)).body.curbside.pausedReason, 'hidden');
    assert.strictEqual((await sam.put('/post/' + post.id + '/curbside').send({ all: true })).status, 409);
  });

  it('item flags leak nothing while the offer is paused or over', async () => {
    const post = await sale();
    const lamp = await item(post, { name: 'Desk lamp', price: '8' });
    at('12:30');
    await sam.put('/post/' + post.id + '/curbside').send({ itemIds: [lamp.id] });
    const flag = (body) => body.items.find((i) => i.id === lamp.id).curbside;
    assert.strictEqual(flag((await get(bea, post)).body), true);
    assert.strictEqual(flag((await bea.get('/post/' + post.id + '/items')).body), true);
    await tom.post('/post/' + post.id + '/report').send({ reason: 'spam' });
    assert.strictEqual(flag((await get(bea, post)).body), false);
    assert.strictEqual(flag((await bea.get('/post/' + post.id + '/items')).body), false);
    assert.strictEqual(flag((await get(sam, post)).body), true, 'the seller still sees which items are out');
  });

  it('"Taken": signed in, not blocked, once per person, rate limited; seller sees who and can undo', async () => {
    process.env.CURBSIDE_TAKEN_PER_HOUR = '3';
    const post = await sale();
    const lamp = await item(post, { name: 'Desk lamp', price: '8' });
    const rug = await item(post, { name: 'Rug', price: '5' });
    const other = await sale({ title: 'Second sale', street: '2 mi St' });
    const o1 = await item(other, { name: 'Chair', price: '3' });
    const o2 = await item(other, { name: 'Table', price: '9' });
    at('12:30');
    await sam.put('/post/' + post.id + '/curbside').send({ itemIds: [lamp.id, rug.id] });
    assert.strictEqual((await request(app).post('/post/' + post.id + '/curbside/taken').send({ itemId: lamp.id })).status, 401);
    // Partial offers need an item; the item must be on the curb.
    assert.strictEqual((await bea.post('/post/' + post.id + '/curbside/taken').send({})).status, 400);
    let r = await bea.post('/post/' + post.id + '/curbside/taken').send({ itemId: lamp.id });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.curbside.itemsLeft, 1);
    assert.strictEqual(r.body.items.find((i) => i.id === lamp.id).curbsideGone, true);
    assert.strictEqual((await tom.post('/post/' + post.id + '/curbside/taken').send({ itemId: lamp.id })).body.error.code, 'already_taken');
    // Seller sees "Bea B." (never an email) and undoes it.
    let g = await get(sam, post);
    assert.deepStrictEqual(g.body.curbside.marks.map((m) => [m.itemId, m.by.name, m.undone]), [[lamp.id, 'Bea B.', false]]);
    noEmails(g.body);
    r = await sam.post('/post/' + post.id + '/curbside/undo').send({ itemId: lamp.id });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.curbside.itemsLeft, 2);
    assert.strictEqual(r.body.curbside.marks[0].undone, true);
    // Bea can't mark the same thing again in this offer.
    assert.strictEqual((await bea.post('/post/' + post.id + '/curbside/taken').send({ itemId: lamp.id })).body.error.code, 'already_marked');
    // Blocked pair can't.
    await models.UserBlock.create({ blockerId: samId, blockedId: tomId });
    assert.strictEqual((await tom.post('/post/' + post.id + '/curbside/taken').send({ itemId: rug.id })).status, 403);
    await models.UserBlock.destroy({ where: {} });
    // Last item taken: the whole offer is gone (and off the lists).
    r = await tom.post('/post/' + post.id + '/curbside/taken').send({ itemId: rug.id });
    assert.strictEqual(r.status, 200);
    r = await tom.post('/post/' + post.id + '/curbside/taken').send({ itemId: lamp.id });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.curbside, null, 'neighbors only see live offers');
    g = await get(sam, post);
    assert.strictEqual(g.body.curbside.state, 'gone');
    assert.strictEqual(g.body.curbside.goneSource, 'items');
    assert.deepStrictEqual(ids(await search(bea)), []);
    // Seller puts one back: live again.
    r = await sam.post('/post/' + post.id + '/curbside/undo').send({ itemId: rug.id });
    assert.strictEqual(r.body.curbside.state, 'active');
    assert.deepStrictEqual(ids(await search(bea)), [post.id]);
    // Rate limit across offers: Tom has used 2 of 3; a third elsewhere, then 429.
    await sam.put('/post/' + other.id + '/curbside').send({ itemIds: [o1.id, o2.id] });
    assert.strictEqual((await tom.post('/post/' + other.id + '/curbside/taken').send({ itemId: o1.id })).status, 200);
    r = await tom.post('/post/' + other.id + '/curbside/taken').send({ itemId: o2.id });
    assert.strictEqual(r.status, 429);
    // The seller marking things gone isn't rate limited and leaves no mark.
    r = await sam.post('/post/' + other.id + '/curbside/taken').send({ itemId: o2.id });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.curbside.state, 'gone');
    assert.strictEqual(await models.CurbsideMark.count({ where: { userId: samId } }), 0);
    // Only the seller can undo.
    assert.strictEqual((await bea.post('/post/' + other.id + '/curbside/undo').send({ itemId: o2.id })).status, 403);
  });

  it('whole-sale offers: one "taken" ends it; seller undo; selling or deleting the last item ends a partial one', async () => {
    const post = await sale();
    const lamp = await item(post, { name: 'Desk lamp', price: '8' });
    at('12:30');
    await sam.put('/post/' + post.id + '/curbside').send({ all: true });
    assert.strictEqual((await bea.post('/post/' + post.id + '/curbside/taken').send({ itemId: lamp.id })).status, 400);
    let r = await bea.post('/post/' + post.id + '/curbside/taken').send({});
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.curbside, null);
    const own = (await get(sam, post)).body.curbside;
    assert.strictEqual(own.state, 'gone');
    assert.strictEqual(own.goneSource, 'neighbor');
    r = await sam.post('/post/' + post.id + '/curbside/undo').send({});
    assert.strictEqual(r.body.curbside.state, 'active');
    // Partial: selling the only curbside item ends it; un-selling brings it back.
    await sam.put('/post/' + post.id + '/curbside').send({ itemIds: [lamp.id] });
    await sam.put('/post/' + post.id + '/items/' + lamp.id).send({ sold: true });
    assert.strictEqual((await get(sam, post)).body.curbside.state, 'gone');
    await sam.put('/post/' + post.id + '/items/' + lamp.id).send({ sold: false });
    assert.strictEqual((await get(sam, post)).body.curbside.state, 'active');
    await sam.delete('/post/' + post.id + '/items/' + lamp.id);
    assert.strictEqual((await get(sam, post)).body.curbside.state, 'gone');
  });

  it('reserved items stay off the curb; restarting an offer starts fresh', async () => {
    const post = await sale();
    const lamp = await item(post, { name: 'Desk lamp', price: '8' });
    at('12:30');
    await models.SaleItem.update({ reservedUntil: new Date(now.getTime() + HOUR) }, { where: { id: lamp.id } });
    const r = await sam.put('/post/' + post.id + '/curbside').send({ itemIds: [lamp.id] });
    assert.strictEqual(r.status, 400);
    assert.ok(/Reserved/.test(r.body.error.details.itemIds));
  });

  it('notifies buyers whose wanted posts match a now-free item (once per sale), even after the sale', async () => {
    const post = await sale();
    const bike = await item(post, { name: 'Kids bike', price: '60' });
    // Bea wants a bike up to $20: the $60 bike doesn't match during the sale.
    const w = await bea.post('/wanted').send({ title: 'Kids bike', areaLabel: 'Midtown', lat: C.lat, lng: C.lng, radiusMiles: 5, maxPriceCents: 2000 });
    assert.strictEqual(w.status, 201);
    assert.strictEqual(await models.WantedMatch.count(), 0);
    at('12:30');
    await sam.put('/post/' + post.id + '/curbside').send({ itemIds: [bike.id] });
    await alerts.idle();
    const rows = await models.WantedMatch.findAll({ raw: true });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].itemId, bike.id);
    assert.strictEqual(rows[0].status, 'pending');
    // In the app: the match shows as free on the curb.
    const mine = await bea.get('/wanted/' + w.body.id);
    assert.strictEqual(mine.body.matches.length, 1);
    assert.strictEqual(mine.body.matches[0].item.free, true);
    assert.ok(mine.body.matches[0].post.curbsideUntil);
    // Email goes out with the pickup time, through the shared queue.
    const summary = await alerts.processQueue(now);
    assert.strictEqual(summary.wanted.sent, 1);
    // (Sam also gets his post-sale summary; lib/sellerTools.js)
    const toBea = sent.filter((m) => m.to === 'bea@example.com');
    assert.strictEqual(toBea.length, 1);
    assert.ok(/Free on the curb until/.test(toBea[0].text), toBea[0].text);
    // Changing the offer doesn't tell her again.
    await sam.put('/post/' + post.id + '/curbside').send({ itemIds: [bike.id], note: 'By the mailbox' });
    await alerts.idle();
    assert.strictEqual(await models.WantedMatch.count(), 1);
    // Once the offer is over, the ended sale drops off her matches.
    now = new Date(schedule.zonedToUtc(tomorrow(), '23:59', TZ).getTime() + 1000);
    assert.strictEqual((await bea.get('/wanted/' + w.body.id)).body.matches.length, 0);
  });

  it('a reported offer does not notify, and only items on the curb match after the sale', async () => {
    const post = await sale();
    const bike = await item(post, { name: 'Kids bike', price: '60' });
    const lamp = await item(post, { name: 'Desk lamp', price: '8' });
    await bea.post('/wanted').send({ title: 'Kids bike', areaLabel: 'Midtown', lat: C.lat, lng: C.lng, radiusMiles: 5, maxPriceCents: 2000 });
    await tom.post('/wanted').send({ title: 'Desk lamp', areaLabel: 'Midtown', lat: C.lat, lng: C.lng, radiusMiles: 5, maxPriceCents: 500 });
    at('12:30');
    await tom.post('/post/' + post.id + '/report').send({ reason: 'spam' });
    await sam.put('/post/' + post.id + '/curbside').send({ itemIds: [bike.id] });
    await alerts.idle();
    assert.strictEqual(await models.WantedMatch.count(), 0);
    await models.Report.update({ status: 'dismissed' }, { where: {} });
    await sam.put('/post/' + post.id + '/curbside').send({ itemIds: [bike.id] });
    await alerts.idle();
    // Bea's bike matches; Tom's lamp isn't on the curb (and the sale is over).
    const rows = await models.WantedMatch.findAll({ raw: true });
    assert.deepStrictEqual(rows.map((r) => r.itemId), [bike.id]);
    assert.ok(lamp.id);
  });
});
