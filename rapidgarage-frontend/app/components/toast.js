// Tiny toast store: toast.success('Saved'), toast.error('Nope').
// <Toaster /> (mounted once in App) renders whatever is in the queue.
// Toasts close on their own, but pause while the pointer or keyboard focus is
// on them (WCAG 2.2.1), and errors stay longer.
let nextId = 1;
let items = [];
let paused = false;
const timers = new Map(); // id -> { handle, remaining, startedAt }
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(items));
const now = () => Date.now();

function arm(id, ms) {
  const handle = paused ? null : setTimeout(() => dismiss(id), ms);
  timers.set(id, { handle, remaining: ms, startedAt: now() });
}

function push(type, message, opts) {
  const id = nextId++;
  const duration = (opts && opts.duration) || (type === 'error' ? 10000 : 5000);
  const dropped = items.slice(0, Math.max(0, items.length - 3));
  items = items.concat({ id, type, message }).slice(-4);
  dropped.forEach((d) => { const tm = timers.get(d.id); if (tm) clearTimeout(tm.handle); timers.delete(d.id); });
  arm(id, duration);
  emit();
  return id;
}

export function dismiss(id) {
  const tm = timers.get(id);
  if (tm) clearTimeout(tm.handle);
  timers.delete(id);
  items = items.filter((x) => x.id !== id);
  emit();
}

// Stop every countdown (pointer over / focus inside the toasts) ...
export function pause() {
  if (paused) return;
  paused = true;
  timers.forEach((tm) => { clearTimeout(tm.handle); tm.remaining = Math.max(0, tm.remaining - (now() - tm.startedAt)); tm.handle = null; });
}
// ... and carry on from where each one was (at least a second more).
export function resume() {
  if (!paused) return;
  paused = false;
  timers.forEach((tm, id) => arm(id, Math.max(1000, tm.remaining)));
}

export function subscribe(fn) {
  listeners.add(fn);
  fn(items);
  return () => listeners.delete(fn);
}

const toast = {
  success: (m, o) => push('success', m, o),
  error: (m, o) => push('error', m, o),
  info: (m, o) => push('info', m, o),
};
export default toast;
