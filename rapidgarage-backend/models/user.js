'use strict';
const bcrypt = require('bcrypt-nodejs');

module.exports = (sequelize, DataTypes) => {
  var User = sequelize.define('User', {
    firstName: DataTypes.STRING,
    lastName: DataTypes.STRING,
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    // Null for accounts created through Google sign-in (no local password).
    password: { type: DataTypes.STRING, allowNull: true },
    googleId: { type: DataTypes.STRING, allowNull: true, unique: true },
    // Per-user Google Maps browser key, AES-256-GCM encrypted (lib/secretBox.js).
    mapsKeyEncrypted: { type: DataTypes.TEXT, allowNull: true },
    // Last 4 characters only, for display ("…abcd"). Not secret.
    mapsKeyLast4: { type: DataTypes.STRING(4), allowNull: true },
    role: { type: DataTypes.STRING, allowNull: false, defaultValue: 'user', validate: { isIn: [['user', 'admin']] } },
  }, {
    // Never load the password hash unless explicitly asked for (login only).
    // The encrypted Maps key is excluded too; load it only via scope('withMapsKey').
    defaultScope: {
      attributes: { exclude: ['password', 'mapsKeyEncrypted'] },
    },
    scopes: {
      withPassword: { attributes: { exclude: ['mapsKeyEncrypted'] } },
      withMapsKey: { attributes: { exclude: ['password'] } },
    },
  });

  User.beforeCreate((user) => {
    if (user.password === null || user.password === undefined) return undefined;
    return new sequelize.Promise((resolve) => {
      bcrypt.hash(user.password, null, null, (err, hashedPassword) => {
        resolve(hashedPassword);
      });
    }).then((hashedPassword) => {
      user.password = hashedPassword;
    });
  });

  User.associate = (models) => {
    User.hasMany(models.Post, { foreignKey: 'userId', onDelete: 'CASCADE' });
  };

  // Belt and braces: strip the hash from any instance that is serialized.
  User.prototype.toJSON = function() {
    const values = Object.assign({}, this.get());
    delete values.password;
    delete values.mapsKeyEncrypted;
    delete values.googleId;
    values.hasMapsKey = !!values.mapsKeyLast4;
    return values;
  };

  return User;
};
