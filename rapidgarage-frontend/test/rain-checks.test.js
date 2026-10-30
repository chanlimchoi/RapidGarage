import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { dayLine, rainPrompt, postponedNote, dayName } from '../app/lib/weatherText.js';
import { notificationText, notificationLink } from '../app/lib/savedSearch.js';

describe('rain check text', () => {
  test('forecast chips and the seller prompt', () => {
    assert.equal(dayName('2030-05-04'), 'Sat, May 4');
    assert.equal(dayLine({ date: '2030-05-04', bad: true, reason: 'storm', pop: 90 }), 'Sat, May 4: Storms likely (90%)');
    assert.equal(dayLine({ date: '2030-05-04', bad: false, pop: 40 }), 'Sat, May 4: chance of rain 40%');
    assert.equal(dayLine({ date: '2030-05-04', bad: false, pop: 5 }), 'Sat, May 4: looks dry');
    assert.equal(rainPrompt({ date: '2030-05-04', reason: 'rain', pop: 80 }), 'Rain likely on Sat, May 4 (80%). Postpone the sale?');
    assert.equal(rainPrompt(null), '');
  });
  test('postponed note for two weeks', () => {
    const now = new Date('2030-05-05T12:00:00Z');
    assert.equal(postponedNote({ postponedAt: '2030-05-03T12:00:00Z', postponedFrom: '2030-05-04' }, now), 'Postponed from Sat, May 4');
    assert.equal(postponedNote({ postponedAt: '2030-04-01T12:00:00Z', postponedFrom: '2030-04-04' }, now), '');
    assert.equal(postponedNote({}, now), '');
  });
  test('bell lines for the seller and for people who saved it', () => {
    const post = { id: 7, title: 'Moving sale' };
    assert.equal(notificationText({ kind: 'rain_check', post, data: { date: '2030-05-04', reason: 'snow' } }), 'Snow likely on Sat, May 4 for “Moving sale”. Postpone it?');
    assert.equal(notificationText({ kind: 'sale_postponed', post, data: { date: '2030-05-11', start: '08:00', end: '14:00' } }), '“Moving sale” was postponed to Sat, May 11, 8 AM–2 PM.');
    assert.equal(notificationLink({ kind: 'sale_postponed', post }), '/post/7');
  });
});
