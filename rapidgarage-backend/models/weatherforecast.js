'use strict';
// Cached Open-Meteo daily forecasts per ~1 km grid cell (lib/weather.js).
module.exports = (sequelize, DataTypes) => {
  const WeatherForecast = sequelize.define('WeatherForecast', {
    cellKey: { type: DataTypes.STRING(32), allowNull: false, unique: true },
    // JSON: { 'YYYY-MM-DD': { code, pop, precip, wind, tmax } }
    days: { type: DataTypes.TEXT, allowNull: false, defaultValue: '{}' },
    fetchedAt: { type: DataTypes.DATE, allowNull: true },
    failedAt: { type: DataTypes.DATE, allowNull: true },
  });
  return WeatherForecast;
};
