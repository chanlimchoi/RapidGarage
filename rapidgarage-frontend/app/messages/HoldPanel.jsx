import React from 'react';
import { Bookmark, Clock, Check, X, CalendarClock, Undo2, HandCoins } from 'lucide-react';
import { errorMessage, fetchHolds, requestHold, holdAction } from '../api';
import { Alert, Spinner } from '../components/ui';
import { formatCents, parseCents } from '../lib/items';
import toast from '../components/toast';
import { t } from '../i18n';
import { holdTime } from './holdText';
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
    this.state = { data: null, error: '', formOpen: false, itemId: '', pickup: '', offer: '', formError: '', fieldErrors: {}, busy: null, lengths: {}, showPast: false, counterFor: null, counter: '', counterError: '' };
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
    this.setState({ busy: null, formOpen: false, itemId: '', pickup: '', offer: '', formError: '', fieldErrors: {}, counterFor: null, counter: '', counterError: '' });
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
    const { data, error, formOpen, showPast } = this.state;
    if (error) return <Alert tone="warning" className="hold-panel">{error}</Alert>;
    if (!data) return null;
    const open = data.results.filter((h) => OPEN.includes(h.status));
    const past = data.results.filter((h) => !OPEN.includes(h.status));
    const buyer = this.props.role === 'buyer';
    if (!open.length && !past.length && !(buyer && data.canRequest && this.props.canAct)) return null;
    return (
      <section className="hold-panel" aria-labelledby="hold-title">
        <div className="hold-head">
          <h3 id="hold-title"><Bookmark size={16} aria-hidden="true" />{t('hold.title')}</h3>
          {buyer && this.props.canAct && data.canRequest && !formOpen && data.holdable.length ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => this.setState({ formOpen: true })}>{t('hold.ask')}</button>
          ) : null}
        </div>
        {buyer && this.props.canAct && data.canRequest && !data.holdable.length ? <p className="small muted hold-note">{t('hold.noneHoldable')}</p> : null}
        {formOpen ? this.renderForm() : null}
        {open.length ? <ul className="hold-list">{open.map((h) => this.renderHold(h))}</ul> : null}
        {past.length ? (
          <div className="hold-past">
            <button type="button" className="btn btn-link btn-sm" aria-expanded={showPast} onClick={() => this.setState({ showPast: !showPast })}>{t('hold.past', { count: past.length })}</button>
            {showPast ? <ul className="hold-list">{past.map((h) => this.renderHold(h))}</ul> : null}
          </div>
        ) : null}
        {open.some((h) => h.status === 'accepted') ? <p className="small muted hold-note">{t('hold.capNote')}</p> : null}
        <p className="small muted hold-note hold-safety">{t('hold.safetyNote')} <SafetyLink hash="meet" /></p>
      </section>
    );
  }
}
