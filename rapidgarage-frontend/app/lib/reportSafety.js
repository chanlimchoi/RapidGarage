// Buyer safety reports (backend lib/safety.js): pure helpers for the admin queue
// (test/buyer-safety.test.js).

// A reporter's standing -> null | { key, tone } chip (keys under rep.*).
export function standingChip(standing) {
  if (!standing) return null;
  if (standing.untrusted) return { key: 'untrusted', tone: 'warning' };
  if (standing.upheld && standing.upheld >= standing.dismissed) return { key: 'reliable', tone: 'success' };
  return null;
}

// Hidden-source label key: auto (per-post threshold), repeat (seller hold or
// strikes), else moderator.
export function hiddenKey(source) {
  if (source === 'auto') return 'auto';
  if (source === 'repeat') return 'repeat';
  return 'moderator';
}

// "scam 2 · no_show 1" order: most first, then by name.
export function reasonCounts(reasons) {
  return Object.keys(reasons || {}).map((k) => ({ reason: k, count: reasons[k] })).sort((a, b) => b.count - a.count || (a.reason < b.reason ? -1 : 1));
}
