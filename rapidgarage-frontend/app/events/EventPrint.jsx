import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Download, Printer, Copy, ExternalLink, FileText, Signpost, QrCode, Lock, ArrowRight, Ban } from 'lucide-react';
import { errorMessage, fetchEvent, fetchEventPrint, eventAssetUrl } from '../api';
import { Alert, EmptyState, SkeletonBlock } from '../components/ui';
import { flyerLines, signLines } from '../lib/flyerText';
import { LOCALES, loadCatalog, t, tIn, locale, intlLocale } from '../i18n';
import toast from '../components/toast';
import ScanStats from '../print/ScanStats';

const LAYOUTS = [
  { value: 'letter', labelKey: 'pf.flyer', sizeKey: 'pf.letter', icon: FileText },
  { value: 'half', labelKey: 'pf.half', sizeKey: 'pf.halfSize', icon: FileText },
  { value: 'sign', labelKey: 'pf.sign', sizeKey: 'pf.signSize', icon: Signpost },
];

// /events/:id/print: one shared flyer or yard sign for the whole neighborhood
// sale. Its QR code is the event's short link (/s/<code>), counted like a
// sale's scans; the PDF itself comes from the server (lib/flyer.js, kind "event").
export default class EventPrint extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, error: '', event: null, info: null, layout: 'letter', sales: true, arrow: 'right', lang: locale() };
  }

  componentDidMount() { this.load(); document.title = t('ev.printDocTitle'); }
  setLang(lang) { loadCatalog(lang).then(() => this.setState({ lang })).catch(() => null); }

  load() {
    const id = this.props.match.params.id;
    Promise.all([fetchEvent(id), fetchEventPrint(id)]).then(([e, i]) => {
      if (!e.ok) return this.setState({ loading: false, error: e.status === 404 ? 'not_found' : errorMessage(e.data, t('ev.loadFailed')) });
      if (!i.ok) return this.setState({ loading: false, event: e.data, error: i.status === 403 ? 'forbidden' : i.status === 401 ? 'login' : errorMessage(i.data, t('pf.qrFailed')) });
      return this.setState({ loading: false, event: e.data, info: i.data, sales: e.data.sales.length > 0 });
    }).catch(() => this.setState({ loading: false, error: t('common.networkShort') }));
  }

  copy() {
    const url = this.state.info.shortUrl;
    const done = () => toast.success(t('pf.copied'));
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => toast.info(url));
    else toast.info(url);
  }

  pdfParams(download) {
    const { layout, sales, arrow, lang } = this.state;
    const p = { layout, lang };
    if (layout === 'sign') p.arrow = arrow; else p.sales = sales ? 1 : 0;
    if (download) p.download = 1;
    return p;
  }

  renderSheet() {
    const { event: ev, info, layout, sales, arrow, lang } = this.state;
    const tl = (key, vars) => tIn(lang, key, vars);
    const qr = eventAssetUrl(ev.id, 'qr.svg');
    const head = tl('flyer.headline.neighborhood').toLocaleUpperCase(intlLocale(lang));
    if (layout === 'sign') {
      const lines = signLines(lang, ev);
      return (
        <div className="print-sheet sheet-sign" lang={lang} role="group" aria-label={t('pf.signPreview')}>
          <div className="sign-head">{head}</div>
          <div className={'sign-row sign-arrow-' + arrow}>
            {arrow === 'left' ? <ArrowRight className="sign-arrow flip" aria-hidden="true" strokeWidth={3} /> : null}
            <div className="sign-when">{(lines.length ? lines : [tl('flyer.seeListing')]).map((l, i) => <div key={i}>{l}</div>)}</div>
            {arrow === 'right' ? <ArrowRight className="sign-arrow" aria-hidden="true" strokeWidth={3} /> : null}
          </div>
          <div className="sign-foot">
            <div><div className="sign-street">{ev.areaLabel.toLocaleUpperCase(intlLocale(lang))}</div><div className="sign-place">{ev.name}</div></div>
            <figure className="sign-qr"><img src={qr} alt={tl('flyer.qrAlt', { url: info.shortUrl })} /><figcaption>{tl('flyer.eventScanForMap')}</figcaption></figure>
          </div>
        </div>
      );
    }
    const list = sales ? ev.sales.slice(0, layout === 'half' ? 4 : 6) : [];
    const lines = flyerLines(lang, ev);
    return (
      <div className={'print-sheet sheet-flyer' + (layout === 'half' ? ' sheet-half' : '')} lang={lang} role="group" aria-label={t('pf.flyerPreview')}>
        <div className="flyer-band"><span className="flyer-brand">RapidGarage</span><span>{tl('flyer.tagline')}</span></div>
        <div className="flyer-body">
          <div className="flyer-kicker">{head}</div>
          <h2 className="flyer-title">{ev.name}</h2>
          <div className="flyer-cols">
            <dl className="flyer-details">
              <dt>{tl('flyer.when')}</dt><dd className="strong">{lines.length ? lines.map((l, i) => <div key={i}>{l}</div>) : tl('flyer.seeDates')}</dd>
              <dt>{tl('flyer.where')}</dt><dd>{ev.areaLabel}</dd>
            </dl>
          </div>
          {list.length ? (
            <div className="flyer-items">
              <div className="flyer-label">{tl('flyer.eventSales')}</div>
              <ul>{list.map((s) => <li key={s.id}><span>{s.title}</span><strong>{s.street || ''}</strong></li>)}</ul>
              {ev.sales.length > list.length ? <p className="flyer-more">{tl('flyer.moreSales', { count: ev.sales.length - list.length })}</p> : null}
            </div>
          ) : null}
          <div className="flyer-qr">
            <img src={qr} alt={tl('flyer.qrAlt', { url: info.shortUrl })} />
            <div>
              <div className="flyer-qr-title">{tl('flyer.scanTitle')}</div>
              <div className="flyer-qr-hint">{tl('flyer.eventScanHint')}</div>
              <div className="flyer-url">{info.shortUrl}</div>
            </div>
          </div>
          <div className="flyer-foot">{tl('flyer.listed')}</div>
        </div>
      </div>
    );
  }

  render() {
    const { loading, error, event: ev, info, layout, sales, arrow } = this.state;
    const back = ev ? <Link className="back-link" to={'/events/' + ev.id}><ArrowLeft size={16} aria-hidden="true" />{t('ev.backToEvent')}</Link> : null;
    if (loading) return <div className="container"><SkeletonBlock lines={6} /></div>;
    if (error === 'not_found') return <div className="container container-narrow"><EmptyState level={1} title={t('ev.cantFind')}>{t('ev.notFound')}</EmptyState></div>;
    if (error === 'login') return <div className="container container-narrow"><EmptyState level={1} icon={Lock} title={t('pf.loginTitle')} action={<Link className="btn btn-primary" to="/login">{t('nav.logIn')}</Link>}>{t('ev.onlyOrganizerPrint')}</EmptyState></div>;
    if (error === 'forbidden') return <div className="container container-narrow">{back}<EmptyState level={1} icon={Lock} title={t('ev.onlyOrganizer')}>{t('ev.onlyOrganizerPrint')}</EmptyState></div>;
    if (error) return <div className="container container-narrow">{back}<Alert tone="danger">{error}</Alert></div>;
    const pdf = (download) => eventAssetUrl(ev.id, 'flyer.pdf', this.pdfParams(download));
    const pageSize = layout === 'sign' ? 'letter landscape' : layout === 'half' ? '5.5in 8.5in' : 'letter';
    return (
      <div className="container print-page">
        <style>{'@media print { @page { size: ' + pageSize + '; margin: 0; } }'}</style>
        <div className="no-print">
          {back}
          <header className="page-header"><div><h1>{t('ev.print')}</h1><p className="muted">{t('ev.printLead')}</p></div></header>
        </div>
        {!info.canPrint ? <Alert tone="warning" className="no-print"><p>{info.hidden ? t('ev.printHidden') : t('pf.adminView')}</p></Alert> : null}
        <div className="print-layout">
          <div className="stack no-print">
            {info.canPrint ? (
              <section className="panel stack" aria-labelledby="print-what">
                <h2 id="print-what" className="h4">{t('pf.what')}</h2>
                <div className="layout-choices" role="radiogroup" aria-label={t('pf.layout')}>
                  {LAYOUTS.map((l) => {
                    const Icon = l.icon;
                    return (
                      <label key={l.value} className={'layout-choice' + (layout === l.value ? ' on' : '')}>
                        <input type="radio" name="layout" className="sr-only" value={l.value} checked={layout === l.value} onChange={() => this.setState({ layout: l.value })} />
                        <Icon size={20} aria-hidden="true" /><span><strong>{t(l.labelKey)}</strong><span className="small muted">{t(l.sizeKey)}</span></span>
                      </label>
                    );
                  })}
                </div>
                <label className="field-label" htmlFor="print-lang">{t('pf.language')}</label>
                <select id="print-lang" className="select" value={this.state.lang} onChange={(e) => this.setLang(e.target.value)}>
                  {LOCALES.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.name}</option>)}
                </select>
                {layout === 'sign' ? (
                  <div>
                    <div className="field-label" id="arrow-label">{t('pf.arrow')}</div>
                    <div className="segmented" role="group" aria-labelledby="arrow-label">
                      <button type="button" aria-pressed={arrow === 'left'} onClick={() => this.setState({ arrow: 'left' })}>{t('pf.left')}</button>
                      <button type="button" aria-pressed={arrow === 'none'} onClick={() => this.setState({ arrow: 'none' })}><Ban size={14} aria-hidden="true" />{t('pf.none')}</button>
                      <button type="button" aria-pressed={arrow === 'right'} onClick={() => this.setState({ arrow: 'right' })}>{t('pf.right')}</button>
                    </div>
                  </div>
                ) : (
                  <label className="checkbox-row"><input type="checkbox" checked={sales} disabled={!ev.sales.length} onChange={(e) => this.setState({ sales: e.target.checked })} />
                    <span>{t('ev.listSales')}{!ev.sales.length ? <span className="muted">{t('ev.noSalesYet')}</span> : null}</span></label>
                )}
                <div className="form-actions">
                  <a className="btn btn-primary" href={pdf(true)} download><Download size={16} aria-hidden="true" />{t('pf.download')}</a>
                  <a className="btn btn-secondary" href={pdf(false)} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} aria-hidden="true" />{t('pf.open')}</a>
                  <button type="button" className="btn btn-ghost" onClick={() => window.print()}><Printer size={16} aria-hidden="true" />{t('pf.printPreview')}</button>
                </div>
                <p className="small muted">{t('ev.printHint')}</p>
              </section>
            ) : null}
            <section className="panel stack" aria-labelledby="qr-h">
              <h2 id="qr-h" className="h4"><QrCode size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />{t('pf.qrLink')}</h2>
              <div className="qr-row">
                {info.canPrint ? <img className="qr-preview" src={eventAssetUrl(ev.id, 'qr.svg')} alt={t('flyer.qrAlt', { url: info.shortUrl })} width="132" height="132" /> : null}
                <div className="stack-tight">
                  <code className="short-url">{info.shortUrl}</code>
                  <div className="form-actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => this.copy()}><Copy size={14} aria-hidden="true" />{t('pf.copy')}</button>
                    {info.canPrint ? <a className="btn btn-secondary btn-sm" href={eventAssetUrl(ev.id, 'qr.png', { size: 1024, download: 1 })} download><Download size={14} aria-hidden="true" />PNG</a> : null}
                    {info.canPrint ? <a className="btn btn-secondary btn-sm" href={eventAssetUrl(ev.id, 'qr.svg', { download: 1 })} download><Download size={14} aria-hidden="true" />SVG</a> : null}
                  </div>
                  <p className="small muted">{t('ev.qrHint')}</p>
                </div>
              </div>
            </section>
            <section className="panel" aria-labelledby="scans-h">
              <h2 id="scans-h" className="h4">{t('pf.scans')}</h2>
              <ScanStats scans={info.scans} />
            </section>
          </div>
          {info.canPrint ? <div className="print-preview-wrap"><div className="small muted no-print preview-label">{t('pf.preview')}</div>{this.renderSheet()}</div> : null}
        </div>
      </div>
    );
  }
}
