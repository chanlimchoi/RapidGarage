const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const schedule = require('../lib/schedule');
const holds = require('../lib/holds');

const PW = 'correct-horse';
const H = 3600000;
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);

describe('item holds', function () {
  this.timeout(30000);
  let t0, now, seller, buyer, buyer2, stranger, sellerId, buyerId, postId, items, conv, conv2;

  async function user(email, first) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: 'Test' });
    assert.strictEqual(r.status, 201);
    return [agent, r.body.id];
  }
  const advance = (ms) => { now = new Date(now.getTime() + ms); };
  const holdsOf = async (agent, c) => (await agent.get('/conversations/' + c + '/holds')).body;
  const unread = async (agent) => (await agent.get('/conversations/unread')).body.count;
  const publicItems = async () => (await request(app).get('/post/' + postId + '/items')).body.items || (await request(app).get('/post/' + postId + '/items')).body;
  const ask = (agent, c, itemId, extra) => agent.post('/conversations/' + c + '/holds').send(Object.assign({ itemId }, extra));
  async function startConv(agent) {
    const r = await agent.post('/conversations').send({ postId });
    assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
    return r.body.id;
  }

  beforeEach(async () => {
    await models.sequelize.sync({ force: true });
    t0 = new Date(); now = t0;
    schedule.setClock(() => now);
    [seller, sellerId] = await user('sam@example.com', 'Sam');
    [buyer, buyerId] = await user('bea@example.com', 'Bea');
    [buyer2] = await user('cal@example.com', 'Cal');
    [stranger] = await user('sue@example.com', 'Sue');
    // Two-day sale: tomorrow and the day after, 8am-6pm New York.
    const d1 = ymd(new Date(t0.getTime() + 24 * H));
    const d2 = ymd(new Date(t0.getTime() + 48 * H));
    const p = await seller.post('/post').send({ title: 'Moving sale', street: '1 Main St', city: 'Brooklyn', state: 'NY', zipCode: '11201',
      schedule: { timeZone: 'America/New_York', days: [{ date: d1, start: '08:00', end: '18:00' }, { date: d2, start: '08:00', end: '18:00' }] } });
    assert.strictEqual(p.status, 201, JSON.stringify(p.body));
    postId = p.body.id;
    items = [];
    for (const name of ['Desk', 'Chair', 'Lamp', 'Rug', 'Sofa']) items.push((await seller.post('/post/' + postId + '/items').send({ name, price: '10' })).body);
    conv = await startConv(buyer);
    conv2 = await startConv(buyer2);
  });
  after(() => schedule.setClock(null));

  it('buyer asks, seller sees it as unread, accepts; the item shows Reserved to everyone (never by whom)', async () => {
    const pickupAt = new Date(t0.getTime() + 26 * H).toISOString();
    const r = await ask(buyer, conv, items[0].id, { pickupAt });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.strictEqual(r.body.status, 'pending');
    assert.strictEqual(r.body.item.name, 'Desk');
    assert.strictEqual(await unread(seller), 1, 'the request is an unread message for the seller');
    const thread = (await seller.get('/conversations/' + conv)).body;
    const ev = thread.messages[thread.messages.length - 1];
    assert.strictEqual(ev.kind, 'hold');
    assert.deepStrictEqual([ev.hold.event, ev.hold.itemName, ev.hold.status], ['requested', 'Desk', 'pending']);
    assert.strictEqual(new Date(ev.hold.pickupAt).toISOString(), pickupAt);
    assert.strictEqual((await publicItems()).find((i) => i.id === items[0].id).reserved, false, 'pending is not reserved');

    const a = await seller.post('/holds/' + r.body.id + '/accept').send({});
    assert.strictEqual(a.status, 200, JSON.stringify(a.body));
    assert.strictEqual(a.body.status, 'accepted');
    // Default: until an hour after pickup.
    assert.strictEqual(new Date(a.body.expiresAt).getTime(), new Date(pickupAt).getTime() + H);
    assert.strictEqual(await unread(buyer), 1, 'buyer notified');
    const pub = (await publicItems()).find((i) => i.id === items[0].id);
    assert.strictEqual(pub.reserved, true);
    assert.ok(pub.reservedUntil);
    const raw = JSON.stringify(await (await request(app).get('/post/' + postId)).body);
    assert.ok(!/bea@example|Bea/.test(raw), 'the public post never says who holds it');
    // Can't be requested by someone else while reserved.
    const other = await ask(buyer2, conv2, items[0].id);
    assert.strictEqual(other.status, 409);
    assert.strictEqual(other.body.error.code, 'item_reserved');
  });

  it('only the two participants see or act on a hold', async () => {
    const r = await ask(buyer, conv, items[0].id);
    const id = r.body.id;
    assert.strictEqual((await stranger.post('/holds/' + id + '/accept')).status, 404);
    assert.strictEqual((await stranger.get('/conversations/' + conv + '/holds')).status, 404);
    assert.strictEqual((await buyer.post('/holds/' + id + '/accept')).status, 403, 'buyer cannot accept');
    assert.strictEqual((await seller.post('/holds/' + id + '/cancel')).status, 403, 'seller cannot cancel for the buyer');
    assert.strictEqual((await seller.post('/conversations/' + conv + '/holds').send({ itemId: items[1].id })).status, 403, 'seller cannot request');
    assert.strictEqual((await request(app).post('/holds/' + id + '/decline')).status, 401);
    const list = await holdsOf(seller, conv);
    assert.strictEqual(list.results.length, 1);
    assert.strictEqual(list.results[0].role, 'seller');
    assert.strictEqual(list.canRequest, false);
    const mine = await holdsOf(buyer, conv);
    assert.strictEqual(mine.canRequest, true);
    assert.ok(!mine.holdable.some((i) => i.id === items[0].id), 'already asked: not offered again');
  });

  it('accepting one request declines the others for that item and tells them', async () => {
    const a = await ask(buyer, conv, items[0].id);
    const b = await ask(buyer2, conv2, items[0].id);
    assert.strictEqual(b.status, 201);
    await seller.post('/holds/' + a.body.id + '/accept').send({ hours: 3 });
    const list = await holdsOf(buyer2, conv2);
    assert.strictEqual(list.results[0].status, 'declined');
    assert.strictEqual(list.results[0].endedReason, 'taken');
    assert.strictEqual(await unread(buyer2), 1);
    // A "taken" decline doesn't trigger the decline cooldown.
    await seller.post('/holds/' + a.body.id + '/release');
    assert.strictEqual((await ask(buyer2, conv2, items[0].id)).status, 201);
  });

  it('two accepts racing for one item: exactly one wins', async () => {
    const a = await ask(buyer, conv, items[0].id);
    const b = await ask(buyer2, conv2, items[0].id);
    const [ra, rb] = await Promise.all([seller.post('/holds/' + a.body.id + '/accept'), seller.post('/holds/' + b.body.id + '/accept')]);
    assert.deepStrictEqual([ra.status, rb.status].sort(), [200, 409]);
    assert.strictEqual(await models.ItemHold.count({ where: { status: 'accepted' } }), 1);
  });

  it('decline (with a one-day cooldown), cancel and release', async () => {
    const a = await ask(buyer, conv, items[0].id);
    assert.strictEqual((await seller.post('/holds/' + a.body.id + '/decline')).body.status, 'declined');
    const again = await ask(buyer, conv, items[0].id);
    assert.strictEqual(again.status, 429);
    assert.strictEqual(again.body.error.code, 'declined_recently');
    advance(25 * H);
    assert.strictEqual((await ask(buyer, conv, items[0].id)).status, 201, 'allowed again the next day');

    const c = await ask(buyer, conv, items[1].id);
    assert.strictEqual((await buyer.post('/holds/' + c.body.id + '/cancel')).body.status, 'cancelled');
    assert.strictEqual((await seller.post('/holds/' + c.body.id + '/accept')).status, 409, 'closed holds stay closed');

    const d = await ask(buyer, conv, items[2].id);
    await seller.post('/holds/' + d.body.id + '/accept');
    assert.strictEqual((await publicItems()).find((i) => i.id === items[2].id).reserved, true);
    assert.strictEqual((await seller.post('/holds/' + d.body.id + '/release')).body.status, 'released');
    assert.strictEqual((await publicItems()).find((i) => i.id === items[2].id).reserved, false);
    const events = (await buyer.get('/conversations/' + conv)).body.messages.filter((m) => m.kind === 'hold').map((m) => m.hold.event);
    assert.deepStrictEqual(events, ['requested', 'declined', 'requested', 'requested', 'cancelled', 'requested', 'accepted', 'released']);
  });

  it('requests lapse unanswered; accepted holds expire on time and never outlive the sale', async () => {
    const a = await ask(buyer, conv, items[0].id);
    assert.strictEqual(new Date(a.body.expiresAt).getTime(), now.getTime() + 24 * H);
    advance(24 * H + 1000);
    assert.strictEqual(await unread(buyer), 1, 'the badge poll ends it and tells the buyer');
    const h = (await holdsOf(buyer, conv)).results[0];
    assert.deepStrictEqual([h.status, h.endedReason], ['expired', 'timeout']);

    const b = await ask(buyer, conv, items[1].id);
    const acc = await seller.post('/holds/' + b.body.id + '/accept').send({ hours: 72 });
    const end = holds.saleEnd(await models.Post.findByPk(postId, { include: [{ model: models.SaleDay, as: 'saleDays' }] }));
    assert.ok(new Date(acc.body.expiresAt).getTime() <= end, 'capped at the end of the sale');
    advance(new Date(acc.body.expiresAt).getTime() - now.getTime() + 1);
    // Reserved is computed against the clock, even before any sweep.
    assert.strictEqual((await publicItems()).find((i) => i.id === items[1].id).reserved, false);
    await holds.sweep();
    assert.strictEqual((await models.ItemHold.findByPk(b.body.id)).status, 'expired');
    assert.strictEqual((await models.SaleItem.findByPk(items[1].id)).reservedUntil, null);
    // Sale over: no new holds.
    const late = await ask(buyer, conv, items[2].id);
    assert.strictEqual(late.status, 409);
    assert.strictEqual(late.body.error.code, 'sale_ended');
  });

  it('marking the item sold completes the hold and tells people still waiting', async () => {
    const a = await ask(buyer, conv, items[0].id);
    await seller.post('/holds/' + a.body.id + '/accept');
    const b = await ask(buyer2, conv2, items[1].id);
    await seller.put('/post/' + postId + '/items/' + items[0].id).send({ sold: true });
    await seller.put('/post/' + postId + '/items/' + items[1].id).send({ sold: true });
    assert.strictEqual((await models.ItemHold.findByPk(a.body.id)).status, 'completed');
    const w = await models.ItemHold.findByPk(b.body.id);
    assert.deepStrictEqual([w.status, w.endedReason], ['declined', 'sold']);
    const ev = (await buyer2.get('/conversations/' + conv2)).body.messages.pop();
    assert.strictEqual(ev.hold.event, 'sold');
  });

  it('blocking ends open holds between the two and frees the item', async () => {
    const a = await ask(buyer, conv, items[0].id);
    await seller.post('/holds/' + a.body.id + '/accept');
    await ask(buyer, conv, items[1].id);
    await seller.post('/conversations/' + conv + '/block');
    const rows = await models.ItemHold.findAll({ where: { buyerId } });
    assert.ok(rows.every((h) => h.status === 'cancelled' && h.endedReason === 'blocked'));
    assert.strictEqual((await publicItems()).find((i) => i.id === items[0].id).reserved, false);
    await seller.delete('/conversations/' + conv + '/block');
    await buyer.post('/conversations/' + conv + '/block');
    const r = await ask(buyer, conv, items[2].id);
    assert.strictEqual(r.status, 403);
  });

  it('hidden sales and banned accounts cannot hold', async () => {
    await models.User.update({ messagingBanned: true }, { where: { id: buyerId } });
    assert.strictEqual((await ask(buyer, conv, items[0].id)).body.error.code, 'messaging_banned');
    await models.User.update({ messagingBanned: false }, { where: { id: buyerId } });
    await models.Post.update({ hidden: true }, { where: { id: postId } });
    const r = await ask(buyer, conv, items[0].id);
    assert.ok([403, 404].includes(r.status), String(r.status));
    assert.strictEqual((await holdsOf(buyer, conv)).canRequest, false);
  });

  it('abuse limits: per sale, open holds, per day, per item', async () => {
    for (let i = 0; i < 3; i++) assert.strictEqual((await ask(buyer, conv, items[i].id)).status, 201);
    const fourth = await ask(buyer, conv, items[3].id);
    assert.strictEqual(fourth.status, 429);
    assert.match(fourth.body.error.message, /up to 3 items per sale/);
    // Per-item pending cap.
    const extra = [];
    for (let i = 0; i < 5; i++) extra.push(await user('x' + i + '@example.com', 'X' + i));
    for (let i = 0; i < 4; i++) assert.strictEqual((await ask(extra[i][0], await (async () => { const r = await extra[i][0].post('/conversations').send({ postId }); return r.body.id; })(), items[0].id)).status, 201);
    const c5 = (await extra[4][0].post('/conversations').send({ postId })).body.id;
    const sixth = await ask(extra[4][0], c5, items[0].id);
    assert.strictEqual(sixth.status, 409);
    assert.strictEqual(sixth.body.error.code, 'too_many_requests');
    // Per day.
    process.env.HOLD_MAX_PER_DAY = '4';
    try {
      await buyer.post('/holds/' + (await holdsOf(buyer, conv)).results[0].id + '/cancel');
      const r = await ask(buyer, conv, items[3].id);
      assert.strictEqual(r.status, 201);
      await buyer.post('/holds/' + r.body.id + '/cancel');
      const over = await ask(buyer, conv, items[4].id);
      assert.strictEqual(over.status, 429);
      assert.strictEqual(over.body.error.code, 'rate_limited');
    } finally { delete process.env.HOLD_MAX_PER_DAY; }
  });

  it('caps open holds across all sales (HOLD_MAX_ACTIVE)', async () => {
    process.env.HOLD_MAX_ACTIVE = '2';
    try {
      assert.strictEqual((await ask(buyer, conv, items[0].id)).status, 201);
      assert.strictEqual((await ask(buyer, conv, items[1].id)).status, 201);
      const r = await ask(buyer, conv, items[2].id);
      assert.strictEqual(r.status, 429);
      assert.strictEqual(r.body.error.message, 'You can have up to 2 open holds. Cancel one first.');
    } finally { delete process.env.HOLD_MAX_ACTIVE; }
  });

  it('validates pickup time and hold length, in the request\'s language', async () => {
    const past = await ask(buyer, conv, items[0].id, { pickupAt: new Date(now.getTime() - H).toISOString() });
    assert.strictEqual(past.status, 400);
    assert.strictEqual(past.body.error.details.pickupAt, 'Pick a pickup time in the future.');
    const after = await buyer.post('/conversations/' + conv + '/holds').set('Accept-Language', 'ko').send({ itemId: items[0].id, pickupAt: new Date(now.getTime() + 5 * 24 * H).toISOString() });
    assert.strictEqual(after.body.error.details.pickupAt, '세일이 끝나기 전의 픽업 시간을 선택하세요.');
    assert.strictEqual((await ask(buyer, conv, items[0].id, { pickupAt: 'soon' })).status, 400);
    assert.strictEqual((await ask(buyer, conv, 999999)).status, 404);
    const ok = await ask(buyer, conv, items[0].id);
    const bad = await seller.post('/holds/' + ok.body.id + '/accept').set('Accept-Language', 'es').send({ hours: 500 });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(bad.body.error.details.hours, 'Aparta de 1 a 72 horas.');
  });
});
