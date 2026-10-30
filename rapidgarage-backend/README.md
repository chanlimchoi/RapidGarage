# Backend Starter Code


## Setup

- Edit `package.json`
    + Add your project name, version, description, authors
    + Add any other packages you may need

- Copy `.env.example` to `.env` and set `DATABASE_URL` (and `DATABASE_SSL` if
  your Postgres needs TLS). `config/config.js` reads them.


## Explanations

- `/config/config.js`
    + Database settings for Sequelize and `sequelize-cli` (via `.sequelizerc`), built from `DATABASE_URL`, `DATABASE_SSL`, `DB_POOL_MAX` and `DB_LOG_SQL`. Tests use in-memory SQLite.
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
- A session stores `{ id, v }`, where `v` is the account's `authVersion` at login. A new password
  (reset or change) increments `authVersion`, so every older session stops authenticating.
  Sessions that hold a bare id (from before this) count as version 0 and stay valid.

## Account: verification, export, deletion

- `POST /verify-email/send` (login; 5 per hour) and `POST /verify-email/confirm` `{ token }` (no login). Tokens are
  32 random bytes, stored as SHA-256, valid 48 h, single use. `Users.emailVerifiedAt` is set by confirmation, by
  Google sign-in or linking, or by a completed password reset; the migration backfills existing users.
- `lib/emailVerify.requireVerified` guards `POST /post`, `POST /wanted`, `POST /events`, `POST /conversations` and
  `POST /conversations/:id/messages` → `403 email_unverified`. It's enforced when `REQUIRE_EMAIL_VERIFICATION`
  is on (default: production only) and SMTP is configured. `/config` reports `emailVerification`.
- `GET /me/export` → a JSON attachment (`format: rapidgarage-export-v1`), 3 per hour.
- `DELETE /me` `{ currentPassword?, confirm: "DELETE" }` → `204`, after removing photo files, posts, conversations,
  follows, saves, alerts, devices, tokens, blocks, wanted posts and events, then the user (other rows cascade).
  The last admin → `409`.
- Migration `20261018070000-email-verification`.

## Passwords

- `POST /password-reset` `{ email }` → `202 { ok, expiresInMinutes }` for any valid email (an
  account or not), `429` past the per-IP limit, `503 not_configured` without SMTP.
- `POST /password-reset/check` `{ token }` → `{ valid }`.
- `POST /password-reset/confirm` `{ token, password }` → `{ user }`. Logs in on a fresh session id.
  A used, expired or unknown link → `400 invalid_token`.
- `GET /me/password` → `{ hasPassword }`. `PUT /me/password` `{ currentPassword?, newPassword }`
  (`currentPassword` is required when the account has one). The current session stays logged in.
- Passwords are 8–200 characters. Settings: `PASSWORD_RESET_TTL_MINUTES` (60),
  `PASSWORD_RESET_MAX_PER_HOUR` (3 emails per account), `PASSWORD_RESET_MAX_PER_IP_HOUR` (20).
- Migration `20261018010000-password-resets` adds `Users.authVersion` and the `PasswordResets` table.

## Abuse protection

`lib/rateLimit.js` keeps fixed-window counters in memory, per process. Keys are the client IP
from `req.ip` (so `TRUST_PROXY` must be right), with IPv6 grouped by /64.

| Limit | Default | Setting |
| --- | --- | --- |
| API requests per IP | 300 / min | `RATE_LIMIT_API_PER_MINUTE` |
| Writes (POST/PUT/DELETE) per IP | 60 / min | `RATE_LIMIT_WRITES_PER_MINUTE` |
| `/login`, `/signup`, `/password-reset` writes per IP | 30 / 15 min | `RATE_LIMIT_AUTH_PER_15_MINUTES` |
| Failed logins per (email, IP) | 5 / 15 min | `LOGIN_MAX_FAILURES` |
| Failed logins per email | 50 / 15 min | `LOGIN_MAX_FAILURES_PER_EMAIL` |
| Requests in flight | 500 | `MAX_CONCURRENT_REQUESTS` (then `503 overloaded`) |

- Over a limit: `429 rate_limited` with `Retry-After`. Every limited response carries
  `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`. `/uploads` and the health checks
  aren't limited.
- A successful login clears that (email, IP) pair's failures.
- POST/PUT/DELETE with an `Origin` other than `FRONTEND_ORIGIN` or `APP_BASE_URL` → `403`.
  Requests without `Origin` pass (curl, RFC 8058 one-click unsubscribe).
- Bodies: JSON 100 kB, forms 10 kB / 50 fields; over → `413 payload_too_large`.
- HTTP server: `headersTimeout` 15 s (`HTTP_HEADERS_TIMEOUT_MS`), `requestTimeout` 120 s
  (`HTTP_REQUEST_TIMEOUT_MS`), `keepAliveTimeout` 5 s, at most 100 headers.
- `GET /allPosts` returns at most the newest `ALL_POSTS_MAX` (500) sales.
- `RATE_LIMIT=off` turns the rate limits off. Under `NODE_ENV=test` they're off unless a test
  sets `RATE_LIMIT=on` (test/security.test.js).
- Network-level DDoS needs a CDN or proxy in front: see DEPLOY.md.

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

## Last-hour markdowns

- Post fields: `markdownPercent` (whole 5–90, `null` clears all three), `markdownFrom` (`"HH:MM"`,
  sale's local time, required with a percent) and `markdownLastDay` (boolean). Updates validate
  against the stored values, like prices.
- Responses carry `markdown: { percent, from, lastDayOnly, active, startsAt, endsAt }` or `null`.
  `startsAt`/`endsAt` give the current or next markdown window (ISO), or `null` once none is left.
  The raw columns aren't serialized.
- A day's window runs from `markdownFrom` to that day's end. A start before opening covers the
  whole day; a start at or after closing covers none.
- `GET /allPosts?markdown=1` and `GET /search?markdown=true` keep only sales whose markdown is
  running now. Search applies it before pagination, so `total` stays correct.
- Item discounts are computed on the client as `floor(cents * (100 - percent) / 100)`; `lib/markdown.js`
  has the same function.
- Migration `20261018030000-markdowns`.

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

## Messaging

Migration `20261017050000-messaging` adds `Conversations` (one per post + buyer + seller,
unique index; `postId` has no FK so threads survive a deleted post, `postTitle` keeps a
snapshot; per-participant `buyerLastReadAt` / `sellerLastReadAt`), `Messages` and
`UserBlocks`. Back up and run `npm run db:precheck` and `npx sequelize-cli db:migrate` as above.

All routes need login. A conversation is visible only to its two participants: anyone else
(admins included) gets 404, so ids can't be probed. Responses identify people as
`{ id, name }` where `name` is first name + last initial ("Bea B."); emails are never included.

| Route | |
|---|---|
| `POST /conversations { postId }` | Start (201) or reuse (200) your conversation with the post's seller. 403 for your own post, `post_unavailable` for a hidden post (unless you already have a conversation about it), `blocked` if either of you blocked the other; 404 for a missing post; 429 over `CONVERSATION_MAX_PER_HOUR`. |
| `GET /conversations` | Your conversations, newest activity first: `post { id, title, status: available\|hidden\|deleted, canView, thumbUrl }`, `other`, `role` (buyer/seller), `lastMessage`, `unreadCount`, `blocked { byMe, byThem }`, plus `unreadTotal`. A seller sees a conversation once the buyer has written. |
| `GET /conversations/unread` | `{ count, conversations }` for the nav badge. |
| `GET /conversations/:id` | The conversation plus the newest 30 messages (oldest first), `hasMore` and `canSend`. Marks them read. |
| `GET /conversations/:id/messages?before=<id>` | Older page. `?after=<id>` returns newer messages (for polling) and marks them read. |
| `POST /conversations/:id/messages { body }` | Send. `body` is plain text, 1-2000 characters after trimming (stored as-is; the client renders it as text, never HTML). 403 `blocked`, 429 over `MESSAGE_MAX_PER_MINUTE`. Sending works in existing conversations even if the post is hidden. |
| `POST` / `DELETE /conversations/:id/block` | Block or unblock the other participant. Blocking applies to all conversations between the two of you, stops messages in both directions, and only the blocker can lift it. |

Settings (optional): `MESSAGE_MAX_PER_MINUTE` (messages per user per minute, default 20) and
`CONVERSATION_MAX_PER_HOUR` (new conversations per user per hour, default 20).

`GET /profile/:id` now returns the full profile (including email) only to that user and to
admins; everyone else gets `{ id, name, createdAt }`.

### Conversation reports and admin access

Migration `20261017060000-conversation-reports` adds `ConversationReports` (separate from the
post `Reports` table, so post reports and their history are untouched),
`ConversationModerationEvents` (append-only audit log), `Users.messagingBanned` /
`messagingBannedAt` and `Messages.removedAt` / `removedBy`.

**Reporting** — `POST /conversations/:id/report { reason, note?, block? }`, participants only
(404 for anyone else). `reason`: `harassment`, `scam`, `spam`, `offensive`, `other`; `note` up
to 500 characters; `block: true` also blocks the other participant. One open report per
participant per conversation (409; unique partial index `conv_reports_one_open_per_user`). Post
and conversation reports share one hourly budget, `REPORT_MAX_PER_HOUR` (429). The thread
response includes `reportedByMe` (your own open report only); participants never see other
reports, reporters or admin notes.

**Admin read rule** (server-enforced in `controllers/adminConversations.js`; the participant
API stays 404 for admins):

| Conversation state | `GET /admin/conversations/:id` |
|---|---|
| never reported | 404, identical to any non-participant |
| has an open report | every message, before and after the report (`access.mode: "open"`) |
| only resolved reports | messages up to the latest resolution time (`access.mode: "history"`); later messages stay private (`access.hiddenLaterMessages` counts them) until someone reports again |

Every successful read writes a `read` event with the admin, time and report id (the newest open
report, or the newest resolved one in history mode). The detail response returns participants
as name + email (admins already see emails on Users), every report, the messages (removed ones
keep their text for admins, flagged `removed`) and the audit trail (`events`).

**Admin routes** (403 for non-admins):

- `GET /admin/conversation-reports` — open reports grouped by conversation, with post context,
  participants, reasons and reporters. No message text; reading needs the logged detail view.
- `GET /admin/conversation-reports/history?page=` — resolved reports.
- `GET /admin/reports` also returns `conversationOpenCount` for the tab badge.
- `POST /admin/conversations/:id/moderate { action, userId?, messageId?, note? }` (404 unless
  the read rule allows access; actions only touch messages the admin may see):

| action | effect | open reports |
|---|---|---|
| `dismiss` | none | `dismissed` |
| `warn` | none (a note in history only; optional `userId`) | `actioned` / warned |
| `ban` | `userId` (a participant) can't send or start conversations anywhere; reading still works | `actioned` / banned |
| `unban` | lifts the ban | unchanged |
| `remove_message` | soft-deletes `messageId`; participants get `{ removed: true, body: null }` | unchanged |

Every action is logged as an event with its note. Banned users get 403 `messaging_banned` on
send and start, and `/me` reports `messagingBanned: true`.

## Sale alerts (email)

Saved alerts live in `SaleAlerts` (center `lat`/`lng`, `radiusMiles` 1–50, `maxPrice`,
`freeOnly`, `enabled`, `label`). Emails go through a database outbox (`AlertNotifications`,
one row per user and post) and each email sent is recorded in `AlertDigests`. Run the
migration (`npx sequelize-cli db:migrate`, back up first) before deploying.

**API** (login required unless noted; errors use the usual `{ error: { code, message, details } }`)

| method | path | notes |
|---|---|---|
| GET | `/alerts` | `{ results, limit, globallyEnabled, radius: { min, max } }` |
| POST | `/alerts` | `{ label?, lat, lng \| address, radiusMiles, maxPrice?, freeOnly?, enabled? }` → 201. 409 `limit_reached`, 403 `feature_disabled`, 400 `geocode_unavailable` (address without a geocoding key) |
| PUT | `/alerts/:id` | any of the fields above (owner only, else 404). `freeOnly: true` clears `maxPrice` |
| DELETE | `/alerts/:id` | 204 |
| POST | `/alerts/unsubscribe` | **public.** `{ a, t }` in the body, or `?a=&t=` (RFC 8058 one-click). Turns that one alert off. Any invalid request (missing/wrong token, bad id) gets the same 400 `invalid_token`, whether or not the alert exists; a valid token for a deleted alert gets `{ ok: true, gone: true }` |

`GET /config` includes `saleAlerts`, and `PUT /admin/settings { saleAlerts }` is the admin toggle
(its default comes from `ENABLE_SALE_ALERTS`, then the saved value wins).

**Matching.** After `POST /post` (and `PUT /post/:id` when the address changes) the response is
sent first; matching runs in the background, so mail or matching errors never slow or fail
the request. A post matches an enabled alert when it is not hidden, has coordinates, is within
the radius (haversine) and passes the price filter. The seller, and users who blocked or were
blocked by the seller, are skipped. Each user gets at most one notification per post (the
nearest alert wins), enforced by a unique index. Posts without coordinates (no geocoding key)
can't match.

**Delivery.** A worker in the API process (every `ALERT_WORKER_SECONDS`, default 60; set
`ALERT_WORKER=off` to disable it in one process when running several) sends one email per user with
everything due, up to `ALERT_MAX_POSTS_PER_EMAIL` (default 20), but not more often than
`ALERT_DIGEST_MINUTES` (default 15, 0 = no bundling delay) and not more than
`ALERT_DAILY_MAX_EMAILS` (default 6) per rolling 24 hours. Leftovers wait for the next window.
At send time it re-checks that the post still exists and isn't hidden, the alert is still on,
and nobody blocked anyone. Failures retry with exponential backoff (2, 4, 8, 16 min) and stop
after 5 attempts. Notifications older than 7 days are dropped. Rows are claimed before sending,
so two workers won't send the same row. Error logs record only the SMTP error code, never addresses
or credentials.

**Privacy.** An email only ever contains the recipient's own address (in `To`). Sellers are
shown as "First L.". Unsubscribe links carry an HMAC-SHA256 token over the alert id, keyed by
`ALERT_TOKEN_SECRET` (falls back to `SESSION_SECRET`; changing it invalidates links already
sent). The token is checked in constant time before any database lookup, so the endpoint
never reveals whether an alert id exists. The email link opens `/alerts/unsubscribe` in the frontend, and that page POSTs
the token, so mail scanners that prefetch links don't unsubscribe anyone. The
`List-Unsubscribe` / `List-Unsubscribe-Post` headers give mail clients a one-click POST
endpoint at `/api/alerts/unsubscribe`.

**Without SMTP** (`SMTP_HOST` unset) nothing is sent: the worker logs that SMTP isn't configured,
marks queued rows `skipped`, and everything else works as normal.

**Environment**

- `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (e.g.
  `RapidGarage <alerts@example.com>`), `SMTP_SECURE` (optional; default true only for port 465).
- `APP_BASE_URL`: public frontend URL used for links in emails (falls back to `FRONTEND_ORIGIN`).
- `ALERT_TOKEN_SECRET`: optional, signs unsubscribe links.
- `ENABLE_SALE_ALERTS` (default true), `ALERTS_MAX_PER_USER` (5), `ALERT_DIGEST_MINUTES` (15),
  `ALERT_DAILY_MAX_EMAILS` (6), `ALERT_MAX_POSTS_PER_EMAIL` (20), `ALERT_WORKER_SECONDS` (60),
  `ALERT_WORKER` (`off` to disable the worker).

## Sale dates & times

`POST /post` and `PUT /post/:id` accept `schedule`:

```json
{ "timeZone": "America/New_York",
  "days": [{ "date": "2026-10-24", "start": "08:00", "end": "14:00" }] }
```

- Up to 14 days, each a real calendar date within the next year, `HH:MM` times, `end` after
  `start` on the same day (overnight sales: add the next day), no duplicate dates. Errors come
  back as `details["days.<i>"]`, `details.schedule` or `details.timeZone`.
- `timeZone` is an IANA zone (validated with `Intl`); missing means `DEFAULT_TIME_ZONE`
  (default `America/New_York`).
- A new sale can't be entirely in the past; edits may keep days that already happened.
- `schedule: null` (or `days: []`) clears the dates. `schedule` replaces all days at once.
- The server stores each day as local date + times **and** UTC instants (`SaleDays`,
  computed with DST handled: a time in the spring-forward gap moves forward; an ambiguous
  fall-back time uses the first occurrence) and sets `Posts.timeZone`, `startDate` (first
  start) and `endDate` (last end).
- Responses include `schedule: { timeZone, days: [{ date, start, end, startsAt, endsAt }] }`
  (or `null`). The legacy `startDate`/`endDate` fields are still accepted when there is no
  `schedule` (they replace any day schedule) and are treated as one window
  `[startDate, endDate or startDate + 12h]`.

**Ended sales** (last `endDate` in the past) are excluded from `/allPosts`, `/all/:zip`,
`/search` (distance and text) and other people's `/allbyuserId/:id`; the owner and admins
still get them there, and `GET /post/:id` keeps working for everyone. Sale alerts only match
sales that haven't ended, and the outbox drops a notification if the sale ended before the
email went out (`lastError: post_ended`).

**Filters**: `/search` and `/allPosts` take `when=today|weekend|now` (400 for anything else).
`now` = a day window contains the current time; `today` = a remaining window on the sale's
local today; `weekend` = a remaining window on the coming Saturday/Sunday (on Saturday:
today + tomorrow; on Sunday: today). Sales without dates don't match these filters. The search
response echoes it as `filter.when`.

## Sale items

`/post/:id/items` (the post must be visible to you; hidden posts 404 like the post itself):

| | |
|---|---|
| `GET /` | `{ items, max }`, in list order. `GET /post/:id` also includes `items`. |
| `POST /` | Seller only. `{ name, price?, photoId?, sold? }` → 201 item. |
| `PUT /:itemId` | Seller only. Any of `name`, `price`, `photoId`, `sold`. |
| `PUT /order` | Seller only. `{ ids }`: every item of the sale once. |
| `DELETE /:itemId` | Seller, or an admin (moderation). |

An item is `{ id, name, priceCents, photoId, sold, soldAt, position }`. `name`: 1–80
characters. `price`: optional, dollars with up to 2 decimals (`"2.50"`, `5`), 0 = free, up to
$100,000; stored as cents. `photoId`: one of **this** sale's photos or `null`; deleting the
photo keeps the item without it. `soldAt` is set when marked sold and cleared when unmarked.
Up to 100 items per sale (400 `too_many`). Deleting the sale deletes its items.

**Keyword search**: `/search` and `/allPosts` take `keyword` (≤ 60 characters, up to 5 words).
Every word must appear (case-insensitive, literally; `%` and `_` are not wildcards) in the
title, the description or the name of an item that is **not sold**. Each result then has
`matchedItems`: up to 3 unsold item names that match the most words. `/search` echoes it as
`filter.keyword`.

## Saved sales & route

All under `/saved`, login required, `Cache-Control: no-store`; nobody sees anyone else's list.

| | |
|---|---|
| `PUT /saved/:postId` | Save (201; 200 if already saved). 404 for missing or hidden sales, 400 `own_post` for your own, 400 `too_many` past 200. |
| `DELETE /saved/:postId` | Unsave (idempotent; also works for sales hidden since). |
| `GET /saved` | `{ results: [post + status], unavailable, limit }`: newest save first; `status` is `open\|upcoming\|ended\|null`. Sales you can no longer see (hidden) are left out and counted in `unavailable`. |
| `GET /saved/ids` | `{ ids }` for star buttons. |
| `GET /saved/route?when=weekend\|today\|all&lat=&lng=` | Route through saved sales that haven't ended and match `when` (default `all`; same rules as the search filter). |

The route answer is `{ when, start, stops: [{ order, legMiles, status, post }], totalMiles,
googleMapsUrl, skipped: { ended, notInWindow, noLocation, overLimit, unavailable }, maxStops }`.
Ordering is greedy nearest-neighbor (haversine) from `lat,lng`, or, without a location,
from the sale that is open or opens first (ties: the one closing first). At most 10 stops
(Google Maps URLs take 9 waypoints + a destination). `googleMapsUrl` is a
[Maps URLs](https://developers.google.com/maps/documentation/urls/get-started#directions-action)
directions link using the sales' public addresses; without `lat,lng` it has no origin so
Google Maps starts from the phone's location. The location is only used for that request.

## Live updates (SSE) and push

- `GET /live` (login): `text/event-stream`. It sends `hello` on connect, then `badges` and `message { conversationId }` events,
  ids only, with a heartbeat comment every 25 s and `retry: 5000`. At most 5 streams per person (the oldest is closed) and
  `MAX_LIVE_CONNECTIONS` (2000) per process; past that, `503`. Streams are exempt from load shedding and closed
  first on shutdown. They're per process: with several instances, the clients' 60 s fallback poll covers events from
  another instance.
- Events come from a `Message` `afterCreate` hook, run after commit (`lib/notify.js`). That covers text, hold and meetup messages.
- Push (`lib/push.js`, `web-push`, VAPID): `GET|PUT /push/settings` (`messages`, `follows`, `reminders`, `offers`, `searches`; offer steps with an amount use `offers`, saved-search matches new in the bell use `searches`), `POST|DELETE
  /push/subscriptions`, `POST /push/test` (5 per hour). Endpoints must be https on a known push service (FCM, Mozilla, Apple, WNS,
  plus `PUSH_EXTRA_HOSTS`): no credentials, no other ports, so the server can't be pointed at arbitrary hosts. Up to 10
  devices per person. A 404/410 from the push service, or 5 failures in a row, deletes the subscription. Triggers: a new message
  (skipped while the recipient has a live tab), a followed seller's new sale, morning reminders. Payloads hold who and which
  sale, never message text.
- Migration `20261018050000-push-notifications`.

## AI listing review

- `lib/aiReview.js` runs after create and edit, and after item adds (fire-and-forget). It sends title + description + item names
  in `<listing>` tags with a system prompt that treats them as data, `output_config.format` (`verdict` ok|flag, `categories`, `reason`),
  `effort: low` (`AI_REVIEW_EFFORT`), and `fallbacks: "default"`. A refusal → flagged `other` for a human.
- `Posts.aiFlagStatus`: `open` | `cleared` (a later clean review) | `dismissed` | `actioned` (set by `/admin/posts/:id/moderate`), plus
  categories, reason, `aiFlaggedAt`, and `aiReviewHash` (unchanged text isn't re-reviewed). Never in public JSON.
- `GET /admin/ai-flags` → open flags (up to 200). Admin setting `aiReview` (`ENABLE_AI_REVIEW`); needs the site key;
  `AI_REVIEW_PER_DAY` (500, a site-wide counter).
- Migration `20261018080000-ai-review`.

## Own Anthropic keys (BYOK)

- `GET /me/ai-key` → `{ hasKey, last4, setAt }`. `PUT /me/ai-key` `{ key, currentPassword }` (password required when the account
  has one) checks the key with Anthropic (`models.list`, free) and saves it. `DELETE /me/ai-key` erases it. All responses are `no-store`.
- `POST /post/:id/items/suggest` `{ oneTimeKey }` uses that key for this call only. Key order: one-time, then saved, then the site's.
  The response's `keySource` says which (`one_time` | `saved` | `site`). No key available → `400 needs_key`; Anthropic
  rejecting the person's key → `400 own_key_rejected`.
- Storage: `Users.aiKeyEncrypted` uses `secretBox` v2 (AES-256-GCM, HKDF per-purpose key, AAD `ai-key:user:<id>`), so a value
  copied onto another row, or read with another `KEY_ENCRYPTION_SECRET`, won't decrypt. It's excluded from every
  scope but `withAiKey` and from `toJSON`, which exposes only `hasAiKey`. Maps keys keep the v1 format.
- Handling: one-time keys are removed from `req.body` before anything else runs. Clients for own keys are built per
  request and never cached. Errors keep only status and class name. Tests prove neither kind of key reaches any table,
  session, response or log line.
- Guards: HTTPS only in production (`req.secure`, so `TRUST_PROXY` must be right; `ALLOW_KEYS_OVER_HTTP` exists for
  local testing only); `AI_KEY_ATTEMPTS_PER_HOUR` (10) key submissions per account; `AI_ITEMS_PER_DAY_OWN_KEY` (50); admin
  setting `userAiKeys` (`ENABLE_USER_AI_KEYS`). Saving needs `KEY_ENCRYPTION_SECRET`; one-time keys don't.
- `/config` adds `aiSiteKey`, `userAiKeys` and `userAiKeySave`. `aiItems` is true when either the site key or own keys can be used.
- Migration `20261018040000-user-ai-keys`.

## Admin analytics

- `GET /admin/analytics?days=7|30|90` (admins; default 30) → `{ days, from, to, totals: { users, activeSales, openReports },
  metrics: { signups, posts, messages, conversations, saves, views, scans, shares, follows }, topCities, topSales }`.
  Each metric is `{ total, previous, series: [{ date, count }] }`, with `previous` covering the same number of days
  just before. Series cover every UTC day in the window, zeros included.
- Created-per-day counts are one `GROUP BY date(createdAt)` query per table (works on SQLite and Postgres).
  Views, scans and shares sum the existing `Post*Day` tables. Messages count `kind = 'text'` only.
- Active sales are visible and not ended. Top cities group active sales by city and state (8).
  Top sales are the 5 most viewed in the window.

## Draft items from photos (Claude)

- `POST /post/:id/items/suggest` `{ photoIds? }` (seller only) → `{ suggestions: [{ name, priceCents|null, photoId|null }], room, photosUsed }`.
  Nothing is saved. `POST /post/:id/items/bulk` `{ items: [{ name, price?, photoId? }] }` adds
  them in one transaction: all or nothing, with errors keyed `"<index>.<field>"`.
- `lib/aiItems.js` uses `@anthropic-ai/sdk`: `beta.messages.create` with `claude-opus-5-5`, base64 WebP
  images, `output_config: { effort, format: { type: 'json_schema', schema } }` and server-side refusal
  fallback (`fallbacks: 'default'`, beta `server-side-fallback-2026-07-01`). Opus 5.5 always uses
  adaptive thinking, so `thinking` isn't sent. The reply is parsed and cleaned up: names trimmed
  and deduplicated (max 80), prices dropped when negative or out of range, photo numbers mapped to ids.
- Errors: refusal → `422 ai_refused`; truncated or invalid output → `502 ai_failed`; Anthropic 429 →
  `503 ai_busy`; anything else → `503 ai_unavailable`; no key or switched off → `404 feature_disabled`;
  over the daily budget → `429`. Failed calls don't use up the budget.
- Settings: `ANTHROPIC_API_KEY` (required), `ENABLE_AI_ITEMS` (admin switch default),
  `AI_ITEMS_PER_DAY` (10, in memory per process), `AI_ITEMS_MODEL` (`claude-opus-5-5`),
  `AI_ITEMS_EFFORT` (`medium`), `AI_ITEMS_TIMEOUT_MS` (90000, one SDK retry). `/config` reports `aiItems`.
- Tests swap in a fake client (`aiItems.setClient`), so they never call the API.

## Error tracking and uptime alerts

- `lib/errorTracking.js`: `init()` (from `createApp`) loads `@sentry/node` only when `SENTRY_DSN` is set, with
  default integrations off (uncaught exceptions, unhandled rejections and linked errors only; no tracing).
  `capture(err, { req, source, tags })` is called by `serverError()` and the final error handler; `beforeSend`
  keeps only the method and path of the request and the user id, and masks emails, keys and tokens.
  Tests swap in a reporter with `setReporter({ capture })`.
- `POST /client-errors` `{ kind: error|rejection|render, message, stack?, path?, release? }` → always 204.
  Forwarded only when tracking is on (`/config` `errorReporting`), `CLIENT_ERRORS_PER_HOUR` (20) per IP.
  The web app (`app/lib/errorReporter.js`, `components/ErrorBoundary.jsx`) sends each distinct error once,
  at most 5 per page load, with the path but no query string.
- `scripts/uptime-check.js`: see DEPLOY.md "Monitoring". `--once` for cron; otherwise a loop with
  down / still down / back up notifications by webhook and/or email.

## Make an offer (lib/holds.js)

- `POST /conversations/:id/holds` takes an optional `offerCents`: a whole number of cents, at least 1 and below the asking
  price (any amount when the item has no price; free items can't get offers). Stored on `ItemHolds.offerCents`.
- `POST /holds/:id/counter { offerCents }` (seller, pending offer only): above the offer, at most the asking price. Sets
  `counterCents` and gives the buyer a fresh answer window (`HOLD_REQUEST_HOURS`).
- `POST /holds/:id/take` (buyer): accepts the counteroffer. The item is reserved like an accepted hold, `offerCents` becomes
  the counter (the agreed price) and other pending requests for the item are declined. A seller `accept` agrees to the
  buyer's offer and drops any counter.
- Hold JSON has `offerCents` and `counterCents`; thread events have `hold.cents` (`Messages.holdCents`, the amount at that
  step) and the new events `countered` and `agreed`. Migration `20261018100000-offers-and-weekend-digest`.

## Pickup scheduling (lib/pickups.js)

- `PickupPlans`: one per conversation (`slots` JSON of ISO starts, `slotMinutes`, `timeZone`, `status` offered | booked |
  cancelled, `chosenAt`). Migration `20261030150000-pickup-plans` also adds `Messages.pickupId/pickupEvent/pickupStart`.
- `GET /conversations/:id/pickup` -> `{ pickup, items, canOffer, canAct, timeZone, saleEndsAt, limits }`.
- `POST /conversations/:id/pickup { slots: [iso], minutes? }` (seller, needs an accepted unexpired hold in the
  conversation): offer 1-6 times (each validated like a hold's pickup time); replaces earlier ones, and a booked pickup goes
  back to offered (event `rescheduled`, else `offered`).
- `POST /conversations/:id/pickup/book { start }` (buyer): one of the offered future slots. Sets every accepted hold's
  `pickupAt` and extends (never shortens) `expiresAt` / `reservedUntil` as `acceptExpiry` would.
- `POST /conversations/:id/pickup/reschedule` (either, booked) -> offered; `POST /conversations/:id/pickup/cancel`
  (either). Blocks and messaging bans stop all of these; 20 pickup steps per person per conversation per day.
- `GET /pickups/upcoming`: my offered/booked pickups with accepted holds, as seller or buyer, with the other person as
  "First L." and the item names, for the dashboard.

## Weekend digest (lib/weekendDigest.js)

- `SaleAlerts.frequency`: `instant` (default) or `weekly`. Weekly alerts never queue instant notifications.
- The alert worker's pass sends each weekly alert one email between Thursday `WEEKEND_DIGEST_HOUR` (17) and Saturday noon
  in `DEFAULT_TIME_ZONE`: up to 10 visible sales open on Saturday or Sunday inside the radius and price filter, nearest
  first, skipping the person's own sales and blocks. It uses the instant alert layout (`renderEmail(user, items, { weekly: true })`).
  `weeklySentAt` is claimed before sending (at most once every 4 days) and released if SMTP fails. No sales, no email.

## Seller tools (lib/sellerTools.js)

- `POST /post/:id/describe` `{ oneTimeKey? }` (owner) → `{ title (≤80), description (≤1200), keySource }`. Nothing is saved.
  Sends unsold item names and prices, city/state, the current title and up to 3 photos; never the street or ZIP.
  Key choice and budget are shared with item drafts (`lib/aiAccess.js`); errors as for item drafts.
- `POST /post/:id/duplicate` (owner, verified email) → 201 with the new post: same text, address, coordinates,
  prices, markdown and time zone; unsold items; photos copied to new storage keys. No dates, no curb offer.
  Hidden sales → 403. The copy is announced like a new sale (alerts, wanted posts, followers, AI review).
- `GET /post/:id/summary` (owner) → `{ items: { total, sold, unsold, soldValueCents }, views, scans, shares, saves,
  conversations, holdsCompleted, ended }` (all time).
- Summary email: the alert worker emails the owner of each visible sale that ended in the last 3 days, once
  (`Posts.summarySentAt`, claimed before sending, released if SMTP fails). Migration
  `20261018090000-sale-summaries` marks already-ended sales as sent so nobody gets old summaries.

## Following sellers

- `GET /follows` → `{ results: [{ seller: { id, name }, notify, currentSales, since }] }`.
- `GET /follows/:sellerId` → `{ following, notify, followers }` (public; logged out, `following` is false).
- `PUT /follows/:sellerId` `{ notify? }` follows (idempotent) or changes the email switch.
  `DELETE` unfollows. Errors: yourself → 400, blocked either way → 403, over `FOLLOWS_MAX_PER_USER` (500) → 409.
- `GET /allPosts?following=1` (login) → current sales by people you follow, with the same
  filters and annotations as `/allPosts`.
- New post → one `FollowNotifications` row per follower with `notify` on (not blocked). The alert
  worker sends them after sale alerts and wanted matches, in the same digest budget
  (`AlertDigest.kind = 'follow'`). Rows for posts that got hidden, deleted or ended, or whose follow
  went away, are skipped.
- `POST /follows/unsubscribe` `{ f, t }` (no login): HMAC token with its own purpose, like the other
  unsubscribe links. Turns `notify` off for that follow; the follow itself stays.
- Blocking (`/conversations/:id/block`, or blocking while reporting) deletes follows in both directions.
- Migration `20261018020000-follows`.

## Tests

`npm test` uses in-memory SQLite. `.mocharc.js` loads `test/setup.js` for every mocha run, direct `npx mocha test/x.test.js` runs included. It refuses to start unless `NODE_ENV=test` (unset counts as test) and the database is throwaway:

- SQLite in memory, or a file in the temp directory (`TEST_SQLITE_FILE`), or
- Postgres via `TEST_DATABASE_URL`, with a name ending in `_test`/`_e2e` **and** `RG_ALLOW_TEST_PG=1`.

`DATABASE_URL` is never used by tests. `models/index.js` also refuses destructive calls (`sync({ force/alter })`, `drop`, `truncate`, delete-everything `destroy`, `dropAllTables`) on anything else, in any environment. See `lib/testDbGuard.js` and `test/test-db-guard.test.js`.

## Optional

- If you want to add views and handlebars to your server side
    + Uncomment the corresponding code in `app.js`
    + Add a `/views` folder and the appropriate templates



