import React from 'react';
import { BellRing, BellOff, Plus, Pencil, Trash2, LocateFixed, MapPin } from 'lucide-react';
import { fetchAlerts, createAlert, updateAlert, deleteAlert, errorMessage, ALERT_RADIUS } from '../api';
import { Field, Alert, EmptyState, SkeletonBlock, Spinner } from '../components/ui';
import { priceFieldError, formatUSD } from '../lib/price';
import toast from '../components/toast';
import { t } from '../i18n';

const LABEL_MAX = 80;
const EMPTY_FORM = { id: null, label: '', where: 'address', address: '', coords: null, radiusMiles: '10', maxPrice: '', freeOnly: false, frequency: 'instant' };

export function alertSummary(a) {
  const parts = [t('list.withinMi', { miles: a.radiusMiles })];
  if (a.freeOnly) parts.push(t('alerts.free'));
  else if (a.maxPrice !== null && a.maxPrice !== undefined) parts.push(t('alerts.maxPrice', { price: formatUSD(a.maxPrice) }));
  if (a.frequency === 'weekly') parts.push(t('alerts.weeklyChip'));
  return parts.join(' · ');
}

// Settings > Sale alerts: saved searches that email you about new nearby sales.
export default class SaleAlerts extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, alerts: [], limit: 5, globallyEnabled: true, error: '', busyId: null,
      form: null, errors: {}, saving: false, locating: false };
    this.submit = this.submit.bind(this);
  }

  componentDidMount() { this.mounted = true; this.load(); }
  componentWillUnmount() { this.mounted = false; }

  load() {
    fetchAlerts().then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) return this.setState({ loading: false, error: errorMessage(data, t('alerts.loadFailed')) });
      this.setState({ loading: false, error: '', alerts: data.results, limit: data.limit, globallyEnabled: data.globallyEnabled });
      // Deep link from emails: /settings#alerts
      if (window.location.hash === '#alerts' && this.ref && this.ref.scrollIntoView) this.ref.scrollIntoView({ block: 'start' });
    }).catch(() => this.mounted && this.setState({ loading: false, error: t('common.networkShort') }));
  }

  openNew() { this.setState({ form: Object.assign({}, EMPTY_FORM), errors: {} }); }
  openEdit(a) {
    this.setState({ errors: {}, form: { id: a.id, label: a.label || '', where: 'keep', address: '', coords: null,
      radiusMiles: String(a.radiusMiles), maxPrice: a.maxPrice === null || a.maxPrice === undefined ? '' : String(a.maxPrice), freeOnly: a.freeOnly, frequency: a.frequency || 'instant' } });
  }
  setForm(patch) { this.setState((s) => ({ form: Object.assign({}, s.form, patch), errors: {} })); }

  locate() {
    if (!navigator.geolocation) return this.setState({ errors: { location: t('list.noGeo') } });
    this.setState({ locating: true });
    navigator.geolocation.getCurrentPosition(
      (pos) => { this.setState({ locating: false }); this.setForm({ where: 'here', coords: { lat: pos.coords.latitude, lng: pos.coords.longitude } }); },
      () => this.setState({ locating: false, errors: { location: t('list.geoFailed') } }),
      { timeout: 10000, maximumAge: 300000 }
    );
  }

  validate(f) {
    const errors = {};
    if (f.label.trim().length > LABEL_MAX) errors.label = t('alerts.nameLong', { max: LABEL_MAX });
    if (f.where === 'address' && !f.address.trim()) errors.location = t('alerts.needAddress');
    if (f.where === 'here' && !f.coords) errors.location = t('alerts.needLocation');
    const r = Number(f.radiusMiles);
    if (!/^\d+$/.test(String(f.radiusMiles).trim()) || r < ALERT_RADIUS.min || r > ALERT_RADIUS.max) errors.radiusMiles = t('alerts.radiusRange', { min: ALERT_RADIUS.min, max: ALERT_RADIUS.max });
    const pe = f.freeOnly ? '' : priceFieldError(f.maxPrice, t('list.maxPrice'));
    if (pe) errors.maxPrice = pe;
    return errors;
  }

  submit(e) {
    e.preventDefault();
    const f = this.state.form;
    const errors = this.validate(f);
    if (Object.keys(errors).length) return this.setState({ errors });
    const body = { label: f.label.trim() || null, radiusMiles: Number(f.radiusMiles), freeOnly: f.freeOnly, frequency: f.frequency,
      maxPrice: f.freeOnly || !f.maxPrice.trim() ? null : Number(f.maxPrice) };
    if (f.where === 'address') body.address = f.address.trim();
    if (f.where === 'here') { body.lat = f.coords.lat; body.lng = f.coords.lng; }
    this.setState({ saving: true });
    (f.id ? updateAlert(f.id, body) : createAlert(body)).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) {
        const d = (data && data.error && data.error.details) || {};
        return this.setState({ saving: false, errors: Object.keys(d).length ? d : { form: errorMessage(data, t('list.alertFailed')) } });
      }
      this.setState((s) => ({ saving: false, form: null,
        alerts: f.id ? s.alerts.map((a) => (a.id === data.id ? data : a)) : s.alerts.concat(data) }));
      toast.success(f.id ? t('alerts.updated') : t('alerts.savedNearby'));
    }).catch(() => this.mounted && this.setState({ saving: false, errors: { form: t('common.networkShort') } }));
  }

  toggle(a) {
    this.setState({ busyId: a.id });
    updateAlert(a.id, { enabled: !a.enabled }).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) { this.setState({ busyId: null }); return toast.error(errorMessage(data, t('alerts.updateFailed'))); }
      this.setState((s) => ({ busyId: null, alerts: s.alerts.map((x) => (x.id === data.id ? data : x)) }));
      toast.success(data.enabled ? t('alerts.on') : t('alerts.paused'));
    }).catch(() => { this.setState({ busyId: null }); toast.error(t('common.networkShort')); });
  }

  remove(a) {
    if (!window.confirm(t('alerts.confirmDelete', { name: a.label || alertSummary(a) }))) return;
    this.setState({ busyId: a.id });
    deleteAlert(a.id).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) { this.setState({ busyId: null }); return toast.error(errorMessage(data, t('alerts.deleteFailed'))); }
      this.setState((s) => ({ busyId: null, alerts: s.alerts.filter((x) => x.id !== a.id), form: s.form && s.form.id === a.id ? null : s.form }));
      toast.success(t('alerts.deleted'));
    }).catch(() => { this.setState({ busyId: null }); toast.error(t('common.networkShort')); });
  }

  renderForm() {
    const f = this.state.form;
    const e = this.state.errors;
    const s = this.state;
    return (
      <form className="alert-form panel stack" onSubmit={this.submit} noValidate aria-labelledby="alert-form-heading">
        <h3 id="alert-form-heading">{f.id ? t('alerts.edit') : t('alerts.new')}</h3>
        <Field id="alert-label" label={t('alerts.name')} optional error={e.label} hint={t('alerts.nameHint')}>
          <input className="input" type="text" maxLength={LABEL_MAX} value={f.label} onChange={(ev) => this.setForm({ label: ev.target.value })} />
        </Field>
        <div className="field">
          <span className="field-label" id="alert-where-label">{t('alerts.location')}</span>
          <div className="segmented" role="group" aria-labelledby="alert-where-label">
            {f.id ? <button type="button" aria-pressed={f.where === 'keep'} onClick={() => this.setForm({ where: 'keep' })}><MapPin size={14} aria-hidden="true" />{t('alerts.keep')}</button> : null}
            <button type="button" aria-pressed={f.where === 'address'} onClick={() => this.setForm({ where: 'address' })}>{t('alerts.address')}</button>
            <button type="button" aria-pressed={f.where === 'here'} onClick={() => this.locate()} disabled={s.locating}>
              {s.locating ? <Spinner size={14} /> : <LocateFixed size={14} aria-hidden="true" />}{t('alerts.myLocation')}
            </button>
          </div>
          {f.where === 'here' && f.coords ? <span className="field-hint">{t('alerts.usingLocation')}</span> : null}
          {e.location && f.where !== 'address' ? <span className="field-error" role="alert">{e.location}</span> : null}
        </div>
        {f.where === 'address' ? (
          <Field id="alert-address" label={t('list.whereLabel')} error={e.location}>
            <input className="input" type="text" maxLength={200} autoComplete="street-address" value={f.address} onChange={(ev) => this.setForm({ address: ev.target.value })} />
          </Field>
        ) : null}
        <div className="alert-form-row">
          <Field id="alert-radius" label={t('alerts.radius')} error={e.radiusMiles} hint={t('alerts.radiusHint', { min: ALERT_RADIUS.min, max: ALERT_RADIUS.max })}>
            <input className="input" type="number" inputMode="numeric" min={ALERT_RADIUS.min} max={ALERT_RADIUS.max} step={1}
              value={f.radiusMiles} onChange={(ev) => this.setForm({ radiusMiles: ev.target.value })} />
          </Field>
          <Field id="alert-max-price" label={t('alerts.maxPriceLabel')} optional error={e.maxPrice} hint={t('list.maxPriceHint')}>
            <input className="input" type="text" inputMode="numeric" maxLength={7} placeholder={t('list.any')} disabled={f.freeOnly}
              value={f.freeOnly ? '' : f.maxPrice} onChange={(ev) => this.setForm({ maxPrice: ev.target.value })} />
          </Field>
        </div>
        <label className="checkbox-row" htmlFor="alert-free">
          <span className="switch">
            <input id="alert-free" type="checkbox" role="switch" checked={f.freeOnly} onChange={(ev) => this.setForm({ freeOnly: ev.target.checked })} />
            <span className="switch-track" aria-hidden="true" />
          </span>
          <span><strong>{t('list.freeOnly')}</strong><span className="field-hint" style={{ display: 'block' }}>{t('alerts.freeHint')}</span></span>
        </label>
        <fieldset className="alert-frequency">
          <legend className="field-label">{t('alerts.frequency')}</legend>
          <label className="radio-row" htmlFor="alert-freq-instant">
            <input id="alert-freq-instant" type="radio" name="alert-frequency" value="instant" checked={f.frequency !== 'weekly'} onChange={() => this.setForm({ frequency: 'instant' })} />
            <span><strong>{t('alerts.instant')}</strong><span className="field-hint" style={{ display: 'block' }}>{t('alerts.instantHint')}</span></span>
          </label>
          <label className="radio-row" htmlFor="alert-freq-weekly">
            <input id="alert-freq-weekly" type="radio" name="alert-frequency" value="weekly" checked={f.frequency === 'weekly'} onChange={() => this.setForm({ frequency: 'weekly' })} />
            <span><strong>{t('alerts.weekly')}</strong><span className="field-hint" style={{ display: 'block' }}>{t('alerts.weeklyHint')}</span></span>
          </label>
        </fieldset>
        {e.form ? <Alert tone="danger">{e.form}</Alert> : null}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={s.saving}>{s.saving ? <Spinner /> : null}{f.id ? t('edit.saveChanges') : t('alerts.create')}</button>
          <button type="button" className="btn btn-secondary" onClick={() => this.setState({ form: null, errors: {} })} disabled={s.saving}>{t('common.cancel')}</button>
        </div>
      </form>
    );
  }

  render() {
    const s = this.state;
    const full = s.alerts.length >= s.limit;
    return (
      <section id="alerts" ref={(el) => { this.ref = el; }} className="settings-section card-form rg-sale-alerts" aria-labelledby="alerts-heading">
        <header>
          <h2 id="alerts-heading"><BellRing size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />{t('alerts.title')}</h2>
          <p>{t('alerts.lead')}</p>
        </header>
        <div className="stack">
          {!s.loading && !s.globallyEnabled ? (
            <Alert tone="warning" live={false}><p>{t('alerts.siteOff')}</p></Alert>
          ) : null}
          {s.loading ? <SkeletonBlock lines={2} height={44} /> : (
            <React.Fragment>
              {s.alerts.length ? (
                <ul className="alert-list">
                  {s.alerts.map((a) => (
                    <li key={a.id} className={'alert-item' + (a.enabled ? '' : ' is-paused')} data-alert-id={a.id}>
                      <label className="checkbox-row" htmlFor={'alert-on-' + a.id}>
                        <span className="switch">
                          <input id={'alert-on-' + a.id} type="checkbox" role="switch" checked={a.enabled} disabled={s.busyId === a.id}
                            onChange={() => this.toggle(a)} aria-label={t(a.enabled ? 'alerts.pauseNamed' : 'alerts.turnOnNamed', { name: a.label || t('alerts.alert') })} />
                          <span className="switch-track" aria-hidden="true" />
                        </span>
                        <span className="alert-item-text">
                          <strong>{a.label || t('alerts.unnamed')}</strong>
                          <span className="chips">
                            <span className="chip chip-brand">{alertSummary(a)}</span>
                            {a.enabled ? null : <span className="chip"><BellOff size={12} aria-hidden="true" />{t('alerts.pausedChip')}</span>}
                          </span>
                        </span>
                      </label>
                      <div className="row alert-item-actions">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => this.openEdit(a)} disabled={s.busyId === a.id}><Pencil size={14} aria-hidden="true" />{t('common.edit')}</button>
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => this.remove(a)} disabled={s.busyId === a.id}><Trash2 size={14} aria-hidden="true" />{t('common.delete')}</button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (s.form ? null : (
                <EmptyState icon={BellRing} title={t('alerts.none')}>{t('alerts.noneText', { cta: t('list.alertMe') })}</EmptyState>
              ))}
              {s.form ? this.renderForm() : (
                <div className="row">
                  <button type="button" className="btn btn-primary" onClick={() => this.openNew()} disabled={full || !s.globallyEnabled}><Plus size={16} aria-hidden="true" />{t('alerts.new')}</button>
                  <span className="small muted">{t('alerts.count', { n: s.alerts.length, limit: s.limit })}{full ? t('alerts.fullNote') : ''}</span>
                </div>
              )}
            </React.Fragment>
          )}
          {s.error ? <Alert tone="danger">{s.error}</Alert> : null}
        </div>
      </section>
    );
  }
}
