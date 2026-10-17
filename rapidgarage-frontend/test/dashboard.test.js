// node --test: seller dashboard chart geometry and summaries.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { niceMax, bars, sum, weekChange, soldPct, filterSales } from '../app/lib/dashboard.js';

const days = (counts) => counts.map((count, i) => ({ date: '2026-10-' + String(10 + i).padStart(2, '0'), count }));

describe('chart geometry', () => {
  test('niceMax rounds up to 1/2/5 x 10^n', () => {
    assert.deepEqual([0, 1, 2, 3, 7, 10, 11, 49, 51, 230].map(niceMax), [1, 1, 2, 5, 10, 10, 20, 50, 100, 500]);
  });
  test('bars fill the box bottom-aligned; zero days get a 1px stub', () => {
    const g = bars(days([0, 5, 10, 3]), 100, 50, 4);
    assert.equal(g.max, 10);
    assert.equal(g.bars.length, 4);
    assert.equal(g.bars[0].h, 1);
    assert.equal(g.bars[2].h, 50); assert.equal(g.bars[2].y, 0);
    assert.equal(g.bars[1].h, 25);
    assert.ok(Math.abs(g.bars[3].x + g.bars[3].w - 100) < 1e-9); // last bar ends at the right edge
    assert.ok(g.bars.every((b) => b.y + b.h === 50));
  });
  test('an all-zero or empty series still draws', () => {
    assert.equal(bars(days(Array(14).fill(0)), 280, 40).max, 1);
    assert.deepEqual(bars([], 280, 40).bars, []);
  });
});

describe('summaries', () => {
  test('sum and week-over-week change', () => {
    const s = days([1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2]);
    assert.equal(sum(s), 21);
    assert.deepEqual(weekChange(s), { last: 14, prev: 7, delta: 100 });
    assert.equal(weekChange(days([0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0])).delta, null);
    assert.equal(weekChange(days([4, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0])).delta, -75);
  });
  test('sold percentage', () => {
    assert.equal(soldPct({ total: 4, sold: 1 }), 25);
    assert.equal(soldPct({ total: 0, sold: 0 }), 0);
    assert.equal(soldPct(null), 0);
  });
  test('filters: active excludes ended and hidden; ended includes hidden ended sales', () => {
    const sales = [{ id: 1, status: 'open', ended: false }, { id: 2, status: 'ended', ended: true }, { id: 3, status: 'hidden', ended: false }, { id: 4, status: 'hidden', ended: true }, { id: 5, status: 'nodates', ended: false }];
    assert.deepEqual(filterSales(sales, 'all').map((s) => s.id), [1, 2, 3, 4, 5]);
    assert.deepEqual(filterSales(sales, 'active').map((s) => s.id), [1, 5]);
    assert.deepEqual(filterSales(sales, 'ended').map((s) => s.id), [2, 4]);
  });
});
