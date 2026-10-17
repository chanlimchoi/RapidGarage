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
    endDate: DataTypes.DATE,
    // Filled by server-side geocoding (lib/geo.js); null = not geocoded.
    lat: { type: DataTypes.DOUBLE, allowNull: true },
    lng: { type: DataTypes.DOUBLE, allowNull: true },
    // ok | no_key | not_found | error | null (never tried)
    geocodeStatus: { type: DataTypes.STRING(16), allowNull: true },
    geocodedAt: { type: DataTypes.DATE, allowNull: true },
  });

  // Sequelize 4 ignores classMethods; associations must be set like this.
  Post.associate = (models) => {
    Post.belongsTo(models.User, { foreignKey: 'userId', onDelete: 'CASCADE' });
    Post.hasMany(models.PostPhoto, { as: 'photos', foreignKey: 'postId', onDelete: 'CASCADE', hooks: true });
  };
  // Nested includes are serialized with get({ plain: true }), which skips
  // PostPhoto#toJSON; serialize photos explicitly so clients get URLs only.
  Post.prototype.toJSON = function toJSON() {
    const out = Object.assign({}, this.get({ plain: true }));
    if (Array.isArray(this.photos)) out.photos = this.photos.map((p) => p.toJSON());
    return out;
  };
  return Post;
};
