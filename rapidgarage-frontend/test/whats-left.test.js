// node --test: live "what's left" helpers (app/lib/whatsLeft.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeStatus, pollDelay, leftCount } from '../app/lib/whatsLeft.js';

const list = [{ id: 1, name: 'Lamp', sold: false, reserved: false }, { id: 2, name: 'Rug', sold: false, reserved: true, reservedUntil: 'x' }];

test('mergeStatus merges sold/reserved, keeps identity when nothing changed, asks to reload on add/remove', () => {
  const same = mergeStatus(list, { items: [{ id: 2, sold: false, reserved: true }, { id: 1, sold: false, reserved: false }] });
  assert.equal(same.changed, false);
  assert.equal(same.items, list);
  const sold = mergeStatus(list, { items: [{ id: 1, sold: true, reserved: false }, { id: 2, sold: false, reserved: false }] });
  assert.equal(sold.changed, true);
  assert.deepEqual(sold.items.map((i) => [i.id, i.sold, i.reserved, i.reservedUntil || null]), [[1, true, false, null], [2, false, false, null]]);
  assert.equal(sold.items[0].name, 'Lamp');
  assert.equal(mergeStatus(list, { items: [{ id: 1, sold: false, reserved: false }] }).reload, true);
  assert.equal(mergeStatus([], { items: [{ id: 9, sold: false, reserved: false }] }).reload, true);
});

test('pollDelay follows the server hint, slower when live or hidden, none after the sale', () => {
  assert.equal(pollDelay({ pollSeconds: 20 }), 20000);
  assert.equal(pollDelay({ pollSeconds: 20 }, { liveOpen: true }), 60000);
  assert.equal(pollDelay({ pollSeconds: 20 }, { hidden: true }), 300000);
  assert.equal(pollDelay({ pollSeconds: 0 }), null);
  assert.equal(pollDelay(null), null);
  assert.deepEqual(leftCount([{ sold: true }, {}, {}]), { total: 3, sold: 1, left: 2 });
});
