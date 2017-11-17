'use strict';
module.exports = (sequelize, DataTypes) => {
  var Post = sequelize.define('Post', {
    street: DataTypes.STRING,
    city: DataTypes.STRING,
    zipCode: DataTypes.STRING,
    title: DataTypes.String,
    description: DataTypes.TEXT,
    userId: DataTypes.INTEGER,
    imagesUrl: DataTypes.STRING,
    startDate: DataTypes.DATE,
    endDate: DataTypes.DATE
  }, {
    classMethods: {
      associate: function(models) {
        Post.belongsTo(models.User);
      }
    }
  });
  return Post;
};
