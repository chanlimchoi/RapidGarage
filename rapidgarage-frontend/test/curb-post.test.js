import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curbPostBody, minutesLeft, radiusLabel, HOUR_CHOICES, DEFAULT_HOURS, RADIUS_CHOICES } from '../app/lib/curbPost.js';

test('quick curb post body: location from the device or a street + zip', () => {
  const a = curbPostBody({ title: ' Couch ', note: '', hours: '4', coords: { lat: 40.7, lng: -73.9 } });
  assert.deepEqual(a.errors, {});
  assert.deepEqual(a.body, { title: 'Couch', note: undefined, hours: 4, lat: 40.7, lng: -73.9 });
  const b = curbPostBody({ street: '5 Elm St', zipCode: '10036' });
  assert.deepEqual(b.errors, {});
  assert.equal(b.body.hours, DEFAULT_HOURS);
  assert.equal(b.body.street, '5 Elm St');
  assert.equal(curbPostBody({}).errors.location, 'quick.errLocation');
  assert.equal(curbPostBody({ street: 'x', zipCode: '123' }).errors.zipCode, 'quick.errZip');
  assert.equal(curbPostBody({ coords: { lat: 1, lng: 1 }, hours: 13 }).errors.hours, 'quick.errHours');
  assert.equal(curbPostBody({ coords: { lat: 1, lng: 1 }, title: 'x'.repeat(81) }).errors.title, 'quick.errTitle');
  assert.equal(curbPostBody({ coords: { lat: 1, lng: 1 }, note: 'x'.repeat(201) }).errors.note, 'quick.errNote');
});

test('choices match the backend and time left never goes negative', () => {
  assert.deepEqual(RADIUS_CHOICES, [0.5, 1, 2, 3, 5, 10]);
  assert.ok(HOUR_CHOICES.includes(DEFAULT_HOURS) && Math.max(...HOUR_CHOICES) === 12);
  const now = new Date('2026-10-31T12:00:00Z');
  assert.equal(minutesLeft('2026-10-31T13:30:00Z', now), 90);
  assert.equal(minutesLeft('2026-10-31T11:00:00Z', now), 0);
  assert.equal(minutesLeft('nope', now), 0);
  assert.equal(radiusLabel(0.5), '0.5 mi');
});
