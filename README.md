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
