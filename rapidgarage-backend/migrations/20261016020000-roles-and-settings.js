'use strict';
// Admin role + persisted app settings.
module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.addColumn('Users', 'role', { type: Sequelize.STRING, allowNull: false, defaultValue: 'user' })
      .then(() => queryInterface.createTable('Settings', {
        key: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
        value: { type: Sequelize.TEXT, allowNull: true },
        createdAt: { allowNull: false, type: Sequelize.DATE },
        updatedAt: { allowNull: false, type: Sequelize.DATE },
      }));
  },
  down: (queryInterface) => {
    return queryInterface.dropTable('Settings')
      .then(() => queryInterface.removeColumn('Users', 'role'));
  },
};
