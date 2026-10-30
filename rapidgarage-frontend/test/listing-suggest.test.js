import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patchFrom, basisText } from '../app/lib/listingSuggest.js';

const s = { source: 'similar', title: 'Tools for sale', category: 'tools', priceMin: 8, priceMax: 75, basis: 'similar', similarCount: 4 };

test('"Use all" fills title, category and prices as form strings (never submits)', () => {
  assert.deepEqual(patchFrom(s), { title: 'Tools for sale', category: 'tools', isFree: false, priceMin: '8', priceMax: '75' });
});

test('one part at a time', () => {
  assert.deepEqual(patchFrom(s, { title: true }), { title: 'Tools for sale' });
  assert.deepEqual(patchFrom(s, { category: true }), { category: 'tools' });
  assert.deepEqual(patchFrom(s, { price: true }), { isFree: false, priceMin: '8', priceMax: '75' });
});

test('unknown categories and missing prices are skipped', () => {
  assert.deepEqual(patchFrom({ title: 'x', category: 'cars', priceMin: null, priceMax: null }), { title: 'x' });
  assert.deepEqual(patchFrom(null), {});
});

test('the basis line names where the numbers came from', () => {
  assert.deepEqual(basisText({ source: 'ai' }), { key: 'suggest.fromAi', vars: {} });
  assert.deepEqual(basisText(s), { key: 'suggest.fromSimilar', vars: { count: 4 } });
  assert.deepEqual(basisText({ source: 'similar', basis: 'typical' }), { key: 'suggest.fromTypical', vars: {} });
});
