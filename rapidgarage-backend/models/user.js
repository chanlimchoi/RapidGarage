'use strict';
const bcrypt = require('bcrypt-nodejs');

module.exports = (sequelize, DataTypes) => {
  var User = sequelize.define('User', {
    firstName: DataTypes.STRING,
    lastName: DataTypes.STRING,
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    password: DataTypes.STRING
  }, {
    // Never load the password hash unless explicitly asked for (login only).
    defaultScope: {
      attributes: { exclude: ['password'] },
    },
    scopes: {
      withPassword: {},
    },
  });

  User.beforeCreate((user) =>
    new sequelize.Promise((resolve) => {
      bcrypt.hash(user.password, null, null, (err, hashedPassword) => {
        resolve(hashedPassword);
      });
    }).then((hashedPassword) => {
      user.password = hashedPassword;
    })
  );

  User.associate = (models) => {
    User.hasMany(models.Post, { foreignKey: 'userId', onDelete: 'CASCADE' });
  };

  // Belt and braces: strip the hash from any instance that is serialized.
  User.prototype.toJSON = function() {
    const values = Object.assign({}, this.get());
    delete values.password;
    return values;
  };

  return User;
};
