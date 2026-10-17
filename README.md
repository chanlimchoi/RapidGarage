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
