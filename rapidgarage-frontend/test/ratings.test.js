// node --test: the conversation rating strip (lib/ratePrompt.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ratePrompt } from '../app/lib/ratePrompt.js';

const other = { id: 2, name: 'Sam S.' };
test('buyer before the meetup or sale: a hint; after: the strip', () => {
  assert.equal(ratePrompt({ other, canRate: false, reason: 'needs_transaction' }), 'hint');
  assert.equal(ratePrompt({ other, canRate: true, reason: null }), 'strip');
});
test('seller: nothing unless a rating exists', () => {
  assert.equal(ratePrompt({ other, canRate: false, reason: 'buyer_only' }), 'none');
  assert.equal(ratePrompt({ other, canRate: false, reason: 'buyer_only', theirs: { stars: 5 } }), 'strip');
});
test('blocked with an old rating still shows it; nothing loaded: none', () => {
  assert.equal(ratePrompt({ other, canRate: false, reason: 'blocked', mine: { stars: 2 } }), 'strip');
  assert.equal(ratePrompt({ other, canRate: false, reason: 'blocked' }), 'none');
  assert.equal(ratePrompt(null), 'none');
});
