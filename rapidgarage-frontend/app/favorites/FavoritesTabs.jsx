import React from 'react';
import { Link } from 'react-router-dom';
import { Heart, UserCheck } from 'lucide-react';
import { t } from '../i18n';

// Favorites: hearted sales (/favorites, also /saved) and favorite sellers,
// i.e. people you follow (/favorites/sellers, also /following).
export default function FavoritesTabs({ current }) {
  const tab = (key, to, Icon, label) => (
    <Link to={to} className={'fav-tab' + (current === key ? ' is-active' : '')} aria-current={current === key ? 'page' : undefined}>
      <Icon size={16} aria-hidden="true" />{label}
    </Link>
  );
  return (
    <nav className="fav-tabs" aria-label={t('fav.tabs')}>
      {tab('sales', '/favorites', Heart, t('fav.sales'))}
      {tab('sellers', '/favorites/sellers', UserCheck, t('fav.sellers'))}
    </nav>
  );
}
