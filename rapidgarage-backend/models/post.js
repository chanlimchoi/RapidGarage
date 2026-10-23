'use strict';
const CURBSIDE_FIELDS = ['curbsideUntil', 'curbsideNote', 'curbsideAll', 'curbsideStartedAt', 'curbsideGoneAt', 'curbsideGoneSource'];
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
    // Last-hour markdown (lib/markdown.js): X% off from a local time. Serialized as `markdown`.
    // Bundle deal (lib/bundles.js): N+ items, X% off.
    bundleMinItems: { type: DataTypes.INTEGER, allowNull: true },
    bundlePercent: { type: DataTypes.INTEGER, allowNull: true },
    markdownPercent: { type: DataTypes.INTEGER, allowNull: true },
    markdownFrom: { type: DataTypes.STRING(5), allowNull: true },
    markdownLastDay: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    // AI listing review (lib/aiReview.js), admins only; never serialized.
    aiFlagStatus: { type: DataTypes.STRING(16), allowNull: true },
    aiFlagCategories: { type: DataTypes.STRING(200), allowNull: true },
    aiFlagReason: { type: DataTypes.STRING(300), allowNull: true },
    aiFlaggedAt: { type: DataTypes.DATE, allowNull: true },
    aiReviewHash: { type: DataTypes.STRING(64), allowNull: true },
    // Post-sale summary email sent (lib/sellerTools.js).
    summarySentAt: { type: DataTypes.DATE, allowNull: true },
    // Moderation (lib/moderation.js). Hidden posts are visible only to the owner and admins.
    hidden: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    hiddenAt: { type: DataTypes.DATE, allowNull: true },
    hiddenBy: { type: DataTypes.INTEGER, allowNull: true },
    hiddenSource: { type: DataTypes.STRING(16), allowNull: true }, // moderator | auto
    // IANA time zone of the sale days (lib/schedule.js); startDate/endDate are
    // then the first start and last end of those days.
    timeZone: { type: DataTypes.STRING(64), allowNull: true },
    // Random code for the QR short link /s/<code> (see lib/shortlinks.js).
    shortCode: { type: DataTypes.STRING(12), allowNull: true, unique: 'posts_short_code_uniq' },
    // Free on the curb (lib/curbside.js): leftovers free until curbsideUntil.
    // Never serialized directly; lib/curbside.js#annotate adds a `curbside` object.
    curbsideUntil: { type: DataTypes.DATE, allowNull: true },
    curbsideNote: { type: DataTypes.STRING(200), allowNull: true },
    curbsideAll: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    curbsideStartedAt: { type: DataTypes.DATE, allowNull: true },
    curbsideGoneAt: { type: DataTypes.DATE, allowNull: true },
    curbsideGoneSource: { type: DataTypes.STRING(16), allowNull: true }, // seller | neighbor | items
    // Add to calendar (lib/calendar.js): .ics SEQUENCE and every day ever scheduled.
    calendarSeq: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    calendarDates: { type: DataTypes.TEXT, allowNull: true },
  }, {
    indexes: [{ name: 'posts_curbside_until_idx', fields: ['curbsideUntil'] }],
    hooks: {
      beforeUpdate: (post) => {
        const cal = require('../lib/calendar');
        cal.bumpOnChange(post, cal.postFields);
      },
    },
  });

  // Sequelize 4 ignores classMethods; associations must be set like this.
  Post.associate = (models) => {
    Post.belongsTo(models.User, { foreignKey: 'userId', onDelete: 'CASCADE' });
    Post.hasMany(models.PostPhoto, { as: 'photos', foreignKey: 'postId', onDelete: 'CASCADE', hooks: true });
    Post.hasMany(models.SaleDay, { as: 'saleDays', foreignKey: 'postId', onDelete: 'CASCADE', hooks: true });
    Post.hasMany(models.SaleItem, { as: 'items', foreignKey: 'postId', onDelete: 'CASCADE', hooks: true });
    Post.hasMany(models.PostScanDay, { as: 'scanDays', foreignKey: 'postId', onDelete: 'CASCADE', hooks: true });
    Post.hasMany(models.PostViewDay, { as: 'viewDays', foreignKey: 'postId', onDelete: 'CASCADE', hooks: true });
    Post.hasMany(models.PostShareDay, { as: 'shareDays', foreignKey: 'postId', onDelete: 'CASCADE', hooks: true });
    Post.hasMany(models.SavedPost, { as: 'saves', foreignKey: 'postId', onDelete: 'CASCADE', hooks: true });
    Post.hasMany(models.CurbsideMark, { as: 'curbsideMarks', foreignKey: 'postId', onDelete: 'CASCADE', hooks: true });
    Post.hasOne(models.EventParticipant, { as: 'participation', foreignKey: 'postId', onDelete: 'CASCADE', hooks: true });
  };
  // Nested includes are serialized with get({ plain: true }), which skips
  // PostPhoto#toJSON; serialize photos explicitly so clients get URLs only.
  Post.prototype.toJSON = function toJSON() {
    const out = Object.assign({}, this.get({ plain: true }));
    if (Array.isArray(this.photos)) out.photos = this.photos.map((p) => p.toJSON());
    if (Array.isArray(this.items)) out.items = this.items.slice().sort((a, b) => a.position - b.position || a.id - b.id).map((i) => i.toJSON());
    delete out.shortCode; // only the owner's print/scan API returns it
    delete out.hiddenBy; // which admin hid it is only shown in the admin API
    CURBSIDE_FIELDS.forEach((k) => { delete out[k]; });
    delete out.calendarDates; // only used to cancel removed days in .ics files
    if (Array.isArray(this.saleDays)) out.schedule = require('../lib/schedule').toJSON(this);
    out.markdown = require('../lib/markdown').state(this);
    delete out.markdownPercent;
    delete out.markdownFrom;
    delete out.markdownLastDay;
    out.bundle = require('../lib/bundles').state(this);
    delete out.bundleMinItems;
    delete out.bundlePercent;
    ['aiFlagStatus', 'aiFlagCategories', 'aiFlagReason', 'aiFlaggedAt', 'aiReviewHash', 'summarySentAt'].forEach((k) => { delete out[k]; });
    delete out.saleDays;
    return out;
  };
  Post.beforeCreate((post) => { if (!post.shortCode) post.shortCode = require('../lib/shortlinks').newCode(); });
  return Post;
};
