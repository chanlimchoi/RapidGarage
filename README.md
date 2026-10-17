# RapidGarage

- `rapidgarage-backend/`: Express + Sequelize API (port 8000). See its README.
- `rapidgarage-frontend/`: React app built with Vite (dev server on port 3000). See its README.

Quick start (Node 22 or 24):

```sh
cd rapidgarage-backend && npm install && cp .env.example .env  # fill in, then:
npm run migrate && npm start
cd ../rapidgarage-frontend && npm install && npm run dev        # http://localhost:3000
```
