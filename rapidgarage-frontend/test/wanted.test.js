// node --test: wanted-post form rules and match-word preview (mirror of the server).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { wordsOf, matchWords, dollarsToCents, centsToInput, daysLeft, validateWanted, wantedBody, CATEGORIES } from '../app/lib/wanted.js';

describe('match words', () => {
  test('stop words dropped, plurals folded, punctuation ignored, max 5', () => {
    assert.deepEqual(wordsOf("Looking for a kid's bikes, 20 inch!"), ['kid', 'bike', '20', 'inch']);
    assert.deepEqual(wordsOf('one two three four five six'), ['one', 'two', 'three', 'four', 'five']);
    assert.deepEqual(wordsOf('glass dress'), ['glass', 'dress']);
    assert.deepEqual(wordsOf('유아용 자전거'), ['유아용', '자전거']);
    assert.deepEqual(wordsOf('婴儿车'), ['婴儿车']);
  });
  test('keywords win over the title; empty keywords fall back to it', () => {
    assert.deepEqual(matchWords('Kids bike', 'bmx'), ['bmx']);
    assert.deepEqual(matchWords('Kids bike', ''), ['kid', 'bike']);
    assert.deepEqual(matchWords('Looking for any', ''), []);
  });
});

describe('prices in cents', () => {
  test('dollars to cents and back', () => {
    assert.equal(dollarsToCents('25'), 2500);
    assert.equal(dollarsToCents('$25.5'), 2550);
    assert.equal(dollarsToCents(' 0 '), 0);
    assert.equal(dollarsToCents(''), null);
    assert.equal(dollarsToCents('2.555'), undefined);
    assert.equal(dollarsToCents('-1'), undefined);
    assert.equal(dollarsToCents('100001'), undefined);
    assert.equal(centsToInput(2550), '25.50');
    assert.equal(centsToInput(3000), '30');
    assert.equal(centsToInput(null), '');
  });
});

describe('expiry', () => {
  test('days left, null once expired', () => {
    const now = new Date('2026-10-17T12:00:00Z');
    assert.equal(daysLeft('2026-11-16T12:00:00Z', now), 30);
    assert.equal(daysLeft('2026-10-17T18:00:00Z', now), 0);
    assert.equal(daysLeft('2026-10-17T11:00:00Z', now), null);
  });
});

describe('form', () => {
  const ok = { title: 'Kids bike', keywords: '', maxPrice: '30', details: '', areaLabel: 'Midtown', where: 'here', coords: { lat: 1, lng: 2 }, radiusMiles: '5', emailEnabled: true, days: 30, category: 'sports' };
  test('a good form has no errors and builds the API body', () => {
    assert.deepEqual(validateWanted(ok), {});
    assert.deepEqual(wantedBody(ok), { title: 'Kids bike', keywords: null, category: 'sports', details: null, maxPriceCents: 3000, areaLabel: 'Midtown', radiusMiles: 5, emailEnabled: true, lat: 1, lng: 2, days: 30 });
    assert.equal(wantedBody(Object.assign({}, ok, { where: 'keep' }), true).days, undefined);
    assert.equal(wantedBody(Object.assign({}, ok, { where: 'keep' }), true).lat, undefined);
  });
  test('each rule reports its field', () => {
    const e = validateWanted({ title: 'x', keywords: '', maxPrice: 'abc', details: 'y'.repeat(501), areaLabel: '', where: 'address', address: ' ', radiusMiles: '0' });
    assert.deepEqual(Object.keys(e).sort(), ['areaLabel', 'details', 'location', 'maxPrice', 'radiusMiles', 'title']);
    assert.deepEqual(validateWanted(Object.assign({}, ok, { title: 'Looking for any' })).keywords, ['want.errNoWords', null]);
    assert.deepEqual(Object.keys(validateWanted(Object.assign({}, ok, { where: 'here', coords: null }))), ['location']);
    assert.deepEqual(validateWanted(Object.assign({}, ok, { where: 'keep', coords: null }), true), {});
  });
  test('categories mirror the server list', () => {
    assert.equal(CATEGORIES.length, 12);
    assert.ok(CATEGORIES.includes('furniture') && CATEGORIES.includes('decor'));
  });
});
