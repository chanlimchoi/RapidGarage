# Backend Starter Code


## Setup

- Edit `package.json`
    + Add your project name, version, description, authors
    + Add any other packages you may need

- Edit `config/config.json`
    + Add your username, password, and database names


## Explanations

- `/config/config.json`
    + This file contains the credentials for connecting to your postgres database. You need to make sure these details match your DB setup.
- `/controllers`
    + This is where you should store all the logic handling URL routes and business logic for your app.
    + `index.js` is where you load up the different files
    + You can write your controller code in many styles. I've provided you two options in the `home.js` and the `alt.js` files. Pick one style and use it for all of your controllers. This is really a matter of preference.
- `/models`
    + This is where your sequelize models will go.
    + `index.js`: you **do not** have to modify this file. This file connects to the Postgres database for you, loads up all models in the folder, and sets up all associations.
- `app.js`
    + This file sets up the basic packages for our projects. Feel free to add more as you see fit.
    + This file already loads up your controllers, so no additional loading is necessary for that to work.

## Upgrading an existing database (backup first)

The 2026 migrations add `Users.email NOT NULL` + `UNIQUE`, and `Posts.userId NOT NULL`
with a foreign key to `Users(id)`. Existing data that violates these makes `npm run migrate`
fail. Before migrating a database that already has data:

1. **Back up first.** `pg_dump "$DATABASE_URL" -Fc -f rapidgarage-$(date +%Y%m%d-%H%M).dump`
   and confirm it restores: `pg_restore -l <file> | head`. Stop the app (or put it in
   maintenance) so nothing writes during the upgrade.
2. **Check (read-only):** `npm run db:precheck`. Prints a report; exits 1 if the migrations would fail.
3. **Preview the fix (dry run, changes nothing):** `npm run db:cleanup`
4. **Apply:** `npm run db:cleanup -- --apply` (optionally `--orphan-owner-id=<userId>` or
   `ORPHAN_POST_OWNER_ID=<userId>`). All changes run in one transaction; on any error or if
   blockers remain, everything is rolled back.
5. `npm run db:precheck` again (should print `OK`), then `npm run migrate`.
6. To undo the cleanup, restore the backup: `pg_restore --clean --if-exists -d "$DATABASE_URL" <file>`.

Cleanup rules (conservative; users are never deleted):

- **Duplicate emails** (compared trimmed + case-insensitive): the oldest account
  (`createdAt`, then lowest id) is kept. Posts of the other accounts are reassigned to it, and
  their emails are renamed to `local+dup-<id>@domain` so they stay unique and traceable.
- **NULL / empty / whitespace emails:** set to `missing-email+<id>@invalid.invalid`
  (`.invalid` is a reserved domain, so nothing is ever emailed there).
- **Remaining emails** are trimmed and lower-cased; login lower-cases input, so mixed-case
  emails could not sign in anyway.
- **Posts with no owner / a missing owner:** reassigned to the configured owner id (must be an
  existing user). If none is set they are reported and left alone, and the command exits 1
  because the migration would still fail.
- `Subscribers.zipCode` INTEGER→VARCHAR and the new `googleId` / `role` columns cannot fail on
  existing data, so they need no cleanup.

## Login sessions

Sessions are stored in Postgres with `connect-pg-simple`, in the `session` table, so logins
survive restarts and work across several backend processes. The table is created by the
migration `20261017020000-create-session-table`, not at runtime, so the app's database role
needs no DDL rights. If the table is missing, the server refuses to start and tells you to run
`npm run migrate`. The store uses its own small pg pool (max 5 connections) on the same
`DATABASE_URL` as Sequelize.

- Cookie: `httpOnly`, `SameSite=Lax`, `Secure` in production (unchanged), and now a
  `maxAge` of `SESSION_MAX_AGE_DAYS` (default 14). Before this change it was a browser-session cookie.
- Expired rows are deleted every `SESSION_PRUNE_INTERVAL_MINUTES` (default 15).
- `POST /logout` deletes the session row and clears the cookie.
- `SESSION_STORE=memory` switches back to the in-memory store (the default under `NODE_ENV=test`).
- Deploying this logs everyone out once, since the old sessions only existed in memory.

## Post photos

Run `npm run migrate` to create the `PostPhotos` table. Endpoints (owner or admin only):

- `POST /post/:id/photos` - multipart/form-data, field `photos` (1-5 files, max 5 per post).
  JPEG/PNG/WebP up to 8 MB each, detected from file contents. Errors: `415 unsupported_type`,
  `413 file_too_large`, `400 bad_request` (too many photos, unreadable image).
- `DELETE /post/:id/photos/:photoId` - removes the row and both stored files.
- Deleting a post deletes its photos. `GET /post/:id`, `/allPosts` and the other list
  endpoints include `photos: [{ id, url, thumbUrl, width, height, position }]`.
- `GET /uploads/<key>` serves stored files read-only (`GET`/`HEAD`, `nosniff`).

Processing (sharp): EXIF orientation applied, max 1600px (no upscaling) + 400px thumbnail,
re-encoded as WebP with all metadata (EXIF, GPS, XMP, ICC) dropped.

Settings (`.env`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `UPLOAD_DIR` | `./uploads` | Where the local driver writes files. Back it up with the database. |
| `PHOTO_STORAGE` | `local` | Storage driver. `lib/storage/` has a small `put/remove/read` interface so an S3 driver can be added. |
| `PHOTO_PUBLIC_BASE` | `/api/uploads` | URL prefix returned to browsers (matches the Vite `/api` proxy). Use e.g. `https://api.example.com/uploads` or a CDN in production. |

## Prices

A garage sale has many items, so a post has an optional price **range** in **whole US dollars**
(integers, no cents), or is marked free. Migration: `20261017030000-post-price` adds `priceMin`,
`priceMax` (INTEGER, nullable) and `isFree` (BOOLEAN, default false).

| Stored | Shown as |
| --- | --- |
| `isFree: true` | Free |
| `priceMin = priceMax = 5` | $5 |
| `priceMin 5, priceMax 50` | $5–$50 |
| only `priceMax 50` | Up to $50 |
| only `priceMin 5` | From $5 |
| nothing | no price chip |

Server rules (`lib/price.js`, mirrored in `rapidgarage-frontend/app/lib/price.js`): values are
whole dollars from 0 to $100,000, `priceMin` ≤ `priceMax`, and a free post can't also have a
price. Numbers or digit strings are accepted, and `null` or `""` clears a value. On `PUT`, the
cross-field rules are checked against the stored post, so to switch a priced post to free, send
`isFree: true` with `priceMin: null, priceMax: null`. Errors are `400` with
`details.priceMin` / `priceMax` / `isFree`.

`GET /search` also takes `maxPrice` (whole dollars) and `free=true`. Both work with any radius
and keep distance sorting and pagination. `maxPrice=X` keeps sales with something at or under $X:
free sales, sales whose lowest price is ≤ X, and "Up to $Y" sales (their cheapest item is
somewhere in $0–$Y). Sales with no price info are left out while the filter is on. `free=true`
returns only free sales and overrides `maxPrice`. The response echoes
`filter: { maxPrice, freeOnly }`.

## Map search

Posts store `lat` / `lng` (migration `20261017010000-post-coordinates`), filled by server-side
geocoding of street, city, state and zip when a post is created or its address changes.
Clients cannot set coordinates. `geocodeStatus` records the outcome: `ok`, `no_key`, `not_found`
or `error`. A post without coordinates is still saved and listed normally; it is only left out
of distance results.

Which key geocodes: `GOOGLE_GEOCODING_API_KEY`, else `GOOGLE_MAPS_API_KEY`, else the post
owner's (or searching user's) own key when BYOK is enabled. Keys are never sent to clients or
logged. Geocoding is rate-limited (`GEOCODE_MAX_PER_SECOND`, default 10, global;
`GEOCODE_SEARCH_PER_MINUTE`, default 20, per user/IP for typed searches) and cached in memory.

`GET /search` (public):

| Param | Meaning |
| --- | --- |
| `lat`, `lng` | Center point (e.g. the browser's location). Needs no key. |
| `q` | Address or zip to geocode as the center (200 chars max). Used when lat/lng are absent. |
| `radius` | Miles: `5`, `10` (default), `25` or `50`. |
| `page`, `pageSize` | Default 1 and 20; pageSize max 50. |

Response: `{ mode, center, radius, notice, page, pageSize, total, totalPages, results }`. With
`mode: "distance"`, results are sorted nearest first and carry `distanceMiles`. If `q` can't be
geocoded (no key, rate limit or lookup error) the response is `mode: "text"`: posts whose zip
equals `q`, or whose address or title contains it, with `distanceMiles: null` and a `notice`
explaining why. An address Google can't find returns `404 location_not_found`. Invalid input
returns `400 bad_request` with per-field details.

Distance math: a lat/lng bounding box in SQL (indexed, and handles the antimeridian), then
exact haversine in Node, so no PostGIS is needed.

Backfill existing posts (back up first):

```sh
npm run geocode:backfill -- --dry-run      # list what would be geocoded
npm run geocode:backfill                   # never geocoded, or failed with no_key / error
npm run geocode:backfill -- --retry        # also retry addresses that were not_found
npm run geocode:backfill -- --limit 500
```

## Reporting and moderation

Migration `20261017040000-moderation` adds `Posts.hidden` (plus `hiddenAt`, `hiddenBy`,
`hiddenSource` = `moderator` or `auto`) and a `Reports` table. Run `npm run db:precheck` and
`npx sequelize-cli db:migrate` after taking a backup, as above.

**Reporting** — `POST /post/:id/report` (login required) with `{ reason, note? }`:

| | |
|---|---|
| `reason` | one of `spam`, `scam`, `prohibited`, `offensive`, `wrong_info`, `other` |
| `note` | optional, up to 500 characters |
| 201 | `{ id, postId, reason, status: "open", createdAt }` |
| 400 / 401 / 404 | bad input / not logged in / no such (visible) post |
| 403 | it's your own post |
| 409 | you already have an open report on this post (also enforced by a unique partial index) |
| 429 | `rate_limited`: more than `REPORT_MAX_PER_HOUR` reports in the last hour (default 10) |

**Visibility** — a hidden post is left out of `/allPosts`, `/all/:zipCode`,
`/allbyuserId/:userId` and `/search` (map and text), and `GET /post/:id` answers 404, for
everyone except its owner and admins. The owner gets it with `hidden: true` and
`hiddenSource`; who hid it is only shown to admins. Photo files themselves are still served by
URL (their keys are random).

**Admin** (all 401/403 for anyone who isn't an admin, like the other `/admin` routes):

- `GET /admin/reports` — open reports grouped by post, most reported first: post preview,
  owner, `openCount`, `reporterCount`, a `reasons` tally, first/last report times and each
  report with its reporter. Also `hidden`: hidden posts with no open reports, and the current
  `autoHideThreshold`.
- `GET /admin/reports/history?page=&pageSize=` — resolved reports, newest first, with the
  reviewer, the outcome (`action`), resolution note, a `postTitle` snapshot and `postExists`.
- `POST /admin/posts/:id/moderate` with `{ action, note? }` resolves every open report on the
  post:

| action | post | reports become |
|---|---|---|
| `dismiss` | unchanged | `dismissed` |
| `hide` | hidden (`hiddenSource: moderator`) | `actioned` / hidden |
| `unhide` | visible again | `dismissed` / unhidden |
| `delete` | deleted with its photos | `actioned` / deleted |

Reports are kept when a post is deleted (by an admin or its owner), so history stays readable.

**Settings** (optional):

- `REPORT_MAX_PER_HOUR` — reports one user can file per rolling hour. Default 10.
- `REPORT_AUTO_HIDE_THRESHOLD` — when set to a positive integer N, a post is hidden
  automatically (`hiddenSource: auto`) once N different users have open reports on it. It
  still shows in the admin queue to dismiss or unhide. Unset (the default) means off.

## Optional

- If you want to add views and handlebars to your server side
    + Uncomment the corresponding code in `app.js`
    + Add a `/views` folder and the appropriate templates



