import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByDue, progress, dueHeading, isOverdue, todayIn, DEFAULT_LABEL_KEYS } from '../app/lib/checklist.js';

const items = [
  { id: 1, key: 'flyers', dueDays: 3, dueDate: '2027-03-12', done: true },
  { id: 2, key: 'signs', dueDays: 1, dueDate: '2027-03-14', done: false },
  { id: 3, key: null, label: 'Table', dueDays: 1, dueDate: '2027-03-14', done: false },
  { id: 4, key: 'setup', dueDays: 0, dueDate: '2027-03-15', done: false },
];

test('groups furthest out first', () => {
  assert.deepEqual(groupByDue(items).map((g) => [g.dueDays, g.dueDate, g.items.map((i) => i.id)]), [[3, '2027-03-12', [1]], [1, '2027-03-14', [2, 3]], [0, '2027-03-15', [4]]]);
});

test('progress and headings', () => {
  assert.deepEqual(progress(items), { done: 1, total: 4, percent: 25 });
  assert.deepEqual(progress([]), { done: 0, total: 0, percent: 0 });
  assert.equal(dueHeading(0).key, 'checklist.due.saleDay');
  assert.equal(dueHeading(1).key, 'checklist.due.dayBefore');
  assert.deepEqual(dueHeading(3), { key: 'checklist.due.daysBefore', vars: { count: 3 } });
  assert.equal(Object.keys(DEFAULT_LABEL_KEYS).length, 5);
});

test('overdue by calendar day in the sale time zone (DST-safe)', () => {
  assert.equal(isOverdue(items[1], '2027-03-15'), true);
  assert.equal(isOverdue(items[1], '2027-03-14'), false);
  assert.equal(isOverdue(items[0], '2027-03-20'), false, 'done is never overdue');
  // 03:30 UTC on 3/14 is still 3/13 in New York (EST), 23:30 the night before the change.
  assert.equal(todayIn('America/New_York', new Date('2027-03-14T03:30:00Z')), '2027-03-13');
  // After the change (EDT, UTC-4): 04:30 UTC on 3/15 is 00:30 on 3/15.
  assert.equal(todayIn('America/New_York', new Date('2027-03-15T04:30:00Z')), '2027-03-15');
});

test('bell line and link for checklist reminders', async () => {
  const { notificationText, notificationLink } = await import('../app/lib/savedSearch.js');
  const n = { kind: 'checklist', post: { id: 7, title: 'Porch sale' }, data: { date: '2027-03-14', saleDate: '2027-03-15', count: 2 } };
  assert.match(notificationText(n), /Porch sale/);
  assert.match(notificationText(n), /2 things/);
  assert.equal(notificationLink(n), '/post/7/checklist');
  const today = notificationText(Object.assign({}, n, { data: { date: '2027-03-15', saleDate: '2027-03-15', count: 1 } }));
  assert.match(today, /is today: 1 thing/);
});
