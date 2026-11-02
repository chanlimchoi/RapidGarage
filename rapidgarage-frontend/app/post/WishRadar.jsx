import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Radar, Lock, ShieldCheck, Check, Lightbulb } from 'lucide-react';
import { fetchSaleRadar, errorMessage } from '../api';
import { Alert, EmptyState, SkeletonBlock } from '../components/ui';
import { barPercent, summary, splitTerms } from '../lib/wishRadar';
import { categoryLabel } from '../wanted/WantedCard';
import { formatCents } from '../lib/items';
import { t } from '../i18n';

const paramId = (props) => (props.match && props.match.params && props.match.params.id) || (props.params && props.params.id);
const SUMMARY = {
  'radar.fewer': (v) => t('radar.fewer', v),
  'radar.hunters': (v) => t('radar.hunters', v),
};

function Bars({ rows, max, label }) {
  return (
    <ul className="radar-list">
      {rows.map((r) => (
        <li key={r.term || r.category}>
          <div className="radar-row">
            <span className="radar-term">{r.term || categoryLabel(r.category)}</span>
            <span className="muted small">{t('radar.count', { count: r.count })}{r.typicalMaxCents ? ' · ' + t('radar.typicalMax', { price: formatCents(r.typicalMaxCents) }) : ''}</span>
          </div>
          <div className="radar-bar" role="presentation"><span style={{ width: barPercent(r.count, max) + '%' }} /></div>
        </li>
      ))}
    </ul>
  );
}

// /post/:id/radar (seller only): what buyers near this sale are hunting for,
// from their saved searches and wanted posts. Counts only; no buyers shown.
class WishRadar extends Component {
  constructor(props) { super(props); this.state = { data: null, error: '' }; }
  componentDidMount() {
    this.mounted = true;
    fetchSaleRadar(paramId(this.props)).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) return this.setState({ error: errorMessage(data, t('radar.loadFailed')) });
      return this.setState({ data });
    }).catch(() => this.mounted && this.setState({ error: t('common.network') }));
  }
  componentWillUnmount() { this.mounted = false; }

  render() {
    const s = this.state;
    const id = paramId(this.props);
    const back = <Link to={'/dashboard/sales/' + id} className="back-link"><ArrowLeft size={16} aria-hidden="true" />{t('dash.saleStats')}</Link>;
    if (this.props.ready && !this.props.user) {
      return <div className="container container-narrow"><EmptyState level={1} icon={Lock} title={t('dash.loginTitle')} action={<Link className="btn btn-primary" to="/login">{t('nav.logIn')}</Link>}>{t('dash.loginText')}</EmptyState></div>;
    }
    if (s.error) return <div className="container container-narrow">{back}<Alert tone="danger">{s.error}</Alert></div>;
    if (!s.data) return <div className="container container-narrow"><SkeletonBlock lines={6} /></div>;
    const d = s.data;
    const sum = summary(d);
    const { have, ideas } = splitTerms(d.terms);
    const max = Math.max(0, ...d.terms.map((x) => x.count), ...d.categories.map((x) => x.count));
    return (
      <div className="container container-narrow radar-page">
        {back}
        <header className="page-header">
          <div>
            <h1><Radar size={22} aria-hidden="true" /> {t('radar.title')}</h1>
            <p>{SUMMARY[sum.key](sum.vars)}</p>
          </div>
        </header>
        {!d.terms.length && !d.categories.length ? (
          <EmptyState icon={Radar} title={t('radar.emptyTitle')}>{t('radar.emptyText')}</EmptyState>
        ) : null}
        {have.length ? (
          <section aria-labelledby="radar-have">
            <h2 id="radar-have" className="h5"><Check size={16} aria-hidden="true" /> {t('radar.have')}</h2>
            <p className="small muted">{t('radar.haveHint')}</p>
            <Bars rows={have} max={max} />
          </section>
        ) : null}
        {ideas.length ? (
          <section aria-labelledby="radar-ideas">
            <h2 id="radar-ideas" className="h5"><Lightbulb size={16} aria-hidden="true" /> {t('radar.ideas')}</h2>
            <p className="small muted">{t('radar.ideasHint')}</p>
            <Bars rows={ideas} max={max} />
          </section>
        ) : null}
        {d.categories.length ? (
          <section aria-labelledby="radar-cats">
            <h2 id="radar-cats" className="h5">{t('radar.categories')}</h2>
            <Bars rows={d.categories} max={max} />
          </section>
        ) : null}
        <p className="small muted radar-privacy"><ShieldCheck size={14} aria-hidden="true" /> {t('radar.privacy', { n: d.minHunters })}</p>
        <p className="small"><Link to={'/post/' + id + '/items'}>{t('radar.addItems')}</Link></p>
      </div>
    );
  }
}

export default WishRadar;
