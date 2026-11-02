import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSlots, localInput, openSlots, donationBell, donationLink } from '../app/lib/donations.js';

const now = new Date('2027-03-16T12:00:00Z');

test('slots: future, unique, sorted, at most 6', () => {
  const a = new Date('2027-03-17T15:00:00Z').toISOString();
  const b = new Date('2027-03-17T14:00:00Z').toISOString();
  assert.deepEqual(buildSlots([a, '', b, a], now), { slots: [b, a] });
  assert.deepEqual(buildSlots(['', ''], now), { error: 'donate.errNoSlot' });
  assert.deepEqual(buildSlots(['2027-03-16T11:00:00Z'], now), { error: 'donate.errSlotPast' });
  assert.deepEqual(buildSlots(['nope'], now), { error: 'donate.errSlot' });
  const many = Array.from({ length: 7 }, (_, i) => new Date(now.getTime() + (i + 1) * 3600000).toISOString());
  assert.deepEqual(buildSlots(many, now), { error: 'donate.errTooMany' });
});

test('datetime-local round trip in the browser zone', () => {
  const v = localInput('2027-03-17T15:30:00.000Z');
  assert.match(v, /^2027-03-1\dT\d\d:30$/);
  assert.equal(new Date(v).toISOString(), '2027-03-17T15:30:00.000Z');
  assert.equal(localInput('bad'), '');
});

test('open slots and bell wording/links', () => {
  assert.deepEqual(openSlots({ slots: [{ start: 'a', past: true }, { start: 'b', past: false }] }).map((s) => s.start), ['b']);
  const post = { id: 9, title: 'Moving sale' };
  assert.deepEqual(donationBell({ kind: 'donation_lot', post, data: { miles: 0.4 } }), { key: 'bell.donationLot', vars: { miles: 0.4 } });
  assert.equal(donationBell({ kind: 'donation_claimed', post, data: { name: 'Cal T.', org: 'Pantry' } }).key, 'bell.donationClaimedOrg');
  assert.equal(donationBell({ kind: 'donation_update', post, data: { event: 'done' } }).key, 'bell.donationDone');
  assert.equal(donationBell({ kind: 'price_drop' }), null);
  assert.equal(donationLink({ kind: 'donation_claimed', post }), '/post/9/donate');
  assert.equal(donationLink({ kind: 'donation_update', post, data: { event: 'released' } }), '/donations/9');
  assert.equal(donationLink({ kind: 'donation_lot', post }), '/donations/9');
});

test('bell text for donation notifications', async () => {
  const { notificationText } = await import('../app/lib/savedSearch.js');
  const post = { id: 9, title: 'Moving sale' };
  assert.match(notificationText({ kind: 'donation_lot', post, data: { miles: 0.4 } }), /Moving sale.*0\.4 mi/);
  assert.match(notificationText({ kind: 'donation_claimed', post, data: { name: 'Cal T.', org: 'Pantry' } }), /Cal T\. \(Pantry\)/);
  assert.match(notificationText({ kind: 'donation_update', post, data: { event: 'released' } }), /released/);
});
