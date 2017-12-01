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
        password: '$2a$10$VfAUOxF.6f3m489lhtidjuwtburpGBgifx767z/ZNqr7jAvEnvUOW',
         createdAt: new Date(),
    updatedAt: new Date()
      }, 
  {
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'test2@test.com',
        password: '$2a$10$5kJYqwTPREki7.JMQhQuAuoy5Mngrzk/Q85pfin0b1xnor7Ksi41S',
         createdAt: new Date(),
    updatedAt: new Date()
      },
  {
        firstName: 'Troy',
        lastName: 'Doe',
        email: 'test3@test.com',
        password: '$2a$10$70ZLjIwOkQZZ2cPwFcaQMO7tL/q/Iv9jp1ZBWTzXT/D4AqJCIbsu6',
         createdAt: new Date(),
    updatedAt: new Date()
      },
  {
        firstName: 'Tiger',
        lastName: 'Doe',
        email: 'test4@test.com',
        password: '$2a$10$G.A.pAl4F/34R6AB/C4yj.b9KCSu0W0Qj4tkg0WGh/wbjZCaoAeIG',
         createdAt: new Date(),
    updatedAt: new Date()
      },
  {
        firstName: 'Dragon',
        lastName: 'Doe',
        email: 'test5@test.com',
        password: '$2a$10$HMOoRAUpe7KIHV7bnTbG..BBuxlFNe5k0IQaL6X5pFFWYJ3cLdPoO',
         createdAt: new Date(),
    updatedAt: new Date()
      },
  {
        firstName: 'West',
        lastName: 'Doe',
        email: 'test6@test.com',
        password: '$2a$10$a31DzyXqPr4a5OfLai3sGehrLH5yj2P7//hzV.s3bdGg8HdgAomz6',
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