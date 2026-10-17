// Minimal RFC 5545 (iCalendar) writer: escaping, 75-octet line folding, a
// VTIMEZONE built from the zone's real transitions (via Intl), and VEVENTs.
// Times are written as local time with TZID, so calendars show the sale in
// its own time zone and DST is handled by the VTIMEZONE.
const schedule = require('./schedule');

const pad = (n, w) => String(Math.abs(n)).padStart(w || 2, '0');

// TEXT values: backslash, semicolon, comma and newlines are escaped.
function escapeText(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

// Fold to lines of at most 75 octets (UTF-8), never splitting a character.
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, 'utf8');
    const limit = out.length ? 74 : 75; // continuation lines start with a space
    if (bytes + b > limit) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.map((l, i) => (i ? ' ' + l : l)).join('\r\n');
}

// 20261018T080000Z
function utcStamp(d) {
  const t = new Date(d);
  return t.getUTCFullYear() + pad(t.getUTCMonth() + 1) + pad(t.getUTCDate()) + 'T' + pad(t.getUTCHours()) + pad(t.getUTCMinutes()) + pad(t.getUTCSeconds()) + 'Z';
}

// Local wall time of `instant` in `tz` (or at a fixed offset) as 20261018T080000.
function localStamp(instant, tz, offset) {
  const o = offset === undefined ? schedule.offsetMs(new Date(instant), tz) : offset;
  const t = new Date(new Date(instant).getTime() + o);
  return t.getUTCFullYear() + pad(t.getUTCMonth() + 1) + pad(t.getUTCDate()) + 'T' + pad(t.getUTCHours()) + pad(t.getUTCMinutes()) + pad(t.getUTCSeconds());
}

const offsetText = (ms) => { const m = Math.round(ms / 60000); return (m < 0 ? '-' : '+') + pad(Math.floor(Math.abs(m) / 60)) + pad(Math.abs(m) % 60); };

function tzName(instant, tz) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(instant));
    const n = p.find((x) => x.type === 'timeZoneName');
    return n && /^[A-Za-z]{2,6}$/.test(n.value) ? n.value : null;
  } catch (e) { return null; }
}

// Offset changes of `tz` between two instants: [{ at, from, to }] (minute precision).
function transitions(tz, fromMs, toMs) {
  const out = [];
  const DAY = 86400000;
  let prevT = fromMs;
  let prevO = schedule.offsetMs(new Date(prevT), tz);
  for (let t = fromMs + DAY; t <= toMs + DAY; t += DAY) {
    const o = schedule.offsetMs(new Date(t), tz);
    if (o !== prevO) {
      let lo = prevT;
      let hi = t;
      while (hi - lo > 60000) {
        const mid = Math.floor((lo + hi) / 2 / 60000) * 60000;
        if (mid <= lo || mid >= hi) break;
        if (schedule.offsetMs(new Date(mid), tz) === prevO) lo = mid; else hi = mid;
      }
      out.push({ at: hi, from: prevO, to: o });
    }
    prevT = t;
    prevO = o;
  }
  return out;
}

// VTIMEZONE covering every year an event falls in. The first observance
// holds the offset in force at the start of the range; each real transition
// in the range follows (DTSTART is the local time just before it, per RFC).
function vtimezone(tz, instants) {
  const years = instants.map((d) => new Date(d).getUTCFullYear());
  const from = Date.UTC(Math.min.apply(null, years), 0, 1);
  const to = Date.UTC(Math.max.apply(null, years) + 1, 0, 1);
  const first = schedule.offsetMs(new Date(from), tz);
  const changes = transitions(tz, from, to);
  const all = [first].concat(changes.map((c) => c.to));
  const standard = Math.min.apply(null, all);
  const lines = ['BEGIN:VTIMEZONE', 'TZID:' + tz];
  const obs = (kind, start, fromO, toO, name) => {
    lines.push('BEGIN:' + kind, 'DTSTART:' + start, 'TZOFFSETFROM:' + offsetText(fromO), 'TZOFFSETTO:' + offsetText(toO));
    if (name) lines.push('TZNAME:' + name);
    lines.push('END:' + kind);
  };
  obs(first > standard ? 'DAYLIGHT' : 'STANDARD', '19700101T000000', first, first, tzName(from, tz));
  changes.forEach((c) => obs(c.to > standard ? 'DAYLIGHT' : 'STANDARD', localStamp(c.at, tz, c.from), c.from, c.to, tzName(c.at, tz)));
  lines.push('END:VTIMEZONE');
  return lines;
}

// events: [{ uid, sequence, start, end, timeZone, summary, description, location, url, status, lastModified }]
// Returns the whole VCALENDAR as a CRLF string.
function calendar(events, opts) {
  const o = opts || {};
  const stamp = utcStamp(o.now || new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RapidGarage//Sale calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  if (o.name) lines.push('X-WR-CALNAME:' + escapeText(o.name));
  const zones = new Map();
  events.forEach((e) => { if (!zones.has(e.timeZone)) zones.set(e.timeZone, []); zones.get(e.timeZone).push(e.start, e.end); });
  zones.forEach((instants, tz) => { lines.push(...vtimezone(tz, instants)); });
  events.forEach((e) => {
    lines.push('BEGIN:VEVENT', 'UID:' + e.uid, 'SEQUENCE:' + (e.sequence || 0), 'DTSTAMP:' + stamp);
    lines.push('DTSTART;TZID=' + e.timeZone + ':' + localStamp(e.start, e.timeZone));
    lines.push('DTEND;TZID=' + e.timeZone + ':' + localStamp(e.end, e.timeZone));
    if (e.lastModified) lines.push('LAST-MODIFIED:' + utcStamp(e.lastModified));
    lines.push('SUMMARY:' + escapeText(e.summary));
    if (e.location) lines.push('LOCATION:' + escapeText(e.location));
    if (e.description) lines.push('DESCRIPTION:' + escapeText(e.description));
    if (e.url) lines.push('URL:' + e.url);
    lines.push('STATUS:' + (e.status || 'CONFIRMED'), 'TRANSP:TRANSPARENT');
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { escapeText, fold, utcStamp, localStamp, offsetText, transitions, vtimezone, calendar };
