import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ArrowDownRight, Minus, Table2 } from 'lucide-react';
import { apiFetch, errorMessage } from '../api';
import { Alert, SkeletonBlock } from '../components/ui';
import TrendChart from './TrendChart';
import { RANGES, delta } from '../lib/analytics';
import { t, intlLocale } from '../i18n';

const fmt = (n) => new Intl.NumberFormat(intlLocale()).format(n);

// Stat tiles, in reading order. key: metrics[key] (period total + previous);
// `now` tiles show a current count instead.
const TILES = [
  { now: 'activeSales', label: 'an.activeSales' },
  { key: 'posts', label: 'an.newSales' },
  { key: 'signups', label: 'an.signups' },
  { key: 'views', label: 'an.views' },
  { key: 'messages', label: 'an.messages' },
  { key: 'scans', label: 'an.scans' },
  { key: 'saves', label: 'an.saves' },
  { key: 'follows', label: 'an.follows' },
];
// Small multiples: one series per chart, never two scales on one axis.
const CHARTS = [
  { key: 'signups', label: 'an.signups' },
  { key: 'posts', label: 'an.newSales' },
  { key: 'messages', label: 'an.messages' },
  { key: 'views', label: 'an.views' },
  { key: 'scans', label: 'an.scans' },
  { key: 'shares', label: 'an.shares' },
];

function Delta({ metric, days }) {
  const d = delta(metric.total, metric.previous);
  const Icon = d.dir === 'up' ? ArrowUpRight : d.dir === 'down' ? ArrowDownRight : Minus;
  const text = d.pct === null ? t('an.fromZero', { n: fmt(metric.previous) }) : t('an.vsPrevious', { pct: (d.pct > 0 ? '+' : '') + fmt(d.pct), days });
  return <span className={'stat-delta is-' + d.dir}><Icon size={14} aria-hidden="true" />{text}</span>;
}

// Admin -> Analytics: site-wide numbers for the last 7 / 30 / 90 days.
export default class Analytics extends React.Component {
  constructor(props) {
    super(props);
    this.state = { days: 30, data: null, loading: true, error: '', showTables: false };
  }

  componentDidMount() { this.mounted = true; this.load(30); }
  componentWillUnmount() { this.mounted = false; }

  load(days) {
    // Refetch keeps the previous numbers on screen (dimmed) until the new ones arrive.
    this.setState({ days, loading: true, error: '' });
    apiFetch('/admin/analytics?days=' + days).then(({ ok, data }) => {
      if (!this.mounted || this.state.days !== days) return;
      if (!ok) return this.setState({ loading: false, error: errorMessage(data, t('an.loadFailed')) });
      this.setState({ loading: false, data });
    }).catch(() => this.mounted && this.setState({ loading: false, error: t('common.networkShort') }));
  }

  render() {
    const { days, data, loading, error, showTables } = this.state;
    return (
      <div className="stack analytics" aria-busy={loading}>
        <div className="analytics-filters row">
          <div className="segmented" role="group" aria-label={t('an.range')}>
            {RANGES.map((d) => (
              <button key={d} type="button" aria-pressed={days === d} onClick={() => this.load(d)}>{t('an.lastDays', { count: d })}</button>
            ))}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" aria-pressed={showTables} onClick={() => this.setState({ showTables: !showTables })}>
            <Table2 size={14} aria-hidden="true" />{showTables ? t('an.hideTables') : t('an.showTables')}
          </button>
          {data ? <span className="small muted">{t('an.utcNote')}</span> : null}
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {!data ? (loading ? <SkeletonBlock height={120} lines={4} /> : null) : (
          <div className={'stack' + (loading ? ' is-refreshing' : '')}>
            <section aria-label={t('an.kpis')} className="stat-grid">
              {TILES.filter((x) => x.now || data.metrics[x.key]).map((x) => (
                <div key={x.label} className="stat-tile">
                  <span className="stat-label">{t(x.label)}</span>
                  <strong className="stat-value">{fmt(x.now ? data.totals[x.now] : data.metrics[x.key].total)}</strong>
                  {x.now ? <span className="stat-delta is-flat">{t('an.rightNow')}</span> : <Delta metric={data.metrics[x.key]} days={data.days} />}
                </div>
              ))}
              <div className="stat-tile">
                <span className="stat-label">{t('an.users')}</span>
                <strong className="stat-value">{fmt(data.totals.users)}</strong>
                <span className="stat-delta is-flat">{t('an.allTime')}</span>
              </div>
              <div className="stat-tile">
                <span className="stat-label">{t('an.openReports')}</span>
                <strong className="stat-value">{fmt(data.totals.openReports)}</strong>
                {data.totals.openReports && this.props.onReports
                  ? <button type="button" className="btn btn-ghost btn-sm stat-link" onClick={this.props.onReports}>{t('an.review')}</button>
                  : <span className="stat-delta is-flat">{t('an.rightNow')}</span>}
              </div>
            </section>
            <section aria-label={t('an.trends')} className="trend-grid">
              {CHARTS.filter((c) => data.metrics[c.key]).map((c) => (
                <TrendChart key={c.key + days} id={'trend-' + c.key} title={t(c.label)} series={data.metrics[c.key].series} showTable={showTables} />
              ))}
            </section>
            <div className="analytics-lists">
              <section className="panel" aria-labelledby="an-cities">
                <h3 id="an-cities" className="h4">{t('an.topCities')}</h3>
                {data.topCities.length ? (
                  <ol className="rank-list">
                    {data.topCities.map((c) => {
                      const max = data.topCities[0].sales;
                      return (
                        <li key={c.city + '|' + c.state}>
                          <span className="rank-name">{[c.city, c.state].filter(Boolean).join(', ')}</span>
                          <span className="rank-bar" aria-hidden="true"><span style={{ width: Math.max(4, (c.sales / max) * 100) + '%' }} /></span>
                          <span className="rank-value">{t('an.salesCount', { count: c.sales })}</span>
                        </li>
                      );
                    })}
                  </ol>
                ) : <p className="muted small">{t('an.noCities')}</p>}
              </section>
              <section className="panel" aria-labelledby="an-top">
                <h3 id="an-top" className="h4">{t('an.topSales', { count: data.days })}</h3>
                {data.topSales.length ? (
                  <ol className="rank-list">
                    {data.topSales.map((s) => (
                      <li key={s.id}>
                        <span className="rank-name">
                          <Link to={'/post/' + s.id}>{s.title}</Link>
                          <span className="small muted"> · {[s.city, s.state].filter(Boolean).join(', ') || t('card.noLocation')} · {s.seller}{s.hidden ? ' · ' + t('card.hidden') : ''}</span>
                        </span>
                        <span className="rank-value">{t('an.viewsCount', { count: s.views })}</span>
                      </li>
                    ))}
                  </ol>
                ) : <p className="muted small">{t('an.noViews')}</p>}
              </section>
            </div>
          </div>
        )}
      </div>
    );
  }
}
