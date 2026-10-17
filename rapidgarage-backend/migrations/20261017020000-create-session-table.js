'use strict';
// express-session store table for connect-pg-simple (same layout as its
// table.sql). Created here instead of createTableIfMissing so the app's DB
// role needs no DDL rights at runtime and the schema is versioned.
module.exports = {
  up: (queryInterface, Sequelize) => queryInterface.createTable('session', {
    sid: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
    sess: { type: Sequelize.JSON, allowNull: false },
    expire: { type: 'TIMESTAMP(6)', allowNull: false },
  }).then(() => queryInterface.addIndex('session', ['expire'], { name: 'IDX_session_expire' })),
  down: (queryInterface) => queryInterface.dropTable('session'),
};
