import React from 'react';
import { Bookmark, Clock, Check, X, CalendarClock, Undo2, HandCoins, Package } from 'lucide-react';
import { errorMessage, fetchHolds, requestHold, requestBundle, holdAction } from '../api';
import { Alert, Spinner } from '../components/ui';
import { formatCents, parseCents } from '../lib/items';
import toast from '../components/toast';
import { t } from '../i18n';
import { holdTime } from './holdText';
import { quote as bundleQuote, groupHolds, lead as bundleLead, describe as describeBundle } from '../lib/bundles';
import { SafetyLink } from './SafetyTips';

const OPEN = ['pending', 'accepted'];
const STATUS = {
  accepted: 'hold.status.accepted', declined: 'hold.status.declined', cancelled: 'hold.status.cancelled',
  released: 'hold.status.released', expired: 'hold.status.expired', completed: 'hold.status.completed',
};
const LENGTHS = [2, 6, 24, 48];
// <input type="datetime-local"> value for a Date, in local time.
const localInput = (d) => { const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); };

// The "Holds" card in a conversation: the buyer asks to hold an item of this
// sale (with an optional pickup time); the seller accepts, declines or
// releases; the buyer can cancel. Events also appear in the thread.
export default class HoldPanel extends React.Component {
  constructor(props) {
    super(props);
    this.state = { data: null, error: '', formOpen: false, itemId: '', pickup: '', offer: '', formError: '', fieldErrors: {}, busy: null, lengths: {}, showPast: false, counterFor: null, counter: '', counterError: '', bundleOpen: false, picked: [] };
  }
  componentDidMount() { this.unmounted = false; this.load(); }
  componentDidUpdate(prev) { if (prev.refreshKey !== this.props.refreshKey || prev.conversationId !== this.props.conversationId) this.load(); }
  componentWillUnmount() { this.unmounted = true; }

  load() {
    fetchHolds(this.props.conversationId)
      .then(({ ok, data }) => { if (!this.unmounted) this.setState(ok ? { data, error: '' } : { error: errorMessage(data, t('hold.loadFailed')) }); })
      .catch(() => { if (!this.unmounted) this.setState({ error: t('hold.loadFailed') }); });
  }

  done(msgKey) {
    toast.success(t(msgKey));
    this.setState({ busy: null, formOpen: false, bundleOpen: false, picked: [], itemId: '', pickup: '', offer: '', formError: '', fieldErrors: {}, counterFor: null, counter: '', counterError: '' });
    this.load();
    if (this.props.onChange) this.props.onChange();
  }

  submit(e) {
    e.preventDefault();
    if (!this.state.itemId) { this.setState({ fieldErrors: { itemId: t('hold.chooseItem') } }); return; }
    const body = { itemId: Number(this.state.itemId) };
    if (this.state.pickup) body.pickupAt = new Date(this.state.pickup).toISOString();
    if (this.state.offer.trim()) {
      const cents = parseCents(this.state.offer);
      if (cents === null || cents < 1) { this.setState({ fieldErrors: { offerCents: t('offer.errAmount') } }); return; }
      body.offerCents = cents;
    }
    this.setState({ busy: 'new', formError: '', fieldErrors: {} });
    requestHold(this.props.conversationId, body)
      .then(({ ok, data }) => {
        if (this.unmounted) return;
        if (ok) { this.done(body.offerCents ? 'offer.sent' : 'hold.requested'); return; }
        const details = (data && data.error && data.error.details) || {};
        this.setState({ busy: null, fieldErrors: details, formError: Object.keys(details).length ? '' : errorMessage(data, t('hold.failed')) });
      })
      .catch(() => { if (!this.unmounted) this.setState({ busy: null, formError: t('common.networkShort') }); });
  }

  submitBundle(e) {
    e.preventDefault();
    const { data, picked } = this.state;
    if (picked.length < data.bundle.minItems) { this.setState({ fieldErrors: { itemIds: t('bundle.pickAtLeast', { count: data.bundle.minItems }) } }); return; }
    const body = { itemIds: picked.map(Number) };
    if (this.state.pickup) body.pickupAt = new Date(this.state.pickup).toISOString();
    this.setState({ busy: 'bundle', formError: '', fieldErrors: {} });
    requestBundle(this.props.conversationId, body)
      .then(({ ok, data: res }) => {
        if (this.unmounted) return;
        if (ok) { this.done('bundle.sent'); return; }
        const details = (res && res.error && res.error.details) || {};
        this.setState({ busy: null, fieldErrors: details, formError: Object.keys(details).length ? '' : errorMessage(res, t('hold.failed')) });
      })
      .catch(() => { if (!this.unmounted) this.setState({ busy: null, formError: t('common.networkShort') }); });
  }

  act(hold, action, msgKey, extra) {
    const body = {};
    if (action === 'accept') { const h = this.state.lengths[hold.id]; if (h) body.hours = Number(h); }
    this.setState({ busy: hold.id });
    if (action === 'counter') body.offerCents = extra;
    holdAction(hold.id, action, body)
      .then(({ ok, data }) => {
        if (this.unmounted) return;
        if (ok) { this.done(msgKey); return; }
        const details = (data && data.error && data.error.details) || {};
        if (action === 'counter' && details.offerCents) { this.setState({ busy: null, counterError: details.offerCents }); return; }
        this.setState({ busy: null });
        toast.error(errorMessage(data, t('hold.failed')));
        this.load();
      })
      .catch(() => { if (!this.unmounted) { this.setState({ busy: null }); toast.error(t('common.networkShort')); } });
  }

  renderHold(h) {
    const seller = h.role === 'seller';
    const busy = this.state.busy === h.id;
    const canAct = this.props.canAct;
    const status = h.status === 'pending' ? (seller ? 'hold.status.pendingSeller' : 'hold.status.pending') : STATUS[h.status];
    const price = formatCents(h.item.priceCents);
    return (
      <li key={h.id} className={'hold-row hold-' + h.status}>
        <span className="hold-icon" aria-hidden="true"><Bookmark size={16} /></span>
        <div className="hold-main">
          <div className="hold-title">
            <strong>{h.item.name || t('hold.anItem')}</strong>{price ? <span className="muted small"> · {price}</span> : null}
            <span className={'chip ' + (h.status === 'accepted' ? 'chip-success' : h.status === 'pending' ? 'chip-brand' : 'chip-muted')}>{t(status)}</span>
          </div>
          <div className="hold-meta small muted">
            {h.pickupAt ? <span><CalendarClock size={13} aria-hidden="true" /> {t('hold.pickupAt', { time: holdTime(h.pickupAt) })}</span> : null}
            {h.status === 'accepted' ? <span><Clock size={13} aria-hidden="true" /> {t('hold.until', { time: holdTime(h.expiresAt) })}</span> : null}
            {h.status === 'pending' ? <span><Clock size={13} aria-hidden="true" /> {t('hold.answerBy', { time: holdTime(h.expiresAt) })}</span> : null}
          </div>
          {h.offerCents ? (
            <div className="hold-offer small">
              <HandCoins size={13} aria-hidden="true" /> {h.status === 'accepted' || h.status === 'completed' ? t('offer.agreed', { price: formatCents(h.offerCents) }) : t('offer.offered', { price: formatCents(h.offerCents) })}
              {h.counterCents && h.status === 'pending' ? <span> · <strong>{t('offer.counter', { price: formatCents(h.counterCents) })}</strong></span> : null}
            </div>
          ) : null}
          {canAct && OPEN.includes(h.status) ? (
            <div className="hold-actions">
              {seller && h.status === 'pending' ? (
                <React.Fragment>
                  <label className="hold-length small" htmlFor={'hold-length-' + h.id}>
                    <span>{t('hold.length')}</span>
                    <select id={'hold-length-' + h.id} className="select select-sm" value={this.state.lengths[h.id] || ''}
                      onChange={(e) => this.setState({ lengths: Object.assign({}, this.state.lengths, { [h.id]: e.target.value }) })}>
                      <option value="">{h.pickupAt ? t('hold.untilPickup') : t('hold.hours', { count: this.state.data.limits.holdHours })}</option>
                      {LENGTHS.map((n) => <option key={n} value={n}>{t('hold.hours', { count: n })}</option>)}
                    </select>
                  </label>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => this.act(h, 'accept', 'hold.accepted')}>
                    {busy ? <Spinner /> : <Check size={14} aria-hidden="true" />}{h.offerCents ? t('offer.acceptAt', { price: formatCents(h.offerCents) }) : t('hold.accept')}
                  </button>
                  {h.offerCents && this.state.counterFor !== h.id ? (
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => this.setState({ counterFor: h.id, counter: '', counterError: '' })}>
                      <HandCoins size={14} aria-hidden="true" />{t('offer.counterButton')}
                    </button>
                  ) : null}
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => this.act(h, 'decline', 'hold.declinedToast')}>
                    <X size={14} aria-hidden="true" />{t('hold.decline')}
                  </button>
                </React.Fragment>
              ) : null}
              {seller && h.status === 'pending' && this.state.counterFor === h.id ? this.renderCounter(h) : null}
              {!seller && h.status === 'pending' && h.counterCents ? (
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => this.act(h, 'take', 'offer.taken')}>
                  {busy ? <Spinner /> : <Check size={14} aria-hidden="true" />}{t('offer.take', { price: formatCents(h.counterCents) })}
                </button>
              ) : null}
              {seller && h.status === 'accepted' ? (
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => this.act(h, 'release', 'hold.releasedToast')}>
                  <Undo2 size={14} aria-hidden="true" />{t('hold.release')}
                </button>
              ) : null}
              {!seller ? (
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => this.act(h, 'cancel', 'hold.cancelledToast')}>
                  <X size={14} aria-hidden="true" />{t('hold.cancel')}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </li>
    );
  }

  // A bundle: its items with bundle prices; the buttons answer the whole bundle.
  renderBundle(g) {
    const h = bundleLead(g);
    const seller = h.role === 'seller';
    const busy = this.state.busy === h.id;
    const open = OPEN.includes(h.status);
    const status = h.status === 'pending' ? (seller ? 'hold.status.pendingSeller' : 'hold.status.pending') : STATUS[h.status];
    const total = g.holds.reduce((s, x) => s + (x.offerCents || 0), 0);
    const was = g.holds.reduce((s, x) => s + (x.item.priceCents || 0), 0);
    const titleId = 'bundle-' + g.key;
    return (
      <li key={g.key} className={'hold-row hold-bundle hold-' + h.status} aria-labelledby={titleId}>
        <span className="hold-icon" aria-hidden="true"><Package size={16} /></span>
        <div className="hold-main">
          <div className="hold-title">
            <strong id={titleId}>{t('bundle.rowTitle', { count: g.holds.length })}</strong>
            <span className="muted small"> · {t('bundle.total', { price: formatCents(total) })}{was > total ? ' ' : ''}{was > total ? <s aria-label={t('md.wasPrice', { price: formatCents(was) })}>{formatCents(was)}</s> : null}</span>
            <span className={'chip ' + (h.status === 'accepted' ? 'chip-success' : h.status === 'pending' ? 'chip-brand' : 'chip-muted')}>{t(status)}</span>
          </div>
          <ul className="bundle-items small">
            {g.holds.map((x) => (
              <li key={x.id}>{x.item.name || t('hold.anItem')} · {formatCents(x.offerCents || 0)}{x.status !== h.status ? <span className="muted"> ({t(STATUS[x.status] || 'hold.status.pending')})</span> : null}</li>
            ))}
          </ul>
          <div className="hold-meta small muted">
            {h.pickupAt ? <span><CalendarClock size={13} aria-hidden="true" /> {t('hold.pickupAt', { time: holdTime(h.pickupAt) })}</span> : null}
            {h.status === 'accepted' ? <span><Clock size={13} aria-hidden="true" /> {t('hold.until', { time: holdTime(h.expiresAt) })}</span> : null}
            {h.status === 'pending' ? <span><Clock size={13} aria-hidden="true" /> {t('hold.answerBy', { time: holdTime(h.expiresAt) })}</span> : null}
          </div>
          {this.props.canAct && open ? (
            <div className="hold-actions">
              {seller && h.status === 'pending' ? (
                <React.Fragment>
                  <label className="hold-length small" htmlFor={'hold-length-' + h.id}>
                    <span>{t('hold.length')}</span>
                    <select id={'hold-length-' + h.id} className="select select-sm" value={this.state.lengths[h.id] || ''}
                      onChange={(e) => this.setState({ lengths: Object.assign({}, this.state.lengths, { [h.id]: e.target.value }) })}>
                      <option value="">{h.pickupAt ? t('hold.untilPickup') : t('hold.hours', { count: this.state.data.limits.holdHours })}</option>
                      {LENGTHS.map((n) => <option key={n} value={n}>{t('hold.hours', { count: n })}</option>)}
                    </select>
                  </label>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => this.act(h, 'accept', 'bundle.acceptedToast')}>
                    {busy ? <Spinner /> : <Check size={14} aria-hidden="true" />}{t('bundle.accept', { price: formatCents(total) })}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => this.act(h, 'decline', 'hold.declinedToast')}>
                    <X size={14} aria-hidden="true" />{t('bundle.decline')}
                  </button>
                </React.Fragment>
              ) : null}
              {seller && h.status === 'accepted' ? (
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => this.act(h, 'release', 'hold.releasedToast')}>
                  <Undo2 size={14} aria-hidden="true" />{t('bundle.release')}
                </button>
              ) : null}
              {!seller ? (
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => this.act(h, 'cancel', 'hold.cancelledToast')}>
                  <X size={14} aria-hidden="true" />{t('bundle.cancel')}
                </button>
              ) : null}
            </div>
          ) : null}
          {seller && h.status === 'pending' ? <p className="small muted bundle-note">{t('bundle.wholeNote')}</p> : null}
        </div>
      </li>
    );
  }

  renderRows(rows) {
    return <ul className="hold-list">{rows.map((r) => (r.key ? this.renderBundle(r) : this.renderHold(r.hold)))}</ul>;
  }

  renderBundleForm() {
    const { data, picked, pickup, fieldErrors, formError, busy } = this.state;
    const b = data.bundle;
    const choices = data.holdable.filter((i) => i.nowCents !== null && i.nowCents !== undefined);
    const q = bundleQuote(choices.filter((i) => picked.indexOf(String(i.id)) !== -1), b.percent);
    const now = new Date();
    const max = data.saleEndsAt ? new Date(data.saleEndsAt) : new Date(now.getTime() + data.limits.pickupMaxDays * 86400000);
    const toggle = (id) => this.setState({ fieldErrors: {}, picked: picked.indexOf(id) === -1 ? picked.concat([id]).slice(0, b.maxItems) : picked.filter((x) => x !== id) });
    return (
      <form className="hold-form bundle-form" onSubmit={(e) => this.submitBundle(e)} noValidate>
        <p className="small muted">{describeBundle(b)}. {t('bundle.lead')} <SafetyLink hash="meet" /></p>
        <fieldset className="bundle-pick" aria-describedby="bundle-summary" aria-invalid={fieldErrors.itemIds ? 'true' : undefined}>
          <legend className="field-label">{t('bundle.pickAtLeast', { count: b.minItems })}</legend>
          {choices.map((i) => (
            <label key={i.id} className="checkbox-row" htmlFor={'bundle-item-' + i.id}>
              <input id={'bundle-item-' + i.id} type="checkbox" checked={picked.indexOf(String(i.id)) !== -1}
                disabled={picked.indexOf(String(i.id)) === -1 && picked.length >= b.maxItems} onChange={() => toggle(String(i.id))} />
              <span>{i.name} · {formatCents(i.nowCents)}</span>
            </label>
          ))}
          {fieldErrors.itemIds ? <span className="field-error" role="alert">{fieldErrors.itemIds}</span> : null}
        </fieldset>
        <p id="bundle-summary" className="bundle-summary small" aria-live="polite">
          {q.count ? t('bundle.summary', { count: q.count, price: formatCents(q.bundleTotalCents), saved: formatCents(q.savedCents) }) : t('bundle.summaryNone')}
        </p>
        <label className="field" htmlFor="bundle-pickup">
          <span className="field-label">{t('hold.pickup')} <span className="muted small">{t('ui.optional')}</span></span>
          <input id="bundle-pickup" type="datetime-local" className="input" value={pickup} min={localInput(now)} max={localInput(max)}
            aria-describedby="bundle-pickup-hint" aria-invalid={fieldErrors.pickupAt ? 'true' : undefined}
            onChange={(e) => this.setState({ pickup: e.target.value, fieldErrors: {} })} />
          {fieldErrors.pickupAt ? <span className="field-error" role="alert">{fieldErrors.pickupAt}</span>
            : <span id="bundle-pickup-hint" className="field-hint">{t('hold.pickupHint')}</span>}
        </label>
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <div className="hold-form-actions">
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy === 'bundle'}>{busy === 'bundle' ? <Spinner /> : <Package size={14} aria-hidden="true" />}{t('bundle.send')}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.setState({ bundleOpen: false, picked: [], formError: '', fieldErrors: {} })}>{t('hold.cancelForm')}</button>
        </div>
      </form>
    );
  }

  renderCounter(h) {
    const busy = this.state.busy === h.id;
    const send = (e) => {
      e.preventDefault();
      const cents = parseCents(this.state.counter);
      if (cents === null || cents < 1) { this.setState({ counterError: t('offer.errAmount') }); return; }
      this.act(h, 'counter', 'offer.countered', cents);
    };
    return (
      <form className="hold-counter" onSubmit={send} noValidate>
        <label className="field" htmlFor={'hold-counter-' + h.id}>
          <span className="field-label">{t('offer.counterLabel')}</span>
          <input id={'hold-counter-' + h.id} className="input input-sm" inputMode="decimal" maxLength={9} placeholder={h.item.priceCents ? formatCents(h.item.priceCents) : ''}
            value={this.state.counter} aria-invalid={this.state.counterError ? 'true' : undefined} onChange={(e) => this.setState({ counter: e.target.value, counterError: '' })} />
          {this.state.counterError ? <span className="field-error" role="alert">{this.state.counterError}</span> : null}
        </label>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? <Spinner /> : null}{t('offer.sendCounter')}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.setState({ counterFor: null, counterError: '' })}>{t('hold.cancelForm')}</button>
      </form>
    );
  }

  renderForm() {
    const { data, itemId, pickup, offer, fieldErrors, formError, busy } = this.state;
    const chosen = data.holdable.find((i) => String(i.id) === String(itemId));
    const canOffer = !!(chosen && chosen.priceCents);
    const now = new Date();
    const max = data.saleEndsAt ? new Date(data.saleEndsAt) : new Date(now.getTime() + data.limits.pickupMaxDays * 86400000);
    return (
      <form className="hold-form" onSubmit={(e) => this.submit(e)} noValidate>
        <p className="small muted">{t('hold.askLead')} <SafetyLink hash="meet" /></p>
        <div className="hold-form-row">
          <label className="field" htmlFor="hold-item">
            <span className="field-label">{t('hold.item')}</span>
            <select id="hold-item" className="select" value={itemId} aria-invalid={fieldErrors.itemId ? 'true' : undefined}
              onChange={(e) => this.setState({ itemId: e.target.value, offer: '', fieldErrors: {} })}>
              <option value="">{t('hold.chooseItem')}</option>
              {data.holdable.map((i) => <option key={i.id} value={i.id}>{i.name}{i.priceCents !== null ? ' · ' + formatCents(i.priceCents) : ''}</option>)}
            </select>
            {fieldErrors.itemId ? <span className="field-error" role="alert">{fieldErrors.itemId}</span> : null}
          </label>
          <label className="field" htmlFor="hold-pickup">
            <span className="field-label">{t('hold.pickup')} <span className="muted small">{t('ui.optional')}</span></span>
            <input id="hold-pickup" type="datetime-local" className="input" value={pickup} min={localInput(now)} max={localInput(max)}
              aria-describedby="hold-pickup-hint" aria-invalid={fieldErrors.pickupAt ? 'true' : undefined}
              onChange={(e) => this.setState({ pickup: e.target.value, fieldErrors: {} })} />
            {fieldErrors.pickupAt ? <span className="field-error" role="alert">{fieldErrors.pickupAt}</span>
              : <span id="hold-pickup-hint" className="field-hint">{t('hold.pickupHint')}</span>}
          </label>
          {canOffer ? (
            <label className="field" htmlFor="hold-offer">
              <span className="field-label">{t('offer.label')} <span className="muted small">{t('ui.optional')}</span></span>
              <input id="hold-offer" className="input" inputMode="decimal" maxLength={9} placeholder={formatCents(chosen.priceCents)} value={offer}
                aria-describedby="hold-offer-hint" aria-invalid={fieldErrors.offerCents ? 'true' : undefined}
                onChange={(e) => this.setState({ offer: e.target.value, fieldErrors: {} })} />
              {fieldErrors.offerCents ? <span className="field-error" role="alert">{fieldErrors.offerCents}</span>
                : <span id="hold-offer-hint" className="field-hint">{t('offer.hint', { price: formatCents(chosen.priceCents) })}</span>}
            </label>
          ) : null}
        </div>
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <div className="hold-form-actions">
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy === 'new'}>{busy === 'new' ? <Spinner /> : <Bookmark size={14} aria-hidden="true" />}{offer.trim() && canOffer ? t('offer.send') : t('hold.send')}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.setState({ formOpen: false, formError: '', fieldErrors: {} })}>{t('hold.cancelForm')}</button>
        </div>
      </form>
    );
  }

  render() {
    const { data, error, formOpen, bundleOpen, showPast } = this.state;
    if (error) return <Alert tone="warning" className="hold-panel">{error}</Alert>;
    if (!data) return null;
    const rows = groupHolds(data.results);
    const isOpen = (r) => (r.key ? r.holds.some((h) => OPEN.includes(h.status)) : OPEN.includes(r.hold.status));
    const open = rows.filter(isOpen);
    const past = rows.filter((r) => !isOpen(r));
    const openHolds = data.results.filter((h) => OPEN.includes(h.status));
    const buyer = this.props.role === 'buyer';
    if (!open.length && !past.length && !(buyer && data.canRequest && this.props.canAct)) return null;
    const asking = buyer && this.props.canAct && data.canRequest && !formOpen && !bundleOpen;
    const bundleable = data.bundle ? data.holdable.filter((i) => i.nowCents !== null && i.nowCents !== undefined).length >= data.bundle.minItems : false;
    return (
      <section className="hold-panel" aria-labelledby="hold-title">
        <div className="hold-head">
          <h3 id="hold-title"><Bookmark size={16} aria-hidden="true" />{t('hold.title')}</h3>
          {asking && data.holdable.length ? (
            <div className="hold-head-actions">
              {bundleable ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => this.setState({ bundleOpen: true, picked: [], fieldErrors: {}, formError: '' })}><Package size={14} aria-hidden="true" />{t('bundle.ask')}</button> : null}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => this.setState({ formOpen: true })}>{t('hold.ask')}</button>
            </div>
          ) : null}
        </div>
        {buyer && this.props.canAct && data.canRequest && data.bundle && !bundleOpen ? <p className="small muted hold-note bundle-offer"><Package size={13} aria-hidden="true" /> {describeBundle(data.bundle)}</p> : null}
        {buyer && this.props.canAct && data.canRequest && !data.holdable.length ? <p className="small muted hold-note">{t('hold.noneHoldable')}</p> : null}
        {formOpen ? this.renderForm() : null}
        {bundleOpen && data.bundle ? this.renderBundleForm() : null}
        {open.length ? this.renderRows(open) : null}
        {past.length ? (
          <div className="hold-past">
            <button type="button" className="btn btn-link btn-sm" aria-expanded={showPast} onClick={() => this.setState({ showPast: !showPast })}>{t('hold.past', { count: past.length })}</button>
            {showPast ? this.renderRows(past) : null}
          </div>
        ) : null}
        {openHolds.some((h) => h.status === 'accepted') ? <p className="small muted hold-note">{t('hold.capNote')}</p> : null}
        <p className="small muted hold-note hold-safety">{t('hold.safetyNote')} <SafetyLink hash="meet" /></p>
      </section>
    );
  }
}
