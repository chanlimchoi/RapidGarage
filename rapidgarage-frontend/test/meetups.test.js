import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { syncMeetups, upcomingAgreed, meetupEventText, statusText, kindLabel } from '../app/messages/meetupText.js';

const M = (id, mid, event, status, extra) => ({ id, kind: 'meetup', mine: false, body: 'English summary', meetup: Object.assign({ id: mid, event, status, mine: false, place: { name: 'Library' }, meetAt: '2030-05-04T14:00:00Z' }, extra || {}) });

describe('meetup messages', () => {
  test('every card about a suggestion shows its newest status', () => {
    const out = syncMeetups([M(1, 9, 'proposed', 'pending'), { id: 2, body: 'hi' }, M(3, 9, 'accepted', 'accepted')]);
    assert.deepEqual(out.map((m) => m.meetup && [m.meetup.event, m.meetup.status]), [['proposed', 'accepted'], undefined, ['accepted', 'accepted']]);
  });
  test('the next agreed meetup still ahead', () => {
    const now = new Date('2030-05-01T00:00:00Z');
    assert.equal(upcomingAgreed([M(1, 9, 'proposed', 'pending')], now), null);
    const msgs = [M(1, 9, 'accepted', 'accepted'), M(2, 10, 'accepted', 'accepted', { meetAt: '2030-05-02T14:00:00Z' }), M(3, 11, 'accepted', 'accepted', { meetAt: '2030-04-02T14:00:00Z' })];
    assert.equal(upcomingAgreed(msgs, now).id, 10);
  });
  test('event lines and chips in English', () => {
    assert.equal(meetupEventText(M(1, 9, 'declined', 'declined'), 'Sam S.'), 'Sam S. declined meeting at Library.');
    assert.equal(meetupEventText(Object.assign(M(1, 9, 'cancelled', 'cancelled'), { mine: true }), 'Sam S.'), 'You called off meeting at Library.');
    assert.match(meetupEventText(M(1, 9, 'expired', 'expired'), 'Sam S.'), /^The suggestion to meet at Library expired/);
    assert.equal(meetupEventText(M(1, 9, 'mystery', null), 'Sam S.'), 'English summary');
    assert.equal(statusText({ status: 'pending', mine: true }, 'Sam S.'), 'Waiting for Sam S.');
    assert.equal(statusText({ status: 'pending', mine: false }, 'Sam S.'), 'Waiting for you');
    assert.equal(statusText({ status: 'cancelled', endedReason: 'blocked' }), 'Ended');
    assert.equal(kindLabel('police'), 'Police station exchange zone');
    assert.equal(kindLabel('custom'), 'Place they named');
  });
});
