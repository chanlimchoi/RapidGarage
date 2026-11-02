import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldCheck, priceCheckMessage, priceInput, isCurrent } from '../app/lib/priceCheck.js';

test('only asks after 3 characters', () => {
  assert.equal(shouldCheck('la'), false);
  assert.equal(shouldCheck('  lam '), true);
  assert.equal(shouldCheck(null), false);
});

test('message keys and vars', () => {
  assert.equal(priceCheckMessage(null), null);
  assert.equal(priceCheckMessage({ words: [], enough: false }), null);
  assert.deepEqual(priceCheckMessage({ words: ['lamp'], enough: false, sample: 2, minSample: 5, radiusMiles: 25 }),
    { key: 'priceCheck.notEnough', vars: { count: 2, min: 5, miles: 25 } });
  assert.deepEqual(priceCheckMessage({ words: ['bike'], enough: true, sample: 7, medianCents: 2500, lowCents: 2000, highCents: 3000, radiusMiles: 25 }),
    { key: 'priceCheck.range', vars: { count: 7, median: 2500, low: 2000, high: 3000, miles: 25 } });
  assert.equal(priceCheckMessage({ words: ['bike'], enough: true, sample: 5, medianCents: 500, lowCents: 500, highCents: 500 }).key, 'priceCheck.same');
});

test('median as a price input', () => {
  assert.equal(priceInput(2500), '25');
  assert.equal(priceInput(750), '7.50');
  assert.equal(priceInput(0), '');
  assert.equal(priceInput(null), '');
});

test('stale answers are ignored', () => {
  assert.equal(isCurrent('lamp ', 'lamp'), true);
  assert.equal(isCurrent('lam', 'lamp'), false);
});
