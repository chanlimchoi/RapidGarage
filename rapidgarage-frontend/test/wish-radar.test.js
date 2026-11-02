import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barPercent, summary, splitTerms } from '../app/lib/wishRadar.js';

test('barPercent is relative with a visible minimum', () => {
  assert.equal(barPercent(0, 5), 0);
  assert.equal(barPercent(5, 5), 100);
  assert.equal(barPercent(1, 50), 8);
  assert.equal(barPercent(3, 0), 0);
});

test('summary hides exact totals below the minimum', () => {
  assert.deepEqual(summary({ hunters: null, fewerThan: 3, minHunters: 3 }), { key: 'radar.fewer', vars: { n: 3 } });
  assert.deepEqual(summary({ hunters: 7, minHunters: 3 }), { key: 'radar.hunters', vars: { count: 7 } });
  assert.equal(summary(null), null);
});

test('splitTerms separates items already listed', () => {
  const r = splitTerms([{ term: 'bike', onYourList: true }, { term: 'lamp', onYourList: false }, { term: 'crib' }]);
  assert.deepEqual(r.have.map((x) => x.term), ['bike']);
  assert.deepEqual(r.ideas.map((x) => x.term), ['lamp', 'crib']);
});
