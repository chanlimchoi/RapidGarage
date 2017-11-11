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
  return queryInterface.bulkInsert('Posts', [{
        address: '485 10th Ave',
        city: 'New York',
        zipCode: '10018',
        description: 'The first user',
        userId:'1',
         createdAt: new Date(),
    updatedAt: new Date()
      }, 
  {
        address: '431 W 37th St',
        city: 'New York',
        zipCode: '10018',
        description: 'The second user',
        userId:'2',
         createdAt: new Date(),
    updatedAt: new Date()
      },
  {
        address: '225 W 37th St',
        city: 'New York',
        zipCode: '10018',
        description: 'The third user',
        userId:'3',
         createdAt: new Date(),
    updatedAt: new Date()
      },
  {
         address: '1564 1st Avenue',
        city: 'New York',
        zipCode: '10028',
        description: 'The fourth user',
        userId:'4',
         createdAt: new Date(),
    updatedAt: new Date()
      },
  {
         address: '1556 2nd Ave',
        city: 'New York',
        zipCode: '10028',
        description: 'The fifth user',
        userId:'5',
         createdAt: new Date(),
    updatedAt: new Date()
      },
  {
        address: '2245 Broadway',
        city: 'New York',
        zipCode: '10024',
        description: 'The sixth user',
        userId:'6',
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
    return queryInterface.bulkDelete('Posts', null, {});
  }
};
