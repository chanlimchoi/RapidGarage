import React from 'react';
import { Link } from 'react-router-dom';
import { Search, MapPin, Tag, Navigation, UserRound, Clock } from 'lucide-react';
import { formatCents } from '../lib/items';
import { formatMiles } from '../lib/format';
import { daysLeft } from '../lib/wanted';
import { t } from '../i18n';

export const STATUS_CHIP = { active: 'chip-success', expired: 'chip-warning', fulfilled: 'chip-info' };
const STATUS = { active: 'want.status.active', expired: 'want.status.expired', fulfilled: 'want.status.fulfilled' };
export const CATEGORY_KEY = {
  furniture: 'want.cat.furniture', electronics: 'want.cat.electronics', kids: 'want.cat.kids', clothing: 'want.cat.clothing',
  tools: 'want.cat.tools', sports: 'want.cat.sports', books: 'want.cat.books', kitchen: 'want.cat.kitchen',
  toys: 'want.cat.toys', garden: 'want.cat.garden', music: 'want.cat.music', decor: 'want.cat.decor',
};
export const statusLabel = (s) => t(STATUS[s] || STATUS.active);
export const categoryLabel = (c) => (c && CATEGORY_KEY[c] ? t(CATEGORY_KEY[c]) : '');

export function expiryText(w) {
  if (w.status !== 'active') return statusLabel(w.status);
  const d = daysLeft(w.expiresAt);
  return d === null ? statusLabel('expired') : d === 0 ? t('want.lastDay') : t('want.daysLeft', { count: d });
}

// A wanted post on the board or in "Your wanted posts".
export default function WantedCard({ wanted: w, extra }) {
  const distance = formatMiles(w.distanceMiles);
  return (
    <article className="wanted-card" data-wanted-id={w.id}>
      <span className="wanted-card-icon" aria-hidden="true"><Search size={20} /></span>
      <div className="wanted-card-body">
        <span className="event-kicker">{t('want.kicker')}</span>
        <h3 className="wanted-card-title"><Link to={'/wanted/' + w.id}>{w.title}</Link></h3>
        <div className="post-card-meta"><MapPin size={14} aria-hidden="true" /><span>{t('want.within', { miles: w.radiusMiles, area: w.areaLabel })}</span></div>
        <div className="chips">
          {w.maxPriceCents !== null && w.maxPriceCents !== undefined ? <span className="chip chip-brand"><Tag size={12} aria-hidden="true" />{w.maxPriceCents === 0 ? t('want.freeOnly') : t('want.upTo', { price: formatCents(w.maxPriceCents) })}</span> : null}
          {w.category ? <span className="chip">{categoryLabel(w.category)}</span> : null}
          {distance ? <span className="chip"><Navigation size={12} aria-hidden="true" />{distance}</span> : null}
          <span className={'chip ' + (w.status === 'active' ? '' : STATUS_CHIP[w.status])}><Clock size={12} aria-hidden="true" />{expiryText(w)}</span>
          {w.hidden ? <span className="chip chip-warning">{t('card.hidden')}</span> : null}
        </div>
        <div className="small muted wanted-card-by"><UserRound size={14} aria-hidden="true" />{w.mine ? t('want.byYou') : t('want.by', { name: w.poster.name })}</div>
        {extra || null}
      </div>
    </article>
  );
}
