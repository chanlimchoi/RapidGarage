const assert = require('assert');
const request = require('supertest');
const app = require('../app');
const models = require('../models');
const schedule = require('../lib/schedule');
const meetups = require('../lib/meetups');
const geo = require('../lib/geo');

const PW = 'correct-horse';
const H = 3600000;
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
// Brooklyn Heights sale; spots at known distances.
const SALE = { lat: 40.6939, lng: -73.9897 };

describe('safety: meetup spots and suggestions', function () {
  this.timeout(30000);
  let t0, now, seller, buyer, stranger, admin, sellerId, buyerId, adminId, postId, conv, spots;

  async function user(email, first, last) {
    const agent = request.agent(app);
    const r = await agent.post('/signup').send({ email, password: PW, firstName: first, lastName: last || 'Test' });
    assert.strictEqual(r.status, 201, JSON.stringify(r.body));
    return [agent, r.body.id];
  }
  const at = (h) => new Date(now.getTime() + h * H).toISOString();
  const propose = (agent, c, body) => agent.post('/conversations/' + c + '/meetups').send(body);
  const thread = async (agent, c) => (await agent.get('/conversations/' + c)).body;
  const unread = async (agent) => (await agent.get('/conversations/unread')).body.count;
  const mkSpot = (data) => admin.post('/admin/meetup-spots').send(data);

  beforeEach(async () => {
    await models.sequelize.sync({ force: true });
    t0 = new Date(); now = t0;
    schedule.setClock(() => now);
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GOOGLE_GEOCODING_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
    meetups.setPlacesProvider(null);
    [seller, sellerId] = await user('sam@example.com', 'Sam', 'Sellerson');
    [buyer, buyerId] = await user('bea@example.com', 'Bea', 'Buyer');
    [stranger] = await user('sue@example.com', 'Sue');
    [admin, adminId] = await user('ada@example.com', 'Ada', 'Admin');
    await models.User.update({ role: 'admin' }, { where: { id: adminId } });
    const d1 = ymd(new Date(t0.getTime() + 24 * H));
    const p = await seller.post('/post').send({ title: 'Moving sale', street: '12 Hicks St', city: 'Brooklyn', state: 'NY', zipCode: '11201',
      schedule: { timeZone: 'America/New_York', days: [{ date: d1, start: '08:00', end: '18:00' }] } });
    assert.strictEqual(p.status, 201, JSON.stringify(p.body));
    postId = p.body.id;
    await models.Post.update(SALE, { where: { id: postId } });
    conv = (await buyer.post('/conversations').send({ postId })).body.id;
    await buyer.post('/conversations/' + conv + '/messages').send({ body: 'Hi! Is the desk still there?' });
    spots = {};
    for (const [k, d] of [['police', { name: '84th Precinct exchange zone', kind: 'police', address: '301 Gold St', city: 'Brooklyn', state: 'NY', lat: 40.6943, lng: -73.9832, notes: 'Marked spaces under camera, 24/7.' }],
      ['library', { name: 'Brooklyn Heights Library', kind: 'library', address: '286 Cadman Plaza W', city: 'Brooklyn', state: 'NY', lat: 40.6957, lng: -73.9906 }],
      ['far', { name: 'Albany library', kind: 'library', city: 'Albany', state: 'NY', lat: 42.6526, lng: -73.7562 }],
      ['off', { name: 'Closed store', kind: 'store', city: 'Brooklyn', state: 'NY', lat: 40.694, lng: -73.99, active: false }]]) {
      const r = await mkSpot(d);
      assert.strictEqual(r.status, 201, JSON.stringify(r.body));
      spots[k] = r.body;
    }
  });
  after(() => { schedule.setClock(null); meetups.setPlacesProvider(null); geo.setProvider(null); });

  describe('admin: curated spots', () => {
    it('only admins can manage spots; fields are validated', async () => {
      assert.strictEqual((await seller.get('/admin/meetup-spots')).status, 403);
      assert.strictEqual((await seller.post('/admin/meetup-spots').send({ name: 'x', kind: 'police', lat: 1, lng: 1 })).status, 403);
      let r = await mkSpot({ name: '', kind: 'bar', lat: 100, lng: 1 });
      assert.strictEqual(r.status, 400);
      assert.deepStrictEqual(Object.keys(r.body.error.details).sort(), ['kind', 'lat', 'name']);
      // No coordinates and no server key: ask for them.
      r = await mkSpot({ name: 'Town library', kind: 'library', address: '1 Main St', city: 'Brooklyn', state: 'NY' });
      assert.strictEqual(r.status, 400);
      assert.match(r.body.error.details.lat, /latitude and longitude/);
      const list = (await admin.get('/admin/meetup-spots')).body;
      assert.strictEqual(list.results.length, 4);
      assert.deepStrictEqual(list.kinds, ['police', 'library', 'store', 'community', 'other']);
      assert.strictEqual(list.geocoding, false);
      assert.strictEqual((await admin.get('/admin/meetup-spots?active=false')).body.results.length, 1);
      assert.strictEqual((await admin.get('/admin/meetup-spots?q=precinct')).body.results[0].id, spots.police.id);
    });

    it('geocodes the address with the server key when coordinates are missing; edits and deletes', async () => {
      process.env.GOOGLE_GEOCODING_API_KEY = 'server-key';
      geo.resetRateLimits();
      const seen = [];
      geo.setProvider(async (address) => { seen.push(address); return { status: 'ok', lat: 40.7, lng: -73.99 }; });
      let r = await mkSpot({ name: 'Town library', kind: 'library', address: '1 Main St', city: 'Brooklyn', state: 'NY' });
      assert.strictEqual(r.status, 201, JSON.stringify(r.body));
      assert.deepStrictEqual([r.body.lat, r.body.lng, seen[0]], [40.7, -73.99, '1 Main St, Brooklyn, NY']);
      r = await admin.put('/admin/meetup-spots/' + r.body.id).send({ active: false, notes: 'Closed Sundays.' });
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual([r.body.active, r.body.notes, seen.length], [false, 'Closed Sundays.', 1]);
      assert.strictEqual((await admin.put('/admin/meetup-spots/' + r.body.id).send({})).status, 400);
      assert.strictEqual((await admin.delete('/admin/meetup-spots/' + r.body.id)).status, 204);
      assert.strictEqual((await admin.delete('/admin/meetup-spots/' + r.body.id)).status, 404);
      geo.setProvider(null);
    });
  });

  describe('spots in a conversation', () => {
    it('lists active spots nearest the sale area (not far or inactive ones), to both people only', async () => {
      for (const agent of [buyer, seller]) {
        const r = await agent.get('/conversations/' + conv + '/meetup-spots');
        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.body.results.map((s) => s.name), ['Brooklyn Heights Library', '84th Precinct exchange zone']);
        assert.deepStrictEqual(r.body.origin, { label: 'Brooklyn, NY', located: true });
        assert.strictEqual(r.body.placesSearch, false);
        assert.ok(r.body.results.every((s) => typeof s.distanceMiles === 'number' && s.lat === undefined && s.active === undefined));
        // Nothing about the people or the sale's street.
        assert.ok(!/Hicks|Sellerson|@example/.test(JSON.stringify(r.body)));
      }
      assert.strictEqual((await stranger.get('/conversations/' + conv + '/meetup-spots')).status, 404);
      assert.strictEqual((await admin.get('/conversations/' + conv + '/meetup-spots')).status, 404);
    });

    it('a sale without coordinates falls back to spots in its city and state', async () => {
      await models.Post.update({ lat: null, lng: null }, { where: { id: postId } });
      const r = await buyer.get('/conversations/' + conv + '/meetup-spots');
      assert.deepStrictEqual(r.body.results.map((s) => [s.name, s.distanceMiles]), [['84th Precinct exchange zone', null], ['Brooklyn Heights Library', null]]);
      assert.strictEqual(r.body.origin.located, false);
    });

    it('wanted-post conversations use the wanted area, with distances rounded to whole miles', async () => {
      const w = await buyer.post('/wanted').send({ title: 'Toddler car seat', areaLabel: 'Brooklyn Heights', lat: 40.6941, lng: -73.9899, radiusMiles: 3, emailEnabled: false });
      assert.strictEqual(w.status, 201, JSON.stringify(w.body));
      const c = (await seller.post('/conversations').send({ wantedId: w.body.id })).body.id;
      const r = await seller.get('/conversations/' + c + '/meetup-spots');
      assert.strictEqual(r.body.origin.label, 'Brooklyn Heights');
      assert.ok(r.body.results.every((s) => Number.isInteger(s.distanceMiles) && s.distanceMiles >= 1 && s.distanceApprox === true), JSON.stringify(r.body.results));
    });
  });

  describe('suggest, accept, decline, counter', () => {
    it('suggests a curated spot; both see a meetup message; the other is notified and accepts', async () => {
      const before = await unread(seller);
      const r = await propose(buyer, conv, { spotId: spots.police.id, meetAt: at(26), note: 'I can come after work.' });
      assert.strictEqual(r.status, 201, JSON.stringify(r.body));
      assert.strictEqual(r.body.status, 'pending');
      assert.deepStrictEqual([r.body.place.name, r.body.place.kind, r.body.place.address, r.body.mine], ['84th Precinct exchange zone', 'police', '301 Gold St', true]);
      assert.match(r.body.place.mapsUrl, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=40\.6943%2C-73\.9832$/);
      assert.strictEqual(await unread(seller), before + 1);
      const st = await thread(seller, conv);
      const m = st.messages[st.messages.length - 1];
      assert.strictEqual(m.kind, 'meetup');
      assert.deepStrictEqual([m.meetup.event, m.meetup.status, m.meetup.mine, m.meetup.note], ['proposed', 'pending', false, 'I can come after work.']);
      assert.match(m.body, /^Suggested meeting at “84th Precinct exchange zone” on \w{3}, \w{3} \d+, \d+:\d\d [AP]M E[DS]T\.$/);
      // Only one open suggestion at a time; the proposer can't answer their own.
      assert.strictEqual((await propose(seller, conv, { spotId: spots.library.id, meetAt: at(27) })).status, 409);
      assert.strictEqual((await buyer.post('/meetups/' + r.body.id + '/accept')).status, 403);
      assert.strictEqual((await seller.post('/meetups/' + r.body.id + '/cancel')).status, 403);
      assert.strictEqual((await stranger.post('/meetups/' + r.body.id + '/accept')).status, 404);
      assert.strictEqual((await admin.post('/meetups/' + r.body.id + '/accept')).status, 404);
      const a = await seller.post('/meetups/' + r.body.id + '/accept');
      assert.strictEqual(a.status, 200);
      assert.strictEqual(a.body.status, 'accepted');
      assert.strictEqual((await seller.post('/meetups/' + r.body.id + '/accept')).status, 409);
      const bt = await thread(buyer, conv);
      const ev = bt.messages.filter((x) => x.kind === 'meetup');
      assert.deepStrictEqual(ev.map((x) => [x.meetup.event, x.meetup.status]), [['proposed', 'accepted'], ['accepted', 'accepted']]);
      assert.match(ev[1].body, /^Agreed to meet at/);
      const list = (await buyer.get('/conversations/' + conv + '/meetups')).body;
      assert.deepStrictEqual([list.results.length, list.canPropose, list.pendingId], [1, true, null]);
      // Either person can call it off.
      const c = await buyer.post('/meetups/' + r.body.id + '/cancel');
      assert.strictEqual(c.body.status, 'cancelled');
    });

    it('counter: the old suggestion becomes countered and a new one waits for the first person', async () => {
      const r = await propose(buyer, conv, { spotId: spots.police.id, meetAt: at(26) });
      const c = await seller.post('/meetups/' + r.body.id + '/counter').send({ place: { name: 'Key Food on Montague St', address: '77 Montague St' }, meetAt: at(30) });
      assert.strictEqual(c.status, 201, JSON.stringify(c.body));
      assert.deepStrictEqual([c.body.status, c.body.counterOfId, c.body.place.kind, c.body.place.spotId, c.body.mine], ['pending', r.body.id, 'custom', null, true]);
      assert.match(c.body.place.mapsUrl, /query=Key%20Food%20on%20Montague%20St%2C%2077%20Montague%20St$/);
      // The old one is closed for its recipient; its proposer never could answer it.
      assert.strictEqual((await seller.post('/meetups/' + r.body.id + '/accept')).status, 409);
      assert.strictEqual((await buyer.post('/meetups/' + r.body.id + '/accept')).status, 403);
      assert.strictEqual((await seller.post('/meetups/' + c.body.id + '/accept')).status, 403);
      const d = await buyer.post('/meetups/' + c.body.id + '/decline');
      assert.strictEqual(d.body.status, 'declined');
      const ev = (await thread(seller, conv)).messages.filter((x) => x.kind === 'meetup').map((x) => [x.meetup.id, x.meetup.event, x.meetup.status]);
      assert.deepStrictEqual(ev, [[r.body.id, 'proposed', 'countered'], [c.body.id, 'countered', 'declined'], [c.body.id, 'declined', 'declined']]);
      // Now anyone can suggest again; the proposer can withdraw.
      const again = await propose(seller, conv, { spotId: spots.library.id, meetAt: at(40) });
      assert.strictEqual(again.status, 201);
      assert.strictEqual((await seller.post('/meetups/' + again.body.id + '/cancel')).body.status, 'cancelled');
    });

    it('validates the place and time', async () => {
      const bad = async (body, field) => {
        const r = await propose(buyer, conv, body);
        assert.strictEqual(r.status, 400, JSON.stringify(r.body));
        assert.ok(r.body.error.details[field], field + ' ' + JSON.stringify(r.body.error.details));
      };
      await bad({ meetAt: at(5) }, 'spotId');
      await bad({ spotId: spots.off.id, meetAt: at(5) }, 'spotId');
      await bad({ spotId: 999, meetAt: at(5) }, 'spotId');
      await bad({ place: { name: 'x' }, meetAt: at(5) }, 'place');
      await bad({ spotId: spots.police.id, meetAt: at(-1) }, 'meetAt');
      await bad({ spotId: spots.police.id, meetAt: at(15 * 24) }, 'meetAt');
      await bad({ spotId: spots.police.id }, 'meetAt');
      await bad({ spotId: spots.police.id, meetAt: at(5), note: 'x'.repeat(201) }, 'note');
      // A spot turned off later doesn't change a suggestion already made (it's a copy).
      const r = await propose(buyer, conv, { spotId: spots.library.id, meetAt: at(5) });
      await admin.put('/admin/meetup-spots/' + spots.library.id).send({ name: 'Renamed' });
      await admin.delete('/admin/meetup-spots/' + spots.library.id);
      const m = (await buyer.get('/conversations/' + conv + '/meetups')).body.results[0];
      assert.deepStrictEqual([m.id, m.place.name, m.place.spotId], [r.body.id, 'Brooklyn Heights Library', null]);
    });

    it('a suggestion nobody answered lapses at its time and tells the proposer', async () => {
      const r = await propose(buyer, conv, { spotId: spots.police.id, meetAt: at(2) });
      await thread(buyer, conv); // read up to now
      now = new Date(now.getTime() + 3 * H);
      assert.strictEqual(await unread(buyer), 1);
      const ev = (await thread(buyer, conv)).messages.filter((x) => x.kind === 'meetup').map((x) => [x.meetup.event, x.meetup.status]);
      assert.deepStrictEqual(ev, [['proposed', 'expired'], ['expired', 'expired']]);
      assert.strictEqual((await seller.post('/meetups/' + r.body.id + '/accept')).status, 409);
    });

    it('caps suggestions per person per conversation per day', async () => {
      for (let i = 0; i < meetups.PER_DAY; i++) {
        const r = await propose(buyer, conv, { spotId: spots.police.id, meetAt: at(5) });
        assert.strictEqual(r.status, 201);
        await buyer.post('/meetups/' + r.body.id + '/cancel');
      }
      assert.strictEqual((await propose(buyer, conv, { spotId: spots.police.id, meetAt: at(5) })).status, 429);
      assert.strictEqual((await propose(seller, conv, { spotId: spots.police.id, meetAt: at(5) })).status, 201);
    });
  });

  describe('blocking, bans and moderation', () => {
    it('blocking ends open suggestions and stops new ones; banned users cannot suggest', async () => {
      const r = await propose(buyer, conv, { spotId: spots.police.id, meetAt: at(26) });
      assert.strictEqual((await seller.post('/conversations/' + conv + '/block')).status, 200);
      const p = await models.MeetupProposal.findByPk(r.body.id);
      assert.deepStrictEqual([p.status, p.endedReason], ['cancelled', 'blocked']);
      assert.strictEqual((await propose(buyer, conv, { spotId: spots.police.id, meetAt: at(26) })).status, 403);
      assert.strictEqual((await buyer.get('/conversations/' + conv + '/meetups')).body.canPropose, false);
      await seller.delete('/conversations/' + conv + '/block');
      await models.User.update({ messagingBanned: true }, { where: { id: buyerId } });
      const b = await propose(buyer, conv, { spotId: spots.police.id, meetAt: at(26) });
      assert.strictEqual(b.status, 403);
      assert.strictEqual(b.body.error.code, 'messaging_banned');
      const s = await propose(seller, conv, { spotId: spots.police.id, meetAt: at(26) });
      assert.strictEqual((await buyer.post('/meetups/' + s.body.id + '/accept')).status, 403);
    });

    it('admins see meetup messages only once the conversation is reported', async () => {
      await propose(buyer, conv, { place: { name: 'Borough Hall steps' }, meetAt: at(26) });
      assert.strictEqual((await admin.get('/admin/conversations/' + conv)).status, 404);
      assert.strictEqual((await admin.get('/conversations/' + conv + '/meetups')).status, 404);
      await seller.post('/conversations/' + conv + '/report').send({ reason: 'scam' });
      const r = await admin.get('/admin/conversations/' + conv);
      assert.strictEqual(r.status, 200);
      const m = r.body.messages.filter((x) => x.kind === 'meetup');
      assert.strictEqual(m.length, 1);
      assert.match(m[0].body, /^Suggested meeting at “Borough Hall steps” on /);
    });
  });

  describe('optional nearby place search', () => {
    it('is off without a server Places key; with one it searches near the sale area', async () => {
      let r = await buyer.get('/conversations/' + conv + '/meetup-places?q=library');
      assert.strictEqual(r.status, 404);
      assert.strictEqual(r.body.error.code, 'places_unavailable');
      process.env.GOOGLE_PLACES_API_KEY = 'places-key';
      const calls = [];
      meetups.setPlacesProvider(async (q, origin, key) => {
        calls.push([q, origin.lat, origin.lng, key]);
        return { status: 'ok', results: [
          { name: 'Far Library', address: '9 Far Rd', lat: 40.75, lng: -73.99, type: 'library' },
          { name: 'Near Library', address: '1 Near St', lat: 40.695, lng: -73.99, type: 'library' },
          { name: null, lat: 1, lng: 1 },
        ] };
      });
      assert.strictEqual((await buyer.get('/conversations/' + conv + '/meetup-spots')).body.placesSearch, true);
      assert.strictEqual((await buyer.get('/conversations/' + conv + '/meetup-places?q=a')).status, 400);
      r = await buyer.get('/conversations/' + conv + '/meetup-places?q=library');
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.deepStrictEqual(r.body.results.map((p) => p.name), ['Near Library', 'Far Library']);
      assert.deepStrictEqual(calls[0], ['library', SALE.lat, SALE.lng, 'places-key']);
      assert.strictEqual((await stranger.get('/conversations/' + conv + '/meetup-places?q=library')).status, 404);
      // A searched place keeps its coordinates for the directions link.
      const p = await propose(buyer, conv, { place: { name: 'Near Library', address: '1 Near St', lat: 40.695, lng: -73.99 }, meetAt: at(5) });
      assert.match(p.body.place.mapsUrl, /query=40\.695%2C-73\.99$/);
      meetups.setPlacesProvider(async () => ({ status: 'error' }));
      assert.strictEqual((await buyer.get('/conversations/' + conv + '/meetup-places?q=library')).status, 502);
    });
  });
});
