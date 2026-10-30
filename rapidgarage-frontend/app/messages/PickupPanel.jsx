import React from 'react';
import { CalendarClock, Check, Plus, X, RefreshCw } from 'lucide-react';
import { errorMessage, fetchPickup, offerPickup, pickupAction } from '../api';
import { Alert, Spinner } from '../components/ui';
import toast from '../components/toast';
import { t, intlLocale } from '../i18n';
import { slotText, pickupStatus, openSlots } from './pickupText';

// <input type="datetime-local"> value for a Date, in local time.
const localInput = (d) => { const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); };
const list = (names) => { try { return new Intl.ListFormat(intlLocale(), { style: 'long', type: 'conjunction' }).format(names); } catch (e) { return names.join(', '); } };

// The "Pickup" card in a conversation, once the seller has accepted a hold or
// an offer: the seller offers a few time slots, the buyer books one, and
// either can reschedule or cancel. Every step also shows in the thread.
export default class PickupPanel extends React.Component {
  constructor(props) {
    super(props);
    this.state = { data: null, error: '', formOpen: false, slots: [''], minutes: 30, chosen: '', busy: null, formError: '', fieldErrors: {} };
  }
  componentDidMount() { this.unmounted = false; this.load(); }
  componentDidUpdate(prev) { if (prev.refreshKey !== this.props.refreshKey || prev.conversationId !== this.props.conversationId) this.load(); }
  componentWillUnmount() { this.unmounted = true; }

  load() {
    fetchPickup(this.props.conversationId)
      .then(({ ok, data }) => { if (!this.unmounted) this.setState(ok ? { data, error: '' } : { error: errorMessage(data, t('pickup.loadFailed')) }); })
      .catch(() => { if (!this.unmounted) this.setState({ error: t('pickup.loadFailed') }); });
  }

  done(msgKey) {
    toast.success(t(msgKey));
    this.setState({ busy: null, formOpen: false, slots: [''], chosen: '', formError: '', fieldErrors: {} });
    this.load();
    if (this.props.onChange) this.props.onChange();
  }

  failed(data) {
    if (this.unmounted) return;
    const d = data && data.error && data.error.details;
    this.setState({ busy: null, formError: d ? '' : errorMessage(data, t('pickup.failed')), fieldErrors: d || {} });
  }

  openForm() {
    const plan = this.state.data && this.state.data.pickup;
    const keep = plan && plan.status !== 'cancelled' ? openSlots(plan).map((s) => localInput(new Date(s.start))) : [];
    this.setState({ formOpen: true, slots: keep.length ? keep : [''], minutes: plan ? plan.slotMinutes : 30, formError: '', fieldErrors: {} });
  }

  submit(e) {
    e.preventDefault();
    const filled = this.state.slots.filter((s) => s);
    if (!filled.length || filled.length !== this.state.slots.length) { this.setState({ fieldErrors: { slots: t('pickup.errSlot') } }); return; }
    this.setState({ busy: 'offer', formError: '', fieldErrors: {} });
    offerPickup(this.props.conversationId, { slots: filled.map((s) => new Date(s).toISOString()), minutes: Number(this.state.minutes) })
      .then(({ ok, data }) => (ok ? this.done('pickup.toast.offered') : this.failed(data)))
      .catch(() => this.failed(null));
  }

  act(action, body, msgKey) {
    this.setState({ busy: action, formError: '' });
    pickupAction(this.props.conversationId, action, body)
      .then(({ ok, data }) => (ok ? this.done(msgKey) : this.failed(data)))
      .catch(() => this.failed(null));
  }

  renderForm() {
    const { data, slots, minutes, busy, fieldErrors, formError } = this.state;
    const now = new Date();
    const max = data.saleEndsAt ? new Date(data.saleEndsAt) : new Date(now.getTime() + data.limits.pickupMaxDays * 86400000);
    const setSlot = (i, v) => this.setState({ slots: slots.map((s, j) => (j === i ? v : s)), fieldErrors: {} });
    return (
      <form className="hold-form pickup-form" onSubmit={(e) => this.submit(e)} noValidate>
        <p className="small muted">{t('pickup.formLead', { name: this.props.other })}</p>
        <fieldset className="pickup-slots">
          <legend className="field-label">{t('pickup.times')}</legend>
          {slots.map((s, i) => (
            <div key={i} className="pickup-slot-input">
              <input type="datetime-local" className="input" value={s} min={localInput(now)} max={localInput(max)} aria-label={t('pickup.slotLabel', { n: i + 1 })}
                aria-invalid={fieldErrors.slots ? 'true' : undefined} onChange={(e) => setSlot(i, e.target.value)} />
              {slots.length > 1 ? (
                <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={t('pickup.removeSlot', { n: i + 1 })}
                  onClick={() => this.setState({ slots: slots.filter((x, j) => j !== i), fieldErrors: {} })}><X size={14} aria-hidden="true" /></button>
              ) : null}
            </div>
          ))}
          {slots.length < data.limits.maxSlots ? (
            <button type="button" className="btn btn-link btn-sm" onClick={() => this.setState({ slots: slots.concat(['']) })}><Plus size={14} aria-hidden="true" />{t('pickup.addSlot')}</button>
          ) : null}
          {fieldErrors.slots ? <span className="field-error" role="alert">{fieldErrors.slots}</span> : <span className="field-hint">{t('pickup.timesHint', { max: data.limits.maxSlots })}</span>}
        </fieldset>
        <label className="field pickup-length" htmlFor="pickup-minutes">
          <span className="field-label">{t('pickup.length')}</span>
          <select id="pickup-minutes" className="select" value={minutes} onChange={(e) => this.setState({ minutes: Number(e.target.value) })}>
            {data.limits.minutes.map((n) => <option key={n} value={n}>{t('pickup.minutes', { n })}</option>)}
          </select>
          {fieldErrors.minutes ? <span className="field-error" role="alert">{fieldErrors.minutes}</span> : null}
        </label>
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <div className="hold-form-actions">
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy === 'offer'}>{busy === 'offer' ? <Spinner /> : <CalendarClock size={14} aria-hidden="true" />}{t('pickup.send')}</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.setState({ formOpen: false, formError: '', fieldErrors: {} })}>{t('hold.cancelForm')}</button>
        </div>
      </form>
    );
  }

  renderChoose(plan) {
    const { chosen, busy, fieldErrors } = this.state;
    const slots = openSlots(plan);
    return (
      <form className="pickup-choose" onSubmit={(e) => { e.preventDefault(); if (chosen) this.act('book', { start: chosen }, 'pickup.toast.booked'); }}>
        <fieldset>
          <legend className="small">{t('pickup.pickOne')}</legend>
          <ul className="pickup-slot-list">
            {slots.map((s) => {
              const v = new Date(s.start).toISOString();
              return (
                <li key={v}>
                  <label className={'pickup-slot' + (chosen === v ? ' is-chosen' : '')}>
                    <input type="radio" name="pickup-slot" value={v} checked={chosen === v} onChange={() => this.setState({ chosen: v, fieldErrors: {} })} />
                    <span>{slotText(s)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
        {fieldErrors.start ? <span className="field-error" role="alert">{fieldErrors.start}</span> : null}
        <div className="hold-actions">
          <button type="submit" className="btn btn-primary btn-sm" disabled={!chosen || !!busy}>{busy === 'book' ? <Spinner /> : <Check size={14} aria-hidden="true" />}{t('pickup.book')}</button>
        </div>
      </form>
    );
  }

  render() {
    const { data, error, formOpen, busy, formError } = this.state;
    if (error) return <Alert tone="warning" className="hold-panel">{error}</Alert>;
    if (!data) return null;
    const plan = data.pickup;
    const seller = this.props.role === 'seller';
    const live = plan && plan.status !== 'cancelled';
    if (!plan && !data.items.length) return null;
    const slotsLeft = openSlots(plan).length;
    return (
      <section className="hold-panel pickup-panel" aria-labelledby="pickup-title">
        <div className="hold-head">
          <h3 id="pickup-title"><CalendarClock size={16} aria-hidden="true" />{t('pickup.title')}</h3>
          {seller && data.canOffer && !formOpen ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => this.openForm()}>
              {live ? <RefreshCw size={14} aria-hidden="true" /> : <CalendarClock size={14} aria-hidden="true" />}{live ? t('pickup.offerNew') : t('pickup.offer')}
            </button>
          ) : null}
        </div>
        {data.items.length ? <p className="small muted hold-note">{t('pickup.items', { items: list(data.items) })}</p> : null}
        {!plan && !seller ? <p className="small muted hold-note">{t('pickup.buyerWait', { name: this.props.other }).replace(/\.\.$/, '.')}</p> : null}
        {!plan && seller && !formOpen ? <p className="small muted hold-note">{t('pickup.sellerLead')}</p> : null}
        {formOpen ? this.renderForm() : null}
        {plan ? (
          <div className={'pickup-state pickup-' + plan.status} role="status">
            {plan.status === 'booked' ? <Check size={16} aria-hidden="true" /> : null}
            <span>{pickupStatus(plan, this.props.other)}</span>
          </div>
        ) : null}
        {plan && plan.status === 'offered' && !slotsLeft ? <p className="small muted hold-note">{seller ? t('pickup.allPassedSeller') : t('pickup.allPassedBuyer', { name: this.props.other })}</p> : null}
        {plan && plan.status === 'offered' && !seller && data.canAct && slotsLeft ? this.renderChoose(plan) : null}
        {plan && plan.status === 'offered' && seller && slotsLeft ? (
          <ul className="pickup-slot-list pickup-slot-list-plain">{openSlots(plan).map((s) => <li key={String(s.start)}>{slotText(s)}</li>)}</ul>
        ) : null}
        {live && data.canAct ? (
          <div className="hold-actions">
            {plan.status === 'booked' ? (
              <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => this.act('reschedule', {}, 'pickup.toast.reschedule')}>
                {busy === 'reschedule' ? <Spinner /> : <RefreshCw size={14} aria-hidden="true" />}{t('pickup.reschedule')}
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => this.act('cancel', {}, 'pickup.toast.cancelled')}>
              {busy === 'cancel' ? <Spinner /> : <X size={14} aria-hidden="true" />}{t('pickup.cancel')}
            </button>
          </div>
        ) : null}
        {live && !data.items.length ? <p className="small muted hold-note">{t('pickup.inactive')}</p> : null}
        {formError && !formOpen ? <Alert tone="danger">{formError}</Alert> : null}
        <p className="small muted hold-note">{t('pickup.note')}</p>
      </section>
    );
  }
}
