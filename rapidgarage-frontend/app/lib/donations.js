// Leftover donation lots (backend lib/donations.js): pure helpers for
// post/DonateLeftovers.jsx, donations/*.jsx (test/donations.test.js). No imports.

export const MAX_SLOTS = 6;
export const MINUTES = [15, 30, 60, 120];
export const RADII = [1, 2, 5, 10, 25];

// datetime-local values ("2027-03-16T10:00", the browser's zone) -> sorted,
// de-duplicated ISO strings; blanks dropped. -> { slots } | { error: i18n key }
export function buildSlots(values, now) {
  const at = (now || new Date()).getTime();
  const out = [];
  for (const v of values || []) {
    if (!v) continue;
    const d = new Date(v);
    if (isNaN(d.getTime())) return { error: 'donate.errSlot' };
    if (d.getTime() <= at) return { error: 'donate.errSlotPast' };
    if (!out.some((x) => Math.abs(new Date(x).getTime() - d.getTime()) < 60000)) out.push(d.toISOString());
  }
  if (!out.length) return { error: 'donate.errNoSlot' };
  if (out.length > MAX_SLOTS) return { error: 'donate.errTooMany' };
  return { slots: out.sort() };
}

// ISO -> value for <input type="datetime-local"> in the browser's zone.
export function localInput(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// Open slots a claimer can still pick.
export const openSlots = (lot) => ((lot && lot.slots) || []).filter((s) => !s.past);

// Bell line key for donation notifications: { key, vars } (vars without title).
const UPDATE_KEYS = { unclaimed: 'bell.donationUnclaimed', released: 'bell.donationReleased', done: 'bell.donationDone', withdrawn: 'bell.donationWithdrawn' };
export function donationBell(n) {
  const d = n.data || {};
  if (n.kind === 'donation_lot') return { key: d.miles != null ? 'bell.donationLot' : 'bell.donationLotPlain', vars: { miles: d.miles } };
  if (n.kind === 'donation_claimed') return { key: d.org ? 'bell.donationClaimedOrg' : 'bell.donationClaimed', vars: { name: d.name || '', org: d.org || '' } };
  if (n.kind === 'donation_update') return { key: UPDATE_KEYS[d.event] || 'bell.donationReleased', vars: { name: d.name || '' } };
  return null;
}

// Where a donation notification opens: the seller's page for their own lot, else the lot.
export function donationLink(n) {
  if (!n.post) return '/donations';
  const d = n.data || {};
  if (n.kind === 'donation_claimed' || (n.kind === 'donation_update' && d.event === 'unclaimed')) return '/post/' + n.post.id + '/donate';
  return '/donations/' + n.post.id;
}
