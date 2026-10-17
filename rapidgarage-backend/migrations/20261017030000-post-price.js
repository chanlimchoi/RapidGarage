'use strict';
// Optional price range (whole US dollars) and a "free" flag on posts.
module.exports = {
  up: (queryInterface, Sequelize) => queryInterface.addColumn('Posts', 'priceMin', { type: Sequelize.INTEGER, allowNull: true })
    .then(() => queryInterface.addColumn('Posts', 'priceMax', { type: Sequelize.INTEGER, allowNull: true }))
    .then(() => queryInterface.addColumn('Posts', 'isFree', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false }))
    .then(() => queryInterface.addIndex('Posts', ['priceMin'], { name: 'posts_price_min_idx' })),
  down: (queryInterface) => queryInterface.removeIndex('Posts', 'posts_price_min_idx')
    .then(() => queryInterface.removeColumn('Posts', 'isFree'))
    .then(() => queryInterface.removeColumn('Posts', 'priceMax'))
    .then(() => queryInterface.removeColumn('Posts', 'priceMin')),
};
