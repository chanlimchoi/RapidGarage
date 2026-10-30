'use strict';
// "This weekend" calendar: a night-before reminder for saved sales with
// "Remind me" on (lib/eveReminders.js). Per-person switch, on by default.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Users', 'remindEve', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('Users', 'remindEve');
  },
};
