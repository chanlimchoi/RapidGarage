# RapidGarage

- `rapidgarage-backend/`: Express + Sequelize API (port 8000). See its README.
- `rapidgarage-frontend/`: React app built with Vite (dev server on port 3000). See its README.

Quick start (Node 22 or 24):

```sh
cd rapidgarage-backend && npm install && cp .env.example .env  # fill in, then:
npm run migrate && npm start
cd ../rapidgarage-frontend && npm install && npm run dev        # http://localhost:3000
```

## Testing

- **Backend:** `cd rapidgarage-backend && npm test` runs mocha on **in-memory SQLite**.
- **Frontend:** `cd rapidgarage-frontend && npm test` runs the unit tests (no database). `npm run test:a11y` runs the accessibility scan against a running local app (see Accessibility).

**Tests can't touch a real database.** Every mocha run loads `test/setup.js` through `.mocharc.js`, including `npx mocha test/x.test.js`. It refuses to start unless:

- `NODE_ENV` is `test` (unset counts as test). `development` or `production` from a `.env` is refused.
- The database is in-memory SQLite, a SQLite file in the temp directory, or a throwaway Postgres DB whose name ends in `_test` or `_e2e`, **and** `RG_ALLOW_TEST_PG=1` is set.

It also blanks `DATABASE_URL` and libpq `PG*` variables for the run, so neither the shell nor a `.env` can leak a real connection into the session store or child processes.

On top of that, `models/index.js` guards every destructive call, also outside tests. That covers `sync({ force })`, `sync({ alter })`, `drop`, `truncate`, `destroy({ truncate })`, `destroy({ where: {} })`, `dropAllTables` and `dropAllSchemas`. Each one throws unless the same conditions hold.

Refusals name the dialect, host, port and database, never the user or password.

To run the backend tests on Postgres, use a database made for it:

```sh
createdb rapidgarage_test
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/rapidgarage_test RG_ALLOW_TEST_PG=1 npm test
```

Tests never read `DATABASE_URL`, so a live `.env` in the shell is ignored. Even so, keep a live `.env` out of your shell. Load it only in a subshell when you need it, e.g. `( set -a; . ./.env; set +a; npm run migrate )`.

## Production

One Docker image runs the whole app on one port (frontend, API under `/api`,
QR links, `/healthz` and `/readyz`). `docker-compose.yml` adds Postgres 17,
daily backups and optional Caddy for automatic HTTPS. **[DEPLOY.md](DEPLOY.md)**
has the settings (`.env.production.example`), step-by-step guides for a VPS,
Render and Fly.io, cost estimates, and backup/restore.

```sh
cp .env.production.example .env.production   # fill in (DEPLOY.md)
docker compose --env-file .env.production up -d --build   # http://localhost:8080
```

## Security and abuse protection

The API rate-limits each client IP, slows down password guessing per account, sheds load when
saturated, drops slow clients, caps body sizes and refuses cross-site writes. Logging in rotates
the session id (passport 0.7). Volumetric DDoS has to be stopped before traffic reaches the app;
DEPLOY.md ("Abuse and DDoS protection") covers the limits, the Caddy settings and putting
Cloudflare in front.

## Photos on posts

Each post can have up to 5 photos (JPEG, PNG or WebP, 8 MB max each). The server checks the
file's actual bytes (not the extension), auto-rotates, resizes to at most 1600px plus a 400px
thumbnail, strips all EXIF/GPS metadata and stores WebP files. Pick photos on **New Post** or
**Edit post & photos**; lists show a thumbnail and the post page (`/post/:id`) has a gallery.
Photos are stored on local disk by default (`rapidgarage-backend/uploads/`, git-ignored); see
the backend README for settings and the API.

## Map search

The home page searches sales near a typed address or zip, or near your location ("Use my
location"), within 5, 10, 25 or 50 miles. Results are sorted by distance, show how far away each
sale is, and are paginated. The map clusters nearby pins (`@googlemaps/markerclusterer`) and
stays in sync with the list: clicking a sale pans to its pin, and clicking a pin highlights the
sale. Without any Maps key, "Use my location" still gives distance results, and a typed zip or
address falls back to text matching with a message explaining why. See the backend README for
the API, keys and the `geocode:backfill` script.

## Prices

Sellers can mark a sale as free or give a price range in whole dollars (lowest and/or highest)
on the New and Edit post forms, with inline checks that match the server's. Cards and the post
page show a price chip ("Free", "$5", "$5–$50", "Up to $50"). The search bar has a "Max price"
box and a "Free only" toggle, which apply on top of the radius and distance sorting. See the
backend README for the exact rules and API.

## Last-hour markdowns

Sellers can sell off what's left: on the New and Edit post forms, **Last-hour markdown** sets a
discount (5–90%) and a start time in the sale's local time, on every sale day or **only on the
last day**. Each day's markdown runs from that time until the day's sale ends. Once it starts,
cards show a "50% off now" chip (and "50% off from 2 PM" in the 12 hours before), the sale page
explains it, and item prices show the old price struck through next to the discounted one,
rounded down to the cent. **Discounts now** on the home page filters both the distance search
and the recent list to sales whose markdown is running. Free sales don't offer a markdown.

## Reporting and moderation

Logged-in users can report someone else's sale from the post page ("Report this sale"): pick a
reason (spam, scam or fraud, prohibited item, offensive, wrong information, other) and add an
optional note of up to 500 characters. Each person can have one open report per post, and
reports are rate-limited per user. Admins review reports in **Admin → Reports**, next to Users
and Settings: open reports are grouped by post with counts, reasons, notes and a preview, and
each post can be dismissed, hidden, unhidden or deleted with an optional resolution note. A
History view lists resolved reports. Hidden posts disappear from home, lists, search and the
map for everyone except the owner (who sees a "Hidden by moderator" notice) and admins.
Optional auto-hide is controlled by `REPORT_AUTO_HIDE_THRESHOLD`; see the backend README.

## Messages

Logged-in buyers can press **Message seller** on someone else's sale. That opens (or reuses)
a private conversation for that post at **/messages**: a conversation list plus a thread with a
composer (Enter sends, Shift+Enter adds a line). New messages and the unread badge on the nav
(Messages link and avatar) update by polling: every 10 s while the inbox or a thread is open,
and every 15 s for the badge. Messages are plain text; http(s) links become clickable. People
only ever see each other's first name and last initial, never an email address. Either person
can **Block** the other, which stops new messages both ways until they unblock. If the post is
hidden by a moderator or deleted, existing conversations stay readable and show the post as
unavailable, but new conversations can't be started on it. See the backend README for the API
and rate limits.

### Reporting a conversation

Either person in a conversation can choose **Report conversation** from the thread's options
menu: pick a reason (harassment, scam or fraud, spam, offensive, other), add an optional note
and optionally block the other person at the same time. **Admins can't read a conversation
unless someone in it has reported it.** Reported conversations appear in **Admin → Reports →
Conversations**, where an admin can read the messages (every read is logged in an audit
trail), dismiss, record a warning, remove individual messages (participants then see "Removed
by moderator") or ban a participant from messaging (they can still read, but not send or
start conversations), and lift a ban later. Participants never see who else reported or any
admin notes.

## Forgot password

**Log in → Forgot password?** asks for an email and sends a link to
`/reset-password`. The page answers the same way whether or not the email has an account. Links
work once and expire after `PASSWORD_RESET_TTL_MINUTES` (default 60). Only a SHA-256 of each
token is stored. Requesting a new link doesn't void older ones, but setting a password voids all
of them. Each account gets at most `PASSWORD_RESET_MAX_PER_HOUR` (default 3) emails an hour; over
the limit, requests still answer normally but send nothing. Each IP gets
`PASSWORD_RESET_MAX_PER_IP_HOUR` (default 20) requests an hour, after which it gets `429`. Emails
are written in the account's language and sent after the response, so response time doesn't
reveal whether an account exists.

**Settings → Password** changes the password (the current one is required) or adds one to an
account created with Google. Either way, and after a reset, every other session is signed out:
sessions record the account's `authVersion`, which goes up with each new password. A short
"your password was changed" email follows. Without SMTP, `/config` reports
`passwordReset: false` and the reset request answers `503` with an explanation.

## Sale alerts (email)

Logged-in users can save up to 5 **sale alerts** in **Settings → Sale alerts** (or press
**Alert me about sales here** after a distance search on the home page, which saves the
current search center, radius and price filters). An alert has a name, a center (an address,
which needs a server geocoding key, or the browser's current location), a radius of 1–50 mi,
and an optional max price or "free only", with the same meaning as the search filters.
Alerts can be paused, edited and deleted.

When someone publishes a sale (or changes its address) and it gets coordinates, every
matching alert's owner is queued for an email, except the seller and anyone who has blocked
the seller or been blocked by them. Hidden sales never match. Emails are bundled: at most one
per user every `ALERT_DIGEST_MINUTES` (default 15) and at most `ALERT_DAILY_MAX_EMAILS` (default 6)
per rolling 24 hours. They list each sale's title, price, distance, city and seller ("First L.",
never an email address), with links to the sale, to Settings, and a one-click **Turn off** link
for each alert that works without logging in. Admins can switch alert emails off for the
whole site in **Admin → Settings**. Email needs SMTP settings; without them the app works
normally and alerts are just logged and skipped. See the backend README.

## Sale dates & times

Sellers add one or more **days** to a sale, each with a start and end time (**When** on the
new/edit sale form). Times are saved in the seller's time zone (the browser's zone when the
sale is created) and shown exactly as entered; buyers in another zone see a note. Cards, the
map popup and the sale page show a badge: **Open now · until 2 PM**, **Starts Sat 8 AM**
(or "today"/"tomorrow") or **Ended**, and the sale page lists every day. The home page has a
**When** filter (**Any time · Today · This weekend · Open now**) that works on the recent list
and on map search. "Today" and "This weekend" use the sale's own local dates; on a Saturday
"this weekend" means today and tomorrow, on a Sunday just today.

After its last day ends, a sale drops out of the recent list, search, the map and email
alerts. Its owner and admins still see it in the seller's list, and the direct link keeps
working (with a "This sale has ended" note), so shared links and conversations don't break.
Sales without dates never end on their own.

## Item lists

Sellers can list what they're selling: on the sale page tap **Add items** (or **Edit items**),
then add each item with a name, an optional price and optionally one of the sale's photos.
Items can be reordered, edited, deleted and **marked sold**; sellers can also tick items sold
right from the sale page while the sale is on. Buyers see the list on the sale page (sold items
struck through and dimmed, with a **Hide sold** switch; tapping a thumbnail shows that photo).
The **What?** box on the home page (e.g. "bike") finds sales whose title, description or
unsold items match every word, on the recent list or together with a location search, and
the cards show the matching items.

## Draft items from photos (Claude)

On **Edit items**, **Draft items from photos** sends the sale's first 5 photos to Anthropic's Claude
(`claude-opus-5-5`), which suggests item names, in the seller's language, with typical
garage-sale prices. The seller edits names and prices, unticks what they don't want and presses
**Add N items**, which saves the rest in one request. Nothing is saved before that. Only the
stored photos are sent (already resized, with EXIF/GPS removed), and the page says so; no name,
email, address or sale text goes along. It needs `ANTHROPIC_API_KEY` on the server and can be
switched off in **Admin → Settings**. Each seller gets `AI_ITEMS_PER_DAY` (default 10) drafts a
day, and failed attempts don't count.

## Install on phone

RapidGarage can be installed like an app (Android/desktop Chrome and Edge: **Install**; iPhone:
Share → **Add to Home Screen**). The installed app opens full screen from the home screen and
still opens without a connection; the service worker caches only the app's own files, never
sales data, messages or anything from the API. See `rapidgarage-frontend/README.md`.

## Flyers, yard signs & QR scans

On their sale page, sellers tap **Print flyer & sign** for print-ready PDFs: a Letter flyer,
a half-page flyer and a big-text yard sign with an optional arrow. There are also a QR code
PNG/SVG and a browser-printable preview. Each QR code opens a short link
`APP_BASE_URL/s/<code>` (8 random characters, unrelated to the post id) that redirects to
the sale. The seller and admins see how many people scanned it, in total and per day.
Repeat scans by the same phone on the same day, bots, link previews and the seller's own
scans don't count. No IP address or device detail is stored: repeats are recognised with
a keyed hash whose key is random, kept in memory only and replaced every UTC day (see
`rapidgarage-backend/lib/scans.js`). Links to hidden sales show a "not available" page;
ended sales still open (marked ended).

**Deploying:** `/s/<code>` is served by the backend. The Vite dev and preview servers
proxy it (see `vite.config.js`); any other front proxy must forward `/s/*` to the backend
too, with `X-Forwarded-For`, and set `trust proxy` (on when `NODE_ENV=production`).
Set `APP_BASE_URL` to the public address before printing.

## Saved sales & weekend route

Logged-in buyers tap the **star** on a sale card (or **Save** on the sale page) to keep it in
**Saved** (nav bar). The Saved page lists them (sales that ended move to an **Ended**
section; sales a moderator hid since disappear, with a count), and plans a **route** through
the saved sales that are still coming up: **This weekend · Today · All upcoming**. The order
is a simple nearest-neighbor walk, starting from your location if you tap **Start from my
location** (asked only then, never stored) or else from the sale that opens first. The route
shows as numbered stops with straight-line distances, a sketch, the Google Map (when a Maps
key is available) and an **Open in Google Maps** link with the stops as waypoints (up to 10
stops, Google's limit). Your saved list is private to you.


## Following sellers

**Follow** on a sale page or a seller's page (`/people/:id`, which also shows the follower count)
gets you their new sales. **Following** in the account menu (`/following`) lists the current sales
of everyone you follow, and each person with an email switch and **Unfollow**. When a followed
seller publishes a sale, followers with emails on get an email. Edits don't trigger one. These
emails share the sale-alert budget (`ALERT_DIGEST_MINUTES`, `ALERT_DAILY_MAX_EMAILS`), so several
new sales arrive bundled. Each email has a one-click link that stops emails about that seller
without unfollowing. Blocking someone ends following in both directions, and blocked users can't
follow each other. Nobody sees anyone's email address; sellers show as "First L.".

## Item holds

From a conversation, a buyer can ask the seller to hold one item of the sale, optionally with a pickup time (before the sale ends, at most 14 days ahead). The seller accepts (choosing how long: until an hour after pickup, or 2/6/24/48 h), declines, or later releases the hold; the buyer can cancel. An accepted hold shows the item as **Reserved** on the sale page and in its item list (the seller also sees "Reserved until ..."); nobody else is told who holds it, and a reserved item can't be requested by anyone else.

- **Expiry.** An unanswered request lapses after `HOLD_REQUEST_HOURS` (24); an accepted hold ends at the chosen time (default `HOLD_HOURS`, 24; at most 72 h) and never outlives the sale. Marking the item sold completes the hold. A sweep runs every minute and whenever the hold or unread endpoints are hit, so nothing depends on the timer alone.
- **Abuse limits (per buyer).** `HOLD_MAX_ACTIVE` open holds overall (5), 3 per sale, `HOLD_MAX_PER_DAY` requests per 24 h (10), no new request for an item the seller declined within 24 h, and at most 5 pending requests per item. Accepting one request automatically declines the others for that item. Blocking someone, or a messaging ban, ends or prevents holds between the two of you.
- **Notifications.** Each step is posted into the conversation as an event message (shown as a centred line, worded for each side in the reader's language), so it counts toward the unread badge and appears in the inbox preview. No email is sent.

## Neighborhood sales

Anyone logged in can organize a **neighborhood sale** (`/events/new`): a name, an area (a center typed as a neighborhood, ZIP code or address, or the organizer's location, plus a radius of 0.25–5 mi), up to 7 days with times (same editor and time-zone rules as a sale), a description, and how sellers join: **approval required** (default) or **open**. The area can't change after creating, so sales that joined stay inside it.

- **Joining.** A seller adds one of their own sales from the event page, or from the "Neighborhood sale" panel on their sale page, which lists nearby events and says why a sale can't join. A sale must be visible, not ended, inside the circle and open on at least one of the event's days, and it can be in one event at a time. In approval mode the organizer approves or declines each request; the organizer can remove any sale and a seller can leave at any time (both simply delete the participation). Blocking in either direction prevents joining and approving.
- **Event page** (`/events/:id`): the participating sales on a map (an SVG area sketch with numbered pins, plus the Google map when a key is configured), schedule, organizer as "First L.", requests for the organizer, report button. Public event data never includes an email address or the short code.
- **Search.** Sales that belong to an event carry a "Part of ..." chip; a location search returns the nearby events (with at least one sale) as a strip above the results and as **one pin per event** on the map, and **Neighborhood sales only** narrows results to their sales (`neighborhood=true` on `/search`).
- **Flyer & sign.** The organizer prints a shared flyer (letter or half page, optionally listing the sales) or yard sign in any of the four languages (`/events/:id/print`, PDF from `GET /events/:id/flyer.pdf`). Its QR code is a short link (`/s/<code>`, codes are unique across sales and events) that opens the event map; scans are counted per day exactly like sale scans (separate `EventScanDays` table).
- **Alerts.** Alerts still match sales, so a sale is never emailed twice to the same person; in a digest, two or more sales of the same event are grouped into one "Neighborhood sale: ..." line with a sale count. Creating an event, joining or leaving sends nothing.
- **Moderation.** Events can be reported (same reasons, the same hourly report budget as posts, auto-hide at the same threshold). Admins find them under **Admin → Reports → Neighborhood sales** and can dismiss, hide, unhide or delete. Hiding takes the event out of search and lists and stops its short link and printing; its sales stay listed on their own. Ended events stay viewable but leave search.
- **Limits.** `EVENT_MAX_ACTIVE` upcoming events per organizer (3), `EVENT_MAX_PER_DAY` created per 24 h (5), `EVENT_MAX_SALES` sales per event (200).

## Search engines (SEO)

Sale and neighborhood-sale pages include schema.org `SaleEvent` structured data (dates, city,
price range, image; never the street or names), so search engines can show them as events.
Public pages list `hreflang` alternates for the four languages. `/robots.txt` and a live
`/sitemap.xml` of current public sales are served, and private pages are `noindex`. See
DEPLOY.md ("Search engines").

## Admin analytics

**Admin → Analytics** shows site-wide numbers for the last 7, 30 or 90 days. Stat tiles show
active sales, new sales, sign-ups, sale views, messages, QR scans, saves, new follows, accounts
and open reports, each with the change versus the previous period of the same length. Below
them, one small chart per daily series: sign-ups, new sales, messages, views, QR scans and
shares. Each chart has a crosshair tooltip that also works with the arrow keys, and **Show
tables** reveals the numbers as tables. Last come where the active sales are (top cities) and
the most-viewed sales. Everything is aggregate: no emails or message text, sellers as "First L.".
Days are UTC.

## Seller dashboard

Logged-in sellers get **Dashboard** in the nav (`/dashboard`): totals and 14-day charts for page views, QR scans, saves and buyer messages across all their sales, a "right now" snapshot (active/ended sales, conversations and unread, holds waiting/reserved, items sold vs total, sales in neighborhood sales), and every sale, ended ones included (filter: all / active / ended), each with its own numbers. `/dashboard/sales/:id` shows one sale: four daily charts, items sold, open holds (item, buyer as "First L.", until when, link to the thread), its conversations and its neighborhood sale. Charts are plain SVG with a screen-reader table; no chart library.

- **Only your own.** The API (`GET /dashboard`, `GET /dashboard/sales/:id`) has no user parameter; another seller's sale is a 404 for everyone, admins included. Admins keep what they already had (e.g. scan counts on a sale's print page).
- **Views are counted like QR scans.** The sale page sends `POST /post/:id/view`; the server counts each visitor once per day per sale with an HMAC of (sale, IP, user agent) under a random salt that lives only in memory and changes every UTC day, and stores only a number per sale per local day (`PostViewDays`). Not counted: the seller, admins, bots and link previews (user-agent list), prefetch/prerender requests, hidden sales, and plain GETs (crawlers that don't run the page never count). A QR scan that opens the page is one scan and, if the page loads, one view.
- **What else is counted.** Saves are current saves (and when they were made); who saved is never shown. Messages are buyers' text messages (not hold events, not the seller's, not removed). Holds count open requests and reservations that haven't expired. Days are each sale's local dates.

## Languages

RapidGarage speaks **English, Español, 한국어 and 简体中文**. The first visit follows the
browser's languages; the switcher in the nav bar (and **Settings → Language**) changes it
instantly, remembers it on the device and, when logged in, on the account. The account
language follows you to new devices and is used for sale-alert emails. Dates, times,
numbers and prices are formatted with `Intl` for the chosen language (prices stay US
dollars). Flyers and yard signs can be printed in any of the four languages, whatever
language the site is in; Korean and Chinese PDFs embed a 4 MB subset of Noto Sans CJK SC
(`rapidgarage-backend/assets/fonts`, SIL Open Font License), and pdfkit embeds only the
glyphs a flyer uses (a Korean flyer is about 35 KB).

**Adding or changing text:**
- Web app: `rapidgarage-frontend/app/i18n/locales/{en,es,ko,zh-CN}.js`, flat keys with
  `{name}` slots and `{ one, other }` plurals; use `t('key', vars)` in components.
  `npm test` fails if any language lacks a key, drops a placeholder or misses a plural
  form, or if the code uses a key that doesn't exist. Keys must be literal strings.
- Server: API messages are still written in plain English in the code, and translated in
  `lib/http.js` from `rapidgarage-backend/locales/*.json` (`messages`, keyed by the
  English text; `{x}` marks a slot for numbers or labels). The server picks the language
  from `Accept-Language` (the web app sends its current language), else the account's.
  A test fails if a message literal in the code, or any message the test run produced,
  has no translation. Emails, short-link pages and PDFs use the `strings` keys.
- The flyer wording (`flyer.*`, `price.*`) exists in both catalogs; a test checks that
  they match, so the print preview always shows what the PDF will print.

## Accessibility

The target is **WCAG 2.2 AA**. What the app does:

- **Keyboard.** "Skip to content" is the first Tab stop. Every control shows a focus ring. Dialogs trap focus, close on Escape, return focus to the button that opened them, and make the page behind them inert. Menus and popovers (account, mobile nav, share, add to calendar, conversation) also close on Escape and return focus; they support Home and End, and close when focus leaves them.
- **Screen readers.**
  - Form errors are tied to their fields with `aria-describedby` and `aria-invalid`.
  - Toasts are announced through permanent live regions. They pause while hovered or focused; errors stay up for 10 s.
  - New unread messages and new wanted matches in the nav are announced politely.
- **Photo descriptions.** Sellers can describe each photo when posting or editing (stored as `PostPhotos.alt`, up to 250 characters). Without one, the alt text is "<title>, photo 2 of 5".
- **Layout.**
  - The nav measures itself: when it doesn't fit, it drops its labels, then moves into the menu, so it never overflows in any language.
  - Pages reflow without sideways scrolling down to 320px wide (400% zoom).
  - Touch targets are at least 24px.
  - `prefers-reduced-motion` turns off transitions and smooth scrolling.
  - `<html lang>` follows the chosen language.

**Checking it:** `npm run test:a11y` in `rapidgarage-frontend` runs axe-core with Playwright on about 46 pages and states: logged in and out, buyer, seller and admin, dialogs and menus open, and forms with errors. It covers desktop (1280px) and mobile (390px) in English and Korean, plus a dark-theme pass and a 320px/640px reflow pass. It then runs keyboard checks: the skip link, focus rings, focus traps, Escape and focus return, html lang, and reduced motion. It exits non-zero on any serious or critical issue and writes `a11y-report.json`.

**Set up before running:**
- It needs the app running with its API, e.g. `npm run dev` against a local backend.
- It creates its own throwaway users and sales through the API, so **never point it at production**; it refuses a non-local `A11Y_BASE` unless `A11Y_ALLOW_REMOTE=1`.
- Playwright's Chromium is needed once: `npx playwright install chromium`.

**Settings** (environment variables):
- `A11Y_BASE`: app URL (default `http://localhost:3000`).
- `A11Y_ADMIN_EMAIL` / `A11Y_ADMIN_PASSWORD`: an existing admin account, for the admin pages. They're skipped without it.
- `A11Y_LOCALES`, `A11Y_VIEWPORTS`, `A11Y_ONLY=<regex>`: narrow the run.
- `A11Y_FAIL_ON`: impacts that fail the run (default `serious,critical`).
- `A11Y_SHOTS=<dir>`: save a screenshot of each state.
- `A11Y_REFLOW=0` / `A11Y_KEYBOARD=0`: skip those passes.
