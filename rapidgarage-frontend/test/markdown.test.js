// node --test: last-hour markdown helpers (mirror of the server's rules).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { discounted, chipKind, markdownErrorKeys, markdownBody, markdownValues, isActive } from '../app/lib/markdown.js';

const NOW = new Date('2026-10-24T16:00:00Z');

describe('markdown helpers', () => {
  test('discounts round down to the cent, like the server', () => {
    assert.equal(discounted(999, 50), 499);
    assert.equal(discounted(1000, 25), 750);
    assert.equal(discounted(0, 50), 0);
    assert.equal(discounted(null, 50), null);
  });

  test('chips: running now, starting soon, or nothing', () => {
    const md = (o) => ({ markdown: Object.assign({ percent: 50, from: '14:00', lastDayOnly: false, active: false, startsAt: null, endsAt: null }, o) });
    assert.equal(chipKind(md({ active: true }), NOW), 'now');
    assert.ok(isActive(md({ active: true })));
    assert.equal(chipKind(md({ startsAt: '2026-10-24T18:00:00Z' }), NOW), 'soon');
    assert.equal(chipKind(md({ startsAt: '2026-10-26T18:00:00Z' }), NOW), null, 'more than 12 hours away');
    assert.equal(chipKind(md({}), NOW), null, 'nothing left');
    assert.equal(chipKind({ markdown: null }, NOW), null);
  });

  test('form checks match the server', () => {
    assert.deepEqual(markdownErrorKeys({ markdownPercent: '', markdownFrom: '' }), {});
    assert.deepEqual(Object.keys(markdownErrorKeys({ markdownPercent: '95', markdownFrom: '14:00' })), ['markdownPercent']);
    assert.deepEqual(Object.keys(markdownErrorKeys({ markdownPercent: '12.5', markdownFrom: '14:00' })), ['markdownPercent']);
    assert.deepEqual(Object.keys(markdownErrorKeys({ markdownPercent: '50', markdownFrom: '' })), ['markdownFrom']);
    assert.deepEqual(markdownErrorKeys({ markdownPercent: '50', markdownFrom: '14:00' }), {});
  });

  test('form values round-trip', () => {
    assert.deepEqual(markdownBody({ markdownPercent: '', markdownFrom: '14:00' }), { markdownPercent: null });
    assert.deepEqual(markdownBody({ markdownPercent: '50', markdownFrom: '14:00', markdownLastDay: true }), { markdownPercent: 50, markdownFrom: '14:00', markdownLastDay: true });
    assert.deepEqual(markdownValues({ markdown: { percent: 30, from: '13:30', lastDayOnly: true } }), { markdownPercent: '30', markdownFrom: '13:30', markdownLastDay: true });
    assert.deepEqual(markdownValues({ markdown: null }), { markdownPercent: '', markdownFrom: '', markdownLastDay: false });
  });
});
