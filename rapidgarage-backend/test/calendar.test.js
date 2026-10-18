const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const geo = require('../lib/geo');
const alerts = require('../lib/alerts');
const mailer = require('../lib/mailer');
const schedule = require('../lib/schedule');
const ics = require('../lib/ics');
const reminders = require('../lib/reminders');

const PW = 'correct-horse';
const C = { lat: 40.758, lng: -73.9855 };
const HOUR = 3600000;
const TZ = 'America/New_York';
function fakeProvider(address) {
  const m = /([\d.]+) mi St/.exec(address);
  if (!m) return Promise.resolve({ status: 'not_found' });
  return Promise.resolve({ status: 'ok', lat: C.lat + Number(m[1]) / 69.0, lng: C.lng });
}
const ENV = ['APP_BASE_URL', 'REMINDER_HOUR', 'REMINDER_LATE_HOURS', 'ALERT_DIGEST_MINUTES', 'SMTP_HOST'];
// Unfold RFC 5545 lines.
const unfold = (s) => s.replace(/\r\n /g, '');
const prop = (s, name) => unfold(s).split('\r\n').filter((l) => l.startsWith(name));

describe('add to calendar + morning-of reminders', function () {
  this.timeout(30000);
  let sam, samId, bea, beaId, tom, tomId, ada, adaId, sent, now, start;

  async function user(email, firstName, lastName) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName, lastName });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return [agent, r.body.id];
  }
  const transport = { sendMail: async (msg) => { sent.push(msg); return { messageId: 'x' + sent.length }; } };
  const dayN = (n) => schedule.localDate(new Date(start.getTime() + n * 24 * HOUR), TZ);
  // Sale on day+1 (and day+2 with two=true), 08:00-12:00 New York time.
  async function sale(extra, days) {
    const r = await sam.post('/post').send(Object.assign({ title: 'Moving sale', description: 'Furniture, lamps; books', street: '1 mi St', city: 'New York', state: 'NY', zipCode: '10036',
      schedule: { timeZone: TZ, days: days || [{ date: dayN(1), start: '08:00', end: '12:00' }] } }, extra));
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    await alerts.idle();
    return r.body;
  }
  const at = (n, hhmm) => { now = schedule.zonedToUtc(dayN(n), hhmm, TZ); };
  const remind = (agent, post, on) => agent.put('/saved/' + post.id + '/reminder').send({ on });
  const run = async () => (await alerts.processQueue(now)).reminders;

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
    [ada, adaId] = await user('ada@example.com', 'Ada', 'Ames');
  });
  after(() => {
    ENV.forEach((k) => delete process.env[k]);
    delete process.env.GOOGLE_MAPS_API_KEY;
    geo.setProvider(null);
    mailer.setTransport(null);
    schedule.setClock(null);
  });

  it('iCalendar basics: escaping, 75-octet folding, VTIMEZONE from real transitions', () => {
    assert.strictEqual(ics.escapeText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
    const long = 'SUMMARY:' + '동네 차고 세일 '.repeat(20);
    const folded = ics.fold(long);
    folded.split('\r\n').forEach((l) => assert.ok(Buffer.byteLength(l) <= 75, 'line too long: ' + Buffer.byteLength(l)));
    assert.strictEqual(folded.replace(/\r\n /g, ''), long, 'folding never splits a character');
    const ny = ics.vtimezone(TZ, [new Date('2026-10-18T12:00:00Z')]).join('\n');
    assert.ok(/BEGIN:DAYLIGHT\nDTSTART:20260308T020000\nTZOFFSETFROM:-0500\nTZOFFSETTO:-0400\nTZNAME:EDT/.test(ny), ny);
    assert.ok(/BEGIN:STANDARD\nDTSTART:20261101T020000\nTZOFFSETFROM:-0400\nTZOFFSETTO:-0500\nTZNAME:EST/.test(ny), ny);
    const seoul = ics.vtimezone('Asia/Seoul', [new Date('2026-10-18T00:00:00Z')]);
    assert.strictEqual(seoul.filter((l) => l.startsWith('BEGIN:STANDARD')).length, 1);
    assert.ok(seoul.includes('TZOFFSETTO:+0900'));
  });

  it('a sale\'s .ics: its time zone, stable UIDs, public address; SEQUENCE bumps and removed days are cancelled', async () => {
    const post = await sale({}, [{ date: dayN(1), start: '08:00', end: '12:00' }, { date: dayN(2), start: '09:30', end: '14:00' }]);
    let r = await request(app).get('/post/' + post.id + '/calendar.ics');
    assert.strictEqual(r.status, 200);
    assert.ok(/^text\/calendar/.test(r.headers['content-type']));
    assert.ok(/attachment; filename="moving-sale\.ics"/.test(r.headers['content-disposition']));
    const body = r.text;
    assert.ok(body.endsWith('\r\n') && !/[^\r]\n/.test(body), 'CRLF line endings');
    body.split('\r\n').forEach((l) => assert.ok(Buffer.byteLength(l) <= 75));
    assert.ok(body.includes('BEGIN:VTIMEZONE\r\nTZID:America/New_York'));
    const ymd = (d) => d.replace(/-/g, '');
    assert.deepStrictEqual(prop(body, 'DTSTART;'), ['DTSTART;TZID=America/New_York:' + ymd(dayN(1)) + 'T080000', 'DTSTART;TZID=America/New_York:' + ymd(dayN(2)) + 'T093000']);
    assert.deepStrictEqual(prop(body, 'UID:'), ['UID:rapidgarage-post-' + post.id + '-' + dayN(1) + '@garage.example', 'UID:rapidgarage-post-' + post.id + '-' + dayN(2) + '@garage.example']);
    assert.deepStrictEqual(prop(body, 'SEQUENCE:'), ['SEQUENCE:0', 'SEQUENCE:0']);
    assert.deepStrictEqual(prop(body, 'LOCATION:'), ['LOCATION:1 mi St\\, New York\\, NY\\, 10036', 'LOCATION:1 mi St\\, New York\\, NY\\, 10036']);
    assert.ok(unfold(body).includes('DESCRIPTION:Furniture\\, lamps\\; books\\n\\nhttps://garage.example/post/' + post.id));
    assert.ok(!/@example\.com/.test(body), 'no emails');
    // Same request twice: same UIDs (re-import updates instead of duplicating).
    assert.deepStrictEqual(prop((await request(app).get('/post/' + post.id + '/calendar.ics')).text, 'UID:'), prop(body, 'UID:'));
    // A change a calendar shows bumps SEQUENCE; one it doesn't (price) leaves it.
    await sam.put('/post/' + post.id).send({ priceMin: 1 });
    assert.deepStrictEqual(prop((await request(app).get('/post/' + post.id + '/calendar.ics')).text, 'SEQUENCE:'), ['SEQUENCE:0', 'SEQUENCE:0']);
    await sam.put('/post/' + post.id).send({ title: 'Big moving sale' });
    r = await request(app).get('/post/' + post.id + '/calendar.ics');
    assert.deepStrictEqual(prop(r.text, 'SEQUENCE:'), ['SEQUENCE:1', 'SEQUENCE:1']);
    assert.deepStrictEqual(prop(r.text, 'SUMMARY:'), ['SUMMARY:Big moving sale', 'SUMMARY:Big moving sale']);
    // Drop day 2 and move day 1: SEQUENCE 2, day 2 comes back as CANCELLED with its UID.
    const ch = await sam.put('/post/' + post.id).send({ schedule: { timeZone: TZ, days: [{ date: dayN(1), start: '10:00', end: '13:00' }] } });
    assert.strictEqual(ch.status, 200, JSON.stringify(ch.body));
    assert.strictEqual(ch.body.calendarDates, undefined, 'history is not in the post JSON');
    r = await request(app).get('/post/' + post.id + '/calendar.ics');
    assert.deepStrictEqual(prop(r.text, 'SEQUENCE:'), ['SEQUENCE:2', 'SEQUENCE:2']);
    assert.deepStrictEqual(prop(r.text, 'STATUS:'), ['STATUS:CONFIRMED', 'STATUS:CANCELLED']);
    assert.deepStrictEqual(prop(r.text, 'DTSTART;'), ['DTSTART;TZID=America/New_York:' + ymd(dayN(1)) + 'T100000', 'DTSTART;TZID=America/New_York:' + ymd(dayN(2)) + 'T093000']);
    // Hidden: like a missing post for everyone but the owner. No dates: 404.
    await models.Post.update({ hidden: true }, { where: { id: post.id } });
    assert.strictEqual((await bea.get('/post/' + post.id + '/calendar.ics')).status, 404);
    assert.strictEqual((await sam.get('/post/' + post.id + '/calendar.ics')).status, 200);
    const undated = await sam.post('/post').send({ title: 'Someday sale', street: '2 mi St', city: 'New York', state: 'NY', zipCode: '10036' });
    assert.strictEqual((await request(app).get('/post/' + undated.body.id + '/calendar.ics')).status, 404);
  });

  it('a sale in another time zone is written in that zone', async () => {
    const post = await sale({ title: 'LA sale' }, undefined);
    await sam.put('/post/' + post.id).send({ schedule: { timeZone: 'America/Los_Angeles', days: [{ date: dayN(3), start: '08:00', end: '12:00' }] } });
    const body = (await request(app).get('/post/' + post.id + '/calendar.ics')).text;
    assert.ok(body.includes('TZID:America/Los_Angeles'));
    // The old New York day is cancelled, in New York time (both zones get a VTIMEZONE).
    assert.deepStrictEqual(prop(body, 'DTSTART;'), ['DTSTART;TZID=America/Los_Angeles:' + dayN(3).replace(/-/g, '') + 'T080000', 'DTSTART;TZID=America/New_York:' + dayN(1).replace(/-/g, '') + 'T080000']);
    assert.deepStrictEqual(prop(body, 'STATUS:'), ['STATUS:CONFIRMED', 'STATUS:CANCELLED']);
    assert.deepStrictEqual(prop(body, 'TZID:'), ['TZID:America/Los_Angeles', 'TZID:America/New_York']);
    assert.deepStrictEqual(prop(body, 'SEQUENCE:'), ['SEQUENCE:1', 'SEQUENCE:1']);
  });

  it('a neighborhood sale\'s .ics uses only its public area label', async () => {
    const r = await sam.post('/events').send({ name: 'Elm Street Block Sale', areaLabel: "Hell's Kitchen, New York", lat: C.lat, lng: C.lng, radiusMiles: 1, joinMode: 'open',
      schedule: { timeZone: TZ, days: [{ date: dayN(2), start: '09:00', end: '15:00' }] } });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    let body = (await request(app).get('/events/' + r.body.id + '/calendar.ics')).text;
    assert.deepStrictEqual(prop(body, 'UID:'), ['UID:rapidgarage-event-' + r.body.id + '-' + dayN(2) + '@garage.example']);
    assert.deepStrictEqual(prop(body, 'LOCATION:'), ["LOCATION:Hell's Kitchen\\, New York"]);
    assert.deepStrictEqual(prop(body, 'SEQUENCE:'), ['SEQUENCE:0']);
    await sam.put('/events/' + r.body.id).send({ schedule: { timeZone: TZ, days: [{ date: dayN(3), start: '09:00', end: '15:00' }] } });
    body = (await request(app).get('/events/' + r.body.id + '/calendar.ics')).text;
    assert.deepStrictEqual(prop(body, 'SEQUENCE:'), ['SEQUENCE:1', 'SEQUENCE:1']);
    assert.deepStrictEqual(prop(body, 'STATUS:'), ['STATUS:CONFIRMED', 'STATUS:CANCELLED']);
    await models.SaleEvent.update({ hidden: true }, { where: { id: r.body.id } });
    assert.strictEqual((await request(app).get('/events/' + r.body.id + '/calendar.ics')).status, 404);
  });

  it('saved sales (and the weekend route) as one .ics: same UIDs, nothing ended, login required', async () => {
    const a = await sale({ title: 'Sale A' });
    const b = await sale({ title: 'Sale B', street: '2 mi St' }, [{ date: dayN(1), start: '13:00', end: '15:00' }]);
    await bea.put('/saved/' + a.id);
    await bea.put('/saved/' + b.id);
    assert.strictEqual((await request(app).get('/saved/calendar.ics')).status, 401);
    const r = await bea.get('/saved/calendar.ics');
    assert.strictEqual(r.status, 200);
    assert.ok(/filename="rapidgarage-saved-all\.ics"/.test(r.headers['content-disposition']));
    assert.strictEqual(prop(r.text, 'BEGIN:VTIMEZONE').length, 1, 'one VTIMEZONE per zone');
    assert.deepStrictEqual(prop(r.text, 'UID:').sort(), [prop((await request(app).get('/post/' + a.id + '/calendar.ics')).text, 'UID:')[0], prop((await request(app).get('/post/' + b.id + '/calendar.ics')).text, 'UID:')[0]].sort());
    assert.ok(prop(r.text, 'X-WR-CALNAME:')[0].includes('saved sales'));
    at(1, '14:00'); // A is over, B is open
    assert.deepStrictEqual(prop((await bea.get('/saved/calendar.ics')).text, 'SUMMARY:'), ['SUMMARY:Sale B']);
    assert.strictEqual((await bea.get('/saved/calendar.ics?when=soon')).status, 400);
    assert.strictEqual((await bea.get('/saved/calendar.ics?when=today')).status, 200);
    const ko = await bea.get('/saved/calendar.ics?when=weekend').set('Accept-Language', 'ko');
    assert.strictEqual(ko.status, 200);
    assert.ok(prop(ko.text, 'X-WR-CALNAME:')[0].includes('주말'));
  });

  it('reminder window: 7 am local, or an hour before an early sale; never later than 3 hours after or past the end', () => {
    const d = (date, s, e) => ({ date, startsAt: schedule.zonedToUtc(date, s, TZ), endsAt: schedule.zonedToUtc(date, e, TZ) });
    let w = reminders.windowFor(d('2026-10-18', '08:00', '12:00'), TZ);
    assert.strictEqual(new Date(w.sendAt).toISOString(), schedule.zonedToUtc('2026-10-18', '07:00', TZ).toISOString());
    assert.strictEqual(new Date(w.until).toISOString(), schedule.zonedToUtc('2026-10-18', '10:00', TZ).toISOString());
    w = reminders.windowFor(d('2026-10-18', '06:00', '09:00'), TZ);
    assert.strictEqual(new Date(w.sendAt).toISOString(), schedule.zonedToUtc('2026-10-18', '05:00', TZ).toISOString());
    w = reminders.windowFor(d('2026-10-18', '07:00', '08:30'), TZ);
    assert.strictEqual(new Date(w.until).toISOString(), schedule.zonedToUtc('2026-10-18', '08:30', TZ).toISOString());
    // Seoul sale: 7 am Seoul time.
    const seoul = { date: '2026-10-18', startsAt: schedule.zonedToUtc('2026-10-18', '10:00', 'Asia/Seoul'), endsAt: schedule.zonedToUtc('2026-10-18', '15:00', 'Asia/Seoul') };
    assert.strictEqual(new Date(reminders.windowFor(seoul, 'Asia/Seoul').sendAt).toISOString(), '2026-10-17T22:00:00.000Z');
    process.env.REMINDER_HOUR = '8';
    w = reminders.windowFor(d('2026-10-18', '10:00', '12:00'), TZ);
    assert.strictEqual(new Date(w.sendAt).toISOString(), schedule.zonedToUtc('2026-10-18', '08:00', TZ).toISOString());
  });

  it('opt in per saved sale or by default; one email + in-app notice per sale-day, with times and the route link', async () => {
    const post = await sale({}, [{ date: dayN(1), start: '08:00', end: '12:00' }, { date: dayN(2), start: '09:00', end: '11:00' }]);
    // Bea opts in from the sale page (this saves it); Tom just saves (default off).
    let r = await remind(bea, post, true);
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body, { saved: true, postId: post.id, remind: true });
    assert.strictEqual((await tom.put('/saved/' + post.id)).body.remind, false);
    // Ada turns the default on in settings, then saves.
    r = await ada.put('/reminders/settings').send({ defaultOn: true });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.defaultOn, true);
    assert.strictEqual((await ada.put('/saved/' + post.id)).body.remind, true);
    assert.deepStrictEqual((await ada.get('/saved/ids')).body.reminders, [post.id]);
    assert.strictEqual((await ada.get('/saved')).body.results[0].remind, true);
    assert.strictEqual((await sam.put('/saved/' + post.id + '/reminder').send({ on: true })).status, 400, 'not your own sale');
    assert.strictEqual((await bea.put('/saved/' + post.id + '/reminder').send({ on: 'yes' })).status, 400);

    at(1, '06:30');
    assert.strictEqual((await run()).queued, 0);
    assert.strictEqual(sent.length, 0);
    at(1, '07:05');
    let s = await run();
    assert.strictEqual(s.emails, 2, JSON.stringify(s));
    const toBea = sent.find((m) => m.to === 'bea@example.com');
    assert.ok(toBea && sent.some((m) => m.to === 'ada@example.com') && !sent.some((m) => m.to === 'tom@example.com'));
    assert.strictEqual(toBea.subject, 'Today: Moving sale · 8:00 AM – 12:00 PM');
    assert.ok(toBea.text.includes('8:00 AM – 12:00 PM'), toBea.text);
    assert.ok(toBea.text.includes('1 mi St, New York, NY, 10036'));
    assert.ok(toBea.text.includes('https://garage.example/saved?when=today#route'));
    assert.ok(toBea.text.includes('https://garage.example/post/' + post.id));
    assert.ok(/<https:\/\/garage\.example\/api\/reminders\/unsubscribe\?r=\d+&t=/.test(toBea.headers['List-Unsubscribe']));
    assert.ok(!toBea.html.includes('sam@example.com') && !toBea.text.includes('Stone'), 'no seller details');
    // Dedupe: later passes that morning send nothing more.
    at(1, '07:30');
    s = await run();
    assert.strictEqual(sent.length, 2);
    assert.strictEqual(await models.SaleReminder.count(), 2);
    // In-app notice + nav badge, dismissable.
    const today = (await bea.get('/reminders/today')).body.results;
    assert.strictEqual(today.length, 1);
    assert.strictEqual(today[0].postId, post.id);
    assert.strictEqual(today[0].title, 'Moving sale');
    assert.strictEqual((await bea.get('/conversations/unread')).body.reminders, 1);
    assert.deepStrictEqual((await tom.get('/reminders/today')).body.results, []);
    assert.strictEqual((await tom.post('/reminders/' + today[0].id + '/seen')).status, 404, 'not Tom\'s');
    assert.strictEqual((await bea.post('/reminders/' + today[0].id + '/seen')).status, 200);
    assert.strictEqual((await bea.get('/conversations/unread')).body.reminders, 0);
    // Day 2 gets its own reminder (09:00 sale: due at 07:00).
    at(2, '07:01');
    await run();
    assert.strictEqual(sent.length, 4);
    assert.strictEqual(sent[2].subject, 'Today: Moving sale · 9:00 AM – 11:00 AM');
  });

  it('written in the reader\'s language and the sale\'s time zone', async () => {
    const post = await sale();
    await models.User.update({ locale: 'ko' }, { where: { id: beaId } });
    await remind(bea, post, true);
    at(1, '07:00');
    await run();
    assert.strictEqual(sent.length, 1);
    assert.ok(sent[0].subject.startsWith('오늘: Moving sale'), sent[0].subject);
    assert.ok(sent[0].text.includes('오늘 경로 짜기'));
    assert.strictEqual(sent[0].headers['Content-Language'], 'ko');
  });

  it('saving late in the morning, after the window, sends nothing that day', async () => {
    const post = await sale({}, [{ date: dayN(1), start: '08:00', end: '16:00' }]);
    at(1, '10:30');
    await remind(bea, post, true);
    await run();
    assert.strictEqual(sent.length, 0);
    assert.strictEqual(await models.SaleReminder.count(), 0);
  });

  it('skipped when the sale is hidden, the day was cancelled, the users are blocked, or reminders were turned off', async () => {
    const hidden = await sale({ title: 'Hidden sale' });
    const moved = await sale({ title: 'Moved sale', street: '2 mi St' });
    const blocked = await sale({ title: 'Blocked sale', street: '3 mi St' });
    const off = await sale({ title: 'Off sale', street: '4 mi St' });
    for (const p of [hidden, moved, blocked, off]) await remind(bea, p, true);
    await models.Post.update({ hidden: true }, { where: { id: hidden.id } });
    await sam.put('/post/' + moved.id).send({ schedule: { timeZone: TZ, days: [{ date: dayN(3), start: '08:00', end: '12:00' }] } });
    await remind(bea, off, false);
    at(1, '07:05');
    // Enqueue while not blocked, block before the email goes out.
    await reminders.enqueueDue(now);
    await models.UserBlock.create({ blockerId: samId, blockedId: beaId });
    const s = await run();
    const rows = await models.SaleReminder.findAll({ raw: true });
    // Hidden/moved/off sales never got a row; the blocked one was skipped.
    assert.deepStrictEqual(rows.map((r) => [r.postId, r.status, r.lastError]), [[blocked.id, 'skipped', 'blocked']]);
    assert.strictEqual(sent.length, 0, JSON.stringify(s));
    assert.deepStrictEqual((await bea.get('/reminders/today')).body.results, []);
  });

  it('a sale hidden after the reminder went out drops the in-app notice', async () => {
    const post = await sale();
    await remind(bea, post, true);
    at(1, '07:05');
    await run();
    assert.strictEqual((await bea.get('/reminders/today')).body.results.length, 1);
    await models.Post.update({ hidden: true }, { where: { id: post.id } });
    assert.strictEqual((await bea.get('/reminders/today')).body.results.length, 0);
    await models.Post.update({ hidden: false }, { where: { id: post.id } });
    at(1, '12:01'); // ended
    assert.strictEqual((await bea.get('/reminders/today')).body.results.length, 0);
  });

  it('without SMTP: logged and skipped, the in-app notice still shows', async () => {
    mailer.setTransport(null);
    const post = await sale();
    await remind(bea, post, true);
    at(1, '07:05');
    const logs = [];
    const orig = console.log;
    console.log = (m) => logs.push(String(m));
    let s;
    try { s = await run(); } finally { console.log = orig; }
    assert.strictEqual(s.reason, 'smtp_not_configured');
    assert.ok(logs.some((l) => /Sale reminders: SMTP is not configured/.test(l)), logs.join('\n'));
    const row = await models.SaleReminder.findOne({ raw: true });
    assert.strictEqual(row.status, 'skipped');
    assert.strictEqual(row.lastError, 'smtp_not_configured');
    assert.strictEqual((await bea.get('/reminders/today')).body.results.length, 1);
    assert.strictEqual((await bea.get('/reminders/settings')).body.emailAvailable, false);
  });

  it('two workers at once still send one email (DB claim)', async () => {
    const post = await sale();
    await remind(bea, post, true);
    at(1, '07:05');
    await Promise.all([reminders.processDue(now), reminders.processDue(now), reminders.processDue(now)]);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(await models.SaleReminder.count(), 1);
    assert.strictEqual((await models.SaleReminder.findOne()).status, 'sent');
  });

  it('a failed send retries with backoff but never after the sale ends', async () => {
    let fail = true;
    mailer.setTransport({ sendMail: async (msg) => { if (fail) { const e = new Error('down'); e.code = 'ECONNECTION'; throw e; } sent.push(msg); return {}; } });
    const post = await sale();
    await remind(bea, post, true);
    at(1, '07:05');
    await run();
    let row = await models.SaleReminder.findOne();
    assert.strictEqual(row.status, 'pending');
    assert.strictEqual(row.attempts, 1);
    fail = false;
    now = new Date(now.getTime() + 3 * 60000);
    await run();
    row = await models.SaleReminder.findOne();
    assert.strictEqual(row.status, 'sent');
    assert.strictEqual(sent.length, 1);
  });

  it('one-click unsubscribe turns every reminder off; bad tokens get a 400', async () => {
    const post = await sale();
    await bea.put('/reminders/settings').send({ defaultOn: true });
    await remind(bea, post, true);
    assert.strictEqual((await request(app).post('/reminders/unsubscribe').send({ r: beaId, t: 'x'.repeat(43) })).status, 400);
    assert.strictEqual((await request(app).post('/reminders/unsubscribe').send({ r: tomId, t: reminders.unsubscribeToken(beaId) })).status, 400);
    // RFC 8058: mail clients POST to the URL itself.
    const r = await request(app).post('/reminders/unsubscribe?r=' + beaId + '&t=' + reminders.unsubscribeToken(beaId)).send('List-Unsubscribe=One-Click');
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual((await models.User.findByPk(beaId)).remindSaved, false);
    assert.strictEqual((await models.SavedPost.findOne({ where: { userId: beaId } })).remind, false);
    at(1, '07:05');
    await run();
    assert.strictEqual(sent.length, 0);
    // Settings: turn on for every saved sale at once.
    const on = await bea.put('/reminders/settings').send({ defaultOn: true, applyToSaved: true });
    assert.strictEqual(on.body.changed, 1);
    assert.strictEqual((await bea.put('/reminders/settings').send({})).status, 400);
  });
});
