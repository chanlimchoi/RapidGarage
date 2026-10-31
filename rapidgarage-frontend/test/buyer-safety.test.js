import { test } from 'node:test';
import assert from 'node:assert/strict';
import { standingChip, hiddenKey, reasonCounts } from '../app/lib/reportSafety.js';

test('reporter standing chip', () => {
  assert.equal(standingChip(null), null);
  assert.deepEqual(standingChip({ dismissed: 6, upheld: 1, untrusted: true }), { key: 'untrusted', tone: 'warning' });
  assert.deepEqual(standingChip({ dismissed: 1, upheld: 2, untrusted: false }), { key: 'reliable', tone: 'success' });
  assert.equal(standingChip({ dismissed: 0, upheld: 0, untrusted: false }), null);
});

test('hidden source and reason ordering', () => {
  assert.deepEqual(['auto', 'repeat', 'moderator', null].map(hiddenKey), ['auto', 'repeat', 'moderator', 'moderator']);
  assert.deepEqual(reasonCounts({ scam: 1, no_show: 2, suspicious: 1 }).map((r) => r.reason), ['no_show', 'scam', 'suspicious']);
  assert.deepEqual(reasonCounts(null), []);
});
