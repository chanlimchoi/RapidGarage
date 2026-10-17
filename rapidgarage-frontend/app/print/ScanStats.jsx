import React from 'react';
import { ScanLine } from 'lucide-react';
import { t, intlLocale } from '../i18n';

function shortDay(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(intlLocale(), { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// Scan counts for a post's QR short link: total, today, last 14 days as bars.
export default function ScanStats({ scans, compact }) {
  if (!scans) return null;
  const days = scans.days.slice(-14);
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <section className={'scan-stats' + (compact ? ' scan-stats-compact' : '')} aria-label={t('scan.label')}>
      <div className="scan-stats-head">
        <ScanLine size={18} aria-hidden="true" />
        <div className="scan-stats-nums">
          <span><strong className="scan-total">{scans.total}</strong> {t('scan.word', { count: scans.total })}</span>
          <span className="muted small">{t('scan.today', { n: scans.today })}</span>
        </div>
      </div>
      {!compact ? (
        <React.Fragment>
          <ol className="scan-bars" aria-label={t('scan.perDay')}>
            {days.map((d) => (
              <li key={d.date} title={shortDay(d.date) + ': ' + d.count}>
                <span className="scan-bar" style={{ height: Math.max(d.count ? 8 : 2, (d.count / max) * 100) + '%' }} />
                <span className="sr-only">{shortDay(d.date)}: {d.count}</span>
              </li>
            ))}
          </ol>
          <div className="scan-bars-axis small muted" aria-hidden="true"><span>{shortDay(days[0].date)}</span><span>{t('scan.todayAxis')}</span></div>
          <p className="small muted scan-privacy">{t('scan.privacy')}</p>
        </React.Fragment>
      ) : null}
    </section>
  );
}
