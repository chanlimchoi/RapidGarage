// "Free on the curb" (pure helpers; see test/curbside.test.js). Mirrors
// rapidgarage-backend/lib/curbside.js; the server still has the final say.

export const NOTE_MAX = 200;
export const MAX_HOURS = 72;
export const MIN_MINUTES = 15;
const HOUR = 3600 * 1000;

const asDate = (v) => (v instanceof Date ? v : new Date(v));

// The offer the viewer can act on: null unless it's live right now.
export function liveOffer(post) {
  const cs = post && post.curbside;
  return cs && cs.state === 'active' ? cs : null;
}

// Is this item free on the curb right now (from the post's live offer)?
export function itemFree(post, item) {
  const cs = liveOffer(post);
  if (!cs || !item || item.sold) return false;
  return cs.all ? true : !!item.curbside && !item.curbsideGone;
}

// Items still waiting on the curb (partial offers); whole-sale offers have none listed.
export const freeItems = (post) => ((post && post.items) || []).filter((i) => itemFree(post, i));

// Pickup-until choices for the seller's form: [{ kind, value: ISO, hours? }].
// "endOfDay" is the server's default; others are +2h, +4h and tomorrow at
// noon when they fit before the server's maxUntil, plus "max" (the latest
// allowed time, labelled with that time). Near-duplicates are dropped.
export function pickupChoices(cs, now) {
  const at = asDate(now || new Date());
  const max = cs && cs.maxUntil ? asDate(cs.maxUntil) : new Date(at.getTime() + MAX_HOURS * HOUR);
  const min = at.getTime() + MIN_MINUTES * 60 * 1000;
  const out = [];
  const add = (kind, d, extra) => {
    if (!d || isNaN(d.getTime())) return;
    const ms = d.getTime();
    if (ms > max.getTime() || ms < min || out.some((c) => Math.abs(new Date(c.value).getTime() - ms) < 30 * 60 * 1000)) return;
    out.push(Object.assign({ kind, value: new Date(ms).toISOString() }, extra || {}));
  };
  add('endOfDay', cs && cs.defaultUntil ? asDate(cs.defaultUntil) : null);
  add('hours', new Date(at.getTime() + 2 * HOUR), { hours: 2 });
  add('hours', new Date(at.getTime() + 4 * HOUR), { hours: 4 });
  const noon = new Date(at); noon.setDate(noon.getDate() + 1); noon.setHours(12, 0, 0, 0);
  add('tomorrowNoon', noon);
  add('max', max);
  return out.sort((a, b) => new Date(a.value) - new Date(b.value));
}

// The choice that matches an existing offer's time, or the default.
export function pickChoice(choices, until) {
  if (!choices.length) return '';
  if (until) {
    const hit = choices.find((c) => Math.abs(new Date(c.value) - asDate(until)) < 60 * 1000);
    if (hit) return hit.value;
  }
  const def = choices.find((c) => c.kind === 'endOfDay');
  return (def || choices[0]).value;
}

// Time left as { hours, minutes } (floored; 0 when past).
export function timeLeft(until, now) {
  const ms = Math.max(0, asDate(until).getTime() - asDate(now || new Date()).getTime());
  return { hours: Math.floor(ms / HOUR), minutes: Math.floor((ms % HOUR) / 60000) };
}

// Form check: returns { field: errorKey } (keys into the UI catalogs).
export function validateCurb(v) {
  const errors = {};
  if (!v.all && !(v.itemIds && v.itemIds.length)) errors.items = 'curb.err.items';
  if (!v.until) errors.until = 'curb.err.until';
  if ((v.note || '').length > NOTE_MAX) errors.note = 'curb.err.note';
  return errors;
}

export function curbBody(v) {
  const body = { all: !!v.all, until: v.until, note: (v.note || '').trim() };
  if (!v.all) body.itemIds = v.itemIds.slice();
  return body;
}

// Items the seller can put out: not sold, not on hold.
export function offerable(items, now) {
  const at = asDate(now || new Date());
  return (items || []).filter((i) => !i.sold && !(i.reserved || (i.reservedUntil && asDate(i.reservedUntil) > at)));
}

// The seller's "taken" log, newest first, with undone marks last.
export function markList(cs, items) {
  const names = new Map((items || []).map((i) => [i.id, i.name]));
  return ((cs && cs.marks) || []).map((m) => ({ id: m.id, who: m.by ? m.by.name : '', item: m.itemId ? names.get(m.itemId) || '' : null, at: m.at, undone: !!m.undone }))
    .sort((a, b) => (a.undone - b.undone) || (new Date(b.at) - new Date(a.at)));
}
