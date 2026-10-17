// node --test: "Add to calendar" links.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { googleUrl, outlookUrl, calendarEvents, googleStamp, icsPath, savedIcsPath, details } from '../app/lib/calendar.js';

const NOW = new Date('2026-10-17T12:00:00Z');
const post = {
  id: 7, title: 'Moving sale & more', description: 'Couch, books', street: '12 N Hicks St', city: 'Brooklyn', state: 'NY', zipCode: '11201',
  schedule: { timeZone: 'America/New_York', days: [
    { date: '2026-10-16', startsAt: '2026-10-16T12:00:00Z', endsAt: '2026-10-16T20:00:00Z' },
    { date: '2026-10-18', startsAt: '2026-10-18T12:00:00Z', endsAt: '2026-10-18T20:00:00Z' },
  ] },
};

describe('add to calendar', () => {
  test('one link-ready event per upcoming day, ended days dropped', () => {
    const evs = calendarEvents(post, 'post', 'https://rg.example', NOW);
    assert.deepEqual(evs.map((e) => e.date), ['2026-10-18']);
    assert.equal(evs[0].location, '12 N Hicks St, Brooklyn, NY, 11201');
    assert.equal(evs[0].url, 'https://rg.example/post/7');
    assert.equal(evs[0].timeZone, 'America/New_York');
  });
  test('Google gets UTC stamps, the zone, title, address and a link back', () => {
    const u = new URL(googleUrl(calendarEvents(post, 'post', 'https://rg.example', NOW)[0]));
    assert.equal(u.host, 'calendar.google.com');
    assert.equal(u.searchParams.get('action'), 'TEMPLATE');
    assert.equal(u.searchParams.get('text'), 'Moving sale & more');
    assert.equal(u.searchParams.get('dates'), '20261018T120000Z/20261018T200000Z');
    assert.equal(u.searchParams.get('ctz'), 'America/New_York');
    assert.equal(u.searchParams.get('location'), '12 N Hicks St, Brooklyn, NY, 11201');
    assert.equal(u.searchParams.get('details'), 'Couch, books\n\nhttps://rg.example/post/7');
  });
  test('Outlook.com and Microsoft 365 compose links', () => {
    const ev = calendarEvents(post, 'post', 'https://rg.example', NOW)[0];
    const live = new URL(outlookUrl(ev, 'live'));
    const office = new URL(outlookUrl(ev, 'office'));
    assert.equal(live.host, 'outlook.live.com');
    assert.equal(office.host, 'outlook.office.com');
    assert.equal(live.searchParams.get('startdt'), '2026-10-18T12:00:00Z');
    assert.equal(live.searchParams.get('enddt'), '2026-10-18T20:00:00Z');
    assert.equal(live.searchParams.get('subject'), 'Moving sale & more');
    assert.equal(live.searchParams.get('rru'), 'addevent');
  });
  test('a neighborhood event shows only its area, never an address', () => {
    const ev = { id: 3, name: 'Hicks St block sale', areaLabel: 'Brooklyn Heights', street: 'x', schedule: post.schedule };
    const evs = calendarEvents(ev, 'event', '', NOW);
    assert.equal(evs[0].location, 'Brooklyn Heights');
    assert.equal(evs[0].url, '/events/3');
    assert.equal(icsPath(ev, 'event'), '/api/events/3/calendar.ics');
    assert.equal(icsPath(post, 'post'), '/api/post/7/calendar.ics');
    assert.equal(savedIcsPath('weekend'), '/api/saved/calendar.ics?when=weekend');
  });
  test('no schedule means no links; long descriptions are clipped', () => {
    assert.deepEqual(calendarEvents({ id: 1, title: 'x' }, 'post', '', NOW), []);
    assert.ok(details('a'.repeat(900), 'u').length < 610);
    assert.equal(googleStamp(Date.UTC(2026, 0, 2, 3, 4, 5)), '20260102T030405Z');
  });
});
