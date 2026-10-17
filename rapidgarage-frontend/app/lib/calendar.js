// "Add to calendar" links (pure; the .ics files come from the API).
// Google and Outlook take UTC instants, so each sale day becomes one event in
// the right zone with no time-zone guessing. Location is only what the sale
// page already shows publicly: the address for a sale, the area for an event.
const DESCRIPTION_MAX = 600;

const pad = (n) => String(n).padStart(2, '0');
// 20261018T120000Z
export function googleStamp(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
}
// 2026-10-18T12:00:00Z
export const isoStamp = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function clip(text, max) {
  const s = String(text || '').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

export function details(description, url) {
  return [clip(description, DESCRIPTION_MAX), url].filter(Boolean).join('\n\n');
}

const query = (params) => Object.keys(params).filter((k) => params[k] !== undefined && params[k] !== '')
  .map((k) => k + '=' + encodeURIComponent(params[k]).replace(/%2F/g, '/')).join('&');

// ev: { title, start(ms), end(ms), location, description, url, timeZone }
export function googleUrl(ev) {
  return 'https://calendar.google.com/calendar/render?' + query({
    action: 'TEMPLATE', text: ev.title, dates: googleStamp(ev.start) + '/' + googleStamp(ev.end),
    details: details(ev.description, ev.url), location: ev.location, ctz: ev.timeZone,
  });
}

// host 'live' (Outlook.com) or 'office' (Microsoft 365, work/school).
export function outlookUrl(ev, host) {
  const base = host === 'office' ? 'https://outlook.office.com' : 'https://outlook.live.com';
  return base + '/calendar/0/action/compose?' + query({
    path: '/calendar/action/compose', rru: 'addevent', subject: ev.title,
    startdt: isoStamp(ev.start), enddt: isoStamp(ev.end), location: ev.location, body: details(ev.description, ev.url),
  });
}

const addressOf = (p) => [p.street, p.city, p.state, p.zipCode].filter(Boolean).join(', ');

// Upcoming days of a sale or neighborhood event as link-ready events.
// kind: 'post' | 'event'; origin: e.g. window.location.origin.
export function calendarEvents(item, kind, origin, now) {
  const days = item && item.schedule && Array.isArray(item.schedule.days) ? item.schedule.days : [];
  const at = (now || new Date()).getTime();
  const url = (origin || '') + (kind === 'event' ? '/events/' : '/post/') + item.id;
  const title = kind === 'event' ? item.name : item.title;
  const location = kind === 'event' ? (item.areaLabel || '') : addressOf(item);
  const tz = (item.schedule && item.schedule.timeZone) || item.timeZone;
  return days.map((d) => ({ date: d.date, start: new Date(d.startsAt).getTime(), end: new Date(d.endsAt).getTime() }))
    .filter((d) => !isNaN(d.start) && !isNaN(d.end) && d.end > at)
    .map((d) => ({ date: d.date, title, start: d.start, end: d.end, location, description: item.description, url, timeZone: tz }));
}

export const icsPath = (item, kind) => '/api/' + (kind === 'event' ? 'events/' : 'post/') + item.id + '/calendar.ics';
export const savedIcsPath = (when) => '/api/saved/calendar.ics?when=' + encodeURIComponent(when || 'all');
