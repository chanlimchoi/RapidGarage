'use strict';
// i18n: the language a user picked (en, es, ko, zh-CN). Null = not chosen yet;
// the web app then saves the language it detected from the browser.
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('Users', 'locale', { type: Sequelize.STRING(8), allowNull: true });
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn('Users', 'locale');
  },
};
