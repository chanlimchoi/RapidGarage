// Tiny toast store: toast.success('Saved'), toast.error('Nope').
// <Toaster /> (mounted once in App) renders whatever is in the queue.
let nextId = 1;
let items = [];
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(items));

function push(type, message, opts) {
  const id = nextId++;
  const duration = (opts && opts.duration) || (type === 'error' ? 7000 : 4000);
  items = items.concat({ id, type, message }).slice(-4);
  emit();
  setTimeout(() => dismiss(id), duration);
  return id;
}

export function dismiss(id) {
  items = items.filter((t) => t.id !== id);
  emit();
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
