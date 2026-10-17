// Outgoing mail via nodemailer + SMTP from env. When SMTP_HOST is unset the
// mailer reports "not configured" and callers skip sending (the app keeps working).
const nodemailer = require('nodemailer');

let transport = null;
let transportKey = null;
let override = null; // tests: setTransport({ sendMail })

function smtpConfig() {
  const host = String(process.env.SMTP_HOST || '').trim();
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  const secureEnv = String(process.env.SMTP_SECURE || '').trim().toLowerCase();
  const secure = secureEnv ? ['1', 'true', 'yes', 'on'].indexOf(secureEnv) !== -1 : port === 465;
  const user = String(process.env.SMTP_USER || '').trim();
  const cfg = { host, port, secure, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000 };
  if (user) cfg.auth = { user, pass: process.env.SMTP_PASS || '' };
  return cfg;
}

function fromAddress() {
  return String(process.env.SMTP_FROM || '').trim() || 'RapidGarage <no-reply@localhost>';
}

function isConfigured() {
  return !!override || !!smtpConfig();
}

function getTransport() {
  if (override) return override;
  const cfg = smtpConfig();
  if (!cfg) return null;
  const key = JSON.stringify([cfg.host, cfg.port, cfg.secure, cfg.auth && cfg.auth.user]);
  if (!transport || key !== transportKey) {
    transport = nodemailer.createTransport(cfg);
    transportKey = key;
  }
  return transport;
}

// Resolves to nodemailer's info; rejects on SMTP errors.
async function send(message) {
  const t = getTransport();
  if (!t) {
    const err = new Error('SMTP is not configured');
    err.code = 'smtp_not_configured';
    throw err;
  }
  return t.sendMail(Object.assign({ from: fromAddress() }, message));
}

function setTransport(t) { override = t || null; }

module.exports = { smtpConfig, fromAddress, isConfigured, send, setTransport };
