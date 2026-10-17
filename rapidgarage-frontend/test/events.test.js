// node --test: neighborhood sales on the map (one pin per event) and the area sketch.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { groupForMap, pinCount, sketch } from '../app/lib/events.js';

const ev = { id: 7, name: 'Maple St', lat: 40.7, lng: -73.99, radiusMiles: 1, saleCount: 5 };

describe('groupForMap', () => {
  test('sales in a shown event collapse into its pin; others stay single', () => {
    const posts = [{ id: 1, event: { id: 7 } }, { id: 2 }, { id: 3, event: { id: 7 } }, { id: 4, event: { id: 99 } }];
    const g = groupForMap(posts, [ev]);
    assert.deepEqual(g.singles.map((p) => p.id), [2, 4]); // event 99 has no pin here
    assert.equal(g.events.length, 1);
    assert.deepEqual(g.events[0].posts.map((p) => p.id), [1, 3]);
  });
  test('an event pin shows even with none of its sales on this page; count is the public count', () => {
    const g = groupForMap([], [ev]);
    assert.equal(g.events.length, 1);
    assert.equal(pinCount(g.events[0]), 5);
    assert.equal(pinCount({ event: { saleCount: 0 }, posts: [{}, {}] }), 2);
  });
  test('no events, or events without coordinates, change nothing', () => {
    const posts = [{ id: 1, event: { id: 7 } }];
    assert.deepEqual(groupForMap(posts, null).singles, posts);
    assert.deepEqual(groupForMap(posts, [{ id: 7 }]).singles, posts);
  });
});

describe('sketch', () => {
  test('center maps to the middle and the radius fits the box', () => {
    const empty = sketch(ev, [], 320, 200, 16);
    assert.equal(empty.cx, 160); assert.equal(empty.cy, 100);
    assert.ok(Math.abs(empty.r - 84) < 1e-9);
    assert.equal(empty.zoomed, false);
    const s = sketch(ev, [{ id: 1, lat: ev.lat, lng: ev.lng }], 320, 200, 16);
    assert.deepEqual([s.dots[0].x, s.dots[0].y], [160, 100]);
  });
  test('zooms in (at most 4x) when sales are close together, never beyond the circle', () => {
    const near = sketch(ev, [{ id: 1, lat: ev.lat + 0.1 / 69, lng: ev.lng }], 320, 200, 16);
    assert.equal(near.zoomed, true);
    assert.ok(Math.abs(near.r - 84 * 4) < 1e-6); // capped at 4x
    const mid = sketch(ev, [{ id: 1, lat: ev.lat + 0.4 / 69, lng: ev.lng }], 320, 200, 16);
    assert.ok(Math.abs(mid.cy - mid.dots[0].y - 84 / 1.25) < 1e-6); // farthest sale at 80% of the view
  });
  test('north is up, east is right, and sales without coordinates are skipped', () => {
    const s = sketch(ev, [{ id: 1, lat: ev.lat + 0.005, lng: ev.lng + 0.005 }, { id: 2 }]);
    assert.equal(s.dots.length, 1);
    assert.ok(s.dots[0].y < s.cy && s.dots[0].x > s.cx);
    const e = sketch(ev, [{ id: 3, lat: ev.lat + 1 / 69, lng: ev.lng }]);
    assert.equal(e.zoomed, false);
    assert.ok(Math.abs(e.cy - e.dots[0].y - e.r) < 1e-9); // a sale exactly 1 mi north sits on the circle
  });
});
