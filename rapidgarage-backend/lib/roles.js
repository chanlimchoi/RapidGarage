// Roles and admin bootstrap.
const ROLES = ['user', 'admin'];

// ADMIN_EMAILS: comma-separated list of emails that are made admins on login.
function adminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Local signup/login has no email verification, so by default only a
// *verified* Google email can bootstrap an admin. ADMIN_BOOTSTRAP_LOCAL=true
// also allows local accounts (only safe if nobody else can register that email
// first, e.g. on a fresh install).
function localBootstrapAllowed() {
  return ['1', 'true', 'yes', 'on'].indexOf(String(process.env.ADMIN_BOOTSTRAP_LOCAL || '').trim().toLowerCase()) !== -1;
}

// Promote `user` if their email is listed. `verified` = email ownership proven.
// Never demotes (removing someone from ADMIN_EMAILS is done via the admin UI).
function applyAdminBootstrap(user, verified) {
  if (!user || user.role === 'admin') return Promise.resolve(user);
  if (!verified && !localBootstrapAllowed()) return Promise.resolve(user);
  const email = String(user.email || '').toLowerCase();
  if (adminEmails().indexOf(email) === -1) return Promise.resolve(user);
  return user.update({ role: 'admin' });
}

function isAdmin(user) {
  return !!user && user.role === 'admin';
}

module.exports = { ROLES, adminEmails, applyAdminBootstrap, isAdmin, localBootstrapAllowed };
