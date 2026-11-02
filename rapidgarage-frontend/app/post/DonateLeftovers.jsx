import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, HeartHandshake, Lock, Plus, Trash2, Check, MessageCircle } from 'lucide-react';
import { apiFetch, fetchDonation, saveDonation, deleteDonation, donationStep, errorMessage } from '../api';
import { Alert, EmptyState, Field, SkeletonBlock, Spinner } from '../components/ui';
import { buildSlots, localInput, MINUTES, MAX_SLOTS } from '../lib/donations';
import { holdTime } from '../messages/holdText';
import toast from '../components/toast';
import { t } from '../i18n';

const paramId = (props) => (props.match && props.match.params && props.match.params.id) || (props.params && props.params.id);
const SLOT_ERR = {
  'donate.errSlot': () => t('donate.errSlot'), 'donate.errSlotPast': () => t('donate.errSlotPast'),
  'donate.errNoSlot': () => t('donate.errNoSlot'), 'donate.errTooMany': () => t('donate.errTooMany', { max: MAX_SLOTS }),
};

// /post/:id/donate (seller): after the sale, list what's left as one donation
// lot with pickup times; a neighbor or an organization claims it.
class DonateLeftovers extends Component {
  constructor(props) {
    super(props);
    this.state = { post: null, lot: null, error: '', picked: {}, note: '', slots: [''], minutes: '30', errors: {}, busy: false };
  }

  componentDidMount() {
    this.mounted = true;
    const id = paramId(this.props);
    Promise.all([apiFetch('/post/' + encodeURIComponent(id)), fetchDonation(id)]).then(([p, l]) => {
      if (!this.mounted) return;
      if (!p.ok) return this.setState({ error: errorMessage(p.data, t('post.notFound')) });
      const unsold = (p.data.items || []).filter((i) => !i.sold);
      const lot = l.ok ? l.data : null;
      const live = lot && (lot.status === 'open' || lot.status === 'claimed');
      const picked = {};
      (live ? lot.items : unsold).forEach((i) => { picked[i.id] = true; });
      return this.setState({ post: p.data, lot: live ? lot : null, picked, note: live ? lot.note || '' : '',
        slots: live && lot.slots.length ? lot.slots.filter((s) => !s.past).map((s) => localInput(s.start)).concat(['']).slice(0, MAX_SLOTS) : [''],
        minutes: live ? String(lot.slotMinutes) : '30' });
    }).catch(() => this.mounted && this.setState({ error: t('common.network') }));
  }
  componentWillUnmount() { this.mounted = false; }

  save(e) {
    e.preventDefault();
    const built = buildSlots(this.state.slots);
    if (built.error) { this.setState({ errors: { slots: SLOT_ERR[built.error]() } }); return; }
    const itemIds = Object.keys(this.state.picked).filter((k) => this.state.picked[k]).map(Number);
    this.setState({ busy: true, errors: {} });
    saveDonation(paramId(this.props), { itemIds, note: this.state.note.trim() || null, slots: built.slots, minutes: Number(this.state.minutes) }).then(({ ok, data }) => {
      this.setState({ busy: false });
      if (!ok) { const d = (data && data.error && data.error.details) || {}; this.setState({ errors: d }); if (!Object.keys(d).length) toast.error(errorMessage(data, t('donate.saveFailed'))); return; }
      this.setState({ lot: data });
      toast.success(t('donate.listed'));
    }).catch(() => { this.setState({ busy: false }); toast.error(t('common.network')); });
  }

  step(step) {
    this.setState({ busy: true });
    const call = step === 'delete' ? deleteDonation(paramId(this.props)) : donationStep(paramId(this.props), step);
    call.then(({ ok, data }) => {
      this.setState({ busy: false });
      if (!ok) { toast.error(errorMessage(data, t('donate.saveFailed'))); return; }
      this.setState({ lot: step === 'delete' || (data && data.status === 'done') ? null : data });
      if (step === 'done') toast.success(t('donate.thanks'));
    }).catch(() => { this.setState({ busy: false }); toast.error(t('common.network')); });
  }

  setSlot(i, v) {
    const slots = this.state.slots.slice();
    slots[i] = v;
    if (i === slots.length - 1 && v && slots.length < MAX_SLOTS) slots.push('');
    this.setState({ slots });
  }

  render() {
    const s = this.state;
    const id = paramId(this.props);
    const back = <Link to={'/dashboard/sales/' + id} className="back-link"><ArrowLeft size={16} aria-hidden="true" />{t('dash.saleStats')}</Link>;
    if (this.props.ready && !this.props.user) {
      return <div className="container container-narrow"><EmptyState level={1} icon={Lock} title={t('dash.loginTitle')} action={<Link className="btn btn-primary" to="/login">{t('nav.logIn')}</Link>}>{t('dash.loginText')}</EmptyState></div>;
    }
    if (s.error) return <div className="container container-narrow">{back}<Alert tone="danger">{s.error}</Alert></div>;
    if (!s.post) return <div className="container container-narrow"><SkeletonBlock lines={6} /></div>;
    const unsold = (s.post.items || []).filter((i) => !i.sold);
    const lot = s.lot;
    return (
      <div className="container container-narrow donate-page">
        {back}
        <header className="page-header"><div><h1><HeartHandshake size={22} aria-hidden="true" /> {t('donate.title')}</h1><p>{t('donate.intro')}</p></div></header>
        {lot && lot.status === 'claimed' ? (
          <div className="card-form" role="status">
            <p><strong>{t('donate.claimedBy', { name: lot.claimer ? lot.claimer.name : '' })}</strong>{lot.claimer && lot.claimer.org ? ' · ' + lot.claimer.org : ''}</p>
            {lot.chosen ? <p>{t('donate.pickupAt', { time: holdTime(lot.chosen.start) })}</p> : null}
            <div className="form-actions">
              {lot.conversationId ? <Link className="btn btn-secondary btn-sm" to={'/messages/' + lot.conversationId}><MessageCircle size={14} aria-hidden="true" />{t('donate.message')}</Link> : null}
              <button type="button" className="btn btn-primary btn-sm" disabled={s.busy} onClick={() => this.step('done')}><Check size={14} aria-hidden="true" />{t('donate.markDone')}</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={s.busy} onClick={() => this.step('release')}>{t('donate.release')}</button>
            </div>
          </div>
        ) : (
          <form className="card-form" onSubmit={(e) => this.save(e)} noValidate>
            {lot ? <Alert tone="info">{t('donate.isOpen')}</Alert> : null}
            <fieldset>
              <legend>{t('donate.items')}</legend>
              {!unsold.length ? <p className="muted small">{t('donate.noItems')}</p> : unsold.map((i) => (
                <label key={i.id} className="checkbox-row">
                  <input type="checkbox" checked={!!s.picked[i.id]} onChange={(e) => this.setState({ picked: Object.assign({}, s.picked, { [i.id]: e.target.checked }) })} />
                  <span>{i.name}</span>
                </label>
              ))}
              {s.errors.itemIds ? <p className="field-error">{s.errors.itemIds}</p> : null}
            </fieldset>
            <Field id="donate-note" label={t('donate.note')} optional error={s.errors.note}>
              <textarea id="donate-note" className="input" rows={2} maxLength={300} placeholder={t('donate.notePlaceholder')} value={s.note} onChange={(e) => this.setState({ note: e.target.value })} />
            </Field>
            <fieldset>
              <legend>{t('donate.slots')}</legend>
              {s.slots.map((v, i) => (
                <div key={i} className="item-form-row">
                  <input type="datetime-local" className="input" aria-label={t('donate.slotN', { n: i + 1 })} value={v} onChange={(e) => this.setSlot(i, e.target.value)} />
                  {v ? <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={t('donate.removeSlot', { n: i + 1 })} onClick={() => this.setState({ slots: s.slots.filter((_, j) => j !== i).concat(s.slots.length === 1 ? [''] : []) })}><Trash2 size={14} aria-hidden="true" /></button> : null}
                </div>
              ))}
              {s.slots.length < MAX_SLOTS && s.slots[s.slots.length - 1] ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.setState({ slots: s.slots.concat(['']) })}><Plus size={14} aria-hidden="true" />{t('donate.addSlot')}</button> : null}
              {s.errors.slots ? <p className="field-error">{s.errors.slots}</p> : null}
            </fieldset>
            <Field id="donate-minutes" label={t('donate.minutes')} error={s.errors.minutes}>
              <select id="donate-minutes" className="input" value={s.minutes} onChange={(e) => this.setState({ minutes: e.target.value })}>
                {MINUTES.map((m) => <option key={m} value={String(m)}>{t('donate.minutesN', { count: m })}</option>)}
              </select>
            </Field>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={s.busy}>{s.busy ? <Spinner /> : <HeartHandshake size={16} aria-hidden="true" />}{lot ? t('common.save') : t('donate.list')}</button>
              {lot ? <button type="button" className="btn btn-ghost" disabled={s.busy} onClick={() => this.step('delete')}>{t('donate.takeDown')}</button> : null}
              {lot ? <Link className="btn btn-ghost" to={'/donations/' + id}>{t('donate.view')}</Link> : null}
            </div>
          </form>
        )}
      </div>
    );
  }
}

export default DonateLeftovers;
