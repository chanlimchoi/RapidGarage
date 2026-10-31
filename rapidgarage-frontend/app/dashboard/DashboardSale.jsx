import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Pencil, QrCode, Package, Hand, MessageCircle, UsersRound, Lock, ShieldCheck, FileText } from 'lucide-react';
import { fetchDashboardSale, errorMessage } from '../api';
import { Alert, EmptyState, SkeletonBlock } from '../components/ui';
import { dayLines } from '../lib/schedule';
import { timeAgo } from '../lib/format';
import { METRICS, funnelRows } from '../lib/dashboard';
import { formatCents } from '../lib/items';
import BarChart from './BarChart';
import SaleRecap from './SaleRecap';
import DuplicateButton from '../post/DuplicateButton';
import { MetricCard, ItemsBar, METRIC_LABEL, STATUS_LABEL, STATUS_CLASS } from './parts';
import { t, intlLocale } from '../i18n';

const HOLD_STATUS = { get pending() { return t('hold.status.pendingSeller'); }, get accepted() { return t('hold.status.accepted'); } };
const when = (v) => new Date(v).toLocaleString(intlLocale(), { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// Literal keys (the i18n test reads them from source).
const FUNNEL_LABEL = { views: 'dash.f.views', saves: 'dash.f.saves', messages: 'dash.f.messages', holds: 'dash.f.holds', sold: 'dash.f.sold' };

// Views -> saves -> buyers who messaged -> hold/offer requests -> items sold.
function Funnel({ funnel }) {
  if (!funnel) return null;
  const fmt = (n) => new Intl.NumberFormat(intlLocale()).format(n);
  const rows = funnelRows(funnel);
  const i = funnel.interest || {};
  return (
    <section className="panel stack" aria-labelledby="dd-funnel">
      <h2 id="dd-funnel" className="h4">{t('dash.funnel')}</h2>
      <p className="small muted">{t('dash.funnelLead')}</p>
      <ol className="funnel-list">
        {rows.map((r) => (
          <li key={r.key}>
            <span className="funnel-name">{t(FUNNEL_LABEL[r.key])}</span>
            <span className="funnel-bar" aria-hidden="true"><span style={{ width: r.width + '%' }} /></span>
            <span className="funnel-value">
              <strong>{r.of !== null ? t('dash.f.soldOf', { n: fmt(r.count), m: fmt(r.of) }) : fmt(r.count)}</strong>
              {r.pct !== null ? <span className="small muted">{t('dash.f.ofViews', { pct: fmt(r.pct) })}</span> : null}
            </span>
          </li>
        ))}
      </ol>
      <h3 className="h5">{t('dash.interest')}</h3>
      <ul className="funnel-extra small">
        <li>{t('dash.i.directions')}: <strong>{fmt(i.directions || 0)}</strong></li>
        <li>{t('dash.i.routeAdds')}: <strong>{fmt(i.routeAdds || 0)}</strong></li>
        <li>{t('dash.i.calendar')}: <strong>{fmt(i.calendar || 0)}</strong></li>
      </ul>
    </section>
  );
}

// /dashboard/sales/:id: one of my sales in detail (404 for anyone else, admins too).
export default class DashboardSale extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, error: '', sale: null };
  }

  componentDidMount() { document.title = t('dash.docTitle'); if (this.props.user) this.load(); }
  componentDidUpdate(prev) {
    if ((!prev.user && this.props.user) || prev.match.params.id !== this.props.match.params.id) this.load();
  }

  load() {
    this.setState({ loading: true, error: '' });
    fetchDashboardSale(this.props.match.params.id).then(({ ok, status, data }) => {
      if (!ok) return this.setState({ loading: false, error: status === 404 ? 'not_found' : errorMessage(data, t('dash.loadFailed')) });
      return this.setState({ loading: false, sale: data.sale });
    }).catch(() => this.setState({ loading: false, error: t('common.networkShort') }));
  }

  render() {
    const back = <Link to="/dashboard" className="back-link"><ArrowLeft size={16} aria-hidden="true" />{t('dash.back')}</Link>;
    if (!this.props.user) {
      return <div className="container container-narrow"><EmptyState level={1} icon={Lock} title={t('dash.loginTitle')} action={<Link className="btn btn-primary" to="/login">{t('nav.logIn')}</Link>}>{t('dash.loginText')}</EmptyState></div>;
    }
    const { loading, error, sale: s } = this.state;
    if (loading) return <div className="container"><SkeletonBlock height={160} lines={6} /></div>;
    if (error === 'not_found') return <div className="container container-narrow">{back}<EmptyState level={1} icon={Lock} title={t('dash.notYours')}>{t('dash.notYoursText')}</EmptyState></div>;
    if (error) return <div className="container">{back}<Alert tone="danger">{error}</Alert></div>;
    const lines = s.schedule ? dayLines(s) : [];
    return (
      <div className="container dashboard dash-detail">
        {back}
        <header className="page-header">
          <h1>{s.title}</h1>
          <div className="chips">
            <span className={'chip ' + STATUS_CLASS[s.status]}>{STATUS_LABEL[s.status]}</span>
            {lines.length ? <span className="chip">{lines[0]}{lines.length > 1 ? ' …' : ''}</span> : null}
          </div>
          <div className="form-actions">
            <Link className="btn btn-secondary btn-sm" to={'/post/' + s.id}><ExternalLink size={14} aria-hidden="true" />{t('dash.viewSale')}</Link>
            {!s.ended ? <Link className="btn btn-secondary btn-sm" to={'/post/' + s.id + '/edit'}><Pencil size={14} aria-hidden="true" />{t('post.editPost')}</Link> : null}
            <Link className="btn btn-secondary btn-sm" to={'/post/' + s.id + '/items'}><Package size={14} aria-hidden="true" />{t('dash.items')}</Link>
            <Link className="btn btn-secondary btn-sm" to={'/post/' + s.id + '/report'}><FileText size={14} aria-hidden="true" />{t('report.link')}</Link>
            {!s.hidden ? <Link className="btn btn-secondary btn-sm" to={'/post/' + s.id + '/print'}><QrCode size={14} aria-hidden="true" />{t('post.printFlyer')}</Link> : null}
            {!s.hidden ? <DuplicateButton postId={s.id} small /> : null}
          </div>
        </header>
        {s.ended ? <SaleRecap postId={s.id} hidden={s.hidden} /> : null}
        <div className="metric-grid">
          {METRICS.map((m) => <MetricCard key={m} metric={m} total={s.totals[m]} today={s.today[m]} series={s.series[m]} />)}
        </div>
        <div className="dash-detail-charts">
          {METRICS.map((m) => (
            <section key={m} className="panel" aria-labelledby={'chart-' + m}>
              <h2 id={'chart-' + m} className="h4">{t('dash.chartLabel', { metric: METRIC_LABEL[m] })}</h2>
              <BarChart series={s.series[m]} label={t('dash.chartLabel', { metric: METRIC_LABEL[m] })} />
            </section>
          ))}
        </div>
        <div className="dash-detail-panels">
          <Funnel funnel={s.funnel} />
          <section className="panel stack" aria-labelledby="dd-items">
            <h2 id="dd-items" className="h4"><Package size={18} aria-hidden="true" />{t('dash.items')}</h2>
            <ItemsBar items={s.items} />
          </section>
          <section className="panel stack" aria-labelledby="dd-holds">
            <h2 id="dd-holds" className="h4"><Hand size={18} aria-hidden="true" />{t('dash.openHolds', { count: s.holdList.length })}</h2>
            {s.holdList.length ? (
              <ul className="dash-list">
                {s.holdList.map((h) => (
                  <li key={h.id}>
                    <div><strong>{h.item || t('dash.removedItem')}</strong> <span className={'chip ' + (h.status === 'accepted' ? 'chip-success' : 'chip-info')}>{HOLD_STATUS[h.status]}</span>{h.offerCents ? <span className="chip chip-price">{h.status === 'accepted' ? t('offer.agreed', { price: formatCents(h.offerCents) }) : t('offer.offered', { price: formatCents(h.offerCents) })}</span> : null}</div>
                    <div className="small muted">{h.buyer || t('msg.formerUser')} · {h.status === 'accepted' ? t('hold.until', { time: when(h.expiresAt) }) : t('hold.answerBy', { time: when(h.expiresAt) })}{h.pickupAt ? ' · ' + t('hold.pickupAt', { time: when(h.pickupAt) }) : ''}</div>
                    <Link className="small" to={'/messages/' + h.conversationId}>{t('dash.openThread')}</Link>
                  </li>
                ))}
              </ul>
            ) : <p className="small muted">{t('dash.noHolds')}</p>}
          </section>
          <section className="panel stack" aria-labelledby="dd-convs">
            <h2 id="dd-convs" className="h4"><MessageCircle size={18} aria-hidden="true" />{t('dash.conversations')}</h2>
            {s.conversationList.length ? (
              <ul className="dash-list">
                {s.conversationList.map((c) => (
                  <li key={c.id}>
                    <div><Link to={'/messages/' + c.id}><strong>{c.buyer || t('msg.formerUser')}</strong></Link>
                    {c.unread ? <span className="chip chip-danger dash-unread">{t('dash.unread', { count: c.unread })}</span> : null}</div>
                    {c.lastMessageAt ? <div className="small muted">{t('dash.lastMessage', { when: timeAgo(c.lastMessageAt) })}</div> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="small muted">{t('dash.noConversations')}</p>}
          </section>
          <section className="panel stack" aria-labelledby="dd-event">
            <h2 id="dd-event" className="h4"><UsersRound size={18} aria-hidden="true" />{t('ev.panelTitle')}</h2>
            {s.event ? (
              <p><Link to={'/events/' + s.event.id}><strong>{s.event.name}</strong></Link> <span className={'chip ' + (s.event.status === 'approved' ? 'chip-success' : 'chip-info')}>{s.event.status === 'approved' ? t('ev.status.approved') : t('ev.status.pending')}</span>{s.event.ended ? <span className="chip">{t('dash.status.ended')}</span> : null}</p>
            ) : <p className="small muted">{t('dash.noEvent')}</p>}
          </section>
        </div>
        <p className="small muted dash-privacy"><ShieldCheck size={14} aria-hidden="true" /> {t('dash.privacy')} {t('dash.sharesNote')}</p>
      </div>
    );
  }
}
