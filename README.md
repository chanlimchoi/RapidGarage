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
