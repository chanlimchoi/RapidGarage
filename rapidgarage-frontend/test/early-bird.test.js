// node --test: early-bird helpers (app/lib/earlyBird.js) and the bell line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { earlyValues, earlyBody, earlyState, EARLY_CHOICES } from '../app/lib/earlyBird.js';
import { notificationText } from '../app/lib/savedSearch.js';

test('form values round-trip; blank turns it off', () => {
  assert.deepEqual(earlyValues({ earlyBird: { minutes: 60, forYou: true } }), { earlyMinutes: '60' });
  assert.deepEqual(earlyValues({}), { earlyMinutes: '' });
  assert.deepEqual(earlyBody({ earlyMinutes: '90' }), { earlyMinutes: 90 });
  assert.deepEqual(earlyBody({ earlyMinutes: '' }), { earlyMinutes: null });
  assert.ok(EARLY_CHOICES.every((n) => n % 15 === 0 && n >= 15 && n <= 180));
});

test('earlyState: times only for people with access', () => {
  assert.equal(earlyState({}), null);
  assert.deepEqual(earlyState({ earlyBird: { offered: true, forYou: false } }), { kind: 'offered' });
  const e = { minutes: 60, forYou: true, startsAt: '2026-11-01T13:00:00Z', until: '2026-11-01T14:00:00Z' };
  assert.equal(earlyState({ earlyBird: Object.assign({ active: false }, e) }).kind, 'upcoming');
  assert.equal(earlyState({ earlyBird: Object.assign({ active: true }, e) }).kind, 'active');
  assert.equal(earlyState({ earlyBird: { minutes: 60, forYou: true, startsAt: null } }), null, 'no window left');
});

test('bell line for early_bird', () => {
  const line = notificationText({ kind: 'early_bird', post: { title: 'Estate sale' }, data: { until: '2026-11-01T14:00:00Z' } });
  assert.match(line, /^Early-bird access is open at “Estate sale” until /);
  assert.equal(notificationText({ kind: 'early_bird', post: { title: 'X' }, data: {} }), 'Early-bird access is open at “X”.');
});
