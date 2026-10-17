import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin, CalendarDays, Images, ImageOff, Navigation, Clock, Tag } from 'lucide-react';
import { formatMiles, placeLine, timeAgo } from '../lib/format';
import { shortWhen, saleBadge } from '../lib/schedule';
import { formatPrice } from '../lib/price';
import SaveButton from '../saved/SaveButton';

export const BADGE_CLASS = { open: 'chip-success', upcoming: 'chip-info', ended: 'chip-muted' };

// Card for one sale. The title link covers the whole card; "Show on map"
// (when the post has a pin) selects it on the map instead.
export default function PostCard({ post, selected, onShowOnMap, actions }) {
  const photos = post.photos || [];
  const distance = formatMiles(post.distanceMiles);
  const badge = saleBadge(post);
  // A single upcoming day is already fully described by its "Starts …" badge.
  const single = post.schedule && post.schedule.days && post.schedule.days.length === 1;
  const when = badge && badge.kind === 'upcoming' && single ? null : shortWhen(post);
  const price = formatPrice(post);
  const hasPin = typeof post.lat === 'number' && typeof post.lng === 'number';
  return (
    <article className={'post-card post-item' + (selected ? ' post-item-selected' : '')} data-post-id={post.id}>
      <div className="post-card-media">
        {photos.length
          ? <img className="post-thumb" src={photos[0].thumbUrl} alt="" loading="lazy" />
          : <div className="post-card-placeholder"><ImageOff size={28} aria-hidden="true" /><span className="sr-only">No photos</span></div>}
        {distance ? <span className="chip post-card-distance post-distance"><Navigation size={12} aria-hidden="true" />{distance}</span> : null}
        <SaveButton post={post} variant="card" />
        {photos.length > 1 ? <span className="post-card-badge"><Images size={12} aria-hidden="true" />{photos.length} photos</span> : null}
      </div>
      <div className="post-card-body">
        <h3 className="post-card-title"><Link to={'/post/' + post.id}>{post.title}</Link></h3>
        <div className="post-card-meta"><MapPin size={14} aria-hidden="true" /><span>{placeLine(post) || 'Location not given'}</span></div>
        <div className="chips">
          {post.hidden ? <span className="chip chip-warning">Hidden</span> : null}
          {price ? <span className={'chip chip-price' + (post.isFree ? ' chip-free' : '')}><Tag size={12} aria-hidden="true" />{price}</span> : null}
          {when ? <span className="chip chip-brand"><CalendarDays size={12} aria-hidden="true" />{when}</span> : null}
          {badge ? <span className={'chip sale-badge sale-badge-' + badge.kind + ' ' + BADGE_CLASS[badge.kind]}>{badge.label}</span> : null}
          {!when && !badge ? <span className="chip"><Clock size={12} aria-hidden="true" />Posted {timeAgo(post.createdAt)}</span> : null}
        </div>
        {onShowOnMap && hasPin ? (
          <div className="post-card-foot">
            <span className="small muted">Posted {timeAgo(post.createdAt)}</span>
            <button type="button" className="btn btn-ghost btn-sm show-on-map" onClick={() => onShowOnMap(post.id)}
              aria-label={'Show ' + post.title + ' on the map'}><MapPin size={14} aria-hidden="true" />Map</button>
          </div>
        ) : null}
      </div>
      {actions ? <div className="post-card-actions">{actions}</div> : null}
    </article>
  );
}
