// node --test: wording of item-hold events in a conversation thread.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as i18n from '../app/i18n/index.js';
import { holdEventText } from '../app/messages/holdText.js';

const ev = (event, mine, extra) => ({ kind: 'hold', mine, body: 'English summary', hold: Object.assign({ event, itemName: 'Blue bike' }, extra) });

describe('hold event text', () => {
  test('mine vs. the other person', () => {
    assert.match(holdEventText(ev('requested', true), 'Sam K.'), /Blue bike/);
    const other = holdEventText(ev('requested', false), 'Sam K.');
    assert.match(other, /Sam K\./);
    assert.match(other, /Blue bike/);
    assert.notEqual(holdEventText(ev('accepted', true), 'Sam K.'), holdEventText(ev('accepted', false), 'Sam K.'));
  });
  test('system events and automatic declines', () => {
    for (const e of ['expired', 'sold']) assert.match(holdEventText(ev(e, false), 'Sam K.'), /Blue bike/);
    const taken = holdEventText(ev('declined', false, { endedReason: 'taken' }), 'Sam K.');
    assert.notEqual(taken, holdEventText(ev('declined', false), 'Sam K.'));
  });
  test('an item that was deleted falls back to a generic name', () => {
    const s = holdEventText(ev('released', false, { itemName: null }), 'Sam K.');
    assert.ok(!s.includes('null') && !s.includes('{item}'));
  });
  test('unknown events fall back to the server summary', () => {
    assert.equal(holdEventText(ev('weird', false), 'Sam K.'), 'English summary');
  });
  test('translated in every language', async () => {
    const en = holdEventText(ev('accepted', false), 'Sam K.');
    for (const code of ['es', 'ko', 'zh-CN']) {
      await i18n.loadCatalog(code);
      await i18n.setLocale(code);
      const s = holdEventText(ev('accepted', false), 'Sam K.');
      assert.notEqual(s, en, code);
      assert.match(s, /Blue bike/);
      assert.doesNotMatch(s, /\{\w+\}/);
    }
    await i18n.setLocale('en');
  });
});
