// Sale-day checklist (backend lib/checklist.js): pure helpers for
// post/Checklist.jsx (test/checklist.test.js). No imports.

// Default item keys -> i18n keys (literal, so the catalog checks see them).
export const DEFAULT_LABEL_KEYS = {
  flyers: 'checklist.item.flyers', pricing: 'checklist.item.pricing', signs: 'checklist.item.signs',
  change: 'checklist.item.change', setup: 'checklist.item.setup',
};

// Groups in display order (furthest out first): [{ dueDays, dueDate, items }].
export function groupByDue(items) {
  const map = new Map();
  (items || []).forEach((i) => {
    if (!map.has(i.dueDays)) map.set(i.dueDays, { dueDays: i.dueDays, dueDate: i.dueDate || null, items: [] });
    map.get(i.dueDays).items.push(i);
  });
  return Array.from(map.values()).sort((a, b) => b.dueDays - a.dueDays);
}

// { done, total, percent }
export function progress(items) {
  const total = (items || []).length;
  const done = (items || []).filter((i) => i.done).length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

// How a group's heading reads: { key, vars }.
//   0 -> checklist.due.saleDay, 1 -> checklist.due.dayBefore, n -> checklist.due.daysBefore
export function dueHeading(dueDays) {
  if (dueDays === 0) return { key: 'checklist.due.saleDay', vars: {} };
  if (dueDays === 1) return { key: 'checklist.due.dayBefore', vars: {} };
  return { key: 'checklist.due.daysBefore', vars: { count: dueDays } };
}

// Overdue: open and its due date is before today (YYYY-MM-DD strings compare).
export function isOverdue(item, today) {
  return !item.done && !!item.dueDate && typeof today === 'string' && item.dueDate < today;
}

// Today's date (YYYY-MM-DD) in a time zone.
export function todayIn(timeZone, at) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || undefined }).format(at || new Date()); } catch (e) { return new Date(at || Date.now()).toISOString().slice(0, 10); }
}
