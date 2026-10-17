# RapidGarage

- `rapidgarage-backend/`: Express + Sequelize API (port 8000). See its README.
- `rapidgarage-frontend/`: React app built with Vite (dev server on port 3000). See its README.

Quick start (Node 22 or 24):

```sh
cd rapidgarage-backend && npm install && cp .env.example .env  # fill in, then:
npm run migrate && npm start
cd ../rapidgarage-frontend && npm install && npm run dev        # http://localhost:3000
```

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

## Install on phone

RapidGarage can be installed like an app (Android/desktop Chrome and Edge: **Install**; iPhone:
Share → **Add to Home Screen**). The installed app opens full screen from the home screen and
still opens without a connection; the service worker caches only the app's own files, never
sales data, messages or anything from the API. See `rapidgarage-frontend/README.md`.

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

