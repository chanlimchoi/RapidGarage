import React from 'react';
import { Bookmark, Clock, Check, X, CalendarClock, Undo2 } from 'lucide-react';
import { errorMessage, fetchHolds, requestHold, holdAction } from '../api';
import { Alert, Spinner } from '../components/ui';
import { formatCents } from '../lib/items';
import toast from '../components/toast';
import { t } from '../i18n';
import { holdTime } from './holdText';

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
    this.state = { data: null, error: '', formOpen: false, itemId: '', pickup: '', formError: '', fieldErrors: {}, busy: null, lengths: {}, showPast: false };
  }
  componentDidMount() { this.load(); }
  componentDidUpdate(prev) { if (prev.refreshKey !== this.props.refreshKey || prev.conversationId !== this.props.conversationId) this.load(); }
  componentWillUnmount() { this.unmounted = true; }

  load() {
    fetchHolds(this.props.conversationId)
      .then(({ ok, data }) => { if (!this.unmounted) this.setState(ok ? { data, error: '' } : { error: errorMessage(data, t('hold.loadFailed')) }); })
      .catch(() => { if (!this.unmounted) this.setState({ error: t('hold.loadFailed') }); });
  }

  done(msgKey) {
    toast.success(t(msgKey));
    this.setState({ busy: null, formOpen: false, itemId: '', pickup: '', formError: '', fieldErrors: {} });
    this.load();
    if (this.props.onChange) this.props.onChange();
  }

  submit(e) {
    e.preventDefault();
    if (!this.state.itemId) { this.setState({ fieldErrors: { itemId: t('hold.chooseItem') } }); return; }
    const body = { itemId: Number(this.state.itemId) };
    if (this.state.pickup) body.pickupAt = new Date(this.state.pickup).toISOString();
    this.setState({ busy: 'new', formError: '', fieldErrors: {} });
    requestHold(this.props.conversationId, body)
      .then(({ ok, data }) => {
        if (this.unmounted) return;
        if (ok) { this.done('hold.requested'); return; }
        const details = (data && data.error && data.error.details) || {};
        this.setState({ busy: null, fieldErrors: details, formError: Object.keys(details).length ? '' : errorMessage(data, t('hold.failed')) });
      })
      .catch(() => { if (!this.unmounted) this.setState({ busy: null, formError: t('common.networkShort') }); });
  }

  act(hold, action, msgKey) {
    const body = {};
    if (action === 'accept') { const h = this.state.lengths[hold.id]; if (h) body.hours = Number(h); }
    this.setState({ busy: hold.id });
    holdAction(hold.id, action, body)
      .then(({ ok, data }) => {
        if (this.unmounted) return;
        if (ok) { this.done(msgKey); return; }
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
                    {busy ? <Spinner /> : <Check size={14} aria-hidden="true" />}{t('hold.accept')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => this.act(h, 'decline', 'hold.declinedToast')}>
                    <X size={14} aria-hidden="true" />{t('hold.decline')}
                  </button>
                </React.Fragment>
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

  renderForm() {
    const { data, itemId, pickup, fieldErrors, formError, busy } = this.state;
    const now = new Date();
    const max = data.saleEndsAt ? new Date(data.saleEndsAt) : new Date(now.getTime() + data.limits.pickupMaxDays * 86400000);
    return (
      <form className="hold-form" onSubmit={(e) => this.submit(e)} noValidate>
        <p className="small muted">{t('hold.askLead')}</p>
        <div className="hold-form-row">
          <label className="field" htmlFor="hold-item">
            <span className="field-label">{t('hold.item')}</span>
            <select id="hold-item" className="select" value={itemId} aria-invalid={fieldErrors.itemId ? 'true' : undefined}
              onChange={(e) => this.setState({ itemId: e.target.value, fieldErrors: {} })}>
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
        </div>
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <div className="hold-form-actions">
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy === 'new'}>{busy === 'new' ? <Spinner /> : <Bookmark size={14} aria-hidden="true" />}{t('hold.send')}</button>
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
          {buyer && this.props.canAct && data.canRequest && !formOpen ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => this.setState({ formOpen: true })}>{t('hold.ask')}</button>
          ) : null}
        </div>
        {formOpen ? this.renderForm() : null}
        {open.length ? <ul className="hold-list">{open.map((h) => this.renderHold(h))}</ul> : null}
        {past.length ? (
          <div className="hold-past">
            <button type="button" className="btn btn-link btn-sm" aria-expanded={showPast} onClick={() => this.setState({ showPast: !showPast })}>{t('hold.past', { count: past.length })}</button>
            {showPast ? <ul className="hold-list">{past.map((h) => this.renderHold(h))}</ul> : null}
          </div>
        ) : null}
        {open.some((h) => h.status === 'accepted') ? <p className="small muted hold-note">{t('hold.capNote')}</p> : null}
      </section>
    );
  }
}
