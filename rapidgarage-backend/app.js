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
const { sendError } = require('./lib/http');
const rateLimit = require('./lib/rateLimit');

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

  // Past this point, refuse at once when the process is already saturated.
  app.use(rateLimit.shedLoad());

  // Explicit body limits: JSON bodies are small (the largest, a 100-item list,
  // is well under 100 kB); forms are only one-click unsubscribe POSTs.
  app.use(bodyParser.json({ limit: '100kb' }));
  app.use(bodyParser.urlencoded({ extended: false, limit: '10kb', parameterLimit: 50 }));

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
  // Before the limiters: a page of results loads one thumbnail per sale.
  api.use('/uploads', require('./controllers/uploads'));
  api.use(rateLimit.sameOriginWrites([FRONTEND_ORIGIN, runtime.origin(e.APP_BASE_URL)]));
  api.use(rateLimit.apiLimiter);
  api.use(rateLimit.writeLimiter);
  api.use(['/login', '/signup', '/password-reset'], rateLimit.authLimiter);
  // Load up all of the controllers
  api.use(require('./controllers'));

  if (frontendDir) {
    app.use('/api', api);
    app.use('/s', require('./controllers/shortlinks')); // printed QR codes
    app.use(require('./controllers/seo')); // /robots.txt, /sitemap.xml
    app.use('/api', (req, res) => sendError(res, 404, 'not_found', 'Not found.'));
    require('./lib/frontend').mountFrontend(app, frontendDir, e);
  } else {
    app.use(api);
  }

  // Consistent JSON error handler for anything passed to next(err).
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
      return sendError(res, 400, 'bad_request', 'Malformed JSON body.');
    }
    if (err && (err.type === 'entity.too.large' || err.type === 'parameters.too.many')) {
      return sendError(res, 413, 'payload_too_large', 'Request body is too large.');
    }
    console.error(err);
    sendError(res, 500, 'server_error', 'Something went wrong.');
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
      // Slow-client (slowloris) protection: see runtime.httpLimits.
      runtime.applyHttpLimits(server, process.env);
      // Sale alert email outbox (set ALERT_WORKER=off to run it elsewhere).
      const alerts = require('./lib/alerts');
      const holds = require('./lib/holds');
      if (String(process.env.ALERT_WORKER || '').toLowerCase() !== 'off') alerts.startWorker();
      // End overdue item holds every minute (reads also sweep; see lib/holds.js).
      setInterval(() => holds.sweep().catch((err) => console.error('hold sweep failed', err && err.message)), 60000).unref();
      setInterval(() => require('./lib/meetups').sweep().catch((err) => console.error('meetup sweep failed', err && err.message)), 60000).unref();
      // On SIGTERM: report not-ready, stop accepting connections, finish
      // in-flight requests, then close DB pools.
      const shutdown = () => {
        app.locals.draining = true;
        // Open event streams would hold close() open; browsers reconnect to the next instance.
        require('./lib/live').closeAll();
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
