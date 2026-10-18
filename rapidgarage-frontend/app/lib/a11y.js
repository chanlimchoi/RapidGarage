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

// While a modal is open, everything outside it is inert and hidden from
// assistive tech (so it can't be tabbed to, clicked or read behind the modal),
// except toasts and live regions, which must still be heard. Returns a
// function that undoes exactly what it changed (nested modals stay correct).
export const KEEP_LIVE = '.toaster, [aria-live], [role="status"], [role="alert"]';
export function inertOutside(el, keep) {
  const sel = keep || KEEP_LIVE;
  const changed = [];
  for (let n = el; n && n.parentElement; n = n.parentElement) {
    if (n.tagName === 'BODY') break;
    for (const sib of Array.from(n.parentElement.children)) {
      if (sib === n || /^(SCRIPT|STYLE|TEMPLATE)$/.test(sib.tagName) || (sib.matches && sib.matches(sel))) continue;
      if (sib.hasAttribute('inert')) continue;
      changed.push([sib, sib.getAttribute('aria-hidden')]);
      sib.setAttribute('inert', '');
      sib.setAttribute('aria-hidden', 'true');
    }
  }
  return () => {
    for (const [sib, hidden] of changed) {
      sib.removeAttribute('inert');
      if (hidden == null) sib.removeAttribute('aria-hidden'); else sib.setAttribute('aria-hidden', hidden);
    }
  };
}
