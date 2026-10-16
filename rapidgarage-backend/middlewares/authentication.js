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

// ---------------------------------------------------------------------------
// Sign in with Google (OAuth 2.0 / OpenID Connect).
// Enabled only when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.
// ---------------------------------------------------------------------------
function googleConfig() {
  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientID || !clientSecret) return null;
  return {
    clientID,
    clientSecret,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/auth/google/callback',
  };
}

function googleEmailVerified(profile) {
  const json = profile && profile._json;
  if (json && (json.email_verified === true || json.email_verified === 'true')) return true;
  const first = profile && profile.emails && profile.emails[0];
  return !!(first && first.verified === true && !json);
}

// Account linking rules (exported for tests):
//  1. A user with this googleId exists → log them in.
//  2. Google's email must be verified; otherwise refuse.
//  3. A local account with the same email exists → link the googleId to it,
//     unless that account is already linked to a different Google account.
//  4. Otherwise create a new user with no local password.
function handleGoogleProfile(profile) {
  const googleId = profile && profile.id ? String(profile.id) : null;
  if (!googleId) return Promise.resolve({ user: null, reason: 'invalid_profile' });
  return User.findOne({ where: { googleId } }).then((existing) => {
    if (existing) return { user: existing, reason: 'existing' };
    const email = profile.emails && profile.emails[0] && profile.emails[0].value;
    if (!email || !googleEmailVerified(profile)) return { user: null, reason: 'email_not_verified' };
    const normalized = String(email).trim().toLowerCase();
    return User.findOne({ where: { email: normalized } }).then((byEmail) => {
      if (byEmail) {
        // googleId is excluded from toJSON but present on the instance.
        if (byEmail.get('googleId') && byEmail.get('googleId') !== googleId) {
          return { user: null, reason: 'linked_to_other_google_account' };
        }
        return byEmail.update({ googleId }).then((u) => ({ user: u, reason: 'linked' }));
      }
      const name = profile.name || {};
      return User.create({
        email: normalized,
        googleId,
        password: null,
        firstName: name.givenName || profile.displayName || normalized.split('@')[0],
        lastName: name.familyName || null,
      }).then((u) => ({ user: u, reason: 'created' }));
    });
  });
}

let googleRegistered = false;
function ensureGoogleStrategy() {
  const config = googleConfig();
  if (!config) return false;
  if (!googleRegistered) {
    const GoogleStrategy = require('passport-google-oauth20').Strategy;
    passport.use('google', new GoogleStrategy(Object.assign({ state: true }, config), (accessToken, refreshToken, profile, done) => {
      handleGoogleProfile(profile)
        // Google emails are verified (checked in handleGoogleProfile), so they may bootstrap an admin.
        .then(({ user, reason }) => (user
          ? require('../lib/roles').applyAdminBootstrap(user, true).then((u) => done(null, u))
          : done(null, false, { message: reason })))
        .catch(done);
    }));
    googleRegistered = true;
  }
  return true;
}

passport.handleGoogleProfile = handleGoogleProfile;
passport.ensureGoogleStrategy = ensureGoogleStrategy;
passport.googleConfig = googleConfig;
