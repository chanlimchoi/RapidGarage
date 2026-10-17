require('dotenv').config();
const bodyParser = require('body-parser');
const express = require('express');
const expressSession = require('express-session');
const passport = require('./middlewares/authentication');
const models = require('./models');
const { createSessionStore, sessionMaxAgeMs } = require('./lib/sessionStore');

const PORT = process.env.PORT || 8000;

const app = express();

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  throw new Error('Missing SESSION_SECRET environment variable (see .env.example)');
}
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  // Needed for secure cookies behind a TLS-terminating proxy.
  app.set('trust proxy', 1);
}

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
})

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Enable sessions & passport. Sessions live in Postgres (table "session")
// outside tests, so logins survive restarts; see lib/sessionStore.js.
const sessionStore = createSessionStore();
app.locals.sessionStore = sessionStore;
app.use(expressSession({
  store: sessionStore.store,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: sessionMaxAgeMs(),
  },
}));
app.use(passport.initialize());
app.use(passport.session());

// Uncomment the following if you want to serve up static assets.
// (You must create the public folder)
/*
app.use(express.static('./public'));
*/

// Uncomment the following if you want to use handlebars
// on the backend. (You must create the views folder)
/*
const exphbs = require('express-handlebars');
app.engine('handlebars', exphbs({
  layoutsDir: './views/layouts',
  defaultLayout: 'main',
}));
app.set('view engine', 'handlebars');
app.set('views', `${__dirname}/views/`);
*/



// Uploaded photos: read-only (GET/HEAD), served through the storage layer.
app.use('/uploads', require('./controllers/uploads'));

// Load up all of the controllers
const controllers = require('./controllers');
app.use(controllers);


// Consistent JSON error handler for anything passed to next(err).
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'bad_request', message: 'Malformed JSON body.' } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong.' } });
});

module.exports = app;

// Start the server only when run directly (tests require the app instead).
if (require.main === module) {
  sessionStore.check()
    .then(() => models.sequelize.sync({ force: false }))
    .then(() => {
      const server = app.listen(PORT, () => {
        console.log(`Server is up and running on port: ${PORT} (session store: ${sessionStore.kind})`);
      });
      // Stop the prune timer and close DB pools on shutdown.
      const shutdown = () => server.close(() => {
        Promise.all([sessionStore.close(), models.sequelize.close()]).finally(() => process.exit(0));
      });
      process.once('SIGTERM', shutdown);
      process.once('SIGINT', shutdown);
    })
    .catch((err) => {
      console.error('Startup failed:', err.message);
      process.exit(1);
    });
}
