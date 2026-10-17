'use strict';
// Stored coordinates for map/distance search (filled by server-side geocoding).
module.exports = {
  up: (queryInterface, Sequelize) => queryInterface.addColumn('Posts', 'lat', { type: Sequelize.DOUBLE, allowNull: true })
    .then(() => queryInterface.addColumn('Posts', 'lng', { type: Sequelize.DOUBLE, allowNull: true }))
    .then(() => queryInterface.addColumn('Posts', 'geocodeStatus', { type: Sequelize.STRING(16), allowNull: true }))
    .then(() => queryInterface.addColumn('Posts', 'geocodedAt', { type: Sequelize.DATE, allowNull: true }))
    .then(() => queryInterface.addIndex('Posts', ['lat', 'lng'], { name: 'posts_lat_lng_idx' })),
  down: (queryInterface) => queryInterface.removeIndex('Posts', 'posts_lat_lng_idx')
    .then(() => queryInterface.removeColumn('Posts', 'geocodedAt'))
    .then(() => queryInterface.removeColumn('Posts', 'geocodeStatus'))
    .then(() => queryInterface.removeColumn('Posts', 'lng'))
    .then(() => queryInterface.removeColumn('Posts', 'lat')),
};
