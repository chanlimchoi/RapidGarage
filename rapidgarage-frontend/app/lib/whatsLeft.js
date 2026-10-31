// Live "what's left" on the sale page (backend lib/whatsLeft.js): pure helpers
// for merging the polled status into the item list and choosing the next poll.

// items: the page's item list; status: { items: [{ id, sold, reserved }] }.
// -> { items, changed, reload }: reload when items were added or removed
// (the page then fetches the full list); otherwise sold/reserved are merged.
export function mergeStatus(items, status) {
  const list = items || [];
  const next = (status && status.items) || [];
  const have = list.map((i) => i.id).sort((a, b) => a - b).join(',');
  const want = next.map((i) => i.id).sort((a, b) => a - b).join(',');
  if (have !== want) return { items: list, changed: false, reload: true };
  const by = new Map(next.map((s) => [s.id, s]));
  let changed = false;
  const merged = list.map((i) => {
    const s = by.get(i.id);
    if (!!i.sold === s.sold && !!i.reserved === s.reserved) return i;
    changed = true;
    return Object.assign({}, i, { sold: s.sold, reserved: s.reserved, reservedUntil: s.reserved ? i.reservedUntil : null });
  });
  return { items: changed ? merged : list, changed, reload: false };
}

// Milliseconds until the next poll, or null for none. The server hints
// pollSeconds (0 = the sale is over). A live connection (savers get an
// 'items' nudge) or a hidden tab slows polling down.
export function pollDelay(status, opts) {
  const o = opts || {};
  const s = status && Number(status.pollSeconds);
  if (!s) return null;
  let ms = s * 1000;
  if (o.liveOpen) ms *= 3;
  if (o.hidden) ms = Math.max(ms, 5 * 60 * 1000);
  return ms;
}

// "3 of 12 sold" style counts from a list.
export function leftCount(items) {
  const list = items || [];
  const sold = list.filter((i) => i.sold).length;
  return { total: list.length, sold, left: list.length - sold };
}
