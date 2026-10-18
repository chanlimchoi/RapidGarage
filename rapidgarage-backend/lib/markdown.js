// Last-hour markdowns: "everything X% off from HH:MM", in the sale's local
// time, on every sale day or only on the last one.
//
//   markdownPercent  5–90 (whole percent), null = no markdown
//   markdownFrom     "HH:MM" local start time (required with a percent)
//   markdownLastDay  only on the sale's last day
//
// A day's markdown runs from markdownFrom until that day's sale window ends.
// A start at or after the window's end means no markdown that day; a start
// before the window opens means the whole day is discounted.
// Clients get post.markdown = { percent, from, lastDayOnly, active, startsAt, endsAt }
// (startsAt/endsAt: the current or next markdown window, ISO; null when none
// is left). Item prices are discounted on the client, rounded down to the cent.
// Mirrored in rapidgarage-frontend/app/lib/markdown.js.
const { Op } = require('sequelize');
const schedule = require('./schedule');

const PERCENT_MIN = 5;
const PERCENT_MAX = 90;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const FIELDS = ['markdownPercent', 'markdownFrom', 'markdownLastDay'];

// Validate the markdown fields present in body. `existing` (updates) supplies
// unchanged fields so the cross-field rule sees the final state.
// Returns { errors, values } with only the fields that were sent (plus the
// time cleared when the percent is cleared).
function validateMarkdown(body, existing) {
  const errors = {};
  const values = {};
  if (body.markdownPercent !== undefined) {
    const p = body.markdownPercent;
    if (p === null || p === '') values.markdownPercent = null;
    else {
      const n = typeof p === 'string' && /^\s*\d+\s*$/.test(p) ? Number(p) : p;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < PERCENT_MIN || n > PERCENT_MAX) errors.markdownPercent = 'Markdown must be a whole percent from 5 to 90.';
      else values.markdownPercent = n;
    }
  }
  if (body.markdownFrom !== undefined) {
    const v = body.markdownFrom;
    if (v === null || v === '') values.markdownFrom = null;
    else if (typeof v !== 'string' || !TIME_RE.test(v.trim())) errors.markdownFrom = 'Markdown start must be a time like 14:00.';
    else values.markdownFrom = v.trim();
  }
  if (body.markdownLastDay !== undefined) {
    if (body.markdownLastDay === null) values.markdownLastDay = false;
    else if (typeof body.markdownLastDay !== 'boolean') errors.markdownLastDay = 'markdownLastDay must be true or false.';
    else values.markdownLastDay = body.markdownLastDay;
  }
  if (Object.keys(errors).length) return { errors, values: {} };
  const pick = (k) => (values[k] !== undefined ? values[k] : existing ? existing[k] : null);
  const percent = pick('markdownPercent');
  if (percent === null || percent === undefined) {
    // No markdown: clear its time too so nothing stale lingers.
    if (FIELDS.some((k) => values[k] !== undefined)) { values.markdownFrom = null; values.markdownLastDay = false; }
  } else if (!pick('markdownFrom')) {
    errors.markdownFrom = 'Choose when the markdown starts.';
  }
  return { errors, values: Object.keys(errors).length ? {} : values };
}

const tzOf = (post) => (post.timeZone && schedule.isValidTimeZone(post.timeZone) ? post.timeZone : schedule.defaultTimeZone());

// Markdown windows [{ startsAt, endsAt }] (ms) for a post with saleDays (or legacy dates).
function windowsOf(post) {
  if (!post || !post.markdownPercent || !post.markdownFrom) return [];
  let sale = schedule.windowsOf(post);
  if (!sale.length) return [];
  if (post.markdownLastDay) sale = sale.slice(-1);
  const tz = tzOf(post);
  const out = [];
  sale.forEach((w) => {
    const date = schedule.localDate(new Date(w.startsAt), tz);
    const start = schedule.zonedToUtc(date, post.markdownFrom, tz).getTime();
    if (start >= w.endsAt) return;
    out.push({ startsAt: Math.max(start, w.startsAt), endsAt: w.endsAt });
  });
  return out;
}

function state(post, at) {
  if (!post || !post.markdownPercent || !post.markdownFrom) return null;
  const t = +(at || schedule.now());
  const live = windowsOf(post).filter((w) => w.endsAt > t);
  const cur = live[0] || null;
  return {
    percent: post.markdownPercent,
    from: post.markdownFrom,
    lastDayOnly: !!post.markdownLastDay,
    active: !!cur && cur.startsAt <= t,
    startsAt: cur ? new Date(cur.startsAt).toISOString() : null,
    endsAt: cur ? new Date(cur.endsAt).toISOString() : null,
  };
}

const isActive = (post, at) => { const s = state(post, at); return !!(s && s.active); };

// Price after the markdown, rounded down to the cent; null stays null.
function discounted(cents, percent) {
  if (cents === null || cents === undefined) return cents;
  return Math.floor(cents * (100 - percent) / 100);
}

// Keep rows whose markdown is running now. Rows without saleDays (raw search
// candidates) get their days loaded in one query.
async function filterActive(models, rows, at) {
  const t = at || schedule.now();
  const candidates = rows.filter((r) => r.markdownPercent && r.markdownFrom);
  if (!candidates.length) return [];
  const need = candidates.filter((r) => !Array.isArray(r.saleDays));
  const byPost = new Map();
  if (need.length) {
    const days = await models.SaleDay.findAll({ where: { postId: need.map((r) => r.id), endsAt: { [Op.gt]: t } }, attributes: ['postId', 'startsAt', 'endsAt'], raw: true });
    days.forEach((d) => { if (!byPost.has(d.postId)) byPost.set(d.postId, []); byPost.get(d.postId).push(d); });
  }
  return candidates.filter((r) => {
    if (Array.isArray(r.saleDays)) return isActive(r, t);
    // Only the remaining days are loaded, so "last day" is still the last one.
    const view = Object.assign({}, r, { saleDays: byPost.get(r.id) || (r.timeZone ? [] : undefined) });
    return isActive(view, t);
  });
}

module.exports = { PERCENT_MIN, PERCENT_MAX, FIELDS, validateMarkdown, windowsOf, state, isActive, discounted, filterActive };
