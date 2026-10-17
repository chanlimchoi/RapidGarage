import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Download, Printer, Copy, ExternalLink, FileText, Signpost, QrCode, Lock, ArrowRight, Ban } from 'lucide-react';
import { apiFetch, errorMessage, fetchPrintInfo, printAssetUrl } from '../api';
import { Alert, EmptyState, SkeletonBlock } from '../components/ui';
import { saleDays } from '../lib/schedule';
import { formatPrice } from '../lib/price';
import { formatCents } from '../lib/items';
import toast from '../components/toast';
import ScanStats from './ScanStats';

const LAYOUTS = [
  { value: 'letter', label: 'Flyer', size: 'Letter, 8.5 × 11 in', icon: FileText },
  { value: 'half', label: 'Half-page flyer', size: '5.5 × 8.5 in', icon: FileText },
  { value: 'sign', label: 'Yard sign', size: 'Letter landscape, big text', icon: Signpost },
];
const HEADLINES = [['garage', 'Garage sale'], ['yard', 'Yard sale'], ['moving', 'Moving sale'], ['estate', 'Estate sale']];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function clock12(hhmm, compact) {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  const t = (h % 12 || 12) + (m ? ':' + String(m).padStart(2, '0') : '');
  return t + (compact ? '' : ' ') + (h >= 12 ? 'PM' : 'AM');
}
function parts(date) {
  const [y, m, d] = date.split('-').map(Number);
  return { wd: WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()], mon: MON[m - 1], d };
}
// Printed text never says "Today"/"Tomorrow": paper outlives the day.
function upcoming(post) {
  const all = saleDays(post).filter((d) => d.end);
  const live = all.filter((d) => d.endsAt > Date.now());
  return live.length ? live : all;
}
const flyerLines = (post) => upcoming(post).map((d) => { const p = parts(d.date); return p.wd + ', ' + p.mon + ' ' + p.d + ' · ' + clock12(d.start) + ' – ' + clock12(d.end); });
function signLines(post) {
  const days = upcoming(post);
  if (!days.length) return [];
  const same = days.every((d) => d.start === days[0].start && d.end === days[0].end);
  const hours = (d) => clock12(d.start, true) + '–' + clock12(d.end, true);
  if (same && days.length <= 3) return [days.map((d) => parts(d.date).wd).join(' & ').toUpperCase(), hours(days[0])];
  return days.slice(0, 2).map((d) => (parts(d.date).wd + ' ' + parts(d.date).mon + ' ' + parts(d.date).d + ' ' + hours(d)).toUpperCase());
}

export default class PrintFlyer extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, error: '', post: null, info: null, layout: 'letter', photo: true, items: true, headline: 'garage', arrow: 'right' };
  }

  componentDidMount() { this.load(); document.title = 'Print flyer & sign · RapidGarage'; }

  load() {
    const id = this.props.match.params.id;
    Promise.all([apiFetch('/post/' + id), fetchPrintInfo(id)]).then(([p, i]) => {
      if (!p.ok) return this.setState({ loading: false, error: p.status === 404 ? 'not_found' : errorMessage(p.data, 'Could not load this sale.') });
      if (!i.ok) return this.setState({ loading: false, post: p.data, error: i.status === 403 ? 'forbidden' : i.status === 401 ? 'login' : errorMessage(i.data, 'Could not load the QR code.') });
      return this.setState({ loading: false, post: p.data, info: i.data, photo: !!(p.data.photos || []).length });
    }).catch(() => this.setState({ loading: false, error: 'Unable to reach the server.' }));
  }

  copy() {
    const url = this.state.info.shortUrl;
    const done = () => toast.success('Link copied.');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => toast.info(url));
    else toast.info(url);
  }

  pdfParams(download) {
    const { layout, photo, items, headline, arrow } = this.state;
    const p = { layout };
    if (layout === 'sign') Object.assign(p, { headline, arrow });
    else Object.assign(p, { headline, photo: photo ? 1 : 0, items: items ? 1 : 0 });
    if (download) p.download = 1;
    return p;
  }

  renderSheet() {
    const { post, info, layout, photo, items, headline, arrow } = this.state;
    const qr = printAssetUrl(post.id, 'qr.svg');
    const head = (HEADLINES.find((h) => h[0] === headline) || HEADLINES[0])[1];
    const place = [post.city, [post.state, post.zipCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const price = formatPrice(post);
    if (layout === 'sign') {
      const lines = signLines(post);
      return (
        <div className="print-sheet sheet-sign" aria-label="Yard sign preview">
          <div className="sign-head">{head.toUpperCase()}</div>
          <div className={'sign-row sign-arrow-' + arrow}>
            {arrow === 'left' ? <ArrowRight className="sign-arrow flip" aria-hidden="true" strokeWidth={3} /> : null}
            <div className="sign-when">{(lines.length ? lines : ['SEE LISTING']).map((l, i) => <div key={i}>{l}</div>)}</div>
            {arrow === 'right' ? <ArrowRight className="sign-arrow" aria-hidden="true" strokeWidth={3} /> : null}
          </div>
          <div className="sign-foot">
            <div>
              {post.street ? <div className="sign-street">{post.street.toUpperCase()}</div> : null}
              {place ? <div className="sign-place">{place}</div> : null}
              {price ? <div className="sign-price">{price}</div> : null}
            </div>
            <figure className="sign-qr"><img src={qr} alt={'QR code for ' + info.shortUrl} /><figcaption>SCAN FOR ITEMS</figcaption></figure>
          </div>
        </div>
      );
    }
    const unsold = (post.items || []).filter((i) => !i.sold);
    const shownItems = items ? unsold.slice(0, layout === 'half' ? 4 : 6) : [];
    const firstPhoto = photo && (post.photos || [])[0];
    const lines = flyerLines(post);
    return (
      <div className={'print-sheet sheet-flyer' + (layout === 'half' ? ' sheet-half' : '')} aria-label="Flyer preview">
        <div className="flyer-band"><span className="flyer-brand">RapidGarage</span><span>Garage &amp; yard sales near you</span></div>
        <div className="flyer-body">
          <div className="flyer-kicker">{head.toUpperCase()}</div>
          <h2 className="flyer-title">{post.title}</h2>
          <div className={'flyer-cols' + (firstPhoto ? ' has-photo' : '')}>
            <dl className="flyer-details">
              <dt>When</dt><dd className="strong">{lines.length ? lines.map((l, i) => <div key={i}>{l}</div>) : 'See the listing for dates and times.'}</dd>
              <dt>Where</dt><dd>{post.street}<br />{place}</dd>
              {price ? <React.Fragment><dt>Prices</dt><dd className="strong">{price}</dd></React.Fragment> : null}
            </dl>
            {firstPhoto ? <img className="flyer-photo" src={firstPhoto.url} alt="" /> : null}
          </div>
          {shownItems.length ? (
            <div className="flyer-items">
              <div className="flyer-label">Featured items</div>
              <ul>{shownItems.map((i) => <li key={i.id}><span>{i.name}</span>{i.priceCents != null ? <strong>{formatCents(i.priceCents)}</strong> : null}</li>)}</ul>
              {unsold.length > shownItems.length ? <p className="flyer-more">…and {unsold.length - shownItems.length} more on the listing</p> : null}
            </div>
          ) : null}
          <div className="flyer-qr">
            <img src={qr} alt={'QR code for ' + info.shortUrl} />
            <div>
              <div className="flyer-qr-title">Scan for photos, items &amp; directions</div>
              <div className="flyer-qr-hint">Point your phone camera at the code, or type:</div>
              <div className="flyer-url">{info.shortUrl}</div>
            </div>
          </div>
          <div className="flyer-foot">Listed on RapidGarage</div>
        </div>
      </div>
    );
  }

  render() {
    const { loading, error, post, info, layout, photo, items, headline, arrow } = this.state;
    const back = post ? <Link className="back-link" to={'/post/' + post.id}><ArrowLeft size={16} aria-hidden="true" />Back to the sale</Link> : null;
    if (loading) return <div className="container"><SkeletonBlock lines={6} /></div>;
    if (error === 'not_found') return <div className="container container-narrow"><EmptyState title="Sale not found">It may have been removed.</EmptyState></div>;
    if (error === 'login') return <div className="container container-narrow"><EmptyState icon={Lock} title="Log in to print flyers" action={<Link className="btn btn-primary" to="/login">Log in</Link>}>Only the seller can print flyers and signs for a sale.</EmptyState></div>;
    if (error === 'forbidden') return <div className="container container-narrow">{back}<EmptyState icon={Lock} title="Only the seller can print flyers">Flyers and signs carry this sale's QR code, so only its seller can make them.</EmptyState></div>;
    if (error) return <div className="container container-narrow">{back}<Alert tone="danger">{error}</Alert></div>;
    const pdf = (download) => printAssetUrl(post.id, 'flyer.pdf', this.pdfParams(download));
    const pageSize = layout === 'sign' ? 'letter landscape' : layout === 'half' ? '5.5in 8.5in' : 'letter';
    return (
      <div className="container print-page">
        <style>{'@media print { @page { size: ' + pageSize + '; margin: 0; } }'}</style>
        <div className="no-print">
          {back}
          <header className="page-header">
            <div>
              <h1>Print flyer &amp; sign</h1>
              <p className="muted">Every printout has a QR code that opens this sale. You'll see how many people scanned it.</p>
            </div>
          </header>
        </div>
        {!info.canPrint ? (
          <Alert tone="warning" className="no-print"><p>{info.hidden ? 'A moderator has hidden this sale, so its QR code shows "not available". Printing is off until it\'s visible again.' : 'Only the seller can print flyers. Scan counts are shown below.'}</p></Alert>
        ) : null}
        <div className="print-layout">
          <div className="stack no-print">
            {info.canPrint ? (
              <section className="panel stack" aria-labelledby="print-what">
                <h2 id="print-what" className="h4">What to print</h2>
                <div className="layout-choices" role="radiogroup" aria-label="Layout">
                  {LAYOUTS.map((l) => {
                    const Icon = l.icon;
                    return (
                      <label key={l.value} className={'layout-choice' + (layout === l.value ? ' on' : '')}>
                        <input type="radio" name="layout" className="sr-only" value={l.value} checked={layout === l.value} onChange={() => this.setState({ layout: l.value })} />
                        <Icon size={20} aria-hidden="true" /><span><strong>{l.label}</strong><span className="small muted">{l.size}</span></span>
                      </label>
                    );
                  })}
                </div>
                <label className="field-label" htmlFor="print-headline">Headline</label>
                <select id="print-headline" className="select" value={headline} onChange={(e) => this.setState({ headline: e.target.value })}>
                  {HEADLINES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
                {layout === 'sign' ? (
                  <div>
                    <div className="field-label" id="arrow-label">Arrow</div>
                    <div className="segmented" role="group" aria-labelledby="arrow-label">
                      <button type="button" aria-pressed={arrow === 'left'} onClick={() => this.setState({ arrow: 'left' })}>← Left</button>
                      <button type="button" aria-pressed={arrow === 'none'} onClick={() => this.setState({ arrow: 'none' })}><Ban size={14} aria-hidden="true" />None</button>
                      <button type="button" aria-pressed={arrow === 'right'} onClick={() => this.setState({ arrow: 'right' })}>Right →</button>
                    </div>
                  </div>
                ) : (
                  <div className="stack-tight">
                    <label className="checkbox-row"><input type="checkbox" checked={photo} disabled={!(post.photos || []).length} onChange={(e) => this.setState({ photo: e.target.checked })} />
                      <span>Include the first photo{!(post.photos || []).length ? <span className="muted"> (this sale has no photos)</span> : null}</span></label>
                    <label className="checkbox-row"><input type="checkbox" checked={items} disabled={!(post.items || []).some((i) => !i.sold)} onChange={(e) => this.setState({ items: e.target.checked })} />
                      <span>List a few unsold items{!(post.items || []).some((i) => !i.sold) ? <span className="muted"> (no unsold items)</span> : null}</span></label>
                  </div>
                )}
                <div className="form-actions">
                  <a className="btn btn-primary" href={pdf(true)} download><Download size={16} aria-hidden="true" />Download PDF</a>
                  <a className="btn btn-secondary" href={pdf(false)} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} aria-hidden="true" />Open PDF</a>
                  <button type="button" className="btn btn-ghost" onClick={() => window.print()}><Printer size={16} aria-hidden="true" />Print preview</button>
                </div>
                <p className="small muted">The PDF is print-ready (use "Actual size"). "Print preview" prints the page on the right straight from your browser.</p>
              </section>
            ) : null}
            <section className="panel stack" aria-labelledby="qr-h">
              <h2 id="qr-h" className="h4"><QrCode size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />QR code &amp; link</h2>
              <div className="qr-row">
                {info.canPrint ? <img className="qr-preview" src={printAssetUrl(post.id, 'qr.svg')} alt={'QR code for ' + info.shortUrl} width="132" height="132" /> : null}
                <div className="stack-tight">
                  <code className="short-url">{info.shortUrl}</code>
                  <div className="form-actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => this.copy()}><Copy size={14} aria-hidden="true" />Copy link</button>
                    {info.canPrint ? <a className="btn btn-secondary btn-sm" href={printAssetUrl(post.id, 'qr.png', { size: 1024, download: 1 })} download><Download size={14} aria-hidden="true" />PNG</a> : null}
                    {info.canPrint ? <a className="btn btn-secondary btn-sm" href={printAssetUrl(post.id, 'qr.svg', { download: 1 })} download><Download size={14} aria-hidden="true" />SVG</a> : null}
                  </div>
                  <p className="small muted">Use it on your own posters or online. Scans of this link are counted too.</p>
                </div>
              </div>
            </section>
            <section className="panel" aria-labelledby="scans-h">
              <h2 id="scans-h" className="h4">Scans</h2>
              <ScanStats scans={info.scans} />
            </section>
          </div>
          {info.canPrint ? <div className="print-preview-wrap"><div className="small muted no-print preview-label">Preview</div>{this.renderSheet()}</div> : null}
        </div>
      </div>
    );
  }
}
