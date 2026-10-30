import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { pickupEventText, pickupStatus, openSlots, slotText } from '../app/messages/pickupText.js';
import { holdTime } from '../app/messages/holdText.js';

const START = '2030-05-04T14:00:00Z';
const M = (event, mine, start) => ({ id: 1, kind: 'pickup', mine: !!mine, body: 'English summary', pickup: { id: 3, event, start: start || null } });

describe('pickup scheduling text', () => {
  test('thread lines for each step, mine and theirs', () => {
    assert.equal(pickupEventText(M('offered'), 'Sam S.'), 'Sam S. offered pickup times. Pick one.');
    assert.equal(pickupEventText(M('offered', true), 'Bea B.'), 'You offered pickup times.');
    assert.equal(pickupEventText(M('booked', false, START), 'Bea B.'), 'Bea B. booked pickup for ' + holdTime(START) + '.');
    assert.equal(pickupEventText(M('reschedule', true), 'Sam S.'), 'You asked to pick a different pickup time.');
    assert.equal(pickupEventText(M('cancelled'), 'Sam S.'), 'Sam S. cancelled the pickup.');
    assert.equal(pickupEventText(M('mystery'), 'Sam S.'), 'English summary');
  });
  test('slot ranges and the card status per role', () => {
    const slot = { start: START, end: '2030-05-04T14:30:00Z', past: false };
    assert.ok(slotText(slot).startsWith(holdTime(START) + ' – '));
    const plan = { status: 'offered', role: 'seller', slots: [slot, { start: '2020-01-01T00:00:00Z', past: true }] };
    assert.equal(pickupStatus(plan, 'Bea B.'), 'Waiting for Bea B. to pick a time.');
    assert.equal(pickupStatus(Object.assign({}, plan, { role: 'buyer' }), 'Sam S.'), 'Pick the time that works for you:');
    assert.equal(pickupStatus({ status: 'booked', chosen: slot }), 'Pickup booked: ' + slotText(slot));
    assert.equal(pickupStatus({ status: 'cancelled' }), 'The pickup was cancelled.');
    assert.deepEqual(openSlots(plan), [slot]);
    assert.deepEqual(openSlots(null), []);
  });
});
