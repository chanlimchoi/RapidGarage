import React from 'react';
import { ScanLine } from 'lucide-react';

function shortDay(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// Scan counts for a post's QR short link: total, today, last 14 days as bars.
export default function ScanStats({ scans, compact }) {
  if (!scans) return null;
  const days = scans.days.slice(-14);
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <section className={'scan-stats' + (compact ? ' scan-stats-compact' : '')} aria-label="QR code scans">
      <div className="scan-stats-head">
        <ScanLine size={18} aria-hidden="true" />
        <div className="scan-stats-nums">
          <span><strong className="scan-total">{scans.total}</strong> {scans.total === 1 ? 'scan' : 'scans'}</span>
          <span className="muted small">{scans.today} today</span>
        </div>
      </div>
      {!compact ? (
        <React.Fragment>
          <ol className="scan-bars" aria-label="Scans per day, last 14 days">
            {days.map((d) => (
              <li key={d.date} title={shortDay(d.date) + ': ' + d.count}>
                <span className="scan-bar" style={{ height: Math.max(d.count ? 8 : 2, (d.count / max) * 100) + '%' }} />
                <span className="sr-only">{shortDay(d.date)}: {d.count}</span>
              </li>
            ))}
          </ol>
          <div className="scan-bars-axis small muted" aria-hidden="true"><span>{shortDay(days[0].date)}</span><span>Today</span></div>
          <p className="small muted scan-privacy">Each phone counts once a day. Bots, link previews and your own scans don't count. No IP addresses or device details are stored.</p>
        </React.Fragment>
      ) : null}
    </section>
  );
}
