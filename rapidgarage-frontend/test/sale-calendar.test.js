import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shift, fromQuery, toQuery, apiParams, totalSales, addDays } from '../app/lib/calendarView.js';

test('prev/next move a day in the day view and a week otherwise', () => {
  assert.equal(shift('day', '2026-11-07', 1), '2026-11-08');
  assert.equal(shift('weekend', '2026-11-07', -1), '2026-10-31');
  assert.equal(shift('week', '2026-12-28', 1), '2027-01-04');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('URL query round-trips and ignores bad values', () => {
  assert.deepEqual(fromQuery(''), { view: 'weekend', date: null, radius: 10, alert: null, zip: '', where: 'all' });
  const s = fromQuery('?view=week&date=2026-11-04&q=10036&radius=25');
  assert.deepEqual(s, { view: 'week', date: '2026-11-04', radius: 25, alert: null, zip: '10036', where: 'zip' });
  assert.equal(toQuery(s), '?view=week&date=2026-11-04&q=10036&radius=25');
  assert.equal(fromQuery('?alert=7&q=10036').where, 'alert');
  assert.deepEqual(fromQuery('?view=month&date=nope&radius=7&alert=x'), { view: 'weekend', date: null, radius: 10, alert: null, zip: '', where: 'all' });
});

test('API params follow the chosen place', () => {
  const base = { view: 'day', date: '2026-11-07', radius: 5, alert: 3, zip: '10036' };
  assert.deepEqual(apiParams(Object.assign({ where: 'alert' }, base), null, 'America/New_York'), { view: 'day', tz: 'America/New_York', date: '2026-11-07', alert: 3 });
  assert.deepEqual(apiParams(Object.assign({ where: 'near' }, base), { lat: 1, lng: 2 }, 'UTC'), { view: 'day', tz: 'UTC', date: '2026-11-07', lat: 1, lng: 2, radius: 5 });
  assert.deepEqual(apiParams(Object.assign({ where: 'zip' }, base), null, 'UTC'), { view: 'day', tz: 'UTC', date: '2026-11-07', q: '10036', radius: 5 });
  assert.deepEqual(apiParams(Object.assign({ where: 'all' }, base), null, 'UTC'), { view: 'day', tz: 'UTC', date: '2026-11-07' });
  assert.equal(totalSales({ days: [{ sales: [1, 2] }, { sales: [] }, { sales: [3] }] }), 3);
});

test('the night-before bell line names the sale and its hours', async () => {
  const { notificationText } = await import('../app/lib/savedSearch.js');
  const line = notificationText({ kind: 'reminder_eve', post: { id: 1, title: 'Moving sale' }, data: { date: '2026-11-07', start: '08:00', end: '12:30', timeZone: 'America/New_York' } });
  assert.equal(line, 'Tomorrow: Moving sale, 8 AM–12:30 PM');
  assert.equal(notificationText({ kind: 'reminder_eve', post: { id: 1, title: 'X' }, data: {} }), 'Tomorrow: X');
});
