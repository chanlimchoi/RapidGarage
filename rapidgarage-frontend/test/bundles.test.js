import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundleValues, bundleBody, bundleErrorKeys, bundleCents, quote, groupHolds, lead } from '../app/lib/bundles.js';

test('bundle form values round-trip and need both fields', () => {
  assert.deepEqual(bundleValues({ bundle: { minItems: 3, percent: 20 } }), { bundleMinItems: '3', bundlePercent: '20' });
  assert.deepEqual(bundleValues({ bundle: null }), { bundleMinItems: '', bundlePercent: '' });
  assert.deepEqual(bundleBody({ bundleMinItems: '3', bundlePercent: '20' }), { bundleMinItems: 3, bundlePercent: 20 });
  assert.deepEqual(bundleBody({ bundleMinItems: '3', bundlePercent: '' }), { bundleMinItems: null, bundlePercent: null });
  assert.deepEqual(bundleErrorKeys({ bundleMinItems: '3', bundlePercent: '' }), { bundlePercent: 'bundle.errPercent' });
  assert.deepEqual(bundleErrorKeys({ bundleMinItems: '', bundlePercent: '10' }), { bundleMinItems: 'bundle.errMin' });
  assert.deepEqual(bundleErrorKeys({ bundleMinItems: '', bundlePercent: '' }), {});
});

test('bundle prices match the server (rounded down, current prices)', () => {
  assert.equal(bundleCents(1999, 15), 1699);
  const q = quote([{ nowCents: 4000 }, { nowCents: 1500 }, { nowCents: 0 }, { nowCents: null }], 20);
  assert.deepEqual(q, { count: 3, totalCents: 5500, bundleTotalCents: 4400, savedCents: 1100 });
});

test('holds are grouped into bundles; buttons act on an open hold', () => {
  const list = [
    { id: 9, bundleKey: 'b', status: 'pending' }, { id: 8, bundleKey: 'b', status: 'declined' },
    { id: 7 }, { id: 6, bundleKey: 'a', status: 'cancelled' }, { id: 5, bundleKey: 'a', status: 'cancelled' },
  ];
  const g = groupHolds(list);
  assert.deepEqual(g.map((x) => (x.key ? x.key + ':' + x.holds.map((h) => h.id).join(',') : x.hold.id)), ['b:8,9', 7, 'a:5,6']);
  assert.equal(lead(g[0]).id, 9);
  assert.equal(lead(g[2]).id, 5);
});

test('bundle events read as one line naming every item', async () => {
  const { holdEventText } = await import('../app/messages/holdText.js');
  const m = (event, mine, cents) => ({ mine, body: 'x', hold: { event, cents, bundle: { count: 3, items: ['Desk', 'Lamp', 'Mug'] } } });
  assert.equal(holdEventText(m('bundle_requested', false, 4400), 'Bea T.'), 'Bea T. asked for a bundle: Desk, Lamp, and Mug for $44.');
  assert.equal(holdEventText(m('bundle_accepted', true, 4400), 'Bea T.'), 'You accepted the bundle: Desk, Lamp, and Mug for $44.');
  assert.equal(holdEventText(m('bundle_declined', false, null), 'Sam T.'), 'Sam T. declined your bundle: Desk, Lamp, and Mug.');
  assert.equal(holdEventText(m('bundle_cancelled', true, null), 'Sam T.'), 'You cancelled the bundle: Desk, Lamp, and Mug.');
});
