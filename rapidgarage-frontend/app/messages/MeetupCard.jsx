import React from 'react';
import { MapPin, Check, X, Repeat, CalendarClock, ExternalLink, Undo2 } from 'lucide-react';
import { kindLabel, meetTime, statusText } from './meetupText';
import { Spinner } from '../components/ui';
import { t } from '../i18n';

const CHIP = { pending: 'chip-brand', accepted: 'chip-success' };

// A meetup suggestion in the thread (the "proposed" / "countered" event).
// The person it was suggested to can accept, decline or suggest another;
// the proposer can withdraw it; either person can call off an agreed meetup.
export default function MeetupCard({ m, other, canAct, busy, onAction, onCounter, clock }) {
  const p = m.meetup;
  const place = p.place || {};
  const lead = m.meetup.event === 'countered'
    ? (m.mine ? t('meet.card.counterMine') : t('meet.card.counterOther', { name: other }))
    : (m.mine ? t('meet.card.mine') : t('meet.card.other', { name: other }));
  const where = [place.address, place.city, place.state].filter(Boolean).join(', ');
  const open = canAct && (p.status === 'pending' || p.status === 'accepted');
  return (
    <div className={'meet-card meet-' + p.status + (m.mine ? ' mine' : '')} role="group" aria-label={lead.replace(/:$/, '') + ' ' + place.name}>
      <div className="meet-card-head">
        <span className="meet-icon" aria-hidden="true"><MapPin size={16} /></span>
        <span className="small muted">{lead.replace(/\.\.$/, '.')}</span>
        <span className={'chip ' + (CHIP[p.status] || 'chip-muted')}>{statusText(p, other)}</span>
      </div>
      <div className="meet-card-place">
        <strong>{place.name}</strong>
        <span className="chip chip-sm">{kindLabel(place.kind)}</span>
      </div>
      {where ? <div className="small muted">{where}</div> : null}
      <div className="meet-card-when"><CalendarClock size={14} aria-hidden="true" /> {meetTime(p.meetAt)}</div>
      {p.note ? <p className="meet-card-note">“{p.note}”</p> : null}
      <div className="meet-card-actions">
        <a className="btn btn-ghost btn-sm" href={place.mapsUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} aria-hidden="true" />{t('meet.directions')}</a>
        {open && p.status === 'pending' && !p.mine ? (
          <React.Fragment>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => onAction(p, 'accept')}>{busy ? <Spinner /> : <Check size={14} aria-hidden="true" />}{t('meet.accept')}</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onCounter(p)}><Repeat size={14} aria-hidden="true" />{t('meet.counter')}</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onAction(p, 'decline')}><X size={14} aria-hidden="true" />{t('meet.decline')}</button>
          </React.Fragment>
        ) : null}
        {open && p.status === 'pending' && p.mine ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onAction(p, 'cancel')}><Undo2 size={14} aria-hidden="true" />{t('meet.withdraw')}</button>
        ) : null}
        {open && p.status === 'accepted' && new Date(p.meetAt) > new Date() ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onAction(p, 'cancel')}><X size={14} aria-hidden="true" />{t('meet.callOff')}</button>
        ) : null}
      </div>
      <time className="bubble-time" dateTime={m.createdAt}>{clock(m.createdAt)}</time>
    </div>
  );
}
