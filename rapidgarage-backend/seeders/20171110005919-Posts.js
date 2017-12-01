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
        street: '485 10th Ave',
        city: 'New York',
        state: 'NY',
        zipCode: '10018',
        title: 'Great sales by John',
        description: 'The first user',
        userId:'1',
         createdAt: new Date(),
    updatedAt: new Date()
      }, 
  {
        street: '431 W 37th St',
        city: 'New York',
         state: 'NY',
        zipCode: '10018',
        title: 'Great sales by Jane',
        description: 'The second user',
        userId:'2',
         createdAt: new Date(),
    updatedAt: new Date()
      },
  {
        street: '225 W 37th St',
        city: 'New York',
         state: 'NY',
        zipCode: '10018',
        title: 'Great sales by Troy',
        description: 'The third user',
        userId:'3',
         createdAt: new Date(),
    updatedAt: new Date()
      },
  {
         street: '1564 1st Avenue',
        city: 'New York',
         state: 'NY',
        zipCode: '10028',
        title: 'Great sales by Tiger',
        description: 'The fourth user',
        userId:'4',
         createdAt: new Date(),
    updatedAt: new Date()
      },
  {
         street: '1556 2nd Ave',
        city: 'New York',
         state: 'NY',
        zipCode: '10028',
        title: 'Great sales by Dragon',
        description: 'The fifth user',
        userId:'5',
         createdAt: new Date(),
    updatedAt: new Date()
      },
  {
        street: '2245 Broadway',
        city: 'New York',
         state: 'NY',
        zipCode: '10024',
        title: 'Great sales by West',
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
