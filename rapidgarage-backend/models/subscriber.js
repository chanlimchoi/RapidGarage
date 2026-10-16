'use strict';
module.exports = (sequelize, DataTypes) => {
  var Subscriber = sequelize.define('Subscriber', {
    firstName: DataTypes.STRING,
    lastName: DataTypes.STRING,
    email: DataTypes.STRING,
    zipCode: DataTypes.STRING
  });
  return Subscriber;
};
