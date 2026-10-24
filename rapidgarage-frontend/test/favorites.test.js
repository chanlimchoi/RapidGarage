// node --test: favorites update notifications (price drops, sold items) in lib/savedSearch.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { notificationText, money } from '../app/lib/savedSearch.js';

const post = { id: 7, title: 'Porch sale', seller: { id: 2, name: 'Sam S.' } };
const n = (kind, data) => ({ id: 1, kind, seen: false, post, data });

describe('favorites notifications', () => {
  test('money: cents, whole dollars without decimals, free', () => {
    assert.equal(money(4550), '$45.50');
    assert.equal(money(300), '$3');
    assert.equal(money(0), 'Free');
    assert.equal(money(null), '');
  });
  test('price drops: one item, several, the range, free, markdown', () => {
    assert.equal(notificationText(n('price_drop', { items: [{ id: 1, name: 'Lamp', from: 4000, to: 2500 }] })), 'Porch sale: Lamp is now $25 (was $40)');
    assert.equal(notificationText(n('price_drop', { items: [{ id: 1, name: 'Lamp', from: 4000, to: 0 }] })), 'Porch sale: Lamp is now free');
    assert.equal(notificationText(n('price_drop', { items: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] })), 'Porch sale: 2 items are cheaper');
    assert.equal(notificationText(n('price_drop', { price: { from: 150, to: 60 } })), 'Porch sale: prices now up to $60 (was $150)');
    assert.equal(notificationText(n('price_drop', { price: { from: 150, to: 0 } })), 'Porch sale is now free');
    assert.equal(notificationText(n('price_drop', { markdown: 25 })), 'Porch sale: 25% off now');
    assert.equal(notificationText(n('price_drop', {})), 'Porch sale got cheaper');
  });
  test('sold: one item, several, everything', () => {
    assert.equal(notificationText(n('item_sold', { items: [{ id: 1, name: 'Desk' }], soldOut: false })), 'Porch sale: Desk sold');
    assert.equal(notificationText(n('item_sold', { items: [{ id: 1, name: 'Desk' }, { id: 2, name: 'Chair' }] })), 'Porch sale: 2 items sold');
    assert.equal(notificationText(n('item_sold', { items: [{ id: 1, name: 'Desk' }], soldOut: true })), 'Porch sale: everything listed has sold');
  });
});
