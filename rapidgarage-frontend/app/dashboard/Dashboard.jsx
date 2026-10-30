import React from 'react';
import { Link } from 'react-router-dom';
import { LayoutDashboard, Lock, Store, Plus, MessageCircle, Hand, PackageCheck, UsersRound, ChevronRight, ShieldCheck } from 'lucide-react';
import { fetchDashboard, errorMessage } from '../api';
import { Alert, EmptyState, SkeletonBlock } from '../components/ui';
import { browserTimeZone, shortWhen } from '../lib/schedule';
import { METRICS, filterSales, sum } from '../lib/dashboard';
import BarChart from './BarChart';
import UpcomingPickups from './UpcomingPickups';
import RainChecks from './RainChecks';
import { MetricCard, ItemsBar, METRIC_ICON, METRIC_LABEL, METRIC_TOTAL, STATUS_LABEL, STATUS_CLASS } from './parts';
import { t } from '../i18n';

const FILTERS = [
  { value: 'all', get label() { return t('dash.filterAll'); } },
  { value: 'active', get label() { return t('dash.filterActive'); } },
  { value: 'ended', get label() { return t('dash.filterEnded'); } },
];

// /dashboard: the signed-in seller's own sales only (the API has no user parameter).
export default class Dashboard extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, error: '', data: null, metric: 'views', filter: 'all' };
  }

  componentDidMount() { document.title = t('dash.docTitle'); if (this.props.user) this.load(); }
  componentDidUpdate(prev) { if (!prev.user && this.props.user) this.load(); }

  load() {
    this.setState({ loading: true, error: '' });
    fetchDashboard(browserTimeZone()).then(({ ok, data }) => {
      if (!ok) return this.setState({ loading: false, error: errorMessage(data, t('dash.loadFailed')) });
      return this.setState({ loading: false, data });
    }).catch(() => this.setState({ loading: false, error: t('common.networkShort') }));
  }

  renderSale(s) {
    const when = s.schedule ? shortWhen(s) : '';
    return (
      <li key={s.id} className={'panel dash-sale' + (s.ended ? ' is-ended' : '')} data-sale-id={s.id}>
        <div className="dash-sale-head">
          <div>
            <h3 className="dash-sale-title"><Link to={'/dashboard/sales/' + s.id}>{s.title}</Link></h3>
            <div className="chips">
              <span className={'chip ' + STATUS_CLASS[s.status]}>{STATUS_LABEL[s.status]}</span>
              {when ? <span className="chip">{when}</span> : null}
              {s.event ? <Link className="chip chip-event" to={'/events/' + s.event.id}><UsersRound size={12} aria-hidden="true" />{s.event.status === 'pending' ? t('dash.eventPending', { name: s.event.name }) : t('ev.partOf', { name: s.event.name })}</Link> : null}
            </div>
          </div>
          <Link className="btn btn-ghost btn-sm" to={'/dashboard/sales/' + s.id} aria-label={t('dash.detailsFor', { title: s.title })}>{t('dash.details')}<ChevronRight size={14} aria-hidden="true" /></Link>
        </div>
        <dl className="dash-sale-stats">
          {METRICS.map((m) => {
            const Icon = METRIC_ICON[m];
            return (
              <div key={m} className={'dash-stat dash-stat-' + m}>
                <dt><Icon size={14} aria-hidden="true" />{METRIC_LABEL[m]}</dt>
                <dd><strong>{s.totals[m]}</strong> <span className="small muted">{t('dash.last14Short', { n: sum(s.series[m]) })}</span></dd>
              </div>
            );
          })}
          <div className="dash-stat"><dt><MessageCircle size={14} aria-hidden="true" />{t('dash.conversations')}</dt><dd><strong>{s.conversations}</strong>{s.unread ? <span className="chip chip-danger dash-unread">{t('dash.unread', { count: s.unread })}</span> : null}</dd></div>
          <div className="dash-stat"><dt><Hand size={14} aria-hidden="true" />{t('dash.holds')}</dt><dd>{t('dash.holdsNums', { pending: s.holds.pending, active: s.holds.active })}</dd></div>
          <div className="dash-stat dash-stat-items"><dt><PackageCheck size={14} aria-hidden="true" />{t('dash.items')}</dt><dd><ItemsBar items={s.items} /></dd></div>
        </dl>
      </li>
    );
  }

  render() {
    if (!this.props.user) {
      return <div className="container container-narrow"><EmptyState level={1} icon={Lock} title={t('dash.loginTitle')} action={<Link className="btn btn-primary" to="/login">{t('nav.logIn')}</Link>}>{t('dash.loginText')}</EmptyState></div>;
    }
    const { loading, error, data, metric, filter } = this.state;
    if (loading) return <div className="container"><SkeletonBlock height={160} lines={6} /></div>;
    if (error) return <div className="container"><Alert tone="danger">{error}</Alert></div>;
    const o = data.overall;
    const shown = filterSales(data.sales, filter);
    const counts = { all: data.sales.length, active: filterSales(data.sales, 'active').length, ended: filterSales(data.sales, 'ended').length };
    return (
      <div className="container dashboard">
        <header className="page-header page-header-row">
          <div>
            <h1><LayoutDashboard size={28} aria-hidden="true" className="h1-icon" />{t('dash.title')}</h1>
            <p className="muted">{t('dash.lead')}</p>
          </div>
          <Link className="btn btn-primary" to="/newpost"><Plus size={16} aria-hidden="true" />{t('nav.postSale')}</Link>
        </header>
        <RainChecks onChange={() => this.load()} />
        <UpcomingPickups />
        {!data.sales.length ? (
          <EmptyState icon={Store} title={t('dash.noneTitle')} action={<Link className="btn btn-primary" to="/newpost"><Plus size={16} aria-hidden="true" />{t('nav.postSale')}</Link>}>{t('dash.noneText')}</EmptyState>
        ) : (
          <React.Fragment>
            <div className="metric-grid">
              {METRICS.map((m) => <MetricCard key={m} metric={m} total={o.totals[m]} today={o.today[m]} series={o.series[m]} />)}
            </div>
            <div className="dash-overview">
              <section className="panel dash-chart" aria-labelledby="dash-chart-title">
                <div className="dash-chart-head">
                  <h2 id="dash-chart-title" className="h4">{t('dash.chartTitle', { n: data.span })}</h2>
                  <div className="segmented" role="group" aria-label={t('dash.metric')}>
                    {METRICS.map((m) => <button key={m} type="button" aria-pressed={metric === m} onClick={() => this.setState({ metric: m })}>{METRIC_LABEL[m]}</button>)}
                  </div>
                </div>
                <p className="dash-chart-total"><strong>{sum(o.series[metric])}</strong> {METRIC_TOTAL[metric](sum(o.series[metric]))}</p>
                <BarChart series={o.series[metric]} label={t('dash.chartLabel', { metric: METRIC_LABEL[metric] })} height={140} />
              </section>
              <section className="panel dash-snapshot" aria-labelledby="dash-snap-title">
                <h2 id="dash-snap-title" className="h4">{t('dash.snapshot')}</h2>
                <dl className="detail-list">
                  <div><dt><Store size={18} aria-hidden="true" /><span>{t('dash.sales')}</span></dt><dd>{t('dash.salesNums', { active: o.active, ended: o.ended })}</dd></div>
                  <div><dt><MessageCircle size={18} aria-hidden="true" /><span>{t('dash.conversations')}</span></dt><dd>{o.conversations}{o.unread ? <Link className="chip chip-danger dash-unread" to="/messages">{t('dash.unread', { count: o.unread })}</Link> : null}</dd></div>
                  <div><dt><Hand size={18} aria-hidden="true" /><span>{t('dash.holds')}</span></dt><dd>{t('dash.holdsNums', { pending: o.holdsPending, active: o.holdsActive })}</dd></div>
                  <div><dt><PackageCheck size={18} aria-hidden="true" /><span>{t('dash.items')}</span></dt><dd><ItemsBar items={{ total: o.itemsTotal, sold: o.itemsSold, reserved: 0 }} /></dd></div>
                  <div><dt><UsersRound size={18} aria-hidden="true" /><span>{t('nav.events')}</span></dt><dd>{t('dash.inEvents', { count: o.inEvents })}</dd></div>
                </dl>
              </section>
            </div>
            <section className="dash-sales" aria-labelledby="dash-sales-title">
              <div className="dash-sales-head">
                <h2 id="dash-sales-title" className="h4">{t('dash.yourSales')}</h2>
                <div className="segmented" role="group" aria-label={t('dash.filter')}>
                  {FILTERS.map((f) => <button key={f.value} type="button" aria-pressed={filter === f.value} onClick={() => this.setState({ filter: f.value })}>{f.label} <span className="count-muted">{counts[f.value]}</span></button>)}
                </div>
              </div>
              {shown.length ? <ul className="dash-sale-list">{shown.map((s) => this.renderSale(s))}</ul> : <p className="muted">{t('dash.noneFiltered')}</p>}
              {data.truncated ? <p className="small muted">{t('dash.truncated', { n: data.sales.length })}</p> : null}
            </section>
            <p className="small muted dash-privacy"><ShieldCheck size={14} aria-hidden="true" /> {t('dash.privacy')} {t('dash.sharesNote')}</p>
          </React.Fragment>
        )}
      </div>
    );
  }
}
