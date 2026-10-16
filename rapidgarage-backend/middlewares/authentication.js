const bcrypt = require('bcrypt-nodejs');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;

const User = require('../models').User;

function passwordsMatch(passwordSubmitted, storedPassword) {
  if (typeof passwordSubmitted !== 'string' || typeof storedPassword !== 'string') {
    return false;
  }
  try {
    return bcrypt.compareSync(passwordSubmitted, storedPassword);
  } catch (err) {
    // Malformed stored hash: treat as a failed login instead of crashing.
    return false;
  }
}

passport.use(new LocalStrategy({
    usernameField: 'email',
  },
  (email, password, done) => {
    if (typeof email !== 'string' || typeof password !== 'string') {
      return done(null, false, { message: 'Incorrect email or password.' });
    }
    User.scope('withPassword').findOne({
      where: { email },
    }).then((user) => {

      if(!user) {
        return done(null, false, { message: 'Incorrect email.' });
      }

      if (passwordsMatch(password, user.password) === false) {
        return done(null, false, { message: 'Incorrect password.' });
      }

      return done(null, user, { message: 'Successfully Logged In!' });
    }).catch(done);
  })
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  User.findById(id).then((user) => {
    if (!user) {
      return done(null, false);
    }

    return done(null, user);
  }).catch(done);
});
// 
// passport.redirectIfLoggedIn = (route) =>
//   (req, res, next) => (req.user ? res.redirect(route) : next());
//
// passport.redirectIfNotLoggedIn = (route) =>
//   (req, res, next) => (req.user ? next() : res.redirect(route));

module.exports = passport;
