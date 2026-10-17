import React from 'react';
import { bars } from '../lib/dashboard';
import { t, intlLocale } from '../i18n';

export function shortDay(date, opts) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(intlLocale(), Object.assign({ month: 'short', day: 'numeric', timeZone: 'UTC' }, opts));
}

// Lightweight SVG bar chart (no chart library). The numbers are also in a
// visually hidden table for screen readers; each bar has a hover title.
// compact = sparkline (no axis labels).
export default function BarChart({ series, label, compact, height }) {
  const W = 280;
  const H = height || (compact ? 36 : 120);
  const g = bars(series, W, H, compact ? 2 : 4);
  return (
    <figure className={'bar-chart' + (compact ? ' bar-chart-compact' : '')}>
      <svg viewBox={'0 0 ' + W + ' ' + H} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        {!compact ? <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} className="bar-chart-base" /> : null}
        {g.bars.map((b, i) => (
          <rect key={b.date} x={b.x} y={b.y} width={b.w} height={b.h} rx={compact ? 1 : 2}
            className={'bar-chart-bar' + (i === g.bars.length - 1 ? ' is-today' : '') + (b.count ? '' : ' is-zero')}>
            <title>{shortDay(b.date, { weekday: 'short' }) + ': ' + b.count}</title>
          </rect>
        ))}
      </svg>
      {!compact ? (
        <div className="bar-chart-axis small muted" aria-hidden="true">
          <span>{series.length ? shortDay(series[0].date) : ''}</span>
          <span>{t('dash.max', { n: g.max })}</span>
          <span>{t('scan.todayAxis')}</span>
        </div>
      ) : null}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead><tr><th scope="col">{t('dash.date')}</th><th scope="col">{t('dash.count')}</th></tr></thead>
        <tbody>{series.map((d) => <tr key={d.date}><td>{shortDay(d.date, { weekday: 'short' })}</td><td>{d.count}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
