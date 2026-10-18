// Last-hour markdowns (pure helpers; see test/markdown.test.js). Mirrors
// rapidgarage-backend/lib/markdown.js; the server still has the final say.
// The server sends post.markdown = { percent, from, lastDayOnly, active,
// startsAt, endsAt } or null. Labels live in lib/markdownText.js.

export const PERCENT_MIN = 5;
export const PERCENT_MAX = 90;
export const PERCENT_CHOICES = [10, 20, 25, 30, 40, 50, 60, 70, 75];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const SOON_MS = 12 * 3600 * 1000;

export const isActive = (post) => !!(post && post.markdown && post.markdown.active);

// Same rounding as the server: down to the cent.
export function discounted(cents, percent) {
  if (cents === null || cents === undefined) return cents;
  return Math.floor(cents * (100 - percent) / 100);
}

// 'now' | 'soon' (starts within 12 hours) | null: what a card should say.
export function chipKind(post, now) {
  const m = post && post.markdown;
  if (!m) return null;
  if (m.active) return 'now';
  if (m.startsAt && new Date(m.startsAt) - (now || new Date()) < SOON_MS) return 'soon';
  return null;
}

// Form values { markdownPercent: '' | '50', markdownFrom: '' | '14:00' } ->
// { field: i18n key } (lib/markdownText.js translates them).
export function markdownErrorKeys(v) {
  const out = {};
  const raw = String(v.markdownPercent == null ? '' : v.markdownPercent).trim();
  if (!raw) return out;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n < PERCENT_MIN || n > PERCENT_MAX) out.markdownPercent = 'md.errPercent';
  if (!v.markdownFrom) out.markdownFrom = 'md.errTimeEmpty';
  else if (!TIME_RE.test(v.markdownFrom)) out.markdownFrom = 'md.errTime';
  return out;
}

// Body fields for POST/PUT /post. No percent clears the markdown.
export function markdownBody(v) {
  const raw = String(v.markdownPercent == null ? '' : v.markdownPercent).trim();
  if (!raw) return { markdownPercent: null };
  return { markdownPercent: Number(raw), markdownFrom: v.markdownFrom, markdownLastDay: !!v.markdownLastDay };
}

export function markdownValues(post) {
  const m = post && post.markdown;
  return { markdownPercent: m ? String(m.percent) : '', markdownFrom: m ? m.from : '', markdownLastDay: !!(m && m.lastDayOnly) };
}
