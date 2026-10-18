'use strict';
// Sale item lists: validation and keyword matching (see controllers/items.js).
const { Op } = require('sequelize');

const MAX_ITEMS = 100;
const NAME_MAX = 80;
const PRICE_CAP_CENTS = 100000 * 100; // same cap as sale prices ($100,000)
const KEYWORD_MAX = 60;
const MAX_WORDS = 5;

// "12", "12.5", "12.50", 12, 12.5 -> cents. "" / null -> null.
function parseCents(raw) {
  if (raw === null || raw === undefined || raw === '') return { value: null };
  const s = typeof raw === 'number' ? String(raw) : (typeof raw === 'string' ? raw.trim().replace(/^\$/, '') : null);
  if (s === null || !/^\d{1,6}(\.\d{1,2})?$/.test(s)) return { error: 'Enter a price like 5 or 2.50.' };
  const [d, c] = s.split('.');
  const cents = Number(d) * 100 + Number((c || '').padEnd(2, '0') || 0);
  if (cents > PRICE_CAP_CENTS) return { error: 'Price must be $100,000 or less.' };
  return { value: cents };
}

// body -> { errors, value }. partial: only fields present are checked/returned.
// photoIds: ids of the post's own photos.
function validateItem(body, photoIds, partial) {
  const b = body && typeof body === 'object' ? body : {};
  const errors = {};
  const value = {};
  if (!partial || b.name !== undefined) {
    const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
    if (!name) errors.name = 'Give the item a name.';
    else if (name.length > NAME_MAX) errors.name = 'Keep the name to ' + NAME_MAX + ' characters.';
    else value.name = name;
  }
  if (!partial || b.price !== undefined) {
    const p = parseCents(b.price);
    if (p.error) errors.price = p.error;
    else value.priceCents = p.value;
  }
  if (!partial || b.photoId !== undefined) {
    if (b.photoId === null || b.photoId === undefined || b.photoId === '') value.photoId = null;
    else {
      const id = Number(b.photoId);
      if (!Number.isInteger(id) || photoIds.indexOf(id) < 0) errors.photoId = "Choose one of this sale's photos.";
      else value.photoId = id;
    }
  }
  if (b.sold !== undefined) {
    if (typeof b.sold !== 'boolean') errors.sold = 'sold must be true or false.';
    else value.sold = b.sold;
  }
  return { errors, value };
}

// ?keyword= -> { words } | { error }. Each word must match the title, the
// description or an unsold item's name.
function parseKeyword(raw) {
  if (raw === undefined || raw === '') return { words: null };
  if (typeof raw !== 'string') return { error: 'Must be text.' };
  const k = raw.trim().replace(/\s+/g, ' ');
  if (!k) return { words: null };
  if (k.length > KEYWORD_MAX) return { error: 'Keep it to ' + KEYWORD_MAX + ' characters.' };
  const words = Array.from(new Set(k.toLowerCase().split(' '))).slice(0, MAX_WORDS);
  return { words, keyword: k };
}

// Case-insensitive, literal "field contains word": ILIKE with escaping on
// Postgres; instr(lower()) on SQLite (whose LIKE has no default escape).
function contains(models, field, word) {
  const sq = models.sequelize;
  if (sq.getDialect() === 'postgres') return { [field]: { [Op.iLike]: '%' + word.replace(/[\\%_]/g, (c) => '\\' + c) + '%' } };
  return sq.where(sq.fn('instr', sq.fn('lower', sq.col(field)), word.toLowerCase()), Op.gt, 0);
}

// Ids (among `ids`, or all posts when null) matching every word.
async function keywordPostIds(models, words, ids) {
  let result = ids ? new Set(ids) : null;
  for (const w of words) {
    if (result && !result.size) break;
    const scope = result ? { id: Array.from(result) } : {};
    const posts = await models.Post.findAll({ attributes: ['id'], raw: true,
      where: { [Op.and]: [scope, { [Op.or]: [contains(models, 'title', w), contains(models, 'description', w)] }] } });
    const items = await models.SaleItem.findAll({ attributes: ['postId'], raw: true,
      where: { [Op.and]: [{ sold: false }, result ? { postId: Array.from(result) } : {}, contains(models, 'name', w)] } });
    result = new Set(posts.map((p) => p.id).concat(items.map((i) => i.postId)));
  }
  return result || new Set();
}

// { postId: ['Road bike', ...] }: unsold item names matching the keyword (max 3 each).
async function matchedItems(models, words, postIds) {
  if (!words || !postIds.length) return {};
  const rows = await models.SaleItem.findAll({ attributes: ['postId', 'name', 'position', 'id'], raw: true,
    where: { [Op.and]: [{ postId: postIds, sold: false }, { [Op.or]: words.map((w) => contains(models, 'name', w)) }] },
    order: [['position', 'ASC'], ['id', 'ASC']] });
  // Per post: the items matching the most words (e.g. "road bike" prefers
  // "Road bike" over "Bike helmet"), in list order, at most 3.
  const score = (name) => words.filter((w) => name.toLowerCase().indexOf(w) >= 0).length;
  const by = {};
  rows.forEach((r) => { (by[r.postId] = by[r.postId] || []).push({ name: r.name, score: score(r.name) }); });
  const out = {};
  Object.keys(by).forEach((id) => {
    const best = Math.max.apply(null, by[id].map((x) => x.score));
    out[id] = by[id].filter((x) => x.score === best).slice(0, 3).map((x) => x.name);
  });
  return out;
}

module.exports = { MAX_ITEMS, NAME_MAX, PRICE_CAP_CENTS, KEYWORD_MAX, parseCents, validateItem, parseKeyword, keywordPostIds, matchedItems };
