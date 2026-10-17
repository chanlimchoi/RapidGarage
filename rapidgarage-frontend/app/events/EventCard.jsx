import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin, CalendarDays, Store, Navigation, UsersRound } from 'lucide-react';
import { shortWhen, saleBadge } from '../lib/schedule';
import { formatMiles } from '../lib/format';
import { BADGE_CLASS } from '../components/PostCard';
import { t } from '../i18n';

// Card for a neighborhood sale (lists, search strip, "My neighborhood sales").
export default function EventCard({ event, extra, compact }) {
  const badge = saleBadge(event);
  const when = shortWhen(event);
  const distance = formatMiles(event.distanceMiles);
  return (
    <article className={'event-card' + (compact ? ' event-card-compact' : '')} data-event-id={event.id}>
      <span className="event-card-icon" aria-hidden="true"><UsersRound size={compact ? 18 : 22} /></span>
      <div className="event-card-body">
        <span className="event-kicker">{t('ev.kicker')}</span>
        <h3 className="event-card-title"><Link to={'/events/' + event.id}>{event.name}</Link></h3>
        <div className="post-card-meta"><MapPin size={14} aria-hidden="true" /><span>{event.areaLabel}</span></div>
        <div className="chips">
          <span className="chip chip-brand event-sale-count"><Store size={12} aria-hidden="true" />{t('ev.saleCount', { count: event.saleCount || 0 })}</span>
          {badge ? <span className={'chip sale-badge ' + BADGE_CLASS[badge.kind]}>{badge.label}</span> : null}
          {when && !compact ? <span className="chip"><CalendarDays size={12} aria-hidden="true" />{when}</span> : null}
          {distance ? <span className="chip"><Navigation size={12} aria-hidden="true" />{distance}</span> : null}
          {event.hidden ? <span className="chip chip-warning">{t('card.hidden')}</span> : null}
        </div>
        {extra || null}
      </div>
    </article>
  );
}
