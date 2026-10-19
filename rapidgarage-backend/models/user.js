'use strict';
// Maintained, pure-JS drop-in for bcrypt-nodejs (unmaintained since 2016).
// Same compareSync; the hash() callback signature is (data, salt, cb).
const bcrypt = require('bcryptjs');

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
    // Set by a moderator: can still read conversations but not send or start them.
    messagingBanned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    messagingBannedAt: { type: DataTypes.DATE, allowNull: true },
    // UI, email and flyer language: 'en' | 'es' | 'ko' | 'zh-CN' (lib/i18n.js); null = not chosen.
    // New saved sales get a morning-of reminder (lib/reminders.js).
    remindSaved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    locale: { type: DataTypes.STRING(8), allowNull: true, validate: { isIn: [['en', 'es', 'ko', 'zh-CN']] } },
    // Bumped when the password is reset or changed; sessions made under an
    // older value are signed out (middlewares/authentication.js).
    authVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    // Bring-your-own Anthropic key (lib/userAiKey.js), encrypted and bound to
    // this row; never serialized. Load only via scope('withAiKey').
    aiKeyEncrypted: { type: DataTypes.TEXT, allowNull: true },
    aiKeyLast4: { type: DataTypes.STRING(4), allowNull: true },
    aiKeySetAt: { type: DataTypes.DATE, allowNull: true },
    // Push notification choices (lib/push.js); devices are PushSubscriptions.
    pushMessages: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    pushFollows: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    pushReminders: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    // When the address was confirmed (lib/emailVerify.js); Google sign-in counts.
    emailVerifiedAt: { type: DataTypes.DATE, allowNull: true },
  }, {
    // Never load the password hash unless explicitly asked for (login only).
    // The encrypted Maps key is excluded too; load it only via scope('withMapsKey').
    defaultScope: {
      attributes: { exclude: ['password', 'mapsKeyEncrypted', 'aiKeyEncrypted'] },
    },
    scopes: {
      withPassword: { attributes: { exclude: ['mapsKeyEncrypted', 'aiKeyEncrypted'] } },
      withMapsKey: { attributes: { exclude: ['password', 'aiKeyEncrypted'] } },
      withAiKey: { attributes: { exclude: ['password', 'mapsKeyEncrypted'] } },
    },
  });

  const SALT_ROUNDS = 10;
  User.hashPassword = (plain) => new Promise((resolve, reject) => {
    // bcryptjs takes (data, salt, callback); pass the cost the old
    // bcrypt-nodejs default used. Hashes stay `$2a$`-compatible.
    bcrypt.hash(plain, SALT_ROUNDS, (err, hashedPassword) => (err ? reject(err) : resolve(hashedPassword)));
  });

  User.beforeCreate((user) => {
    if (user.password === null || user.password === undefined) return undefined;
    return User.hashPassword(user.password).then((hashedPassword) => {
      user.password = hashedPassword;
    });
  });

  // New passwords set through update() (reset, change) are hashed the same way.
  User.beforeUpdate((user) => {
    if (!user.changed('password') || user.password === null || user.password === undefined) return undefined;
    return User.hashPassword(user.password).then((hashedPassword) => {
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
    delete values.authVersion;
    delete values.aiKeyEncrypted;
    delete values.aiKeyLast4;
    delete values.aiKeySetAt;
    values.hasAiKey = !!this.get('aiKeyLast4');
    values.hasMapsKey = !!values.mapsKeyLast4;
    return values;
  };

  return User;
};
