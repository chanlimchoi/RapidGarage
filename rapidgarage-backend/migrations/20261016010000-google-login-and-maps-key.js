'use strict';
// Sign in with Google + per-user (bring-your-own) Google Maps key.
module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.addColumn('Users', 'googleId', { type: Sequelize.STRING, allowNull: true })
      .then(() => queryInterface.addConstraint('Users', { fields: ['googleId'], type: 'unique', name: 'users_google_id_unique' }))
      .then(() => queryInterface.addColumn('Users', 'mapsKeyEncrypted', { type: Sequelize.TEXT, allowNull: true }))
      .then(() => queryInterface.addColumn('Users', 'mapsKeyLast4', { type: Sequelize.STRING(4), allowNull: true }))
      // Google-only accounts have no local password.
      .then(() => queryInterface.changeColumn('Users', 'password', { type: Sequelize.STRING, allowNull: true }));
  },
  down: (queryInterface) => {
    return queryInterface.removeColumn('Users', 'mapsKeyLast4')
      .then(() => queryInterface.removeColumn('Users', 'mapsKeyEncrypted'))
      .then(() => queryInterface.removeConstraint('Users', 'users_google_id_unique'))
      .then(() => queryInterface.removeColumn('Users', 'googleId'));
  },
};
