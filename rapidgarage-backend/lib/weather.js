'use strict';
// Rain checks: the free, keyless Open-Meteo daily forecast for a sale's
// location (https://open-meteo.com, no account or API key). Optional and
// fail-safe: when it is turned off (WEATHER_ENABLED=false), unreachable, slow
// or returns junk, every caller simply gets "no forecast" and nothing else
// changes. Forecasts are cached in the database (WeatherForecasts) per ~1 km
// grid cell for WEATHER_CACHE_MINUTES (180), failures for 15 minutes, so a
// busy site makes at most a handful of requests per area per day, across
// instances. Only the sale's public coordinates are sent; never a person's.
const { Op } = require('sequelize');

function models() { return require('../models'); }
function intEnv(name, dflt, min, max) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : dflt;
}
const OFF = ['false', '0', 'off', 'no'];
const MIN = 60000;
const FAIL_MINUTES = 15;
const FORECAST_DAYS = 16;
const baseUrl = () => String(process.env.OPEN_METEO_URL || 'https://api.open-meteo.com/v1/forecast').trim();
const timeoutMs = () => intEnv('WEATHER_TIMEOUT_MS', 5000, 500, 30000);
const cacheMinutes = () => intEnv('WEATHER_CACHE_MINUTES', 180, 10, 1440);

let provider = null; // tests: async (url) => json
function setProvider(fn) { provider = fn || null; }

// Off when WEATHER_ENABLED is false-ish. Under NODE_ENV=test it's off unless a
// test installed a provider, so the suite never touches the network.
function enabled() {
  if (OFF.includes(String(process.env.WEATHER_ENABLED || '').trim().toLowerCase())) return false;
  if (process.env.NODE_ENV === 'test' && !provider) return false;
  return true;
}

// ~1 km cell: nearby sales share one cached forecast.
const cellKey = (lat, lng) => lat.toFixed(2) + ',' + lng.toFixed(2);

function forecastUrl(lat, lng) {
  const u = new URL(baseUrl());
  u.searchParams.set('latitude', lat.toFixed(2));
  u.searchParams.set('longitude', lng.toFixed(2));
  u.searchParams.set('daily', 'weather_code,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,temperature_2m_max');
  u.searchParams.set('timezone', 'auto');
  u.searchParams.set('forecast_days', String(FORECAST_DAYS));
  return u.toString();
}

async function fetchJson(url) {
  if (provider) return provider(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs());
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
// Open-Meteo daily JSON -> { 'YYYY-MM-DD': { code, pop, precip, wind, tmax } } (local dates at the place).
function parseDaily(json) {
  const d = json && json.daily;
  if (!d || !Array.isArray(d.time)) return null;
  const out = {};
  d.time.forEach((date, i) => {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const at = (k) => (Array.isArray(d[k]) ? num(d[k][i]) : null);
    out[date] = { code: at('weather_code'), pop: at('precipitation_probability_max'), precip: at('precipitation_sum'), wind: at('wind_speed_10m_max'), tmax: at('temperature_2m_max') };
  });
  return Object.keys(out).length ? out : null;
}

// Daily forecast for a place, from the cache or Open-Meteo. Never throws: null when unavailable.
async function forecastFor(lat, lng, now) {
  if (!enabled() || typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)) return null;
  const t = (now || new Date()).getTime();
  const key = cellKey(lat, lng);
  try {
    const m = models();
    const row = await m.WeatherForecast.findOne({ where: { cellKey: key } });
    if (row && row.fetchedAt && t - new Date(row.fetchedAt).getTime() < cacheMinutes() * MIN && (!row.failedAt || new Date(row.failedAt) < new Date(row.fetchedAt))) {
      try { return JSON.parse(row.days); } catch (e) { /* refetch */ }
    }
    if (row && row.failedAt && t - new Date(row.failedAt).getTime() < FAIL_MINUTES * MIN) {
      // Recently failed: serve a stale forecast (up to a day old) rather than nothing.
      if (row.fetchedAt && t - new Date(row.fetchedAt).getTime() < 24 * 60 * MIN) { try { return JSON.parse(row.days); } catch (e) { return null; } }
      return null;
    }
    let days = null;
    try { days = parseDaily(await fetchJson(forecastUrl(lat, lng))); } catch (err) { days = null; }
    if (!days) {
      if (row) await row.update({ failedAt: new Date(t) });
      else await m.WeatherForecast.create({ cellKey: key, days: '{}', fetchedAt: null, failedAt: new Date(t) }).catch(() => {});
      return null;
    }
    const values = { days: JSON.stringify(days), fetchedAt: new Date(t), failedAt: null };
    if (row) await row.update(values);
    else await m.WeatherForecast.create(Object.assign({ cellKey: key }, values)).catch(() => m.WeatherForecast.update(values, { where: { cellKey: key } }));
    return days;
  } catch (err) {
    console.error('Weather forecast failed:', err && err.message);
    return null;
  }
}

// WMO weather codes: 61-67 rain (63/65 moderate/heavy, 66/67 freezing), 71-77 snow,
// 80-82 showers, 85-86 snow showers, 95-99 thunderstorms.
const STORM = (c) => c >= 95 && c <= 99;
const SNOW = (c) => (c >= 71 && c <= 77) || c === 85 || c === 86;
const HEAVY_RAIN = (c) => [63, 65, 66, 67, 81, 82].includes(c);
const popMin = () => intEnv('RAIN_CHECK_POP', 60, 20, 100);

// One day's forecast -> { bad, reason: storm|snow|rain|wind|null, pop, code, tmax }.
function assess(day) {
  if (!day) return null;
  const c = day.code;
  let reason = null;
  if (c !== null && STORM(c)) reason = 'storm';
  else if (c !== null && SNOW(c)) reason = 'snow';
  else if ((c !== null && HEAVY_RAIN(c) && (day.pop === null || day.pop >= 40)) || (day.pop !== null && day.pop >= popMin() && (day.precip === null || day.precip >= 1))) reason = 'rain';
  else if (day.wind !== null && day.wind >= 50) reason = 'wind';
  return { bad: !!reason, reason, pop: day.pop, code: c, tmax: day.tmax };
}

// Forecast for a sale's upcoming days (the next FORECAST_DAYS days only).
// -> { days: [{ date, bad, reason, pop, code, tmax }], bad } | null (no forecast).
async function saleWeather(post, saleDays, now) {
  if (!post || post.hidden || typeof post.lat !== 'number' || typeof post.lng !== 'number') return null;
  const t = now || new Date();
  const upcoming = (saleDays || []).filter((d) => new Date(d.endsAt) > t && new Date(d.startsAt) < new Date(t.getTime() + FORECAST_DAYS * 24 * 60 * MIN));
  if (!upcoming.length) return null;
  const f = await forecastFor(post.lat, post.lng, t);
  if (!f) return null;
  const days = upcoming.map((d) => (f[d.date] ? Object.assign({ date: d.date }, assess(f[d.date])) : null)).filter(Boolean);
  if (!days.length) return null;
  return { days, bad: days.some((d) => d.bad) };
}

async function prune(now) {
  const t = (now || new Date()).getTime();
  return models().WeatherForecast.destroy({ where: { updatedAt: { [Op.lt]: new Date(t - 3 * 24 * 60 * MIN) } } });
}

module.exports = { enabled, setProvider, cellKey, forecastUrl, parseDaily, forecastFor, assess, saleWeather, prune, FORECAST_DAYS };
