import React from 'react';
import { Link } from 'react-router-dom';
import { ImageOff, Navigation, CalendarDays, MapPin } from 'lucide-react';
import { formatMiles, placeLine } from '../lib/format';
import { shortWhen, saleBadge } from '../lib/schedule';
import { formatCents } from '../lib/items';
import { itemPrice, saleAsPost } from '../lib/itemSearch';
import { BADGE_CLASS } from './PostCard';
import { t } from '../i18n';

// One item from the item search: its photo (or the sale's cover, labeled),
// price, and the sale it's at with distance and date. Links to the sale.
export default function ItemResultCard({ item, selected, onShowOnMap }) {
  const sale = saleAsPost(item.sale);
  const distance = formatMiles(item.sale.distanceMiles);
  const badge = saleBadge(sale);
  const when = shortWhen(sale);
  const price = itemPrice(item);
  return (
    <article className={'post-card item-result' + (selected ? ' post-item-selected' : '')} data-post-id={item.sale.id} data-item-id={item.id}>
      <div className="post-card-media">
        {item.photo
          ? <img className="post-thumb" src={item.photo.thumbUrl} alt={item.photo.ofSale ? '' : (item.photo.alt || item.name)} loading="lazy" />
          : <div className="post-card-placeholder"><ImageOff size={28} aria-hidden="true" /><span className="sr-only">{t('itemSearch.noPhoto')}</span></div>}
        {item.photo && item.photo.ofSale ? <span className="post-card-badge">{t('itemSearch.salePhoto')}</span> : null}
        {distance ? <span className="chip post-card-distance post-distance"><Navigation size={12} aria-hidden="true" />{distance}</span> : null}
      </div>
      <div className="post-card-body">
        <h3 className="post-card-title"><Link to={'/post/' + item.sale.id + '#item-' + item.id}>{item.name}</Link></h3>
        <p className="item-result-price">
          {price.cents !== null ? <strong>{formatCents(price.cents)}</strong> : <span className="muted small">{t('itemSearch.noPrice')}</span>}
          {price.wasCents !== null ? <s className="muted small"><span className="sr-only">{t('itemSearch.was')}</span>{formatCents(price.wasCents)}</s> : null}
          {item.reserved ? <span className="chip chip-muted">{t('items.reserved')}</span> : null}
        </p>
        <div className="post-card-meta"><MapPin size={14} aria-hidden="true" /><span>{t('itemSearch.at', { title: item.sale.title })}{placeLine(sale) ? ' · ' + placeLine(sale) : ''}</span></div>
        <div className="chips">
          {when ? <span className="chip chip-brand"><CalendarDays size={12} aria-hidden="true" />{when}</span> : null}
          {badge ? <span className={'chip sale-badge sale-badge-' + badge.kind + ' ' + BADGE_CLASS[badge.kind]}>{badge.label}</span> : null}
        </div>
        {onShowOnMap ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onShowOnMap(item.sale.id)}>
            <MapPin size={14} aria-hidden="true" />{t('card.map')}<span className="sr-only">: {item.name}</span>
          </button>
        ) : null}
      </div>
    </article>
  );
}
