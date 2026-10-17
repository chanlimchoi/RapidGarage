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
    // Optional price range in whole US dollars; see lib/price.js.
    priceMin: { type: DataTypes.INTEGER, allowNull: true },
    priceMax: { type: DataTypes.INTEGER, allowNull: true },
    isFree: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    // Moderation (lib/moderation.js). Hidden posts are visible only to the owner and admins.
    hidden: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    hiddenAt: { type: DataTypes.DATE, allowNull: true },
    hiddenBy: { type: DataTypes.INTEGER, allowNull: true },
    hiddenSource: { type: DataTypes.STRING(16), allowNull: true }, // moderator | auto
    // IANA time zone of the sale days (lib/schedule.js); startDate/endDate are
    // then the first start and last end of those days.
    timeZone: { type: DataTypes.STRING(64), allowNull: true },
  });

  // Sequelize 4 ignores classMethods; associations must be set like this.
  Post.associate = (models) => {
    Post.belongsTo(models.User, { foreignKey: 'userId', onDelete: 'CASCADE' });
    Post.hasMany(models.PostPhoto, { as: 'photos', foreignKey: 'postId', onDelete: 'CASCADE', hooks: true });
    Post.hasMany(models.SaleDay, { as: 'saleDays', foreignKey: 'postId', onDelete: 'CASCADE', hooks: true });
    Post.hasMany(models.SaleItem, { as: 'items', foreignKey: 'postId', onDelete: 'CASCADE', hooks: true });
    Post.hasMany(models.SavedPost, { as: 'saves', foreignKey: 'postId', onDelete: 'CASCADE', hooks: true });
  };
  // Nested includes are serialized with get({ plain: true }), which skips
  // PostPhoto#toJSON; serialize photos explicitly so clients get URLs only.
  Post.prototype.toJSON = function toJSON() {
    const out = Object.assign({}, this.get({ plain: true }));
    if (Array.isArray(this.photos)) out.photos = this.photos.map((p) => p.toJSON());
    if (Array.isArray(this.items)) out.items = this.items.slice().sort((a, b) => a.position - b.position || a.id - b.id).map((i) => i.toJSON());
    delete out.hiddenBy; // which admin hid it is only shown in the admin API
    if (Array.isArray(this.saleDays)) out.schedule = require('../lib/schedule').toJSON(this);
    delete out.saleDays;
    return out;
  };
  return Post;
};
