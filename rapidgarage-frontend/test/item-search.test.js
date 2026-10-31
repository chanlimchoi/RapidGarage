// node --test: item search helpers (app/lib/itemSearch.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemParams, itemPrice, saleAsPost, queryString } from '../app/lib/itemSearch.js';

test('itemParams carries the place, radius and every filter', () => {
  const base = { activeKeyword: 'bike', radius: 25, freeOnly: false, maxPrice: ' 20 ', when: 'weekend', neighborhood: true, curbside: false, markdown: true };
  assert.deepEqual(itemParams(Object.assign({ lastWhere: { coords: { lat: 1.5, lng: -2 } } }, base), 2),
    { keyword: 'bike', page: 2, pageSize: 12, lat: 1.5, lng: -2, radius: 25, maxPrice: '20', when: 'weekend', neighborhood: 'true', markdown: 'true' });
  assert.deepEqual(itemParams(Object.assign({ lastWhere: { q: '10036' } }, base, { freeOnly: true })),
    { keyword: 'bike', page: 1, pageSize: 12, q: '10036', radius: 25, free: 'true', when: 'weekend', neighborhood: 'true', markdown: 'true' });
  const none = itemParams({ activeKeyword: 'lamp', lastWhere: null, radius: 10, maxPrice: '' });
  assert.deepEqual(none, { keyword: 'lamp', page: 1, pageSize: 12 }, 'no place: no radius');
  assert.equal(queryString({ keyword: 'road bike', page: 1, q: '' }), 'keyword=road%20bike&page=1');
});

test('itemPrice applies a running markdown, rounded down', () => {
  const on = { percent: 25, active: true };
  assert.deepEqual(itemPrice({ priceCents: 999, sale: { markdown: on } }), { cents: 749, wasCents: 999 });
  assert.deepEqual(itemPrice({ priceCents: 999, sale: { markdown: { percent: 25, active: false } } }), { cents: 999, wasCents: null });
  assert.deepEqual(itemPrice({ priceCents: 0, sale: { markdown: on } }), { cents: 0, wasCents: null });
  assert.deepEqual(itemPrice({ priceCents: null, sale: {} }), { cents: null, wasCents: null });
  assert.deepEqual(Object.keys(saleAsPost({ id: 1, title: 'x', schedule: null, distanceMiles: 2 })).sort(), ['city', 'distanceMiles', 'id', 'markdown', 'schedule', 'state', 'title']);
});
