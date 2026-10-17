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
  test: { dialect: 'sqlite', storage: ':memory:', logging: false },
  production: postgres(false),
};
