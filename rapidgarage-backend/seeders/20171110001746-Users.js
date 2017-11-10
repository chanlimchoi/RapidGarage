'use strict';

module.exports = {
  up: (queryInterface, Sequelize) => {
    /*
      Add altering commands here.
      Return a promise to correctly handle asynchronicity.

      Example:
      return queryInterface.bulkInsert('Person', [{
        name: 'John Doe',
        isBetaMember: false
      }], {});
    */
    return queryInterface.bulkInsert('Users', [{
        firstName: 'John',
        lastName: 'Doe',
        email: 'test1@test.com',
        password: '111',
         createdAt: new Date(),
    updatedAt: new Date()
      }, 
  {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'test2@test.com',
        password: '222',
         createdAt: new Date(),
    updatedAt: new Date()
      },
  {
        firstName: 'Troy',
        lastName: 'Doe',
        email: 'test3@test.com',
        password: '333',
         createdAt: new Date(),
    updatedAt: new Date()
      },
  {
        firstName: 'Tiger',
        lastName: 'Doe',
        email: 'test4@test.com',
        password: '444',
         createdAt: new Date(),
    updatedAt: new Date()
      },
  {
        firstName: 'Dragon',
        lastName: 'Doe',
        email: 'test5@test.com',
        password: '555',
         createdAt: new Date(),
    updatedAt: new Date()
      },
  {
        firstName: 'West',
        lastName: 'Doe',
        email: 'test6@test.com',
        password: '666',
         createdAt: new Date(),
    updatedAt: new Date()
      }],
  {});
  },

  down: (queryInterface, Sequelize) => {
    /*
      Add reverting commands here.
      Return a promise to correctly handle asynchronicity.

      Example:
      return queryInterface.bulkDelete('Person', null, {});
    */
    return queryInterface.bulkDelete('Users', null, {});
  }
};
