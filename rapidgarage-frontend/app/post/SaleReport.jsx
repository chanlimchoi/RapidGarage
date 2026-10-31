import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Printer, Download, FileText, Lock } from 'lucide-react';
import { fetchSaleReport, errorMessage } from '../api';
import { Alert, EmptyState, SkeletonBlock } from '../components/ui';
import { formatCents } from '../lib/items';
import { dayLines } from '../lib/schedule';
import { reachRows, keptPercent, soldPercent, reportCsv, reportFileName } from '../lib/saleReport';
import { t, intlLocale } from '../i18n';

const REACH_LABEL = {
  views: () => t('report.views'), scans: () => t('report.scans'), shares: () => t('report.shares'), saves: () => t('report.saves'),
  conversations: () => t('report.conversations'), messages: () => t('report.messages'), holdsCompleted: () => t('report.holdsCompleted'),
};

const paramId = (props) => (props.match && props.match.params && props.match.params.id) || (props.params && props.params.id);

// /post/:id/report (seller only): a printable after-sale summary. "Print or
// save as PDF" uses the browser's print dialog; print CSS drops the app
// chrome. Count-only: no visitor or buyer is named.
class SaleReport extends Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, report: null, error: '', status: 0 };
  }

  componentDidMount() {
    this.mounted = true;
    fetchSaleReport(paramId(this.props)).then(({ ok, status, data }) => {
      if (!this.mounted) return;
      if (!ok) return this.setState({ loading: false, status, error: errorMessage(data, t('report.loadFailed')) });
      return this.setState({ loading: false, report: data });
    }).catch(() => this.mounted && this.setState({ loading: false, error: t('common.network') }));
  }
  componentWillUnmount() { this.mounted = false; }

  download() {
    const r = this.state.report;
    const csv = reportCsv(r, { item: t('report.colItem'), status: t('report.colStatus'), listed: t('report.colListed'), soldFor: t('report.colSoldFor'), source: t('report.colSource'), sold: t('report.sold'), unsold: t('report.unsold') });
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = reportFileName(r.post.title);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  render() {
    const s = this.state;
    const id = paramId(this.props);
    const back = <Link to={'/dashboard/sales/' + id} className="back-link no-print"><ArrowLeft size={16} aria-hidden="true" />{t('dash.saleStats')}</Link>;
    if (this.props.ready && !this.props.user) {
      return <div className="container container-narrow"><EmptyState level={1} icon={Lock} title={t('dash.loginTitle')} action={<Link className="btn btn-primary" to="/login">{t('nav.logIn')}</Link>}>{t('dash.loginText')}</EmptyState></div>;
    }
    if (s.loading) return <div className="container container-narrow"><SkeletonBlock lines={6} /></div>;
    if (!s.report) return <div className="container container-narrow">{back}<Alert tone="danger">{s.error}</Alert></div>;
    const r = s.report;
    const tot = r.totals;
    const kept = keptPercent(tot);
    const soldPct = soldPercent(tot);
    const generated = new Date(r.generatedAt).toLocaleString(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' });
    const price = (c) => (c === null || c === undefined ? t('report.noPrice') : formatCents(c));
    return (
      <div className="container sale-report">
        {back}
        <div className="row no-print sale-report-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}><Printer size={16} aria-hidden="true" />{t('report.print')}</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => this.download()} disabled={!tot.items}><Download size={16} aria-hidden="true" />{t('report.csv')}</button>
        </div>
        <article className="report-sheet stack">
          <header>
            <p className="small muted"><FileText size={14} aria-hidden="true" /> {t('report.kicker')}</p>
            <h1>{r.post.title}</h1>
            <p className="muted">{[r.post.city, r.post.state].filter(Boolean).join(', ')}</p>
            <ul className="report-days">{dayLines(r.post).map((l) => <li key={l}>{l}</li>)}</ul>
            <p className="small muted">{t('report.generated', { when: generated })}</p>
          </header>

          <section aria-labelledby="report-totals" className="report-section">
            <h2 id="report-totals" className="h4">{t('report.totals')}</h2>
            <dl className="report-totals">
              <div><dt>{t('report.earned')}</dt><dd>{formatCents(tot.earnedCents) || formatCents(0)}</dd></div>
              <div><dt>{t('report.itemsSold')}</dt><dd>{t('report.soldOf', { sold: tot.sold, total: tot.items })}{soldPct !== null ? ' (' + soldPct + '%)' : ''}</dd></div>
              <div><dt>{t('report.listedSold')}</dt><dd>{formatCents(tot.listedValueSoldCents) || '—'}{kept !== null ? ' · ' + t('report.kept', { percent: kept }) : ''}</dd></div>
              <div><dt>{t('report.left')}</dt><dd>{t('report.leftValue', { count: tot.unsold, value: formatCents(tot.unsoldListedCents) || '—' })}</dd></div>
            </dl>
            <p className="small muted">{t('report.earnedNote')}{tot.soldWithoutPrice ? ' ' + t('report.withoutPrice', { count: tot.soldWithoutPrice }) : ''}</p>
          </section>

          <section aria-labelledby="report-sold" className="report-section">
            <h2 id="report-sold" className="h4">{t('report.soldItems', { count: r.sold.length })}</h2>
            {r.sold.length ? (
              <table className="report-table">
                <thead><tr><th scope="col">{t('report.colItem')}</th><th scope="col">{t('report.colListed')}</th><th scope="col">{t('report.colSoldFor')}</th></tr></thead>
                <tbody>
                  {r.sold.map((i) => (
                    <tr key={i.id}><td>{i.name}</td><td>{price(i.listedCents)}</td><td>{price(i.soldCents)}{i.priceSource === 'offer' ? <span className="small muted"> · {t('report.byOffer')}</span> : null}</td></tr>
                  ))}
                </tbody>
                <tfoot><tr><th scope="row">{t('report.total')}</th><td>{formatCents(tot.listedValueSoldCents) || '—'}</td><td>{formatCents(tot.earnedCents) || formatCents(0)}</td></tr></tfoot>
              </table>
            ) : <p className="muted">{t('report.noneSold')}</p>}
          </section>

          {r.unsold.length ? (
            <section aria-labelledby="report-unsold" className="report-section">
              <h2 id="report-unsold" className="h4">{t('report.unsoldItems', { count: r.unsold.length })}</h2>
              <ul className="report-unsold">{r.unsold.map((i) => <li key={i.id}>{i.name}{i.listedCents != null ? ' · ' + formatCents(i.listedCents) : ''}</li>)}</ul>
            </section>
          ) : null}

          <section aria-labelledby="report-reach" className="report-section">
            <h2 id="report-reach" className="h4">{t('report.reach')}</h2>
            <dl className="report-totals report-reach">
              {reachRows(r).map((x) => <div key={x.key}><dt>{REACH_LABEL[x.key]()}</dt><dd>{x.value.toLocaleString(intlLocale())}</dd></div>)}
            </dl>
            {r.daily.length ? (
              <table className="report-table report-daily">
                <thead><tr><th scope="col">{t('report.colDay')}</th><th scope="col">{t('report.views')}</th><th scope="col">{t('report.scans')}</th><th scope="col">{t('report.shares')}</th></tr></thead>
                <tbody>{r.daily.map((d) => <tr key={d.day}><td>{new Date(d.day + 'T12:00:00Z').toLocaleDateString(intlLocale(), { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}</td><td>{d.views}</td><td>{d.scans}</td><td>{d.shares}</td></tr>)}</tbody>
              </table>
            ) : null}
            <p className="small muted">{t('report.privacy')}</p>
          </section>
        </article>
      </div>
    );
  }
}

export default SaleReport;
