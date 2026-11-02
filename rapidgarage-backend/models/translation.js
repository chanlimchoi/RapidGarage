// Cached machine translation of one text (lib/translate.js).
module.exports = (sequelize, DataTypes) => {
  const Translation = sequelize.define('Translation', {
    hash: { type: DataTypes.STRING(64), allowNull: false },
    source: { type: DataTypes.STRING(10), allowNull: false },
    target: { type: DataTypes.STRING(10), allowNull: false },
    text: { type: DataTypes.TEXT, allowNull: false },
  }, {
    indexes: [
      { name: 'translations_hash_uniq', unique: true, fields: ['hash'] },
      { name: 'translations_created_idx', fields: ['createdAt'] },
    ],
  });
  return Translation;
};
