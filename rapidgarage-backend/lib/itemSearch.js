'use strict';
// Item-level search (GET /search/items): individual unsold items whose name
// contains every keyword word ("bike" -> "Kids bike", "Bike helmet"), across
// the sales a normal search would show (same place, radius and filters, same
// visibility and moderation rules). Each result is one item with its photo
// (or the sale's cover, marked as such), price, and the sale's distance and
// dates; `sales` lists the distinct sales on the page for the map pins.
const { Op } = require('sequelize');
const schedule = require('./schedule');
const markdown = require('./markdown');
const itemsLib = require('./items');

const MAX_ITEMS = 2000; // hard cap on matched rows per request

// SaleItem rows (unsold, in postIds) whose name contains every word.
async function matching(models, words, postIds) {
  if (!words || !words.length || !postIds.length) return [];
  return models.SaleItem.findAll({
    where: { [Op.and]: [{ postId: postIds, sold: false }].concat(words.map((w) => itemsLib.contains(models, 'name', w))) },
    attributes: ['id', 'postId', 'name', 'priceCents', 'photoId', 'position', 'reservedUntil', 'curbside', 'curbsideGoneAt'],
    order: [['postId', 'ASC'], ['position', 'ASC'], ['id', 'ASC']],
    limit: MAX_ITEMS,
    raw: true,
  });
}

// ranked: [{ id, distance }] in display order (distance null without a place).
// -> [{ row, rank, distance }] in display order: by the sale's rank, then the item's list position.
function order(rows, ranked) {
  const rank = new Map(ranked.map((r, i) => [r.id, { i, d: r.distance }]));
  return rows.filter((r) => rank.has(r.postId))
    .map((r) => ({ row: r, rank: rank.get(r.postId).i, distance: rank.get(r.postId).d }))
    .sort((a, b) => a.rank - b.rank || a.row.position - b.row.position || a.row.id - b.row.id);
}

// Next (or current) window of a sale: { startsAt, endsAt, status } or null for undated posts.
function nextWindow(post, at) {
  const t = (at || schedule.now()).getTime();
  const w = schedule.windowsOf(post);
  const cur = w.find((x) => x.endsAt > t);
  if (!cur) return null;
  return { startsAt: new Date(cur.startsAt).toISOString(), endsAt: new Date(cur.endsAt).toISOString(), status: cur.startsAt <= t ? 'open' : 'upcoming' };
}

// One page of ordered matches -> { results, sales }. posts: Map id -> Post (with photos, saleDays).
function shape(page, posts, at) {
  const now = at || schedule.now();
  const results = [];
  const sales = new Map();
  page.forEach(({ row, distance }) => {
    const post = posts.get(row.postId);
    if (!post) return;
    const photos = (post.photos || []).slice().sort((a, b) => a.position - b.position || a.id - b.id);
    const own = row.photoId ? photos.find((p) => p.id === row.photoId) : null;
    const photo = own || photos[0] || null;
    const reserved = !!row.reservedUntil && new Date(row.reservedUntil) > now;
    const md = markdown.state(post, now);
    const dist = distance === null || distance === undefined ? null : Math.round(distance * 10) / 10;
    results.push({
      id: row.id, name: row.name, priceCents: row.priceCents, reserved,
      photo: photo ? { url: photo.toJSON().url, thumbUrl: photo.toJSON().thumbUrl, alt: photo.alt || null, ofSale: !own } : null,
      sale: {
        id: post.id, title: post.title, city: post.city, state: post.state, distanceMiles: dist,
        isFree: !!post.isFree, window: nextWindow(post, now), schedule: schedule.toJSON(post),
        markdown: md,
      },
    });
    if (!sales.has(post.id)) sales.set(post.id, Object.assign(post.toJSON(), { distanceMiles: dist }));
  });
  return { results, sales: Array.from(sales.values()) };
}

module.exports = { MAX_ITEMS, matching, order, nextWindow, shape };
