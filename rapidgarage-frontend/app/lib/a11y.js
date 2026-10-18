// Small accessibility helpers shared by components (no DOM needed at import).

// True when the person asked the system for less motion.
export function prefersReducedMotion(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  try { return !!(w && w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
}

// scrollIntoView behavior that respects prefers-reduced-motion.
export const scrollBehavior = (win) => (prefersReducedMotion(win) ? 'auto' : 'smooth');

// Text alternative for a sale photo: the seller's own description when they
// wrote one, otherwise "<title>, photo 2 of 5" (via the t() template given).
export function photoAlt(photo, index, count, title, tmpl) {
  const own = photo && typeof photo.alt === 'string' ? photo.alt.trim() : '';
  if (own) return own;
  return tmpl({ title: title || '', n: index + 1, count });
}
