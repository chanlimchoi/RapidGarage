require('dotenv').config();
const bodyParser = require('body-parser');
const express = require('express');
const expressSession = require('express-session');
const passport = require('./middlewares/authentication');
const models = require('./models');

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

// Enable sessions & passport
app.use(expressSession({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
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



// Load up all of the controllers
const controllers = require('./controllers');
app.use(controllers);


// First, make sure the Database tables and models are in sync
// then, start up the server and start listening.
models.sequelize.sync({force: false})
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server is up and running on port: ${PORT}`)
    });
  });
