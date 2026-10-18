import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMessage, needsNudge, showTips, hideTips, tipsHidden } from '../app/lib/safety.js';

describe('before-you-send safety check', () => {
  test('phone numbers and emails', () => {
    for (const s of ['Call me at (718) 555-0142', 'text +1 718 555 0142', '7185550142', '내 번호 010-1234-5678', 'bea.buyer@example.com', 'mail me: B@x.co.uk'])
      assert.equal(checkMessage(s).contact, true, s);
    for (const s of ['Sat 10:00-14:00 works', 'Oct 18, 2026-10-18', 'It is $1,000,000', 'Item #12345', 'see you at 9:30', 'a@b'])
      assert.equal(checkMessage(s).contact, false, s);
  });
  test('scam phrases in all four languages', () => {
    for (const s of ['Can I pay with a Gift Card?', 'I will send a cashier\'s check', 'I overpaid, refund the difference', 'my courier will pick it up', 'can you ship it?',
      'what is the verification code I sent', 'pay by Western Union', '¿Aceptas tarjeta de regalo?', 'te pagué de más', 'Envío por mensajería', 'código de verificación',
      '상품권으로 드릴게요', '택배로 보내 주세요', '인증번호 알려주세요', '用礼品卡付款', '我多付了', '请把验证码发给我', '快递给我'])
      assert.equal(checkMessage(s).scam, true, s);
    for (const s of ['Is the desk still available?', 'Cash is fine, see you Saturday', 'shipshape condition', '¿Sigue disponible?', '아직 있나요?', '还在吗？'])
      assert.equal(needsNudge(s), false, s);
  });
});

describe('safety tips card', () => {
  const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) }; };
  test('shows in new conversations until dismissed there', () => {
    const s = store();
    assert.equal(showTips(7, [], false, s), true);
    assert.equal(showTips(7, new Array(5).fill({}), false, s), true);
    assert.equal(showTips(7, new Array(6).fill({}), false, s), false);
    assert.equal(showTips(7, [{}], true, s), false);
    hideTips(7, s);
    assert.equal(tipsHidden(7, s), true);
    assert.equal(showTips(7, [], false, s), false);
    assert.equal(showTips(8, [], false, s), true);
  });
});
