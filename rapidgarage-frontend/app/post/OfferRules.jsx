import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Lock, Gavel } from 'lucide-react';
import { fetchOfferRules, saveSaleOfferRule, saveItemOfferRule, errorMessage } from '../api';
import { Alert, EmptyState, Field, SkeletonBlock, Spinner } from '../components/ui';
import { formatCents, centsInput } from '../lib/items';
import { itemRuleErrors, saleRuleErrors, percentValue, ruleLines } from '../lib/offerRules';
import toast from '../components/toast';
import { t } from '../i18n';

const paramId = (props) => (props.match && props.match.params && props.match.params.id) || (props.params && props.params.id);
const ERR = {
  'offerRules.errAmount': () => t('offerRules.errAmount'), 'offerRules.errFree': () => t('offerRules.errFree'),
  'offerRules.errBelowAsking': () => t('offerRules.errBelowAsking'), 'offerRules.errFloorBelowAccept': () => t('offerRules.errFloorBelowAccept'),
  'offerRules.errPercent': () => t('offerRules.errPercent'),
};
const LINE = {
  'offerRules.acceptsAt': (price) => t('offerRules.acceptsAt', { price }),
  'offerRules.declinesBelow': (price) => t('offerRules.declinesBelow', { price }),
};
const errText = (e) => { const o = {}; Object.keys(e).forEach((k) => { o[k] = ERR[e[k]] ? ERR[e[k]]() : e[k]; }); return o; };
const serverErrors = (data) => (data && data.error && data.error.details) || {};

// /post/:id/offer-rules (seller only): offers at or above the auto-accept
// price are accepted (and the item reserved) right away, offers below the
// floor get a polite no; only offers in between wait for you. Buyers never
// see these prices.
class OfferRules extends Component {
  constructor(props) {
    super(props);
    this.state = { data: null, error: '', sale: { acceptPercent: '', floorPercent: '' }, saleErrors: {}, savingSale: false, rows: {}, rowErrors: {}, busy: null };
  }

  componentDidMount() {
    this.mounted = true;
    fetchOfferRules(paramId(this.props)).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) return this.setState({ error: errorMessage(data, t('offerRules.loadFailed')) });
      return this.take(data);
    }).catch(() => this.mounted && this.setState({ error: t('common.network') }));
  }
  componentWillUnmount() { this.mounted = false; }

  take(data) {
    const rows = {};
    data.items.forEach((i) => { rows[i.id] = { accept: centsInput(i.acceptCents), floor: centsInput(i.floorCents) }; });
    this.setState({ data, rows, sale: { acceptPercent: data.sale.acceptPercent ? String(data.sale.acceptPercent) : '', floorPercent: data.sale.floorPercent ? String(data.sale.floorPercent) : '' } });
  }

  saveSale(e) {
    e.preventDefault();
    const errs = saleRuleErrors(this.state.sale);
    this.setState({ saleErrors: errText(errs) });
    if (Object.keys(errs).length) return;
    this.setState({ savingSale: true });
    const body = { acceptPercent: percentValue(this.state.sale.acceptPercent), floorPercent: percentValue(this.state.sale.floorPercent) };
    saveSaleOfferRule(paramId(this.props), body).then(({ ok, data }) => {
      this.setState({ savingSale: false });
      if (!ok) { this.setState({ saleErrors: serverErrors(data) }); if (!Object.keys(serverErrors(data)).length) toast.error(errorMessage(data, t('offerRules.saveFailed'))); return; }
      this.take(data);
      toast.success(t('common.saved'));
    }).catch(() => { this.setState({ savingSale: false }); toast.error(t('common.network')); });
  }

  saveItem(e, item) {
    e.preventDefault();
    const row = this.state.rows[item.id];
    const errs = itemRuleErrors(row, item.priceCents);
    this.setState({ rowErrors: Object.assign({}, this.state.rowErrors, { [item.id]: errText(errs) }) });
    if (Object.keys(errs).length) return;
    this.setState({ busy: item.id });
    saveItemOfferRule(paramId(this.props), item.id, { accept: row.accept.trim() || null, floor: row.floor.trim() || null }).then(({ ok, data }) => {
      this.setState({ busy: null });
      if (!ok) { this.setState({ rowErrors: Object.assign({}, this.state.rowErrors, { [item.id]: serverErrors(data) }) }); if (!Object.keys(serverErrors(data)).length) toast.error(errorMessage(data, t('offerRules.saveFailed'))); return; }
      this.take(data);
      toast.success(t('common.saved'));
    }).catch(() => { this.setState({ busy: null }); toast.error(t('common.network')); });
  }

  setRow(id, patch) { this.setState({ rows: Object.assign({}, this.state.rows, { [id]: Object.assign({}, this.state.rows[id], patch) }) }); }

  render() {
    const s = this.state;
    const id = paramId(this.props);
    const back = <Link to={'/post/' + id + '/items'} className="back-link"><ArrowLeft size={16} aria-hidden="true" />{t('items.title')}</Link>;
    if (this.props.ready && !this.props.user) {
      return <div className="container container-narrow"><EmptyState level={1} icon={Lock} title={t('dash.loginTitle')} action={<Link className="btn btn-primary" to="/login">{t('nav.logIn')}</Link>}>{t('dash.loginText')}</EmptyState></div>;
    }
    if (s.error) return <div className="container container-narrow">{back}<Alert tone="danger">{s.error}</Alert></div>;
    if (!s.data) return <div className="container container-narrow"><SkeletonBlock lines={6} /></div>;
    const items = s.data.items.filter((i) => !i.sold && i.priceCents !== 0);
    return (
      <div className="container container-narrow offer-rules">
        {back}
        <header className="page-header"><div><h1><Gavel size={22} aria-hidden="true" /> {t('offerRules.title')}</h1><p>{t('offerRules.intro')}</p></div></header>
        <form className="card-form" onSubmit={(e) => this.saveSale(e)} noValidate aria-labelledby="or-sale">
          <h2 id="or-sale" className="h4">{t('offerRules.saleTitle')}</h2>
          <p className="small muted">{t('offerRules.saleHelp')}</p>
          <div className="item-form-row">
            <Field id="or-accept" label={t('offerRules.acceptPercent')} optional error={s.saleErrors.acceptPercent}>
              <input id="or-accept" className="input" inputMode="numeric" maxLength={3} placeholder="80" value={s.sale.acceptPercent}
                onChange={(e) => this.setState({ sale: Object.assign({}, s.sale, { acceptPercent: e.target.value }) })} />
            </Field>
            <Field id="or-floor" label={t('offerRules.floorPercent')} optional error={s.saleErrors.floorPercent}>
              <input id="or-floor" className="input" inputMode="numeric" maxLength={3} placeholder="50" value={s.sale.floorPercent}
                onChange={(e) => this.setState({ sale: Object.assign({}, s.sale, { floorPercent: e.target.value }) })} />
            </Field>
          </div>
          <div className="form-actions"><button type="submit" className="btn btn-primary btn-sm" disabled={s.savingSale}>{s.savingSale ? <Spinner /> : <Check size={14} aria-hidden="true" />}{t('common.save')}</button></div>
        </form>
        <section aria-labelledby="or-items">
          <h2 id="or-items" className="h4">{t('offerRules.itemsTitle')}</h2>
          {!items.length ? <p className="muted">{t('offerRules.noItems')}</p> : (
            <ul className="stack offer-rule-list">
              {items.map((i) => {
                const row = s.rows[i.id] || { accept: '', floor: '' };
                const err = s.rowErrors[i.id] || {};
                const lines = ruleLines(i.effective);
                return (
                  <li key={i.id} className="card-form">
                    <form onSubmit={(e) => this.saveItem(e, i)} noValidate aria-label={i.name}>
                      <p><strong>{i.name}</strong>{i.priceCents != null ? ' · ' + formatCents(i.priceCents) : ''}</p>
                      <div className="item-form-row">
                        <Field id={'or-a-' + i.id} label={t('offerRules.accept')} optional error={err.accept}>
                          <input id={'or-a-' + i.id} className="input" inputMode="decimal" maxLength={9} value={row.accept} onChange={(e) => this.setRow(i.id, { accept: e.target.value })} />
                        </Field>
                        <Field id={'or-f-' + i.id} label={t('offerRules.floor')} optional error={err.floor}>
                          <input id={'or-f-' + i.id} className="input" inputMode="decimal" maxLength={9} value={row.floor} onChange={(e) => this.setRow(i.id, { floor: e.target.value })} />
                        </Field>
                      </div>
                      <p className="field-hint">
                        {lines.length ? lines.map((l) => LINE[l.key](formatCents(l.cents))).join(' · ') : t('offerRules.none')}
                        {i.effective.source === 'sale' ? ' ' + t('offerRules.fromSale') : ''}
                      </p>
                      <div className="form-actions"><button type="submit" className="btn btn-secondary btn-sm" disabled={s.busy === i.id}>{s.busy === i.id ? <Spinner /> : <Check size={14} aria-hidden="true" />}{t('common.save')}<span className="sr-only">: {i.name}</span></button></div>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    );
  }
}

export default OfferRules;
