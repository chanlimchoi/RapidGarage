const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const schedule = require('../lib/schedule');

const PW = 'correct-horse';
const H = 3600000;
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);

describe('pickup scheduling', function () {
  this.timeout(30000);
  let now, sam, bea, cal, postId, items, conv, holdId;

  async function user(email, first) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: 'Test' });
    assert.strictEqual(r.status, 201);
    return agent;
  }
  const iso = (h) => new Date(now.getTime() + h * H).toISOString();
  const last = async (agent) => { const th = (await agent.get('/conversations/' + conv)).body; return th.messages[th.messages.length - 1]; };

  beforeEach(async () => {
    await models.sequelize.sync({ force: true });
    now = new Date(Math.ceil(Date.now() / H) * H);
    schedule.setClock(() => now);
    sam = await user('sam@example.com', 'Sam');
    bea = await user('bea@example.com', 'Bea');
    cal = await user('cal@example.com', 'Cal');
    const d1 = ymd(new Date(now.getTime() + 24 * H));
    const d2 = ymd(new Date(now.getTime() + 48 * H));
    const p = await sam.post('/post').send({ title: 'Moving sale', street: '1 Main St', city: 'Brooklyn', zipCode: '11201',
      schedule: { timeZone: 'America/New_York', days: [{ date: d1, start: '00:00', end: '23:30' }, { date: d2, start: '00:00', end: '23:30' }] } });
    postId = p.body.id;
    items = [];
    for (const [name, price] of [['Desk', '40'], ['Lamp', '10']]) items.push((await sam.post('/post/' + postId + '/items').send({ name, price })).body);
    conv = (await bea.post('/conversations').send({ postId })).body.id;
    holdId = (await bea.post('/conversations/' + conv + '/holds').send({ itemId: items[0].id, offerCents: 3000 })).body.id;
  });
  after(() => schedule.setClock(null));

  it('needs an accepted hold; only the seller offers; the buyer books; the hold covers the time', async () => {
    let g = (await sam.get('/conversations/' + conv + '/pickup')).body;
    assert.deepStrictEqual([g.pickup, g.canOffer], [null, false]);
    assert.strictEqual((await sam.post('/conversations/' + conv + '/pickup').send({ slots: [iso(26)] })).body.error.code, 'no_accepted_hold');
    assert.strictEqual((await sam.post('/holds/' + holdId + '/accept').send({})).status, 200);
    g = (await sam.get('/conversations/' + conv + '/pickup')).body;
    assert.deepStrictEqual([g.canOffer, g.items, g.timeZone], [true, ['Desk'], 'America/New_York']);
    assert.strictEqual((await bea.get('/conversations/' + conv + '/pickup')).body.canOffer, false);
    assert.strictEqual((await bea.post('/conversations/' + conv + '/pickup').send({ slots: [iso(26)] })).status, 403);

    // Validation.
    const bad = async (body) => (await sam.post('/conversations/' + conv + '/pickup').send(body)).body.error.details;
    assert.ok((await bad({ slots: [] })).slots);
    assert.ok((await bad({ slots: [iso(-1)] })).slots);
    assert.ok((await bad({ slots: [iso(26), iso(26)] })).slots);
    assert.ok((await bad({ slots: [iso(26)], minutes: 45 })).minutes);
    assert.ok((await bad({ slots: [1, 2, 3, 4, 5, 6, 7].map((h) => iso(24 + h)) })).slots);

    const r = await sam.post('/conversations/' + conv + '/pickup').send({ slots: [iso(30), iso(26)], minutes: 60 });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.pickup.slots.map((s) => s.start), [iso(26), iso(30)], 'sorted');
    assert.strictEqual(r.body.pickup.slots[0].end, iso(27));
    let ev = await last(bea);
    assert.deepStrictEqual([ev.kind, ev.pickup.event, ev.body], ['pickup', 'offered', 'Offered 2 pickup times.']);

    assert.strictEqual((await sam.post('/conversations/' + conv + '/pickup/book').send({ start: iso(26) })).status, 403, 'only the buyer books');
    assert.strictEqual((await bea.post('/conversations/' + conv + '/pickup/book').send({ start: iso(27) })).status, 400, 'not an offered slot');
    const b = await bea.post('/conversations/' + conv + '/pickup/book').send({ start: iso(30) });
    assert.strictEqual(b.status, 200, JSON.stringify(b.body));
    assert.deepStrictEqual([b.body.pickup.status, b.body.pickup.chosen.start], ['booked', iso(30)]);
    ev = await last(sam);
    assert.deepStrictEqual([ev.pickup.event, ev.pickup.start], ['booked', iso(30)]);
    assert.match(ev.body, /^Booked pickup for .+ (EST|EDT)\.$/);
    // The hold's pickup time and reservation follow the booking.
    const hold = await models.ItemHold.findByPk(holdId);
    assert.strictEqual(new Date(hold.pickupAt).toISOString(), iso(30));
    assert.ok(new Date(hold.expiresAt).getTime() >= now.getTime() + 31 * H);
    const item = await models.SaleItem.findByPk(items[0].id);
    assert.strictEqual(new Date(item.reservedUntil).getTime(), new Date(hold.expiresAt).getTime());
    // Booking twice is a state error.
    assert.strictEqual((await bea.post('/conversations/' + conv + '/pickup/book').send({ start: iso(26) })).status, 409);
  });

  it('either side reschedules or cancels; both see it on the dashboard; outsiders see nothing', async () => {
    await sam.post('/holds/' + holdId + '/accept').send({});
    await sam.post('/conversations/' + conv + '/pickup').send({ slots: [iso(26), iso(30)] });
    await bea.post('/conversations/' + conv + '/pickup/book').send({ start: iso(26) });

    let up = (await sam.get('/pickups/upcoming')).body.results;
    assert.strictEqual(up.length, 1);
    assert.deepStrictEqual([up[0].role, up[0].status, up[0].other.name, up[0].items, up[0].post.title], ['seller', 'booked', 'Bea T.', ['Desk'], 'Moving sale']);
    assert.ok(!JSON.stringify(up).includes('@'), 'no emails');
    up = (await bea.get('/pickups/upcoming')).body.results;
    assert.deepStrictEqual([up[0].role, up[0].other.name], ['buyer', 'Sam T.']);
    assert.deepStrictEqual((await cal.get('/pickups/upcoming')).body.results, []);
    assert.strictEqual((await cal.get('/conversations/' + conv + '/pickup')).status, 404);
    assert.strictEqual((await request(app).get('/pickups/upcoming')).status, 401);

    // Buyer asks to reschedule: back to offered, then books the other slot.
    const rs = await bea.post('/conversations/' + conv + '/pickup/reschedule').send({});
    assert.deepStrictEqual([rs.body.pickup.status, rs.body.pickup.chosen], ['offered', null]);
    assert.strictEqual((await last(sam)).pickup.event, 'reschedule');
    assert.strictEqual((await bea.post('/conversations/' + conv + '/pickup/book').send({ start: iso(30) })).status, 200);
    // Seller offers new times on a booked pickup: "rescheduled".
    await sam.post('/conversations/' + conv + '/pickup').send({ slots: [iso(40)] });
    assert.deepStrictEqual([(await last(bea)).pickup.event, (await last(bea)).body], ['rescheduled', 'Offered new pickup times (1).']);
    // Seller cancels.
    const c = await sam.post('/conversations/' + conv + '/pickup/cancel').send({});
    assert.strictEqual(c.body.pickup.status, 'cancelled');
    assert.strictEqual((await sam.post('/conversations/' + conv + '/pickup/cancel').send({})).status, 409);
    assert.deepStrictEqual((await bea.get('/pickups/upcoming')).body.results, []);
    // The hold is still accepted.
    assert.strictEqual((await models.ItemHold.findByPk(holdId)).status, 'accepted');
  });

  it('a block stops pickup changes and an ended hold drops it from the dashboard', async () => {
    await sam.post('/holds/' + holdId + '/accept').send({});
    await sam.post('/conversations/' + conv + '/pickup').send({ slots: [iso(26)] });
    await sam.post('/holds/' + holdId + '/release').send({});
    assert.deepStrictEqual((await bea.get('/pickups/upcoming')).body.results, []);
    const g = (await bea.get('/conversations/' + conv + '/pickup')).body;
    assert.deepStrictEqual([g.canAct, g.pickup.status], [false, 'offered']);
    assert.strictEqual((await bea.post('/conversations/' + conv + '/pickup/book').send({ start: iso(26) })).status, 409);
    await bea.post('/conversations/' + conv + '/block').send({});
    assert.strictEqual((await sam.post('/conversations/' + conv + '/pickup/cancel').send({})).body.error.code, 'blocked');
  });
});
