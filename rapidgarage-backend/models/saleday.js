'use strict';
// One day of a sale (see lib/schedule.js).
module.exports = (sequelize, DataTypes) => {
  const SaleDay = sequelize.define('SaleDay', {
    postId: { type: DataTypes.INTEGER, allowNull: false },
    date: { type: DataTypes.STRING(10), allowNull: false },
    startTime: { type: DataTypes.STRING(5), allowNull: false },
    endTime: { type: DataTypes.STRING(5), allowNull: false },
    startsAt: { type: DataTypes.DATE, allowNull: false },
    endsAt: { type: DataTypes.DATE, allowNull: false },
  }, {
    indexes: [
      { name: 'sale_days_post_date_uniq', unique: true, fields: ['postId', 'date'] },
      { name: 'sale_days_ends_idx', fields: ['endsAt'] },
    ],
  });
  SaleDay.associate = (models) => {
    SaleDay.belongsTo(models.Post, { foreignKey: 'postId', onDelete: 'CASCADE' });
  };
  return SaleDay;
};
