import React from 'react';
import { sketch } from '../lib/events';
import { t } from '../i18n';

// The event's area as a circle with its sales as dots: a schematic that works
// without map tiles (the real map is shown alongside when a key is available).
export default function EventSketch({ event, sales, selectedId, onSelect }) {
  const s = sketch(event, sales, 360, 220, 18);
  return (
    <figure className="event-sketch">
      <svg viewBox={'0 0 ' + s.W + ' ' + s.H} role="img" aria-label={t('ev.sketchLabel', { count: s.dots.length, area: event.areaLabel })}>
        <circle cx={s.cx} cy={s.cy} r={s.r} className="event-sketch-area" />
        <circle cx={s.cx} cy={s.cy} r={3} className="event-sketch-center" />
        {s.dots.map((d, i) => (
          <g key={d.id} className={'event-sketch-dot' + (d.id === selectedId ? ' is-selected' : '')} transform={'translate(' + d.x.toFixed(1) + ' ' + d.y.toFixed(1) + ')'}
            onClick={onSelect ? () => onSelect(d.id) : undefined}>
            <title>{d.title}</title>
            <circle r={9} />
            <text textAnchor="middle" dy="3.5">{i + 1}</text>
          </g>
        ))}
      </svg>
      <figcaption className="small muted">{s.zoomed ? t('ev.sketchCaptionZoomed', { miles: event.radiusMiles }) : t('ev.sketchCaption', { miles: event.radiusMiles })}</figcaption>
    </figure>
  );
}
