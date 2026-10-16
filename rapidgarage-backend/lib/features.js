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

module.exports = { envFlag, SETTINGS, getSetting, getAllSettings, setSetting, userMapsKeysEnabled };
