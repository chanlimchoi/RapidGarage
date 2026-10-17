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

## Optional

- If you want to add views and handlebars to your server side
    + Uncomment the corresponding code in `app.js`
    + Add a `/views` folder and the appropriate templates



