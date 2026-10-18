// Sequelize + sequelize-cli config (see .sequelizerc). Replaces config.json so
// production can turn on TLS (DATABASE_SSL) and quiet SQL logging.
require('dotenv').config();
const { sslOption } = require('../lib/dbSsl');

const on = (v) => /^(1|true|on|yes)$/i.test(String(v || '').trim());

function postgres(defaultLogging) {
  const cfg = { use_env_variable: 'DATABASE_URL', dialect: 'postgres' };
  const ssl = sslOption();
  if (ssl) cfg.dialectOptions = { ssl };
  // Development logs every SQL statement (as before); production does not
  // unless DB_LOG_SQL=true.
  if (process.env.DB_LOG_SQL !== undefined) cfg.logging = on(process.env.DB_LOG_SQL) ? console.log : false;
  else if (!defaultLogging) cfg.logging = false;
  const max = parseInt(process.env.DB_POOL_MAX, 10);
  if (max > 0) cfg.pool = { max };
  return cfg;
}

module.exports = {
  development: postgres(true),
  // Tests never read DATABASE_URL (a dev or live .env may set it). In-memory
  // SQLite by default; Postgres only via TEST_DATABASE_URL, and test/setup.js
  // still refuses it unless the name ends in _test/_e2e and RG_ALLOW_TEST_PG=1.
  test: process.env.TEST_DATABASE_URL
    ? Object.assign(postgres(false), { use_env_variable: 'TEST_DATABASE_URL', logging: false })
    : { dialect: 'sqlite', storage: process.env.TEST_SQLITE_FILE || ':memory:', logging: false },
  production: postgres(false),
};
