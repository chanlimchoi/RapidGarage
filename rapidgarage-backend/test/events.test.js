const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const schedule = require('../lib/schedule');
const alerts = require('../lib/alerts');
const mailer = require('../lib/mailer');
const flyer = require('../lib/flyer');
const scans = require('../lib/scans');
const shortlinksCtl = require('../controllers/shortlinks');

const PW = 'correct-horse';
const C = { lat: 40.758, lng: -73.9855 };
const H = 3600000;
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
// "<n> mi St" geocodes n miles due north of C; "Hell's Kitchen" geocodes to C.
function fakeProvider(address) {
  if (/hell's kitchen/i.test(address)) return Promise.resolve({ status: 'ok', lat: C.lat, lng: C.lng });
  const m = /([\d.]+) mi St/.exec(address);
  if (!m) return Promise.resolve({ status: 'not_found' });
  return Promise.resolve({ status: 'ok', lat: C.lat + Number(m[1]) / 69.0, lng: C.lng });
}
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';

describe('neighborhood sales', function () {
  this.timeout(30000);
  let org, orgId, sam, samId, bea, beaId, admin, adminId, t0, now, d1, d2, d5;

  async function user(email, firstName, lastName) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName, lastName });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return [agent, r.body.id];
  }
  const sched = (days) => ({ timeZone: 'America/New_York', days: days.map((date) => ({ date, start: '08:00', end: '16:00' })) });
  const base = (extra) => Object.assign({ name: 'Elm Street Block Sale', areaLabel: "Hell's Kitchen, New York", radiusMiles: 1, joinMode: 'approval', schedule: sched([d1, d2]) }, extra);
  async function makeEvent(agent, extra) {
    const r = await agent.post('/events').send(base(extra));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return r.body;
  }
  async function sale(agent, mi, days, extra) {
    const r = await agent.post('/post').send(Object.assign({ title: 'Sale ' + mi, street: mi + ' mi St', city: 'New York', state: 'NY', zipCode: '10036', schedule: sched(days || [d1]) }, extra));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    await alerts.idle();
    return r.body;
  }
  const join = (agent, ev, post) => agent.post('/events/' + ev.id + '/join').send({ postId: post.id });

  beforeEach(async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-server-key';
    process.env.APP_BASE_URL = 'https://garage.example';
    geo.setProvider(fakeProvider);
    geo.resetRateLimits();
    shortlinksCtl.resetMisses();
    scans.resetSalt();
    await models.sequelize.sync({ force: true });
    t0 = new Date(); now = t0;
    schedule.setClock(() => now);
    scans.setClock(() => now);
    d1 = ymd(new Date(t0.getTime() + 24 * H));
    d2 = ymd(new Date(t0.getTime() + 48 * H));
    d5 = ymd(new Date(t0.getTime() + 5 * 24 * H));
    [org, orgId] = await user('olga@example.com', 'Olga', 'Ortiz');
    [sam, samId] = await user('sam@example.com', 'Sam', 'Stone');
    [bea, beaId] = await user('bea@example.com', 'Bea', 'Banks');
    [admin, adminId] = await user('ada@example.com', 'Ada', 'Admin');
    await models.User.update({ role: 'admin' }, { where: { id: adminId } });
  });
  after(() => {
    schedule.setClock(null);
    scans.setClock(null);
    geo.setProvider(null);
    delete process.env.GOOGLE_MAPS_API_KEY;
    delete process.env.APP_BASE_URL;
  });

  it('creates an event (area looked up), shows the organizer as "First L." and never an email or code', async () => {
    const ev = await makeEvent(org, { description: 'Thirty houses, one Saturday.' });
    assert.strictEqual(ev.organizer.name, 'Olga O.');
    assert.ok(Math.abs(ev.lat - C.lat) < 1e-9 && Math.abs(ev.lng - C.lng) < 1e-9);
    assert.strictEqual(ev.status, 'upcoming');
    assert.deepStrictEqual(ev.schedule.days.map((d) => d.date), [d1, d2]);
    const pub = await request(app).get('/events/' + ev.id);
    assert.strictEqual(pub.status, 200);
    const text = JSON.stringify(pub.body);
    assert.ok(!/@example\.com/.test(text), 'no emails');
    assert.ok(!/shortCode/.test(text), 'no short code in public JSON');
    assert.strictEqual(pub.body.saleCount, 0);
    assert.strictEqual(pub.body.requests, undefined, 'requests are for the organizer');
    // Browser coordinates skip the lookup.
    const r = await org.post('/events').send(base({ name: 'Coords', areaLabel: 'Somewhere', lat: 40.7, lng: -73.99 }));
    assert.strictEqual(r.status, 201);
    assert.strictEqual(r.body.lat, 40.7);
  });

  it('validates fields and limits', async () => {
    assert.strictEqual((await request(app).post('/events').send(base())).status, 401);
    const r = await org.post('/events').send({ name: ' ', radiusMiles: 7, joinMode: 'maybe', schedule: sched([]) });
    assert.strictEqual(r.status, 400);
    const f = r.body.error.details;
    ['name', 'areaLabel', 'radiusMiles', 'joinMode', 'schedule'].forEach((k) => assert.ok(f[k], k + ' ' + JSON.stringify(f)));
    const many = [];
    for (let i = 1; i <= 8; i++) many.push(ymd(new Date(t0.getTime() + i * 24 * H)));
    assert.ok((await org.post('/events').send(base({ schedule: sched(many) }))).body.error.details.schedule);
    assert.ok((await org.post('/events').send(base({ areaLabel: 'Nowhere at all' }))).body.error.details.areaLabel, 'unknown area');
    await makeEvent(org);
    await makeEvent(org, { name: 'Two' });
    await makeEvent(org, { name: 'Three' });
    const fourth = await org.post('/events').send(base({ name: 'Four' }));
    assert.strictEqual(fourth.status, 429);
    assert.strictEqual(fourth.body.error.code, 'too_many_events');
  });

  it('approval mode: request, organizer approves, then the sale is listed, marked and searchable', async () => {
    const ev = await makeEvent(org);
    const p = await sale(sam, 0.5);
    const j = await join(sam, ev, p);
    assert.strictEqual(j.status, 201, JSON.stringify(j.body));
    assert.strictEqual(j.body.status, 'pending');
    assert.strictEqual((await request(app).get('/events/' + ev.id)).body.saleCount, 0, 'pending is not public');
    const asOrg = (await org.get('/events/' + ev.id)).body;
    assert.strictEqual(asOrg.requests.length, 1);
    assert.strictEqual(asOrg.requests[0].seller.name, 'Sam S.');
    assert.ok(!/@example\.com/.test(JSON.stringify(asOrg)));
    assert.strictEqual((await sam.post('/events/' + ev.id + '/participants/' + p.id + '/approve')).status, 403, 'only the organizer approves');
    assert.strictEqual((await org.post('/events/' + ev.id + '/participants/' + p.id + '/approve')).body.status, 'approved');
    const pub = (await request(app).get('/events/' + ev.id)).body;
    assert.deepStrictEqual(pub.sales.map((s) => s.id), [p.id]);
    assert.strictEqual(pub.sales[0].seller.name, 'Sam S.');
    assert.deepStrictEqual((await request(app).get('/post/' + p.id)).body.event, { id: ev.id, name: ev.name });
    // Search: one event entry for the map, and the sale says which event it is in.
    const other = await sale(bea, 2);
    const s = (await request(app).get('/search').query({ lat: C.lat, lng: C.lng, radius: 5 })).body;
    assert.deepStrictEqual(s.events.map((e) => [e.id, e.saleCount]), [[ev.id, 1]]);
    assert.deepStrictEqual(s.results.find((x) => x.id === p.id).event, { id: ev.id, name: ev.name });
    assert.strictEqual(s.results.find((x) => x.id === other.id).event, undefined);
    const only = (await request(app).get('/search').query({ lat: C.lat, lng: C.lng, radius: 5, neighborhood: 'true' })).body;
    assert.deepStrictEqual(only.results.map((x) => x.id), [p.id]);
    assert.strictEqual(only.filter.neighborhood, true);
    assert.strictEqual((await request(app).get('/search').query({ lat: C.lat, lng: C.lng, neighborhood: 'maybe' })).status, 400);
    const near = (await request(app).get('/events').query({ lat: C.lat, lng: C.lng, radius: 5 })).body.results;
    assert.deepStrictEqual(near.map((e) => e.id), [ev.id]);
    const recent = (await request(app).get('/allPosts')).body;
    assert.deepStrictEqual(recent.find((x) => x.id === p.id).event, { id: ev.id, name: ev.name });
  });

  it('open mode joins at once; area, dates, one-event-per-sale and ownership are enforced; leave and remove', async () => {
    const ev = await makeEvent(org, { joinMode: 'open' });
    const p = await sale(sam, 0.5);
    assert.strictEqual((await join(sam, ev, p)).body.status, 'approved');
    assert.strictEqual((await join(sam, ev, p)).status, 409, 'already in');
    assert.strictEqual((await join(bea, ev, p)).status, 403, 'not your sale');
    const far = await sale(bea, 3);
    assert.strictEqual((await join(bea, ev, far)).body.error.code, 'outside_area');
    const later = await sale(bea, 0.2, [d5]);
    assert.strictEqual((await join(bea, ev, later)).body.error.code, 'dates');
    const ev2 = await makeEvent(org, { name: 'Other', joinMode: 'open' });
    assert.strictEqual((await join(sam, ev2, p)).status, 409, 'one event per sale');
    // Options for a sale: what it could join and why not.
    const opts = (await bea.get('/events/for-post/' + later.id)).body;
    assert.strictEqual(opts.current, null);
    assert.ok(opts.options.length >= 1 && opts.options.every((o) => o.canJoin === false && o.reasonCode === 'dates'));
    assert.strictEqual((await sam.get('/events/for-post/' + p.id)).body.current.id, ev.id);
    assert.strictEqual((await bea.get('/events/for-post/' + p.id)).status, 403);
    // The seller leaves; the organizer removes another.
    assert.strictEqual((await sam.delete('/events/' + ev.id + '/participants/' + p.id)).status, 204);
    assert.strictEqual((await join(sam, ev2, p)).body.status, 'approved', 'free to join another after leaving');
    const q = await sale(bea, 0.3);
    await join(bea, ev2, q);
    assert.strictEqual((await sam.delete('/events/' + ev2.id + '/participants/' + q.id)).status, 403, 'other sellers cannot remove');
    assert.strictEqual((await org.delete('/events/' + ev2.id + '/participants/' + q.id)).status, 204);
    assert.deepStrictEqual((await request(app).get('/events/' + ev2.id)).body.sales.map((s) => s.id), [p.id]);
    // Mine: organized and joined.
    const mine = (await org.get('/events/mine')).body;
    assert.deepStrictEqual(mine.organized.map((e) => e.name).sort(), ['Elm Street Block Sale', 'Other']);
    assert.deepStrictEqual((await sam.get('/events/mine')).body.joined.map((e) => e.id), [ev2.id]);
  });

  it('respects blocks, hidden sales and ended events', async () => {
    const ev = await makeEvent(org, { joinMode: 'open' });
    const p = await sale(sam, 0.5);
    await models.UserBlock.create({ blockerId: orgId, blockedId: samId });
    assert.strictEqual((await join(sam, ev, p)).body.error.code, 'blocked');
    await models.UserBlock.destroy({ where: {} });
    await join(sam, ev, p);
    const q = await sale(bea, 0.4);
    await join(bea, ev, q);
    await models.Post.update({ hidden: true }, { where: { id: q.id } });
    assert.deepStrictEqual((await request(app).get('/events/' + ev.id)).body.sales.map((s) => s.id), [p.id], 'hidden sale left out');
    assert.strictEqual((await request(app).get('/search').query({ lat: C.lat, lng: C.lng, radius: 5 })).body.events[0].saleCount, 1);
    // After the last day: out of search and lists, can't join, page says ended.
    now = new Date(t0.getTime() + 4 * 24 * H);
    assert.deepStrictEqual((await request(app).get('/search').query({ lat: C.lat, lng: C.lng, radius: 5 })).body.events, []);
    assert.deepStrictEqual((await request(app).get('/events')).body.results, []);
    const page = (await request(app).get('/events/' + ev.id)).body;
    assert.strictEqual(page.status, 'ended');
    assert.strictEqual(page.ended, true);
    const r = await sale(bea, 0.1, [d5]);
    assert.strictEqual((await join(bea, ev, r)).body.error.code, 'event_ended');
  });

  it('reports go to admins, who can hide (short link, search and print then refuse) and unhide', async () => {
    const ev = await makeEvent(org, { joinMode: 'open' });
    const p = await sale(sam, 0.5);
    await join(sam, ev, p);
    assert.strictEqual((await org.post('/events/' + ev.id + '/report').send({ reason: 'spam' })).status, 403, 'not your own');
    assert.strictEqual((await bea.post('/events/' + ev.id + '/report').send({ reason: 'nope' })).status, 400);
    assert.strictEqual((await bea.post('/events/' + ev.id + '/report').send({ reason: 'scam', note: 'Fake' })).status, 201);
    assert.strictEqual((await bea.post('/events/' + ev.id + '/report').send({ reason: 'scam' })).status, 409);
    assert.strictEqual((await sam.get('/admin/events/reports')).status, 403);
    const q = (await admin.get('/admin/events/reports')).body;
    assert.strictEqual(q.groups[0].eventId, ev.id);
    assert.strictEqual(q.groups[0].event.saleCount, 1);
    const code = (await models.SaleEvent.findByPk(ev.id)).shortCode;
    const h = await admin.post('/admin/events/' + ev.id + '/moderate').send({ action: 'hide', note: 'Scam' });
    assert.strictEqual(h.status, 200);
    assert.strictEqual(h.body.resolved, 1);
    assert.strictEqual((await request(app).get('/events/' + ev.id)).status, 404);
    assert.strictEqual((await org.get('/events/' + ev.id)).body.hidden, true, 'organizer still sees it');
    assert.deepStrictEqual((await request(app).get('/search').query({ lat: C.lat, lng: C.lng, radius: 5 })).body.events, []);
    assert.strictEqual((await request(app).get('/post/' + p.id)).body.event, undefined, 'the sale stays, without the event');
    assert.strictEqual((await request(app).get('/s/' + code).set('User-Agent', UA)).status, 404);
    assert.strictEqual((await org.get('/events/' + ev.id + '/flyer.pdf')).status, 409);
    assert.strictEqual((await admin.get('/admin/events/reports')).body.hidden[0].id, ev.id);
    await admin.post('/admin/events/' + ev.id + '/moderate').send({ action: 'unhide' });
    assert.strictEqual((await request(app).get('/events/' + ev.id)).status, 200);
    const del = await admin.post('/admin/events/' + ev.id + '/moderate').send({ action: 'delete' });
    assert.strictEqual(del.body.event, null);
    assert.strictEqual(await models.EventParticipant.count(), 0);
    assert.strictEqual((await request(app).get('/post/' + p.id)).status, 200, 'sales survive their event');
  });

  it('short link redirects to the event and counts scans privately; organizer prints flyer and sign', async () => {
    const ev = await makeEvent(org, { joinMode: 'open' });
    const p = await sale(sam, 0.5);
    await join(sam, ev, p);
    const info = (await org.get('/events/' + ev.id + '/print')).body;
    assert.ok(/^https:\/\/garage\.example\/s\/[a-z0-9]{8}$/.test(info.shortUrl), info.shortUrl);
    assert.strictEqual((await sam.get('/events/' + ev.id + '/print')).status, 403);
    assert.strictEqual((await admin.get('/events/' + ev.id + '/print')).status, 200, 'admins see scan counts');
    const r = await request(app).get('/s/' + info.code).set('User-Agent', UA);
    assert.strictEqual(r.status, 302);
    assert.strictEqual(r.headers.location, 'https://garage.example/events/' + ev.id);
    await request(app).get('/s/' + info.code).set('User-Agent', UA); // repeat: not counted
    await org.get('/s/' + info.code).set('User-Agent', UA); // organizer: not counted
    assert.strictEqual((await org.get('/events/' + ev.id + '/print')).body.scans.total, 1);
    assert.strictEqual(await models.PostScanDay.count(), 0, 'post scans untouched');
    for (const layout of ['letter', 'half', 'sign']) {
      const pdf = await org.get('/events/' + ev.id + '/flyer.pdf').query({ layout, lang: 'ko' }).buffer(true).parse((res, cb) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => cb(null, Buffer.concat(c))); });
      assert.strictEqual(pdf.status, 200, layout);
      assert.strictEqual(pdf.headers['content-type'], 'application/pdf');
      assert.strictEqual(pdf.body.slice(0, 5).toString(), '%PDF-');
    }
    assert.strictEqual((await sam.get('/events/' + ev.id + '/flyer.pdf')).status, 403);
    assert.strictEqual((await org.get('/events/' + ev.id + '/flyer.pdf').query({ layout: 'poster' })).status, 400);
    const e = await models.SaleEvent.findByPk(ev.id);
    const d = flyer.flyerData(flyer.eventAsPost(e, [{ title: 'Sale 0.5', street: '0.5 mi St' }]), { kind: 'event', lang: 'en', url: info.shortUrl });
    assert.strictEqual(d.headline, 'Neighborhood sale');
    assert.strictEqual(d.title, 'Elm Street Block Sale');
    assert.strictEqual(d.street, "Hell's Kitchen, New York");
    assert.deepStrictEqual(d.items, [{ name: 'Sale 0.5', price: '0.5 mi St' }]);
    assert.strictEqual(d.when.length, 2);
    const ko = flyer.flyerData(flyer.eventAsPost(e, []), { kind: 'event', lang: 'ko' });
    assert.notStrictEqual(ko.headline, 'Neighborhood sale');
  });

  it('organizer edits and deletes; the area is fixed', async () => {
    const ev = await makeEvent(org);
    assert.strictEqual((await sam.put('/events/' + ev.id).send({ name: 'X' })).status, 403);
    const u = await org.put('/events/' + ev.id).send({ name: 'Elm St Sale', joinMode: 'open', schedule: sched([d1]) });
    assert.strictEqual(u.status, 200, JSON.stringify(u.body));
    assert.strictEqual(u.body.joinMode, 'open');
    assert.strictEqual(u.body.schedule.days.length, 1);
    assert.ok((await org.put('/events/' + ev.id).send({ radiusMiles: 5 })).body.error.details.radiusMiles);
    assert.strictEqual((await sam.delete('/events/' + ev.id)).status, 403);
    assert.strictEqual((await org.delete('/events/' + ev.id)).status, 204);
    assert.strictEqual((await request(app).get('/events/' + ev.id)).status, 404);
  });

  describe('alerts', () => {
    let sent;
    const transport = { sendMail: async (msg) => { sent.push(msg); return { messageId: 'x' }; } };
    beforeEach(() => {
      sent = [];
      process.env.SMTP_HOST = 'smtp.example';
      process.env.ALERT_DIGEST_MINUTES = '0';
      mailer.setTransport(transport);
    });
    afterEach(() => {
      delete process.env.SMTP_HOST;
      delete process.env.ALERT_DIGEST_MINUTES;
      mailer.setTransport(null);
    });

    it('groups sales of one neighborhood sale into one entry and never repeats a sale', async () => {
      await bea.post('/alerts').send({ lat: C.lat, lng: C.lng, radiusMiles: 10, label: 'Home' });
      const ev = await makeEvent(org, { joinMode: 'open' });
      const a = await sale(sam, 0.5);
      const b = await sale(org, 0.6);
      const c = await sale(sam, 4);
      await join(sam, ev, a);
      await join(org, ev, b);
      const s = await alerts.processQueue();
      assert.strictEqual(s.emails, 1);
      assert.strictEqual(sent.length, 1);
      const m = sent[0];
      assert.ok(m.text.includes('Neighborhood sale: Elm Street Block Sale'), m.text);
      assert.ok(m.text.includes('https://garage.example/events/' + ev.id));
      assert.ok(m.text.includes('2 sales'));
      assert.ok(m.text.includes('/post/' + c.id), 'the other sale is listed on its own');
      assert.ok(!m.text.includes('/post/' + a.id + '\n'), 'grouped sales link to the event instead');
      assert.ok(!/@example\.com/.test(m.text + m.html));
      // Leaving and re-joining, or a new event, never emails the same sale again.
      await sam.delete('/events/' + ev.id + '/participants/' + a.id);
      await join(sam, ev, a);
      assert.strictEqual((await alerts.processQueue()).emails, 0);
      assert.strictEqual(await models.AlertNotification.count({ where: { postId: a.id } }), 1);
    });
  });
});
