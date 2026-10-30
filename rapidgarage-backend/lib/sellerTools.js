// Seller tools: duplicate a past sale, the post-sale summary, and its email.
//
// Duplicate: a new sale with the same details, prices, markdown settings,
// unsold items and copies of the photos (new storage keys, so deleting one
// sale never touches the other's files). No dates: the seller picks new ones.
//
// Summary: items sold (and their listed value), views, saves, shares, QR
// scans, conversations and completed holds, all-time, for the seller only.
// Emailed once, the day after the sale ends, with links to put leftovers out
// "free on the curb" and to duplicate the sale for next time.
const { Op } = require('sequelize');
const schedule = require('./schedule');
const i18n = require('./i18n');
const mailer = require('./mailer');
const { newKeys } = require('./photos');
const { getStorage } = require('./storage');

function models() { return require('../models'); }

const COPY_FIELDS = ['title', 'street', 'city', 'state', 'zipCode', 'description', 'lat', 'lng', 'geocodeStatus', 'geocodedAt', 'priceMin', 'priceMax', 'isFree', 'category',
  'markdownPercent', 'markdownFrom', 'markdownLastDay', 'bundleMinItems', 'bundlePercent', 'timeZone'];

// Resolves to the new post id. Photos are copied byte for byte.
async function duplicate(post) {
  const m = models();
  const values = { userId: post.userId };
  COPY_FIELDS.forEach((f) => { if (post[f] !== undefined) values[f] = post[f]; });
  const copy = await m.Post.create(values);
  const storage = getStorage();
  const photos = await m.PostPhoto.findAll({ where: { postId: post.id }, order: [['position', 'ASC'], ['id', 'ASC']] });
  const photoMap = new Map();
  const written = [];
  try {
    for (const p of photos) {
      const keys = newKeys(copy.id);
      const [full, thumb] = await Promise.all([storage.read(p.storageKey), storage.read(p.thumbKey)]);
      await storage.put(keys.storageKey, full, 'image/webp'); written.push(keys.storageKey);
      await storage.put(keys.thumbKey, thumb, 'image/webp'); written.push(keys.thumbKey);
      const row = await m.PostPhoto.create({ postId: copy.id, storageKey: keys.storageKey, thumbKey: keys.thumbKey, width: p.width, height: p.height, position: p.position, alt: p.alt });
      photoMap.set(p.id, row.id);
    }
  } catch (err) {
    // Don't leave a half-copied sale behind.
    await Promise.all(written.map((k) => storage.remove(k).catch(() => null)));
    await m.PostPhoto.destroy({ where: { postId: copy.id } });
    await copy.destroy();
    throw err;
  }
  const items = await m.SaleItem.findAll({ where: { postId: post.id, sold: false }, order: [['position', 'ASC'], ['id', 'ASC']] });
  if (items.length) {
    await m.SaleItem.bulkCreate(items.map((it, i) => ({ postId: copy.id, name: it.name, priceCents: it.priceCents, photoId: it.photoId ? photoMap.get(it.photoId) || null : null, position: i, sold: false })));
  }
  return copy.id;
}

const sumOf = async (model, postId) => Number((await model.sum('count', { where: { postId } })) || 0);

async function summary(post) {
  const m = models();
  const items = await m.SaleItem.findAll({ where: { postId: post.id }, attributes: ['sold', 'priceCents'], raw: true });
  const sold = items.filter((i) => i.sold);
  const [views, scans, shares, saves, conversations, holdsCompleted] = await Promise.all([
    sumOf(m.PostViewDay, post.id), sumOf(m.PostScanDay, post.id), sumOf(m.PostShareDay, post.id),
    m.SavedPost.count({ where: { postId: post.id } }),
    m.Conversation.count({ where: { postId: post.id } }),
    m.ItemHold.count({ where: { postId: post.id, status: 'completed' } }),
  ]);
  return {
    postId: post.id,
    ended: schedule.isEnded(post),
    items: { total: items.length, sold: sold.length, unsold: items.length - sold.length, soldValueCents: sold.reduce((s, i) => s + (i.priceCents || 0), 0) },
    views, scans, shares, saves, conversations, holdsCompleted,
  };
}

// ---- email (from the alert worker's pass) ----------------------------------
const money = (lang, cents) => { try { return new Intl.NumberFormat(i18n.intlLocale(lang), { style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100); } catch (e) { return '$' + (cents / 100); } };

function renderSummaryEmail(user, post, s) {
  const lang = i18n.normalize(user.locale) || 'en';
  const L = (k, v) => i18n.t(lang, k, v);
  const base = require('./alerts').baseUrl();
  const hello = user.firstName ? L('mail.hi', { name: user.firstName }) : L('mail.hiAnon');
  const lines = [
    hello, '',
    L('summary.intro', { title: post.title }),
    s.items.total ? L('summary.items', { sold: s.items.sold, total: s.items.total, value: money(lang, s.items.soldValueCents) }) : null,
    L('summary.reach', { views: s.views, saves: s.saves, conversations: s.conversations }),
    '',
    // Leftovers, and no curb offer running yet.
    s.items.unsold && !(post.curbsideUntil && new Date(post.curbsideUntil) > schedule.now()) ? L('summary.curb', { url: base + '/post/' + post.id }) : null,
    L('summary.again', { url: base + '/dashboard/sales/' + post.id }),
  ].filter((x) => x !== null);
  return { subject: L('summary.subject', { title: post.title }), text: lines.join('\n'), headers: { 'Content-Language': lang } };
}

// Sales that ended in the last 3 days and haven't had their summary. Resolves
// to how many emails went out.
async function processSummaries(now) {
  const m = models();
  const t = now || schedule.now();
  if (!mailer.isConfigured()) return 0;
  const posts = await m.Post.findAll({
    where: { summarySentAt: null, hidden: false, endDate: { [Op.lt]: t, [Op.gt]: new Date(t.getTime() - 3 * 86400000) } },
    include: [{ model: m.SaleDay, as: 'saleDays' }, { model: m.User, attributes: ['id', 'email', 'firstName', 'locale'] }],
    limit: 200,
  });
  let sent = 0;
  for (const post of posts) {
    if (!schedule.isEnded(post, t) || !post.User) continue;
    // Claim first so two workers never both send it.
    const [claimed] = await m.Post.update({ summarySentAt: new Date() }, { where: { id: post.id, summarySentAt: null } });
    if (!claimed) continue;
    const msg = renderSummaryEmail(post.User, post, await summary(post));
    try {
      await mailer.send({ to: post.User.email, subject: msg.subject, text: msg.text, headers: msg.headers });
      sent++;
    } catch (err) {
      console.error('Sale summary for post ' + post.id + ' failed:', err && (err.code || err.name));
      await m.Post.update({ summarySentAt: null }, { where: { id: post.id } });
    }
  }
  return sent;
}

module.exports = { duplicate, summary, renderSummaryEmail, processSummaries, COPY_FIELDS };
