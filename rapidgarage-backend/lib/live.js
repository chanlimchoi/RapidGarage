// Live updates over Server-Sent Events: GET /live keeps one connection per
// open tab and the server pushes small events ("badges", "message") the
// moment something happens, instead of every tab polling every 10-15 s.
//
// Events carry ids and counts only, never message text; the page fetches what
// it needs through the normal API (with its normal permission checks).
// Connections live in this process: with several instances, an event only
// reaches tabs connected to the instance that produced it, and the pages'
// slow fallback poll covers the rest.

function intEnv(name, dflt) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : dflt;
}
const PER_USER = 5;
const maxConnections = () => intEnv('MAX_LIVE_CONNECTIONS', 2000);
const HEARTBEAT_MS = 25000;

const byUser = new Map(); // userId -> Set<res>
let total = 0;

function isConnected(userId) {
  const set = byUser.get(userId);
  return !!(set && set.size);
}

function write(res, event, data) {
  try { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); } catch (e) { /* closed */ }
}

// Attach a response as an event stream for `userId`. Returns false when the
// server is at capacity (the caller answers 503; the browser retries later).
function connect(userId, req, res) {
  if (total >= maxConnections()) return false;
  let set = byUser.get(userId);
  if (!set) { set = new Set(); byUser.set(userId, set); }
  // A person rarely has more than a few tabs: close the oldest past the cap.
  if (set.size >= PER_USER) { const oldest = set.values().next().value; try { oldest.end(); } catch (e) { /* gone */ } }
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // proxies: don't buffer the stream
  });
  if (res.flushHeaders) res.flushHeaders();
  res.write('retry: 5000\n\n');
  write(res, 'hello', { ok: true });
  set.add(res);
  total++;
  const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { /* closed */ } }, HEARTBEAT_MS);
  if (beat.unref) beat.unref();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(beat);
    set.delete(res);
    if (!set.size) byUser.delete(userId);
    total--;
  };
  req.on('close', close);
  res.on('close', close);
  return true;
}

function emit(userId, event, data) {
  const set = byUser.get(userId);
  if (!set) return 0;
  set.forEach((res) => write(res, event, data || {}));
  return set.size;
}

function stats() { return { users: byUser.size, connections: total }; }
function closeAll() { byUser.forEach((set) => set.forEach((res) => { try { res.end(); } catch (e) { /* gone */ } })); }

module.exports = { connect, emit, isConnected, stats, closeAll, maxConnections, PER_USER };
