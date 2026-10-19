// One EventSource per tab to the backend's /live stream (lib/live.js there).
// Events are tiny ("badges", "message" { conversationId }); listeners then
// fetch through the normal API. While connected, pages poll rarely instead of
// every few seconds; if it drops, the browser reconnects and polling covers the gap.
let source = null;
let open = false;
const listeners = new Set();

export const isOpen = () => open;

export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function dispatch(type, e) {
  let data = {};
  try { data = e && e.data ? JSON.parse(e.data) : {}; } catch (err) { data = {}; }
  listeners.forEach((fn) => { try { fn(type, data); } catch (err) { /* a listener's problem */ } });
}

export function connect() {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource('/api/live', { withCredentials: true });
  source.onopen = () => { open = true; };
  source.onerror = () => { open = false; };
  ['badges', 'message'].forEach((type) => source.addEventListener(type, (e) => dispatch(type, e)));
}

export function disconnect() {
  if (source) source.close();
  source = null;
  open = false;
}
