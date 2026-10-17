#!/usr/bin/env node
'use strict';
// Pre-migration data check / cleanup for the 2026 migrations.
//
// Constraints the pending migrations add (see migrations/2026101600*):
//   20261016000000  Users.email NOT NULL; UNIQUE(Users.email);
//                   Posts.userId NOT NULL; FK Posts.userId -> Users.id;
//                   Subscribers.zipCode INTEGER -> VARCHAR (always safe)
//   20261016010000  new Users.googleId column + UNIQUE (new column, always safe)
//   20261016020000  new Users.role NOT NULL DEFAULT 'user' (default fills it, safe)
//
// Usage:
//   node scripts/db-precheck.js precheck            read-only report, exit 1 if migrations would fail
//   node scripts/db-precheck.js cleanup             dry run: print the planned changes, change nothing
//   node scripts/db-precheck.js cleanup --apply     perform the changes in ONE transaction
//   options: --orphan-owner-id=<userId>  (or env ORPHAN_POST_OWNER_ID)
//
// Connection: DATABASE_URL (loaded from .env). The URL is never printed.
require('dotenv').config();
const { Client } = require('pg');

const args = process.argv.slice(2);
const mode = args[0];
const apply = args.includes('--apply');
const ownerArg = args.find((a) => a.startsWith('--orphan-owner-id='));
const orphanOwnerRaw = ownerArg ? ownerArg.split('=')[1] : process.env.ORPHAN_POST_OWNER_ID;

if (!['precheck', 'cleanup'].includes(mode)) {
  console.error('Usage: db-precheck.js precheck | cleanup [--apply] [--orphan-owner-id=<id>]');
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (see .env.example).');
  process.exit(2);
}

const norm = (e) => (e == null ? '' : String(e).trim().toLowerCase());

// "local@domain" -> "local+dup-<id>@domain"; no "@" -> "<value>+dup-<id>"
function dupEmail(email, id) {
  const e = norm(email);
  const at = e.lastIndexOf('@');
  return at > 0 ? `${e.slice(0, at)}+dup-${id}${e.slice(at)}` : `${e}+dup-${id}`;
}
const missingEmail = (id) => `missing-email+${id}@invalid.invalid`;

async function tableExists(c, name) {
  const r = await c.query('SELECT to_regclass($1) AS t', [`public."${name}"`]);
  return r.rows[0].t !== null;
}

async function analyze(c) {
  const users = (await c.query('SELECT id, email, "createdAt" FROM "Users" ORDER BY "createdAt" ASC, id ASC')).rows;
  const ids = new Set(users.map((u) => u.id));
  const empty = users.filter((u) => norm(u.email) === '');
  const groups = new Map();
  for (const u of users) {
    const k = norm(u.email);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(u); // already oldest first
  }
  const dups = [...groups.values()].filter((g) => g.length > 1);
  const unnormalized = users.filter((u) => norm(u.email) !== '' && u.email !== norm(u.email));
  const posts = (await c.query('SELECT id, "userId" FROM "Posts" ORDER BY id')).rows;
  const nullOwner = posts.filter((p) => p.userId == null);
  const missingOwner = posts.filter((p) => p.userId != null && !ids.has(p.userId));
  // Subscribers.zipCode INTEGER -> VARCHAR always succeeds; nothing to check.
  return { users, ids, empty, dups, unnormalized, posts, nullOwner, missingOwner };
}

function report(a) {
  const masked = (e) => (e == null ? '(null)' : JSON.stringify(e));
  console.log(`Users: ${a.users.length}, Posts: ${a.posts.length}`);
  console.log(`\n[BLOCKER] Users with NULL/empty email (NOT NULL + UNIQUE): ${a.empty.length}`);
  a.empty.forEach((u) => console.log(`  user ${u.id} email=${masked(u.email)}`));
  console.log(`\n[BLOCKER] Duplicate emails (trimmed, case-insensitive): ${a.dups.length} group(s)`);
  a.dups.forEach((g) => console.log(`  "${norm(g[0].email)}": keep user ${g[0].id} (oldest), extras ${g.slice(1).map((u) => u.id).join(', ')}`));
  console.log(`\n[BLOCKER] Posts with NULL userId (NOT NULL): ${a.nullOwner.length}`);
  a.nullOwner.forEach((p) => console.log(`  post ${p.id}`));
  console.log(`\n[BLOCKER] Posts whose owner does not exist (FOREIGN KEY): ${a.missingOwner.length}`);
  a.missingOwner.forEach((p) => console.log(`  post ${p.id} userId=${p.userId}`));
  console.log(`\n[WARN] Emails not trimmed/lower-cased (login lower-cases input, so these users cannot sign in): ${a.unnormalized.length}`);
  a.unnormalized.forEach((u) => console.log(`  user ${u.id} email=${masked(u.email)}`));
  return a.empty.length + a.dups.length + a.nullOwner.length + a.missingOwner.length;
}

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    for (const t of ['Users', 'Posts']) {
      if (!(await tableExists(c, t))) { console.error(`Table "${t}" not found; is this the right database?`); return 2; }
    }
    if (mode === 'precheck') {
      await c.query('BEGIN READ ONLY');
      const blockers = report(await analyze(c));
      await c.query('ROLLBACK');
      console.log(blockers ? `\nFAIL: ${blockers} blocking issue group(s). Run "npm run db:cleanup" (dry run) next.` : '\nOK: migrations should apply cleanly.');
      return blockers ? 1 : 0;
    }

    // cleanup
    await c.query('BEGIN');
    // Lock both tables so nothing changes between analysis and update.
    await c.query('LOCK TABLE "Users", "Posts" IN SHARE ROW EXCLUSIVE MODE');
    const a = await analyze(c);
    report(a);
    let orphanOwner = null;
    if (orphanOwnerRaw != null && orphanOwnerRaw !== '') {
      orphanOwner = Number(orphanOwnerRaw);
      if (!Number.isInteger(orphanOwner) || !a.ids.has(orphanOwner)) {
        await c.query('ROLLBACK');
        console.error(`\nOrphan owner id ${JSON.stringify(orphanOwnerRaw)} is not an existing user. Nothing changed.`);
        return 2;
      }
    }

    const plan = []; // [description, sql, params]
    const taken = new Set(a.users.map((u) => norm(u.email)).filter(Boolean));
    const unique = (base) => { let e = base, n = 1; while (taken.has(e)) e = base.replace('@', `-${n++}@`); taken.add(e); return e; };
    const renamed = new Set();
    for (const g of a.dups) {
      const keep = g[0];
      for (const u of g.slice(1)) {
        plan.push([`reassign posts of user ${u.id} -> user ${keep.id}`, 'UPDATE "Posts" SET "userId"=$1, "updatedAt"=NOW() WHERE "userId"=$2', [keep.id, u.id]]);
        const e = unique(dupEmail(u.email, u.id));
        plan.push([`rename user ${u.id} email -> ${e}`, 'UPDATE "Users" SET email=$1, "updatedAt"=NOW() WHERE id=$2', [e, u.id]]);
        renamed.add(u.id);
      }
    }
    for (const u of a.empty) {
      const e = unique(missingEmail(u.id));
      plan.push([`set user ${u.id} placeholder email -> ${e}`, 'UPDATE "Users" SET email=$1, "updatedAt"=NOW() WHERE id=$2', [e, u.id]]);
      renamed.add(u.id);
    }
    for (const u of a.unnormalized) {
      if (renamed.has(u.id)) continue;
      plan.push([`normalize user ${u.id} email -> ${norm(u.email)}`, 'UPDATE "Users" SET email=$1, "updatedAt"=NOW() WHERE id=$2', [norm(u.email), u.id]]);
    }
    const orphans = [...a.nullOwner, ...a.missingOwner];
    if (orphans.length && orphanOwner != null) {
      for (const p of orphans) plan.push([`assign orphan post ${p.id} -> user ${orphanOwner}`, 'UPDATE "Posts" SET "userId"=$1, "updatedAt"=NOW() WHERE id=$2', [orphanOwner, p.id]]);
    }

    console.log(`\nPlanned changes (${plan.length}):`);
    plan.forEach(([d]) => console.log(`  - ${d}`));
    const leftOrphans = orphans.length && orphanOwner == null ? orphans.length : 0;
    if (leftOrphans) console.log(`\nLEFT ALONE: ${leftOrphans} orphan post(s); no owner configured. Set --orphan-owner-id=<id> or ORPHAN_POST_OWNER_ID. The migration will fail until they are resolved.`);

    if (!apply) {
      await c.query('ROLLBACK');
      console.log('\nDRY RUN: nothing was changed. Re-run with --apply (after taking a backup).');
      return leftOrphans ? 1 : 0;
    }
    for (const [, sql, params] of plan) await c.query(sql, params);
    const after = await analyze(c);
    const remaining = after.empty.length + after.dups.length + (leftOrphans ? 0 : after.nullOwner.length + after.missingOwner.length);
    if (remaining) {
      await c.query('ROLLBACK');
      console.error('\nUnexpected: blockers remain after cleanup; rolled back, nothing changed.');
      return 1;
    }
    await c.query('COMMIT');
    console.log(`\nAPPLIED ${plan.length} change(s) in one transaction.`);
    return leftOrphans ? 1 : 0;
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch (_) { /* ignore */ }
    console.error('Error (rolled back, nothing changed):', err.message);
    return 1;
  } finally {
    await c.end();
  }
}

if (require.main === module) main().then((code) => process.exit(code));
module.exports = { norm, dupEmail, missingEmail };
