// TLS to Postgres, shared by Sequelize (config/config.js), the session store
// pool and the release/precheck scripts. Managed databases often need it:
//   DATABASE_SSL=off        plain connection (default; fine on a private network)
//   DATABASE_SSL=verify     TLS, certificate checked against system CAs or
//                           DATABASE_SSL_CA (PEM; literal "\n" allowed)
//   DATABASE_SSL=no-verify  TLS without certificate check ("require" in libpq
//                           terms); encrypted but not protected against MITM
function sslOption(env) {
  const e = env || process.env;
  const v = String(e.DATABASE_SSL || '').trim().toLowerCase();
  if (!v || ['off', 'false', '0', 'no', 'disable'].includes(v)) return null;
  if (['no-verify', 'noverify', 'require'].includes(v)) return { rejectUnauthorized: false };
  if (['verify', 'verify-full', 'true', 'on', '1'].includes(v)) {
    const opt = { rejectUnauthorized: true };
    if (e.DATABASE_SSL_CA) opt.ca = String(e.DATABASE_SSL_CA).replace(/\\n/g, '\n');
    return opt;
  }
  throw new Error('DATABASE_SSL must be one of: off, verify, no-verify');
}

module.exports = { sslOption };
