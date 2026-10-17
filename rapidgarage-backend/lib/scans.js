'use strict';
// Privacy-respecting scan counter for /s/<code>.
//
// Stored: per post and local day, a number. Nothing about the visitor.
// Dedupe: HMAC-SHA256(daily salt, postId | client IP | user agent), truncated
// to 128 bits, kept only for the current UTC day. The salt is random, lives
// only in this process's memory and is replaced when the UTC day changes (and
// on restart); rows hashed with an old salt are deleted then. Without the
// salt a hash can't be linked back to an IP, even by brute force over IPv4.
// Not counted: non-GET (HEAD), empty or bot/preview user agents, prefetches,
// and the post's owner or an admin (testing their own flyer).
const crypto = require('crypto');
const { Op } = require('sequelize');
const schedule = require('./schedule');
const { isAdmin } = require('./roles');

function models() { return require('../models'); }

let clock = () => new Date();
function setClock(fn) { clock = fn || (() => new Date()); }

const utcDay = (d) => d.toISOString().slice(0, 10);

let saltDay = null;
let salt = null;
let purging = null;

function currentSalt() {
  const day = utcDay(clock());
  if (day !== saltDay) {
    const first = saltDay === null;
    saltDay = day;
    salt = crypto.randomBytes(32);
    // After a restart even today's rows are unusable (their salt is gone).
    const where = first ? {} : { day: { [Op.ne]: day } };
    purging = models().ScanDedupe.destroy({ where }).catch(() => null);
  }
  return { day, salt };
}

// Tests: forget the salt (as on a restart).
function resetSalt() { saltDay = null; salt = null; }

const BOT_RE = /bot\b|bot\/|crawl|spider|slurp|archiver|facebookexternalhit|facebookcatalog|meta-externalagent|embedly|preview|whatsapp|telegram|slack|discord|skype|vkshare|pinterest|redditbot|quora|bingpreview|google-inspectiontool|lighthouse|pagespeed|pingdom|uptime|monitor|headlesschrome|phantomjs|curl\/|wget\/|python-requests|python-urllib|aiohttp|httpx|go-http-client|okhttp|java\/|libwww|axios\/|node-fetch|undici|postmanruntime|insomnia/i;

function isBot(ua) { return !ua || !String(ua).trim() || BOT_RE.test(ua); }

function isPrefetch(req) {
  const p = [req.get('sec-purpose'), req.get('purpose'), req.get('x-purpose'), req.get('x-moz')].filter(Boolean).join(' ');
  return /prefetch|preview|prerender/i.test(p);
}

// The visitor's address. Behind a configured proxy Express's req.ip is used.
// Otherwise, when the request comes from loopback (the Vite server proxying
// /s/ with xfwd), the last X-Forwarded-For hop (added by that proxy) is used.
function clientIp(req) {
  if (req.app && req.app.get('trust proxy')) return req.ip || '';
  const remote = (req.socket && req.socket.remoteAddress) || '';
  const xff = req.get('x-forwarded-for');
  if (xff && /^(::1|127\.|::ffff:127\.)/.test(remote)) {
    const hops = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return remote;
}

function visitorHash(postId, ip, ua) {
  const s = currentSalt();
  const hash = crypto.createHmac('sha256', s.salt).update(postId + '\n' + ip + '\n' + ua).digest('base64url').slice(0, 22);
  return { day: s.day, hash };
}

function skipReason(req, post) {
  if (req.method !== 'GET') return 'method';
  const ua = req.get('user-agent') || '';
  if (isBot(ua)) return 'bot';
  if (isPrefetch(req)) return 'prefetch';
  if (req.user && (req.user.id === post.userId || isAdmin(req.user))) return 'owner';
  return null;
}

// Count one scan of `post` unless skipped or a repeat. -> { counted, reason }
async function record(req, post) {
  const reason = skipReason(req, post);
  if (reason) return { counted: false, reason };
  const M = models();
  const { day, hash } = visitorHash(post.id, clientIp(req), req.get('user-agent') || '');
  if (purging) { await purging; purging = null; }
  try {
    await M.ScanDedupe.create({ day, hash });
  } catch (err) {
    if (err && err.name === 'SequelizeUniqueConstraintError') return { counted: false, reason: 'repeat' };
    throw err;
  }
  const local = schedule.localDate(clock(), post.timeZone || schedule.defaultTimeZone());
  const where = { postId: post.id, day: local };
  let row = await M.PostScanDay.findOne({ where });
  if (!row) {
    try {
      await M.PostScanDay.create(Object.assign({ count: 1 }, where));
      return { counted: true, reason: null };
    } catch (err) {
      if (!err || err.name !== 'SequelizeUniqueConstraintError') throw err;
      row = await M.PostScanDay.findOne({ where });
    }
  }
  await row.increment('count'); // SET count = count + 1 (atomic)
  return { counted: true, reason: null };
}

// { total, today, days: [{ date, count }] } for the last `n` local days (oldest first).
async function stats(post, n) {
  const span = n || 30;
  const tz = post.timeZone || schedule.defaultTimeZone();
  const today = schedule.localDate(clock(), tz);
  const first = schedule.addDays(today, -(span - 1));
  const M = models();
  const [rows, total] = await Promise.all([
    M.PostScanDay.findAll({ where: { postId: post.id, day: { [Op.gte]: first } }, raw: true }),
    M.PostScanDay.sum('count', { where: { postId: post.id } }),
  ]);
  const by = new Map(rows.map((r) => [String(r.day).slice(0, 10), r.count]));
  const days = [];
  for (let i = 0; i < span; i++) {
    const d = schedule.addDays(first, i);
    days.push({ date: d, count: by.get(d) || 0 });
  }
  return { total: total || 0, today: by.get(today) || 0, timeZone: tz, days };
}

module.exports = { setClock, resetSalt, isBot, isPrefetch, clientIp, skipReason, record, stats, BOT_RE };
