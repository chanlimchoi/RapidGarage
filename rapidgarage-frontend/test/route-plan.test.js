// node --test: route planner picks and form rules (lib/routePlan.js).
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as plan from '../app/lib/routePlan.js';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

describe('picked sales', () => {
  beforeEach(() => { store.clear(); plan.resetForTests(); });
  test('add, toggle, remove; unique; persisted', () => {
    plan.add(3); plan.add(5); plan.add(3);
    assert.deepEqual(plan.picked(), [3, 5]);
    plan.toggle(5);
    assert.deepEqual(plan.picked(), [3]);
    assert.equal(store.get('rg-route'), '[3]');
    plan.resetForTests();
    assert.deepEqual(plan.picked(), [3], 'reloaded from storage');
  });
  test('at most 10; bad stored data is ignored', () => {
    plan.addMany([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert.equal(plan.picked().length, 10);
    assert.equal(plan.isFull(), true);
    plan.add(99);
    assert.equal(plan.isPicked(99), false);
    store.set('rg-route', '{nope');
    plan.resetForTests();
    assert.deepEqual(plan.picked(), []);
    assert.deepEqual(plan.cleanIds(['4', 4, -1, 'x', 2.5, 7]), [4, 7]);
  });
  test('listeners hear changes', () => {
    let seen = null;
    const off = plan.subscribe((ids) => { seen = ids; });
    plan.add(8);
    assert.deepEqual(seen, [8]);
    off();
  });
});

describe('route form', () => {
  const now = new Date('2026-10-24T14:00:00Z').getTime();
  test('builds the POST /route body', () => {
    const { body } = plan.routeBody({ ids: [3, 3, 5], start: { lat: 40.7, lng: -74 }, departAt: '2026-10-24T15:30', dwell: '30' }, now - 86400000);
    assert.deepEqual(body.postIds, [3, 5]);
    assert.equal(body.dwellMinutes, 30);
    assert.equal(body.lat, 40.7);
    assert.equal(body.departAt, new Date('2026-10-24T15:30').toISOString());
    assert.deepEqual(plan.routeBody({ ids: [1], start: null, departAt: '', dwell: '' }, now).body, { postIds: [1], dwellMinutes: 20 });
  });
  test('reports each problem', () => {
    assert.deepEqual(plan.routeBody({ ids: [], departAt: 'x', dwell: '2' }, now).errors, { ids: 'rt.needSales', departAt: 'rt.badTime', dwell: 'rt.badDwell' });
    assert.equal(plan.routeBody({ ids: [1], departAt: '2020-01-01T10:00' }, now).errors.departAt, 'rt.pastTime');
  });
  test('helpers', () => {
    assert.equal(plan.localInputValue(new Date(2026, 9, 4, 9, 5)), '2026-10-04T09:05');
    assert.equal(plan.skipKey('closed_by_then'), 'rt.skipClosed');
    assert.equal(plan.skipKey('weird'), 'rt.skipUnavailable');
    assert.equal(plan.minutesBetween('2026-10-24T10:00:00Z', '2026-10-24T10:45:00Z'), 45);
  });
});
