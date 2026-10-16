'use strict';
// Data-model fixes (new migration; older migrations are left untouched):
//  - Subscribers.zipCode INTEGER -> STRING (keeps leading zeros)
//  - Users.email NOT NULL + unique
//  - Posts.userId NOT NULL with FK to Users(id) ON DELETE CASCADE
// Run after de-duplicating any duplicate emails / orphaned posts.
module.exports = {
  up: (queryInterface, Sequelize) => {
    return queryInterface.changeColumn('Subscribers', 'zipCode', { type: Sequelize.STRING })
      .then(() => queryInterface.changeColumn('Users', 'email', { type: Sequelize.STRING, allowNull: false }))
      .then(() => queryInterface.addConstraint('Users', ['email'], { type: 'unique', name: 'users_email_unique' }))
      .then(() => queryInterface.sequelize.query('ALTER TABLE "Posts" DROP CONSTRAINT IF EXISTS "Posts_userId_fkey"'))
      .then(() => queryInterface.changeColumn('Posts', 'userId', { type: Sequelize.INTEGER, allowNull: false }))
      .then(() => queryInterface.addConstraint('Posts', ['userId'], {
        type: 'foreign key',
        name: 'Posts_userId_fkey',
        references: { table: 'Users', field: 'id' },
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }));
  },
  down: (queryInterface, Sequelize) => {
    return queryInterface.removeConstraint('Posts', 'Posts_userId_fkey')
      .then(() => queryInterface.changeColumn('Posts', 'userId', { type: Sequelize.INTEGER, allowNull: true }))
      .then(() => queryInterface.sequelize.query('ALTER TABLE "Posts" ADD CONSTRAINT "Posts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users" ("id")'))
      .then(() => queryInterface.removeConstraint('Users', 'users_email_unique'))
      .then(() => queryInterface.changeColumn('Users', 'email', { type: Sequelize.STRING, allowNull: true }))
      .then(() => queryInterface.sequelize.query('ALTER TABLE "Subscribers" ALTER COLUMN "zipCode" TYPE INTEGER USING "zipCode"::integer'));
  },
};
