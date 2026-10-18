'use strict';
const { publicUrl } = require('../lib/storage');

module.exports = (sequelize, DataTypes) => {
  const PostPhoto = sequelize.define('PostPhoto', {
    postId: { type: DataTypes.INTEGER, allowNull: false },
    storageKey: { type: DataTypes.STRING, allowNull: false },
    thumbKey: { type: DataTypes.STRING, allowNull: false },
    width: { type: DataTypes.INTEGER, allowNull: false },
    height: { type: DataTypes.INTEGER, allowNull: false },
    position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    // Seller's description for screen readers (null: the app writes a default).
    alt: { type: DataTypes.STRING(250), allowNull: true },
  });

  PostPhoto.associate = (models) => {
    PostPhoto.belongsTo(models.Post, { foreignKey: 'postId', onDelete: 'CASCADE' });
  };

  // Clients get URLs, never raw storage keys.
  PostPhoto.prototype.toJSON = function toJSON() {
    return {
      id: this.id,
      postId: this.postId,
      width: this.width,
      height: this.height,
      position: this.position,
      alt: this.alt || null,
      url: publicUrl(this.storageKey),
      thumbUrl: publicUrl(this.thumbKey),
      createdAt: this.createdAt,
    };
  };
  return PostPhoto;
};
