// node --test: admin analytics helpers.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { delta, niceMax, areaGeometry, nearestIndex } from '../app/lib/analytics.js';

describe('analytics helpers', () => {
  test('change versus the previous period', () => {
    assert.deepEqual(delta(12, 10), { pct: 20, dir: 'up' });
    assert.deepEqual(delta(5, 10), { pct: -50, dir: 'down' });
    assert.deepEqual(delta(3, 3), { pct: 0, dir: 'flat' });
    assert.deepEqual(delta(4, 0), { pct: null, dir: 'up' }, 'no percentage from zero');
    assert.deepEqual(delta(0, 0), { pct: 0, dir: 'flat' });
  });

  test('nice axis tops', () => {
    assert.equal(niceMax(0), 1);
    assert.equal(niceMax(7), 10);
    assert.equal(niceMax(13), 20);
    assert.equal(niceMax(42), 50);
    assert.equal(niceMax(100), 100);
  });

  test('area geometry spans the box and keeps the baseline at the bottom', () => {
    const g = areaGeometry([{ date: 'a', count: 0 }, { date: 'b', count: 5 }, { date: 'c', count: 10 }], 300, 100, 0);
    assert.equal(g.top, 10);
    assert.deepEqual(g.points.map((p) => [p.x, p.y]), [[0, 100], [150, 50], [300, 0]]);
    assert.match(g.line, /^M0\.00 100\.00 L150\.00 50\.00 L300\.00 0\.00$/);
    assert.match(g.area, /L300\.00 100 L0\.00 100 Z$/);
    assert.equal(areaGeometry([], 300, 100).area, '');
  });

  test('pointer snaps to the nearest day', () => {
    assert.equal(nearestIndex(0, 30), 0);
    assert.equal(nearestIndex(1, 30), 29);
    assert.equal(nearestIndex(0.5, 7), 3);
    assert.equal(nearestIndex(1.4, 7), 6, 'clamped');
    assert.equal(nearestIndex(0.7, 1), 0);
  });
});
