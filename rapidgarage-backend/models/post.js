'use strict';
module.exports = (sequelize, DataTypes) => {
  var Post = sequelize.define('Post', {
    street: DataTypes.STRING,
    city: DataTypes.STRING,
    state: DataTypes.STRING,
    zipCode: DataTypes.STRING,
    title: DataTypes.STRING,
    description: DataTypes.TEXT,
    userId: { type: DataTypes.INTEGER, allowNull: false },
    imagesUrl: DataTypes.STRING,
    startDate: DataTypes.DATE,
    endDate: DataTypes.DATE
  });

  // Sequelize 4 ignores classMethods; associations must be set like this.
  Post.associate = (models) => {
    Post.belongsTo(models.User, { foreignKey: 'userId', onDelete: 'CASCADE' });
  };
  return Post;
};
