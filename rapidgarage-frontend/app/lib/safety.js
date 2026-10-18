// Client-side safety helpers for conversations. Nothing here talks to the
// server: the "before you send" check runs on the device only, and message
// text is never logged or reported because of it.

// 10-15 digits with common separators: "(718) 555-0142", "+1 718 555 0142",
// "010-1234-5678". Times ("10:00-14:00") and dates ("2026-10-18") don't reach 10 digits.
const PHONE = /(?:\+?\d[\s().\-]{0,3}){10,15}/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/i;

// Phrases common in marketplace scams (gift cards, wires, overpayment,
// shipping/couriers, verification codes, crypto, deposits up front), in every
// supported language: the other person may write in any of them.
const SCAM = [
  // English
  /\bgift ?cards?\b/i, /\b(itunes|steam|google play|amazon|apple|ebay|vanilla) cards?\b/i, /\bwire (transfer|the money)\b/i, /\bwestern union\b/i, /\bmoney ?gram\b/i,
  /\bcashier'?s? che(ck|que)\b/i, /\bcertified che(ck|que)\b/i, /\bmoney order\b/i, /\bover ?pa(y|id|yment)\b/i, /\brefund the (difference|rest|extra)\b/i,
  /\bship(ping)?\b/i, /\bcourier\b/i, /\bverification code\b/i, /\b(6|six)[- ]digit code\b/i, /\bgoogle voice\b/i, /\bbitcoin|\bcrypto(currency)?\b/i,
  /\b(deposit|pay) (first|upfront|up front|in advance)\b/i,
  // Español
  /tarjetas? de regalo/i, /transferencia (bancaria|internacional)/i, /cheque (de caja|certificado)/i, /giro postal/i, /pag(ar|u[eé]|o) de m[aá]s/i,
  /devolver la diferencia/i, /\benv[ií]o\b/i, /mensajer[ií]a/i, /c[oó]digo de verificaci[oó]n/i, /dep[oó]sito (por adelantado|primero)/i,
  // 한국어
  /기프트 ?카드/, /상품권/, /해외 ?송금/, /웨스턴 ?유니온/, /초과 ?입금/, /차액/, /택배/, /배송/, /인증 ?(번호|코드)/, /비트코인/, /선입금/,
  // 中文
  /礼品卡/, /礼物卡/, /购物卡/, /电汇/, /西联/, /本票/, /多付/, /多转/, /退还差额/, /快递/, /邮寄/, /运费/, /验证码/, /比特币/, /加密货币/, /先付/, /定金/,
];

// -> { contact: bool, scam: bool } (both false: nothing to mention).
export function checkMessage(text) {
  const s = String(text || '');
  return { contact: PHONE.test(s) || EMAIL.test(s), scam: SCAM.some((re) => re.test(s)) };
}
export const needsNudge = (text) => { const c = checkMessage(text); return c.contact || c.scam; };

// Tips card: shown at the top of a new conversation until dismissed there.
const KEY = 'rg.safetyTipsHidden';
const MAX = 300;
const NEW_THREAD_MESSAGES = 6;
function read(storage) {
  try { const v = JSON.parse((storage || window.localStorage).getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
export function tipsHidden(conversationId, storage) { return read(storage).indexOf(conversationId) !== -1; }
export function hideTips(conversationId, storage) {
  try {
    const list = read(storage).filter((x) => x !== conversationId).concat([conversationId]).slice(-MAX);
    (storage || window.localStorage).setItem(KEY, JSON.stringify(list));
  } catch (e) { /* private mode: it just shows again next time */ }
}
// A conversation is "new" while it has only a few messages (and none loaded before them).
export const showTips = (conversationId, messages, hasMore, storage) => !hasMore && (messages || []).length < NEW_THREAD_MESSAGES && !tipsHidden(conversationId, storage);
