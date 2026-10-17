# syntax=docker/dockerfile:1
# RapidGarage: one image, one process, one port (8080). Express serves the
# built frontend, the API under /api, QR links under /s, /healthz and /readyz.
#   docker build -t rapidgarage .
#   docker compose --env-file .env.production up -d --build   (see DEPLOY.md)
ARG NODE_VERSION=24

# --- 1. frontend build (Vite) ----------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS frontend
WORKDIR /src/rapidgarage-frontend
COPY rapidgarage-frontend/package.json rapidgarage-frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY rapidgarage-frontend/ ./
# NODE_ENV must not be "development" here (it would emit a dev build).
RUN npx vite build && node scripts/check-pwa.js build && find build -name '*.map' -delete

# --- 2. backend production dependencies -------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS backend-deps
WORKDIR /app
COPY rapidgarage-backend/package.json rapidgarage-backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# --- 3. runtime --------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    SERVE_FRONTEND_DIR=/app/frontend \
    UPLOAD_DIR=/data/uploads \
    PHOTO_STORAGE=local
WORKDIR /app
COPY --from=backend-deps /app/node_modules ./node_modules
COPY rapidgarage-backend/ ./
COPY --from=frontend /src/rapidgarage-frontend/build ./frontend
COPY docker/entrypoint.sh /usr/local/bin/rapidgarage-entrypoint
RUN chmod 0755 /usr/local/bin/rapidgarage-entrypoint \
 && mkdir -p /data/uploads && chown node:node /data/uploads \
 && node -e "require('sharp'); require('pdfkit'); require('helmet'); require('./lib/frontend').loadIndex('/app/frontend')"
EXPOSE 8080
# Liveness only (no DB): a slow database must not get the container killed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# The entrypoint drops to the unprivileged "node" user after fixing volume
# ownership, then runs migrations (RUN_MIGRATIONS) and the CMD.
ENTRYPOINT ["rapidgarage-entrypoint"]
CMD ["node", "app.js"]
