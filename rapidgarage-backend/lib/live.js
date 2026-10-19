// Live updates over Server-Sent Events: GET /live keeps one connection per
// open tab and the server pushes small events ("badges", "message") the
// moment something happens, instead of every tab polling every 10-15 s.
//
// Events carry ids and counts only, never message text; the page fetches what
// it needs through the normal API (with its normal permission checks).
// Connections live in this process. With several instances, set
// LIVE_BROADCAST=postgres: events then go out with Postgres NOTIFY and every
// instance (listening on one dedicated connection) delivers them to its own
// tabs. Without it, an event only reaches tabs on the instance that produced
// it, and the pages' slow fallback poll covers the rest.

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

function deliver(userId, event, data) {
  const set = byUser.get(userId);
  if (!set) return 0;
  set.forEach((res) => write(res, event, data || {}));
  return set.size;
}

// ---- cross-instance broadcast (Postgres LISTEN/NOTIFY) ---------------------
const CHANNEL = 'rg_live';
const broadcastOn = () => String(process.env.LIVE_BROADCAST || '').trim().toLowerCase() === 'postgres';
let listener = null; // { client, ready: Promise }
let stopped = false;

function startBroadcast() {
  if (listener || !broadcastOn()) return listener ? listener.ready : Promise.resolve(false);
  stopped = false;
  const { Client } = require('pg');
  const { connectionString } = require('./sessionStore');
  const ssl = require('./dbSsl').sslOption(process.env);
  const client = new Client(Object.assign({ connectionString: connectionString(process.env) }, ssl ? { ssl } : {}));
  const state = { client, ready: null };
  state.ready = client.connect().then(() => client.query('LISTEN ' + CHANNEL)).then(() => true);
  client.on('notification', (msg) => {
    if (msg.channel !== CHANNEL) return;
    try { const p = JSON.parse(msg.payload); deliver(p.u, p.e, p.d); } catch (e) { /* not ours */ }
  });
  // Lost the listening connection: fall back to local delivery, retry in 5 s.
  client.on('error', (err) => {
    console.error('Live broadcast connection lost:', err && err.message);
    listener = null;
    try { client.end(); } catch (e) { /* already closed */ }
    if (!stopped) setTimeout(() => startBroadcast().catch(() => null), 5000).unref();
  });
  state.ready.catch((err) => { console.error('Live broadcast unavailable:', err && err.message); listener = null; });
  listener = state;
  return state.ready;
}

function stopBroadcast() {
  stopped = true;
  if (listener) { const c = listener.client; listener = null; return c.end().catch(() => null); }
  return Promise.resolve();
}

// Send an event to a user's tabs, on every instance when broadcasting.
function emit(userId, event, data) {
  if (broadcastOn()) {
    startBroadcast().catch(() => null);
    const payload = JSON.stringify({ u: userId, e: event, d: data || {} });
    require('../models').sequelize.query('SELECT pg_notify(:ch, :payload)', { replacements: { ch: CHANNEL, payload } })
      .catch((err) => { console.error('Live broadcast failed, delivering locally:', err && err.message); deliver(userId, event, data); });
    return 0;
  }
  return deliver(userId, event, data);
}

function stats() { return { users: byUser.size, connections: total }; }
function closeAll() { byUser.forEach((set) => set.forEach((res) => { try { res.end(); } catch (e) { /* gone */ } })); }

module.exports = { connect, emit, deliver, isConnected, stats, closeAll, maxConnections, PER_USER, startBroadcast, stopBroadcast, broadcastOn };
