import { test } from 'node:test';
import assert from 'node:assert/strict';
import { differs, languageName, applyTranslation, failureKey } from '../app/lib/listingLanguage.js';

test('badge only when the listing language is set and differs', () => {
  assert.equal(differs('ko', 'en'), true);
  assert.equal(differs('en', 'en'), false);
  assert.equal(differs(null, 'en'), false);
  assert.equal(differs('zh-CN', 'zh-CN'), false);
});

test('language names in the reader\'s language, with fallbacks', () => {
  assert.equal(languageName('ko', 'en-US'), 'Korean');
  assert.equal(languageName('es', 'es-US'), 'Español');
  assert.equal(languageName('xx-nope', 'en-US', { 'xx-nope': 'Fallback' }), 'Fallback');
});

test('applyTranslation swaps text by item id and keeps item state', () => {
  const post = { id: 1, title: '이사 세일', description: '가구', items: [{ id: 5, name: '책상', sold: true }, { id: 6, name: '새 물건' }] };
  const tr = { translated: true, title: 'Moving sale', description: 'Furniture', items: [{ id: 5, name: 'Desk' }] };
  const shown = applyTranslation(post, tr);
  assert.equal(shown.title, 'Moving sale');
  assert.equal(shown.description, 'Furniture');
  assert.deepEqual(shown.items, [{ id: 5, name: 'Desk', sold: true }, { id: 6, name: '새 물건' }]);
  assert.equal(post.title, '이사 세일', 'original untouched');
  assert.equal(applyTranslation(post, { translated: false }), post);
  assert.equal(applyTranslation(post, null), post);
  assert.equal(applyTranslation(Object.assign({}, post, { description: null }), tr).description, null);
});

test('failure messages', () => {
  assert.equal(failureKey('too_long'), 'lang.tooLong');
  assert.equal(failureKey('failed'), 'lang.failed');
  assert.equal(failureKey('unavailable'), 'lang.failed');
  assert.equal(failureKey('same'), null);
});
