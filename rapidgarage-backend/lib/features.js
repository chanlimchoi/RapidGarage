// App settings and feature flags.
// Env vars give the *initial default*; once an admin saves a value in the
// Settings table (PUT /admin/settings), the stored value wins.
const OFF = ['0', 'false', 'off', 'no', 'disabled'];

function envFlag(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return defaultValue;
  return OFF.indexOf(String(raw).trim().toLowerCase()) === -1;
}

// Known settings: name -> { type, default() }
const SETTINGS = {
  userMapsKeys: { type: 'boolean', default: () => envFlag('ENABLE_USER_MAPS_KEYS', true) },
  // Email alerts for new nearby sales (admin kill switch).
  saleAlerts: { type: 'boolean', default: () => envFlag('ENABLE_SALE_ALERTS', true) },
  // Wanted posts: the board, new posts, contacting and match notifications.
  wantedPosts: { type: 'boolean', default: () => envFlag('ENABLE_WANTED_POSTS', true) },
  // "Draft items from photos" with Claude (also needs ANTHROPIC_API_KEY).
  aiItems: { type: 'boolean', default: () => envFlag('ENABLE_AI_ITEMS', true) },
  // Let people use their own Anthropic key for it (saved encrypted, or one-time).
  userAiKeys: { type: 'boolean', default: () => envFlag('ENABLE_USER_AI_KEYS', true) },
  // AI-assisted listing review for admins (lib/aiReview.js; needs ANTHROPIC_API_KEY).
  aiReview: { type: 'boolean', default: () => envFlag('ENABLE_AI_REVIEW', true) },
};

function models() {
  return require('../models');
}

function getSetting(name) {
  const def = SETTINGS[name];
  if (!def) return Promise.reject(new Error('Unknown setting ' + name));
  return models().Setting.findByPk(name).then((row) => {
    if (!row || row.value === null) return def.default();
    try { return JSON.parse(row.value); } catch (e) { return def.default(); }
  });
}

function getAllSettings() {
  const names = Object.keys(SETTINGS);
  return Promise.all(names.map(getSetting)).then((values) => {
    const out = {};
    names.forEach((n, i) => { out[n] = values[i]; });
    return out;
  });
}

function setSetting(name, value) {
  return models().Setting.upsert({ key: name, value: JSON.stringify(value) });
}

const userMapsKeysEnabled = () => getSetting('userMapsKeys');
const saleAlertsEnabled = () => getSetting('saleAlerts');
const wantedEnabled = () => getSetting('wantedPosts');
// On only when the admin switch is on and the server has an Anthropic key.
// Item drafts (lib/aiItems.js): on when the admin switch is on and there is a
// key to use: the site's (ANTHROPIC_API_KEY) or, if allowed, the person's own.
async function aiStatus() {
  const [on, own] = await Promise.all([getSetting('aiItems'), getSetting('userAiKeys')]);
  const site = on && require('./aiItems').isConfigured();
  const userKeys = on && own;
  return { enabled: site || userKeys, site, userKeys, userKeySave: userKeys && require('./secretBox').isConfigured() };
}
const aiItemsEnabled = () => aiStatus().then((s) => s.enabled);
const userAiKeysEnabled = () => aiStatus().then((s) => s.userKeys);

module.exports = { envFlag, SETTINGS, getSetting, getAllSettings, setSetting, userMapsKeysEnabled, saleAlertsEnabled, wantedEnabled, aiItemsEnabled, userAiKeysEnabled, aiStatus };
