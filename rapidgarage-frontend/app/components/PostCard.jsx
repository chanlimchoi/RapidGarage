import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin, CalendarDays, Images, ImageOff, Navigation, Clock } from 'lucide-react';
import { formatMiles, placeLine, saleWhen, saleStatus, timeAgo } from '../lib/format';

const STATUS = { live: ['Happening now', 'chip-success'], upcoming: null, ended: ['Ended', ''] };

// Card for one sale. The title link covers the whole card; "Show on map"
// (when the post has a pin) selects it on the map instead.
export default function PostCard({ post, selected, onShowOnMap, actions }) {
  const photos = post.photos || [];
  const distance = formatMiles(post.distanceMiles);
  const when = saleWhen(post);
  const status = STATUS[saleStatus(post)];
  const hasPin = typeof post.lat === 'number' && typeof post.lng === 'number';
  return (
    <article className={'post-card post-item' + (selected ? ' post-item-selected' : '')} data-post-id={post.id}>
      <div className="post-card-media">
        {photos.length
          ? <img className="post-thumb" src={photos[0].thumbUrl} alt="" loading="lazy" />
          : <div className="post-card-placeholder"><ImageOff size={28} aria-hidden="true" /><span className="sr-only">No photos</span></div>}
        {distance ? <span className="chip post-card-distance post-distance"><Navigation size={12} aria-hidden="true" />{distance}</span> : null}
        {photos.length > 1 ? <span className="post-card-badge"><Images size={12} aria-hidden="true" />{photos.length} photos</span> : null}
      </div>
      <div className="post-card-body">
        <h3 className="post-card-title"><Link to={'/post/' + post.id}>{post.title}</Link></h3>
        <div className="post-card-meta"><MapPin size={14} aria-hidden="true" /><span>{placeLine(post) || 'Location not given'}</span></div>
        <div className="chips">
          {when ? <span className="chip chip-brand"><CalendarDays size={12} aria-hidden="true" />{when}</span> : null}
          {status ? <span className={'chip ' + status[1]}>{status[0]}</span> : null}
          {!when ? <span className="chip"><Clock size={12} aria-hidden="true" />Posted {timeAgo(post.createdAt)}</span> : null}
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
