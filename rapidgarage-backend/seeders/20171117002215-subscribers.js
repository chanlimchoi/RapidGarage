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
    return queryInterface.bulkInsert('Subscribers', [{
        firstName: 'Charlie',
        lastName: 'Lee',
        email: 'sub1@test.com',
        zipCode: '11320',
         createdAt: new Date(),
    updatedAt: new Date()
      }, 
  {
        firstName: 'Kali',
        lastName: 'Bai',
        email: 'sub2@test.com',
       zipCode: '10032',
         createdAt: new Date(),
    updatedAt: new Date()
      },
  {
        firstName: 'Tries',
        lastName: 'Young',
        email: 'sub3@test.com',
        zipCode: '10232',
         createdAt: new Date(),
    updatedAt: new Date()
      },
  {
        firstName: 'Queen',
        lastName: 'Jane',
        email: 'sub4@test.com',
        zipCode: '11432',
         createdAt: new Date(),
    updatedAt: new Date()
      },
  {
        firstName: 'Hane',
        lastName: 'Joy',
        email: 'sub5@test.com',
       zipCode: '13032',
         createdAt: new Date(),
    updatedAt: new Date()
      },
  {
        firstName: 'East',
        lastName: 'Doe',
        email: 'sub6@test.com',
        zipCode: '10032',
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
    return queryInterface.bulkDelete('Subscribers', null, {});
  }
};
