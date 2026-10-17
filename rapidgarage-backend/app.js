require('dotenv').config();
const bodyParser = require('body-parser');
const express = require('express');
const expressSession = require('express-session');
const passport = require('./middlewares/authentication');
const models = require('./models');
const { createSessionStore, sessionMaxAgeMs } = require('./lib/sessionStore');
const runtime = require('./lib/runtime');
const security = require('./lib/security');
const { createHealthRouter } = require('./lib/health');

const PORT = process.env.PORT || 8000;

// Two layouts (see DEPLOY.md):
//   API only (default, development): routes at /post, /auth ...; Vite serves
//     the frontend on :3000 and proxies /api/* here with the prefix stripped.
//   Single process (SERVE_FRONTEND_DIR set, Docker image): this process serves
//     the built frontend at /, the API under /api/*, QR links at /s/<code>,
//     on one port. URLs the frontend and emails use are the same in both.
function createApp(env) {
  const e = env || process.env;
  const SESSION_SECRET = e.SESSION_SECRET;
  if (!SESSION_SECRET) {
    throw new Error('Missing SESSION_SECRET environment variable (see .env.example)');
  }
  const frontendDir = runtime.frontendDir(e);
  // Single origin: the browser talks to us directly, so the frontend origin
  // is the public URL.
  if (frontendDir && !e.FRONTEND_ORIGIN && runtime.origin(e.APP_BASE_URL)) e.FRONTEND_ORIGIN = runtime.origin(e.APP_BASE_URL);
  const FRONTEND_ORIGIN = e.FRONTEND_ORIGIN || 'http://localhost:3000';

  const app = express();
  // Behind a TLS-terminating proxy: the real client IP (rate limits, scan
  // dedupe) and https (secure cookies) come from its X-Forwarded-* headers.
  app.set('trust proxy', runtime.trustProxy(e));
  app.locals.frontendDir = frontendDir;

  if (!runtime.isOn(e.SECURITY_HEADERS_OFF)) app.use(security.securityHeaders(e));

  app.use(function(req, res, next) {
    // Only the configured frontend may call the API with cookies.
    if (req.headers.origin === FRONTEND_ORIGIN) {
      res.header('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Vary', 'Origin');
    }
    res.header('Access-Control-Allow-Methods', "GET,POST,PUT,DELETE,OPTIONS");
    res.header('Access-Control-Allow-Headers', "Origin, X-Requested-With, Content-Type, Accept");
    // Answer CORS preflight requests directly; without this, JSON POSTs
    // cross-origin fail before they ever reach a route.
    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
    next();
  });

  // Health checks first: no session lookup, no body parsing.
  const health = createHealthRouter({ sequelize: models.sequelize, app, env: e });
  app.use(health);
  app.use('/api', health);

  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));

  // Enable sessions & passport. Sessions live in Postgres (table "session")
  // outside tests, so logins survive restarts; see lib/sessionStore.js.
  const sessionStore = createSessionStore({ env: e });
  app.locals.sessionStore = sessionStore;
  app.use(expressSession({
    store: sessionStore.store,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // true / false / 'auto'; 'auto' and true need a trusted proxy to
      // report https (see TRUST_PROXY), or the cookie is not sent at all.
      secure: runtime.cookieSecure(e),
      maxAge: sessionMaxAgeMs(),
    },
  }));
  app.use(passport.initialize());
  app.use(passport.session());

  const api = express.Router();
  // Uploaded photos: read-only (GET/HEAD), served through the storage layer.
  api.use('/uploads', require('./controllers/uploads'));
  // Load up all of the controllers
  api.use(require('./controllers'));

  if (frontendDir) {
    app.use('/api', api);
    app.use('/s', require('./controllers/shortlinks')); // printed QR codes
    app.use('/api', (req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Not found.' } }));
    require('./lib/frontend').mountFrontend(app, frontendDir, e);
  } else {
    app.use(api);
  }

  // Consistent JSON error handler for anything passed to next(err).
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'bad_request', message: 'Malformed JSON body.' } });
    }
    console.error(err);
    res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong.' } });
  });
  return app;
}

const app = createApp();
module.exports = app;
module.exports.createApp = createApp;

// Start the server only when run directly (tests require the app instead).
if (require.main === module) {
  const { errors, warnings } = runtime.checkConfig(process.env);
  warnings.forEach((w) => console.warn('WARNING: ' + w));
  if (errors.length) {
    errors.forEach((m) => console.error('CONFIG ERROR: ' + m));
    process.exit(1);
  }
  const sessionStore = app.locals.sessionStore;
  sessionStore.check()
    .then(() => models.sequelize.sync({ force: false }))
    .then(() => {
      const server = app.listen(PORT, () => {
        const mode = app.locals.frontendDir ? 'frontend + API' : 'API only';
        console.log(`Server is up and running on port: ${PORT} (session store: ${sessionStore.kind}, ${mode})`);
      });
      // Sale alert email outbox (set ALERT_WORKER=off to run it elsewhere).
      const alerts = require('./lib/alerts');
      if (String(process.env.ALERT_WORKER || '').toLowerCase() !== 'off') alerts.startWorker();
      // On SIGTERM: report not-ready, stop accepting connections, finish
      // in-flight requests, then close DB pools.
      const shutdown = () => {
        app.locals.draining = true;
        server.close(() => {
          require('./lib/alerts').stopWorker();
          Promise.all([sessionStore.close(), models.sequelize.close()]).finally(() => process.exit(0));
        });
        // Idle keep-alive sockets would hold close() open; give up after 10s.
        setTimeout(() => process.exit(0), 10000).unref();
        if (server.closeIdleConnections) server.closeIdleConnections();
      };
      process.once('SIGTERM', shutdown);
      process.once('SIGINT', shutdown);
    })
    .catch((err) => {
      console.error('Startup failed:', err.message);
      process.exit(1);
    });
}
