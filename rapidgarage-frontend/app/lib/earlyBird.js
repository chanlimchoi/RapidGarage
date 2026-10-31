// Early-bird access (backend lib/earlyBird.js): form values and what the
// sale page says. Pure helpers (test/early-bird.test.js).
export const EARLY_CHOICES = [15, 30, 45, 60, 90, 120, 180];

export function earlyValues(post) {
  const m = post && post.earlyBird && post.earlyBird.minutes;
  return { earlyMinutes: m ? String(m) : '' };
}

export function earlyBody(v) {
  return { earlyMinutes: v.earlyMinutes ? Number(v.earlyMinutes) : null };
}

// What to show on the sale page: null, or { kind, startsAt?, until? }.
//   active: the early window is on for this viewer; upcoming: it will be;
//   offered: early access exists but the viewer doesn't have it (no times).
export function earlyState(post) {
  const e = post && post.earlyBird;
  if (!e) return null;
  if (!e.forYou) return e.offered ? { kind: 'offered' } : null;
  if (!e.startsAt) return null;
  return { kind: e.active ? 'active' : 'upcoming', startsAt: e.startsAt, until: e.until, minutes: e.minutes };
}
