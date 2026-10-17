#!/usr/bin/env node
// Fill lat/lng for existing posts.
//   npm run geocode:backfill                # never geocoded, or failed (no_key / error)
//   npm run geocode:backfill -- --retry     # also retry addresses that were not_found
//   npm run geocode:backfill -- --dry-run --limit 100
// Uses the same key rules as live geocoding: server key first, else the
// post owner's own key when BYOK is enabled. Respects GEOCODE_MAX_PER_SECOND.
require('dotenv').config();

async function run(opts) {
  const models = require('../models');
  const geo = require('../lib/geo');
  const { Op } = require('sequelize');
  const log = opts.log || console.log;
  // Default: never tried, or failed for a reason a new key / retry can fix.
  // --retry also re-tries addresses Google could not find.
  const statuses = opts.retry ? ['no_key', 'error', 'not_found'] : ['no_key', 'error'];
  const where = { [Op.or]: [{ geocodeStatus: null }, { geocodeStatus: statuses }] };
  const posts = await models.Post.findAll({ where, order: [['id', 'ASC']], limit: opts.limit || undefined });
  const counts = { total: posts.length, ok: 0, no_key: 0, not_found: 0, error: 0, rate_limited: 0, skipped: 0 };
  const delayMs = opts.delayMs !== undefined ? opts.delayMs : Math.ceil(1000 / (parseInt(process.env.GEOCODE_MAX_PER_SECOND, 10) || 10));
  for (const post of posts) {
    if (!geo.postAddress(post)) { counts.skipped++; continue; }
    if (opts.dryRun) { log(`would geocode post ${post.id}`); continue; }
    const before = post.geocodedAt;
    await geo.geocodePost(post);
    const status = post.geocodedAt === before ? 'rate_limited' : post.geocodeStatus;
    counts[status] = (counts[status] || 0) + 1;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  }
  log(`Backfill ${opts.dryRun ? '(dry run) ' : ''}done: ${JSON.stringify(counts)}`);
  return counts;
}

module.exports = { run };

if (require.main === module) {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const opts = {
    dryRun: args.includes('--dry-run'),
    retry: args.includes('--retry'),
    limit: limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) || 0 : 0,
  };
  run(opts)
    .then(() => require('../models').sequelize.close())
    .catch((err) => { console.error(err.message); process.exit(1); });
}
