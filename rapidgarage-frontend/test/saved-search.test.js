// node --test: saved-search body/identity and notification text (lib/savedSearch.js).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cleanKeyword, searchAlertBody, searchKey, notificationLink, notificationText, unseenCount, KEYWORD_MAX } from '../app/lib/savedSearch.js';

const center = { lat: 40.7, lng: -73.99 };

describe('saved searches', () => {
  test('keywords are trimmed and spaces collapsed, like the search box', () => {
    assert.equal(cleanKeyword('  road   bike '), 'road bike');
    assert.equal(cleanKeyword(null), '');
    assert.equal(KEYWORD_MAX, 60);
  });
  test('the alert body carries area, price filter and words', () => {
    const b = searchAlertBody({ center, radius: 10, filter: { maxPrice: 25 }, keyword: ' road bike ', place: 'Brooklyn' });
    assert.deepEqual(b, { label: '“road bike” · Near Brooklyn', keyword: 'road bike', lat: 40.7, lng: -73.99, radiusMiles: 10, freeOnly: false, maxPrice: 25 });
    const free = searchAlertBody({ center, radius: 5, filter: { freeOnly: true, maxPrice: 25 }, keyword: '' });
    assert.equal(free.keyword, null);
    assert.equal(free.maxPrice, null);
    assert.equal(free.label, 'Near my location');
  });
  test('labels are cut to the server limit', () => {
    const b = searchAlertBody({ center, radius: 5, keyword: 'x'.repeat(60), place: 'y'.repeat(60) });
    assert.equal(b.label.length, 80);
  });
  test('the key changes with the words (case-insensitive) and the filters', () => {
    const base = { center, radius: 10, filter: {}, keyword: 'Bike' };
    assert.equal(searchKey(base), searchKey(Object.assign({}, base, { keyword: ' bike ' })));
    assert.notEqual(searchKey(base), searchKey(Object.assign({}, base, { keyword: 'lamp' })));
    assert.notEqual(searchKey(base), searchKey(Object.assign({}, base, { filter: { freeOnly: true } })));
    assert.equal(searchKey({ center: null }), null);
  });
});

describe('notifications', () => {
  const n = { id: 1, kind: 'search_match', seen: false, post: { id: 7, title: 'Moving sale', seller: { id: 2, name: 'Sam S.' } }, search: { id: 3, label: null, keyword: 'road bike' } };
  test('text names the search and the sale', () => {
    assert.equal(notificationText(n), 'New for “road bike”: Moving sale');
    assert.equal(notificationText(Object.assign({}, n, { search: { id: 3, label: 'Bikes' } })), 'New for Bikes: Moving sale');
    assert.equal(notificationText(Object.assign({}, n, { search: null })), 'New sale matching a saved search: Moving sale');
    assert.equal(notificationText(Object.assign({}, n, { post: Object.assign({}, n.post, { title: '' }) })), 'New for “road bike”: Garage sale');
  });
  test('links go to the sale (or Settings when it has none)', () => {
    assert.equal(notificationLink(n), '/post/7');
    assert.equal(notificationLink({ kind: 'search_match', post: null }), '/settings#alerts');
  });
  test('unseen count', () => {
    assert.equal(unseenCount([n, Object.assign({}, n, { seen: true })]), 1);
    assert.equal(unseenCount(null), 0);
  });
});
