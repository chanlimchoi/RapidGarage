import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dollars, itemRuleErrors, saleRuleErrors, percentValue, ruleLines } from '../app/lib/offerRules.js';

test('dollar amounts', () => {
  assert.equal(dollars(''), null);
  assert.equal(dollars('$4.50'), 450);
  assert.equal(dollars('0'), undefined);
  assert.equal(dollars('abc'), undefined);
});

test('item rule checks mirror the server', () => {
  assert.deepEqual(itemRuleErrors({ accept: '30', floor: '20' }, 4000), {});
  assert.deepEqual(itemRuleErrors({ accept: '40', floor: '' }, 4000), { accept: 'offerRules.errBelowAsking' });
  assert.deepEqual(itemRuleErrors({ accept: '30', floor: '30' }, 4000), { floor: 'offerRules.errFloorBelowAccept' });
  assert.deepEqual(itemRuleErrors({ accept: '1', floor: '' }, 0), { accept: 'offerRules.errFree' });
  assert.deepEqual(itemRuleErrors({ accept: 'x', floor: '' }, null), { accept: 'offerRules.errAmount' });
  assert.deepEqual(itemRuleErrors({ accept: '500', floor: '1' }, null), {});
});

test('sale rule checks', () => {
  assert.deepEqual(saleRuleErrors({ acceptPercent: '80', floorPercent: '50%' }), {});
  assert.deepEqual(saleRuleErrors({ acceptPercent: '50', floorPercent: '60' }), { floorPercent: 'offerRules.errFloorBelowAccept' });
  assert.deepEqual(saleRuleErrors({ acceptPercent: '100', floorPercent: '' }), { acceptPercent: 'offerRules.errPercent' });
  assert.equal(percentValue(' 75 '), 75);
  assert.equal(percentValue(''), null);
});

test('rule lines', () => {
  assert.deepEqual(ruleLines({ acceptCents: 3200, floorCents: 2000 }), [{ key: 'offerRules.acceptsAt', cents: 3200 }, { key: 'offerRules.declinesBelow', cents: 2000 }]);
  assert.deepEqual(ruleLines({ acceptCents: null, floorCents: null }), []);
});

test('offer-rule events in the thread', async () => {
  const { holdEventText } = await import('../app/messages/holdText.js');
  const ev = (event, mine) => ({ kind: 'hold', mine, body: 'English summary', hold: { event, itemName: 'Desk', cents: 3200 } });
  const mine = holdEventText(ev('auto_accepted', true), 'Bea T.');
  const theirs = holdEventText(ev('auto_accepted', false), 'Sam T.');
  assert.match(mine, /Desk/); assert.match(mine, /\$32/); assert.match(mine, /Bea T\./);
  assert.match(theirs, /\$32/); assert.notEqual(mine, theirs);
  const no = holdEventText(ev('auto_declined', false), 'Sam T.');
  assert.match(no, /Desk/); assert.ok(!no.includes('English summary'));
});
