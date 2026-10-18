# Deploying RapidGarage

RapidGarage ships as **one Docker image** that runs **one process on one port
(8080)**. That process serves the built frontend, the API under `/api/*`,
printed-QR short links under `/s/<code>`, photos under `/api/uploads/*`, and
health checks at `/healthz` and `/readyz`. It needs **PostgreSQL 17** (16+ works)
and a **persistent directory for photos**.

Nothing here creates accounts or deploys anything. Pick a host below and
follow its steps.

- [What you need to decide](#what-you-need-to-decide)
- [Configuration](#configuration)
- [Try it locally (docker compose)](#try-it-locally-docker-compose)
- [Option A: a VPS with Docker and Caddy](#option-a-a-vps-with-docker-and-caddy-automatic-https)
- [Option B: Render](#option-b-render)
- [Option C: Fly.io](#option-c-flyio)
- [Rough monthly costs](#rough-monthly-costs-estimates)
- [After the first deploy](#after-the-first-deploy-checklist)
- [Backups and restore](#backups-and-restore)
- [Upgrades and rollback](#upgrades-and-rollback)
- [How it works](#how-it-works)

## What you need to decide

1. **Host:** a VPS (cheapest, you run updates), Render (managed, simple),
   or Fly.io (managed, needs a separately paid database). See
   [costs](#rough-monthly-costs-estimates).
2. **Domain:** for example `sales.example.com`. Printed QR codes contain it, so
   pick it before printing flyers. Most registrars charge about $10–20 a year.
3. **Email (SMTP)** for sale alerts, such as Amazon SES, Postmark, Resend or
   Brevo. Without it the app still works, but alert emails are skipped.
4. **Google Cloud:** a Maps *browser* key restricted by HTTP referrer to
   `https://<domain>/*`, a *server* key for the Geocoding API, and optionally an
   OAuth client for "Sign in with Google".

## Configuration

All settings are environment variables. `.env.production.example` lists every
one, with comments. These are required:

| Variable | What |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_BASE_URL` | Public `https://` address. Used in emails and printed QR codes. |
| `SESSION_SECRET` | 32+ random characters (`openssl rand -hex 32`). The app refuses to start in production without it. |
| `DATABASE_URL` | `postgres://user:pass@host:5432/db` |
| `DATABASE_SSL` | `off` (private network), `verify`, or `no-verify` (some managed hosts). Put TLS here, not as `?sslmode=` in the URL: a URL parameter overrides this setting. |
| `TRUST_PROXY` | Number of proxies in front: `1` behind Caddy, Render or Fly; `false` if nothing is in front. |
| `GOOGLE_MAPS_API_KEY`, `GOOGLE_GEOCODING_API_KEY` | Map and address lookup |
| `KEY_ENCRYPTION_SECRET` | Encrypts users' own saved Maps keys. Never change it after launch. |
| `SMTP_*` | Outgoing email |

Secrets belong in the host's secret store or in `.env.production` with mode
600. That file is ignored by git and docker.

## Try it locally (docker compose)

This runs the app, Postgres 17 and the backup job on your machine, exactly as on a VPS.

```sh
cp .env.production.example .env.production && chmod 600 .env.production
# edit: APP_BASE_URL=http://localhost:8080  TRUST_PROXY=false
#       SESSION_SECRET=$(openssl rand -hex 32)  POSTGRES_PASSWORD=$(openssl rand -hex 24)
#       KEY_ENCRYPTION_SECRET=$(openssl rand -hex 32)
#       GOOGLE_CALLBACK_URL=http://localhost:8080/api/auth/google/callback
docker compose --env-file .env.production up -d --build
curl -s localhost:8080/readyz     # {"status":"ready",...}
open http://localhost:8080
docker compose --env-file .env.production logs -f app
docker compose --env-file .env.production down       # add -v to delete the data
```

On first start the app container runs the migrations, then starts the server.

## Option A: a VPS with Docker and Caddy (automatic HTTPS)

Good fit: lowest cost and full control. You are responsible for OS updates and
off-site copies of backups.

1. **Server:** Ubuntu 24.04 or Debian 12/13, 2 GB RAM recommended (1 GB works
   with swap), in a region near your users.
2. **DNS:** create an `A` record (and `AAAA` for IPv6) pointing
   `sales.example.com` at the server. Wait until `dig +short sales.example.com`
   shows its IP.
3. **Basics:**
   ```sh
   sudo apt update && sudo apt -y upgrade && sudo apt -y install unattended-upgrades
   curl -fsSL https://get.docker.com | sudo sh      # Docker Engine + compose plugin
   sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp && sudo ufw enable
   ```
   Docker publishes ports past ufw, which is why the app is bound to
   `127.0.0.1:8080` in `docker-compose.yml`. Only Caddy's 80 and 443 are public.
4. **Code and config:**
   ```sh
   git clone https://github.com/chanlimchoi/RapidGarage.git && cd RapidGarage
   cp .env.production.example .env.production && chmod 600 .env.production
   # APP_BASE_URL=https://sales.example.com  DOMAIN=sales.example.com  TRUST_PROXY=1
   # GOOGLE_CALLBACK_URL=https://sales.example.com/api/auth/google/callback
   # SESSION_SECRET, POSTGRES_PASSWORD (hex), KEY_ENCRYPTION_SECRET, Maps keys, SMTP_*
   ```
5. **Start** with the `https` profile, which adds Caddy and its Let's Encrypt
   certificate:
   ```sh
   docker compose --env-file .env.production --profile https up -d --build
   curl -s https://sales.example.com/readyz
   ```
6. **Backups:** the `backup` service writes a dump of the database and a
   tarball of the photos to `./backups` every 24 h and keeps 14 days of them.
   Also copy them off the machine, for example with a nightly cron entry:
   ```cron
   30 4 * * * rclone copy /home/deploy/RapidGarage/backups remote:rapidgarage-backups --max-age 48h
   ```
   Some VPS providers also sell whole-disk snapshots for about 20% of the
   server price, which is a useful extra layer.

## Option B: Render

Good fit: managed with little operations work. HTTPS, a managed database with
daily backups, and deploys from GitHub. Uses `deploy/render.yaml`.

1. Push the repo to GitHub, then in Render choose **New → Blueprint**, select the repo,
   and set the Blueprint path to `deploy/render.yaml`.
2. Fill in the values it asks for: `APP_BASE_URL` (at first
   `https://rapidgarage.onrender.com`, later your domain), the Maps keys,
   SMTP and `GOOGLE_*`. `SESSION_SECRET` and `KEY_ENCRYPTION_SECRET` are
   generated for you.
3. **Apply.** Render builds the Dockerfile and creates Postgres 17 (Basic, private
   network only) and a 1 GB disk at `/data/uploads`. Before each deploy it runs
   `node scripts/release.js` (precheck and migrations); if that fails, the old
   version keeps running. The health check is `/readyz`.
4. **Custom domain:** Settings → Custom Domains → add `sales.example.com`, create
   the CNAME it shows, then change `APP_BASE_URL` and `GOOGLE_CALLBACK_URL` to the domain.
5. **Check proxy hops once:** set `DEBUG_PROXY=true`, open
   `https://<domain>/healthz/proxy` and confirm `ip` is your own public IP and
   `secure` is `true`. If `ip` is a proxy address, raise `TRUST_PROXY` by one.
   Then remove `DEBUG_PROXY`.

Things to know: a service with a disk runs as **one instance** and has a few
seconds of downtime per deploy, with no zero-downtime overlap. The free plan can't
use disks or pre-deploy commands, so this setup needs Starter or higher.

## Option C: Fly.io

Good fit: managed apps with regions worldwide. The database is billed separately and costs the most. Uses
`deploy/fly.toml`.

```sh
brew install flyctl          # or: curl -L https://fly.io/install.sh | sh
fly auth signup              # or login (an account is needed)
cp deploy/fly.toml fly.toml   # then set app = "<name>" and primary_region
fly apps create <name>
fly volumes create rapidgarage_uploads --size 1 --region ewr
fly mpg create               # Managed Postgres (Basic). Or an external Postgres.
fly secrets set DATABASE_URL='postgres://...' SESSION_SECRET=$(openssl rand -hex 32) \
  KEY_ENCRYPTION_SECRET=$(openssl rand -hex 32) APP_BASE_URL=https://<name>.fly.dev \
  GOOGLE_MAPS_API_KEY=... GOOGLE_GEOCODING_API_KEY=... SMTP_HOST=... SMTP_USER=... SMTP_PASS=... SMTP_FROM=...
fly deploy                   # builds, runs release_command (migrations), starts
fly certs add sales.example.com   # custom domain; then update APP_BASE_URL
```

Notes: `release_command` runs the migrations in a temporary machine, so
`RUN_MIGRATIONS=false` in `fly.toml`. One machine is kept running
(`min_machines_running = 1`) because the sale-alert email worker lives in it.
A volume belongs to one machine, so don't scale past one instance while photos
are on local disk. If the database provider requires TLS, set `DATABASE_SSL`
and remove `sslmode` from the URL. Check proxy hops with `DEBUG_PROXY` as in Render step 5.

## Rough monthly costs (estimates)

**Estimates only.** Collected from public price pages in October 2026, in USD. Verify on each provider's
pricing page before you decide. Not included: domain (about $10–20 a year),
email (free tiers often cover a small site; Amazon SES is about $0.10 per 1,000
emails), and Google Maps (a free monthly allowance per API; small sites usually
stay inside it, but set budget alerts in Google Cloud).

| Setup | What | Est. per month |
| --- | --- | --- |
| VPS, EU (e.g. Hetzner CX23: 2 vCPU, 4 GB) | everything on one server | ~$6–7 (+ ~$1–2 snapshots) |
| VPS, US (e.g. DigitalOcean Basic 2 GB) | everything on one server | ~$12 (+ ~$2.40 backups add-on) |
| Render | Starter web $7 + Postgres Basic-256mb $6 + 1 GB DB storage ~$0.30 + 1 GB disk $0.25 | ~$14 |
| Fly.io | shared-cpu-1x 512 MB ~$3.69 + 1 GB volume $0.15 + Managed Postgres Basic $38 + storage | ~$42–45 |
| Fly.io + external Postgres free tier (e.g. Neon) | app on Fly, DB elsewhere | ~$4–5 (free-tier limits apply) |

For the price, a VPS is cheapest, Render needs the least operations work, and
Fly's cost is mostly its managed database.

## After the first deploy (checklist)

- `https://<domain>/readyz` returns `{"status":"ready"}`.
- Sign up, then make yourself admin: set `ADMIN_EMAILS` to your address and sign in
  with Google, or briefly use `ADMIN_BOOTSTRAP_LOCAL=true` and turn it off right after.
- Post a test sale with a photo, restart the app, and check the photo and your login survive.
- Print a flyer and scan its QR code with a phone: it opens `https://<domain>/s/...`.
- Turn on the Google Cloud budget alert and restrict the browser key to `https://<domain>/*`.
- Do a test restore (below) once.
- Paste a sale link into Facebook's Sharing Debugger (developers.facebook.com/tools/debug)
  or a Slack DM and check the title, dates, area and picture (see *Link previews* below).

## Link previews (Open Graph / Twitter Card)

Links to `/post/<id>`, `/events/<id>` and `/wanted/<id>` unfurl in Facebook,
iMessage, WhatsApp, KakaoTalk, Slack, X and Discord. These apps fetch the HTML
without running JavaScript, so the tags have to be in the page itself:

- **Docker / single process (`SERVE_FRONTEND_DIR`):** nothing to set up. The backend
  replaces the `<!-- rg:head -->` block in `index.html` with the item's title,
  description, canonical URL, `og:*`, `twitter:*` and locale tags. If building them
  takes more than 1.5 s, the static site tags are sent instead.
- **`vite preview` (the setup the live site uses now):** `share/vite-plugin.js`
  (registered in `vite.config.js`) does the same for preview and dev. It asks the
  backend at `BACKEND_URL` (`GET /share/head?path=…`) and falls back to the static
  tags if the backend is down or slow (1.5 s). Restart `vite preview` after
  pulling this change so it loads the plugin. Nothing else is required.
- **Either way, set `APP_BASE_URL` on the backend to the public https URL**, such as
  `https://rapidgarage.example`. Canonical URLs, `og:url` and image URLs are built
  from it. Crawlers ignore links to `localhost`, and some ignore plain http
  images (`og:image:secure_url` is only sent for https).

What a preview shows: the title, the next sale day and time (plus "+N more days"),
the city and state, the price range or "Free on the curb until …", and the start
of the description. Event previews show the area label and number of sales.
Wanted previews show the area, radius and maximum price. A preview never shows
the street address, a last name or an email. Hidden or removed sales, ended
sales (unless they're still free on the curb and not reported), hidden events,
and wanted posts that aren't open (or when the board is off) get the generic
site preview with `noindex`. Their image URL serves the site card, so the
preview doesn't reveal whether the item exists.

**Images.** The preview image is the sale's first photo (already EXIF-stripped),
cropped to 1200×630 JPEG. Without a photo it's a branded 1200×630 PNG card,
drawn with the bundled CJK font (the same one as the flyers), so no system
fonts are needed. URLs are `/api/share/image/<kind>/<id>.(jpg|png)?v=<hash>`. The
hash changes when the title, dates, price, photo or language change, so chat
apps that cache by URL pick up edits. Responses with the current hash are
cached for a week; others for 5 minutes. They're rendered once and kept in
memory (40 images) and on disk at `SHARE_CACHE_DIR` (default
`$TMPDIR/rapidgarage-share`, pruned to 500 files). The disk cache is safe to
delete at any time.

**Language.** `?lang=es|ko|zh-CN` picks the preview language. The Share button
adds it outside English, and `og:url` keeps it, so Facebook re-scrapes in that
language. Without it, the crawler's `Accept-Language` decides, then English.

**Facebook caches previews.** After changing a live sale, use *Scrape Again* in
the Sharing Debugger. Other apps refresh on their own schedule (WhatsApp and
KakaoTalk can take a day or more).

**Share counts.** The Share button on a sale records a press
(`POST /post/<id>/share`), counted at most once per person per day
(daily-salted hash, the same scheme as QR scans). The seller's own presses count;
bots don't. Only the daily total per sale is stored (`PostShareDays`); the
channel is checked but not kept. The total appears as *Shares* on the seller
dashboard.

## Safety tips and meetup spots

Conversations show a short safety card at the start of a new conversation (people can hide it; that choice is remembered on their device only). Every conversation and the hold flow link to the public **/safety** page, which is also in the footer.

**Before-you-send check.** When a message looks like it has a phone number, an email address, or common scam words (gift cards, wire transfers, overpayment, shipping or a courier, verification codes; in English, Spanish, Korean and Chinese), the composer shows a gentle note with "Edit message" and "Send anyway". The check runs in the browser only. It never blocks a message, and nothing about it is sent to the server, logged or reported.

**Suggest a meetup spot.** Either person in a conversation can suggest a public place and a time (up to 14 days ahead). The other person can accept, decline or suggest another time or place. The person who suggested can withdraw it, and either person can call off a meetup they agreed to. Suggestions are stored as conversation messages, like holds, so they follow the same privacy rules: only the two people in the conversation can see them, and moderators can read them only after one of them reports the conversation. Limits: one open suggestion per conversation and 10 a day per person. A suggestion nobody answered expires at its meeting time. Blocking someone (or reporting and blocking) ends open and agreed suggestions.

**Safe meetup spots (admin).** In **Admin → Meetup spots**, add public places such as police station exchange zones, libraries, stores and community centers, each with a name, type, approximate location and an on/off switch. Only spots that are turned on are offered. The nearest ones (within 30 miles, up to 8) are listed first. Distance is measured from the sale's public location, or from the center of the area on a Wanted post (shown in whole miles). If a sale hides its address, the list falls back to spots in the same city and state. Nobody's own location is used, and the app never shows more of a home address than the sale already does. When you add a spot without coordinates, the app looks up the address with the server geocoding key if one is set (`GOOGLE_GEOCODING_API_KEY`); otherwise enter an approximate latitude and longitude. People can also type a public place of their own instead of picking from the list.

**Optional: nearby place search.** If you set `GOOGLE_PLACES_API_KEY` (a server key with the Places API (New) turned on), the meetup dialog adds a search box for nearby public places. Searches go through the server, are biased to the sale's area and limited to 30 an hour per person. The curated list works fine without this key. Leave it unset to turn search off.

## Backups and restore

`rapidgarage-backend/scripts/backup-db.sh` (the compose `backup` service does
this every `BACKUP_INTERVAL_HOURS`). Output in `./backups`:

- `rapidgarage-<UTC time>.dump` (`pg_dump` custom format, checked with `pg_restore --list`)
- `uploads-<UTC time>.tar.gz` (the photos)

Older files are deleted after `BACKUP_KEEP_DAYS`. Take a manual backup before upgrades:

```sh
docker compose --env-file .env.production exec backup /bin/sh /usr/local/bin/backup-db.sh
```

Restore, overwriting the current data. Stop the app first:

```sh
docker compose --env-file .env.production stop app
docker compose --env-file .env.production cp backups/rapidgarage-XXXX.dump db:/tmp/restore.dump
docker compose --env-file .env.production exec db sh -c \
  'pg_restore -U rapidgarage -d rapidgarage --clean --if-exists --no-owner --exit-on-error /tmp/restore.dump && rm /tmp/restore.dump'
docker run --rm -v rapidgarage_uploads:/u -v "$PWD/backups:/b:ro" alpine \
  sh -c 'tar -xzf /b/uploads-XXXX.tar.gz -C /u && chown -R 1000:1000 /u'
docker compose --env-file .env.production start app
```

To test a backup without touching live data, restore it into a scratch
database (`createdb restore_check`, then `pg_restore -d restore_check`) and
compare row counts. Render and Fly Managed Postgres keep their own backups
(Render: daily plus point-in-time recovery; Fly MPG: automated), but photos on
their disks/volumes are only covered by their volume snapshots. Copy
`/data/uploads` elsewhere if the photos matter.

## Upgrades and rollback

```sh
docker compose --env-file .env.production exec backup /bin/sh /usr/local/bin/backup-db.sh
git pull --ff-only
docker compose --env-file .env.production --profile https up -d --build
```

The new container runs `scripts/release.js` (data precheck, then migrations)
before it serves. If that fails, the container exits and the logs say why. To roll back the code:
`git checkout <previous tag>` and rebuild. Migrations are not automatically
reversed, so restore the pre-upgrade dump if a migration has to be undone.

## Never run tests against production

Don't run `npm test` or mocha with the production `.env` loaded, and don't point `TEST_DATABASE_URL` at a real database. The suite recreates every table. It refuses anyway:

- any `NODE_ENV` other than `test`;
- a Postgres database whose name doesn't end in `_test` or `_e2e`;
- a test Postgres database without `RG_ALLOW_TEST_PG=1`.

The app also refuses destructive schema calls such as `sync({ force })` on such databases. Load `.env` only in a subshell for one-off commands, e.g. `( set -a; . ./.env; set +a; npm run migrate )`, so it doesn't stay in your shell.

## How it works

- **Single origin:** with `SERVE_FRONTEND_DIR` set (the image sets it), API
  routes live under `/api` and everything else is the app. Development is
  unchanged: Vite on :3000 proxies `/api` to the backend on :8000.
- **Static files:** `sw.js` and `manifest.webmanifest` are sent with
  `Cache-Control: no-cache` and their correct types, so an update reaches users
  on their next visit. Hashed files under `/assets` are cached for a year.
  Unknown paths without a file extension get the app, which shows its own "not found"
  page. Missing files get a real 404.
- **Security headers (helmet):** `nosniff`; `Referrer-Policy:
  strict-origin-when-cross-origin` (referrer-restricted Maps keys need the
  origin, so not `no-referrer`); COOP `same-origin`; framing blocked; a
  Permissions-Policy that allows only geolocation; HSTS when `APP_BASE_URL` is https.
- **CSP:** the app page uses Google's recommended *strict* policy for the
  Maps JavaScript API. A fresh nonce on every response goes on the app's
  scripts, and `'strict-dynamic'` lets them load Maps, so no Google host has to
  be listed for scripts. Google's image, connect and font hosts are allowed. All
  other responses (JSON, photos, small server pages) allow no scripts. The service
  worker gets its own policy (same-origin fetches). Set `CSP_REPORT_ONLY=true` to
  test changes without blocking anything.
- **Cookies:** `HttpOnly`, `SameSite=Lax`, `Secure` when `APP_BASE_URL` is https (or
  `COOKIE_SECURE=auto`, which follows the proxy's `X-Forwarded-Proto`). A
  `Secure` cookie needs `TRUST_PROXY` set correctly, or logins silently fail.
- **Health:** `/healthz` reports the process is alive and never touches the database.
  `/readyz` checks the database (3 s timeout) and that no migration is pending,
  and returns 503 while shutting down. On SIGTERM the server stops accepting
  connections, finishes in-flight requests, and closes the database pools.
- **Background worker (alerts, wanted matches, sale reminders):** an in-process
  timer in the web process (`ALERT_WORKER=on`, every `ALERT_WORKER_SECONDS`, 60 by
  default). Each tick runs the sale-alert, wanted-match and morning-of reminder
  passes. Reminders go out at `REMINDER_HOUR` (7) in each **sale's** time zone, or
  an hour before an earlier start, and no later than `REMINDER_LATE_HOURS` (3)
  after that or the end of the day. That's why the machine must keep running
  (`min_machines_running = 1` on Fly; a paid, always-on Render instance). It is
  safe with several instances or a restart mid-send: a reminder row is unique per
  (user, sale, day), so two instances can't queue it twice, and a row is sent only
  after one instance claims it (`UPDATE … SET status='sending', claimToken=… WHERE
  status='pending'`). Rows stuck in `sending` for 10 minutes are released for retry.
  To run the worker in only one process, set `ALERT_WORKER=off` on the others.
  Without SMTP, reminder emails are logged and skipped; the in-app notice still shows.
- **Photos:** `lib/storage` has only the `local` driver (`UPLOAD_DIR`, the
  `/data/uploads` volume). There is no S3-compatible driver yet. The interface
  (`put`/`remove`/`read`) is small, so adding one is how you would run more
  than one instance or keep photos off the server's disk.
