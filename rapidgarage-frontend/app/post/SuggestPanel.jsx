import React from 'react';
import { Wand2, Check, RotateCcw, X } from 'lucide-react';
import { suggestListing, errorMessage } from '../api';
import { Alert, Spinner } from '../components/ui';
import { formatPrice } from '../lib/price';
import { categoryLabel } from '../wanted/WantedCard';
import { patchFrom, basisText } from '../lib/listingSuggest';
import { t } from '../i18n';

// "Post a sale": once a photo is picked, suggest a title, category and price
// range. The seller uses all of it, one part, or nothing; the form is never
// submitted from here. props: file (first photo or null), hint() -> title so far, onUse(patch)
export default class SuggestPanel extends React.Component {
  constructor(props) {
    super(props);
    this.state = { busy: false, error: '', suggestion: null, dismissed: false, used: false };
  }

  componentDidMount() { this.mounted = true; if (this.props.file) this.ask(); }
  componentDidUpdate(prev) {
    // A new first photo asks again (unless the seller dismissed suggestions).
    if (this.props.file && this.props.file !== prev.file && !this.state.dismissed) this.ask();
    if (!this.props.file && prev.file) this.setState({ suggestion: null, error: '', used: false });
  }
  componentWillUnmount() { this.mounted = false; }

  ask() {
    const seq = (this.seq = (this.seq || 0) + 1);
    this.setState({ busy: true, error: '', used: false });
    suggestListing(this.props.file, this.props.hint ? this.props.hint() : '').then(({ ok, data }) => {
      if (!this.mounted || seq !== this.seq) return;
      if (!ok) return this.setState({ busy: false, error: errorMessage(data, t('suggest.failed')) });
      return this.setState({ busy: false, suggestion: data });
    }).catch(() => this.mounted && seq === this.seq && this.setState({ busy: false, error: t('common.network') }));
  }

  use(pick) {
    this.props.onUse(patchFrom(this.state.suggestion, pick));
    if (!pick) this.setState({ used: true });
  }

  render() {
    if (!this.props.file || this.state.dismissed) return null;
    const { busy, error, suggestion: s, used } = this.state;
    const basis = basisText(s);
    const price = s ? formatPrice({ isFree: false, priceMin: s.priceMin, priceMax: s.priceMax }) : '';
    return (
      <section className="card-form ai-draft suggest-panel" aria-labelledby="suggest-title" aria-busy={busy}>
        <div className="suggest-head">
          <h2 id="suggest-title" className="h4"><Wand2 size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />{t('suggest.title')}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.setState({ dismissed: true })} aria-label={t('suggest.dismiss')}><X size={16} aria-hidden="true" /></button>
        </div>
        {busy ? <p className="small muted" role="status"><Spinner /> {t('suggest.working')}</p> : null}
        {!busy && s ? (
          <React.Fragment>
            <ul className="suggest-list" aria-live="polite">
              <li className="suggest-row">
                <span className="suggest-label">{t('form.title')}</span><span className="suggest-value"><strong>{s.title}</strong></span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.use({ title: true })}>{t('suggest.useTitle')}</button>
              </li>
              {s.category ? (
                <li className="suggest-row">
                  <span className="suggest-label">{t('form.category')}</span><span className="suggest-value"><span className="chip">{categoryLabel(s.category)}</span></span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.use({ category: true })} >{t('suggest.useCategory')}</button>
                </li>
              ) : null}
              {price ? (
                <li className="suggest-row">
                  <span className="suggest-label">{t('form.prices')}</span><span className="suggest-value"><span className="chip chip-price">{price}</span></span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.use({ price: true })} >{t('suggest.usePrice')}</button>
                </li>
              ) : null}
            </ul>
            {basis ? <p className="small muted">{t(basis.key, basis.vars)}{s.aiFailed ? ' ' + t('suggest.aiFailed') : ''}</p> : null}
            {used ? <Alert tone="success" live>{t('suggest.used')}</Alert> : null}
            <div className="form-actions">
              <button type="button" className="btn btn-primary" onClick={() => this.use(null)}><Check size={16} aria-hidden="true" />{t('suggest.useAll')}</button>
              <button type="button" className="btn btn-ghost" onClick={() => this.ask()}><RotateCcw size={16} aria-hidden="true" />{t('suggest.again')}</button>
            </div>
          </React.Fragment>
        ) : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <p className="small muted ai-draft-privacy">{t('suggest.note')}</p>
      </section>
    );
  }
}
