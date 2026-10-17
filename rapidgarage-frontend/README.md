# RapidGarage frontend

React 16 app built with [Vite](https://vite.dev/) and `@vitejs/plugin-react`.
Needs Node `^20.19.0 || >=22.12.0` (tested on Node 22 and 24 LTS).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` (or `npm start`) | Dev server on http://localhost:3000 with hot reload. `/api/*` is proxied to the backend on http://localhost:8000 with the `/api` prefix stripped. |
| `npm run build` | Production bundle in `build/`. |
| `npm run preview` | Serves `build/` on port 3000 with the same `/api` proxy. |

Set `BACKEND_URL` to proxy to a different backend, e.g. `BACKEND_URL=http://localhost:8100 npm run dev`.
Pass `--port` to use another port, e.g. `npm run dev -- --port 3100`. If you change the port, set the backend's `FRONTEND_ORIGIN` to match.

## Configuration

Copy `.env.example` to `.env` (never commit it). Only `VITE_*` variables reach the browser.

- `VITE_GOOGLE_MAPS_API_KEY`: optional fallback Maps browser key, used only when the backend
  offers none. Normally the map uses the signed-in user's own key (bring-your-own-key, which an
  admin can switch off on the Admin page) or the backend's `GOOGLE_MAPS_API_KEY`. The old name
  `GOOGLE_MAPS_API_KEY` in this file still works as a fallback.

## Layout

- `index.html`: Vite entry; loads `app/index.jsx`.
- `app/`: source. Components with JSX use `.jsx`.
- `public/`: copied as-is to the build root (`manifest.json`, `favicon.ico`).
- `app/styles/tokens.css`: design tokens (CSS variables for color, spacing, radius, shadows, type).
  Dark mode is `prefers-color-scheme: dark` and only swaps the color tokens.
- `app/styles/app.css`: base styles and components (nav, buttons, forms, cards, chips, skeletons, toasts).
- `app/components/ui.jsx`: `Field` (label + inline error + hint), `Alert`, `EmptyState`, skeletons.
- `app/components/toast.js`: `toast.success(msg)` / `toast.error(msg)`; `<Toaster />` is mounted once in `App`.
- `app/lib/validate.js`: client copies of the server's form rules for inline validation (the server still decides).

## UI

No CSS framework and no jQuery. The font is Inter, self-hosted through `@fontsource-variable/inter`
(bundled, no external font request). Icons come from `lucide-react` (tree-shaken).
Keep new colors in `tokens.css` and check text pairs for WCAG AA (4.5:1) in both light and dark.

If `NODE_ENV=development` is exported in your shell, `vite build` produces a development React
bundle. Build with it unset (or `NODE_ENV=production`).

## Deploying

`build/` is static: serve it from any static host and route `/api/*` to the backend
(stripping `/api`), with a fallback to `index.html` for client-side routes. The backend does not
serve the frontend.
