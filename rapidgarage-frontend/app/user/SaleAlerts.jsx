import React from 'react';
import { BellRing, BellOff, Plus, Pencil, Trash2, LocateFixed, MapPin } from 'lucide-react';
import { fetchAlerts, createAlert, updateAlert, deleteAlert, errorMessage, ALERT_RADIUS } from '../api';
import { Field, Alert, EmptyState, SkeletonBlock, Spinner } from '../components/ui';
import { priceFieldError, formatUSD } from '../lib/price';
import toast from '../components/toast';

const LABEL_MAX = 80;
const EMPTY_FORM = { id: null, label: '', where: 'address', address: '', coords: null, radiusMiles: '10', maxPrice: '', freeOnly: false };

export function alertSummary(a) {
  const parts = ['Within ' + a.radiusMiles + ' mi'];
  if (a.freeOnly) parts.push('free only');
  else if (a.maxPrice !== null && a.maxPrice !== undefined) parts.push('items ' + formatUSD(a.maxPrice) + ' or less');
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
      if (!ok) return this.setState({ loading: false, error: errorMessage(data, 'Could not load your alerts.') });
      this.setState({ loading: false, error: '', alerts: data.results, limit: data.limit, globallyEnabled: data.globallyEnabled });
      // Deep link from emails: /settings#alerts
      if (window.location.hash === '#alerts' && this.ref && this.ref.scrollIntoView) this.ref.scrollIntoView({ block: 'start' });
    }).catch(() => this.mounted && this.setState({ loading: false, error: 'Unable to reach the server.' }));
  }

  openNew() { this.setState({ form: Object.assign({}, EMPTY_FORM), errors: {} }); }
  openEdit(a) {
    this.setState({ errors: {}, form: { id: a.id, label: a.label || '', where: 'keep', address: '', coords: null,
      radiusMiles: String(a.radiusMiles), maxPrice: a.maxPrice === null || a.maxPrice === undefined ? '' : String(a.maxPrice), freeOnly: a.freeOnly } });
  }
  setForm(patch) { this.setState((s) => ({ form: Object.assign({}, s.form, patch), errors: {} })); }

  locate() {
    if (!navigator.geolocation) return this.setState({ errors: { location: 'Your browser cannot share its location.' } });
    this.setState({ locating: true });
    navigator.geolocation.getCurrentPosition(
      (pos) => { this.setState({ locating: false }); this.setForm({ where: 'here', coords: { lat: pos.coords.latitude, lng: pos.coords.longitude } }); },
      () => this.setState({ locating: false, errors: { location: 'Could not get your location. Allow location access or type an address.' } }),
      { timeout: 10000, maximumAge: 300000 }
    );
  }

  validate(f) {
    const errors = {};
    if (f.label.trim().length > LABEL_MAX) errors.label = 'Keep the name under ' + LABEL_MAX + ' characters.';
    if (f.where === 'address' && !f.address.trim()) errors.location = 'Enter an address or zip code.';
    if (f.where === 'here' && !f.coords) errors.location = 'Use your current location first.';
    const r = Number(f.radiusMiles);
    if (!/^\d+$/.test(String(f.radiusMiles).trim()) || r < ALERT_RADIUS.min || r > ALERT_RADIUS.max) errors.radiusMiles = 'Radius must be a whole number from ' + ALERT_RADIUS.min + ' to ' + ALERT_RADIUS.max + ' miles.';
    const pe = f.freeOnly ? '' : priceFieldError(f.maxPrice, 'Max price');
    if (pe) errors.maxPrice = pe;
    return errors;
  }

  submit(e) {
    e.preventDefault();
    const f = this.state.form;
    const errors = this.validate(f);
    if (Object.keys(errors).length) return this.setState({ errors });
    const body = { label: f.label.trim() || null, radiusMiles: Number(f.radiusMiles), freeOnly: f.freeOnly,
      maxPrice: f.freeOnly || !f.maxPrice.trim() ? null : Number(f.maxPrice) };
    if (f.where === 'address') body.address = f.address.trim();
    if (f.where === 'here') { body.lat = f.coords.lat; body.lng = f.coords.lng; }
    this.setState({ saving: true });
    (f.id ? updateAlert(f.id, body) : createAlert(body)).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) {
        const d = (data && data.error && data.error.details) || {};
        return this.setState({ saving: false, errors: Object.keys(d).length ? d : { form: errorMessage(data, 'Could not save the alert.') } });
      }
      this.setState((s) => ({ saving: false, form: null,
        alerts: f.id ? s.alerts.map((a) => (a.id === data.id ? data : a)) : s.alerts.concat(data) }));
      toast.success(f.id ? 'Alert updated.' : "Alert saved. We'll email you about new sales nearby.");
    }).catch(() => this.mounted && this.setState({ saving: false, errors: { form: 'Unable to reach the server.' } }));
  }

  toggle(a) {
    this.setState({ busyId: a.id });
    updateAlert(a.id, { enabled: !a.enabled }).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) { this.setState({ busyId: null }); return toast.error(errorMessage(data, 'Could not update the alert.')); }
      this.setState((s) => ({ busyId: null, alerts: s.alerts.map((x) => (x.id === data.id ? data : x)) }));
      toast.success(data.enabled ? 'Alert turned on.' : 'Alert paused.');
    }).catch(() => { this.setState({ busyId: null }); toast.error('Unable to reach the server.'); });
  }

  remove(a) {
    if (!window.confirm('Delete the alert "' + (a.label || alertSummary(a)) + '"?')) return;
    this.setState({ busyId: a.id });
    deleteAlert(a.id).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) { this.setState({ busyId: null }); return toast.error(errorMessage(data, 'Could not delete the alert.')); }
      this.setState((s) => ({ busyId: null, alerts: s.alerts.filter((x) => x.id !== a.id), form: s.form && s.form.id === a.id ? null : s.form }));
      toast.success('Alert deleted.');
    }).catch(() => { this.setState({ busyId: null }); toast.error('Unable to reach the server.'); });
  }

  renderForm() {
    const f = this.state.form;
    const e = this.state.errors;
    const s = this.state;
    return (
      <form className="alert-form panel stack" onSubmit={this.submit} noValidate aria-labelledby="alert-form-heading">
        <h3 id="alert-form-heading">{f.id ? 'Edit alert' : 'New alert'}</h3>
        <Field id="alert-label" label="Name" optional error={e.label} hint="Shown in emails, e.g. “Near home”.">
          <input className="input" type="text" maxLength={LABEL_MAX} value={f.label} onChange={(ev) => this.setForm({ label: ev.target.value })} />
        </Field>
        <div className="field">
          <span className="field-label" id="alert-where-label">Location</span>
          <div className="segmented" role="group" aria-labelledby="alert-where-label">
            {f.id ? <button type="button" aria-pressed={f.where === 'keep'} onClick={() => this.setForm({ where: 'keep' })}><MapPin size={14} aria-hidden="true" />Keep current</button> : null}
            <button type="button" aria-pressed={f.where === 'address'} onClick={() => this.setForm({ where: 'address' })}>Address</button>
            <button type="button" aria-pressed={f.where === 'here'} onClick={() => this.locate()} disabled={s.locating}>
              {s.locating ? <Spinner size={14} /> : <LocateFixed size={14} aria-hidden="true" />}My location
            </button>
          </div>
          {f.where === 'here' && f.coords ? <span className="field-hint">Using your current location.</span> : null}
          {e.location && f.where !== 'address' ? <span className="field-error" role="alert">{e.location}</span> : null}
        </div>
        {f.where === 'address' ? (
          <Field id="alert-address" label="Address or zip code" error={e.location}>
            <input className="input" type="text" maxLength={200} autoComplete="street-address" value={f.address} onChange={(ev) => this.setForm({ address: ev.target.value })} />
          </Field>
        ) : null}
        <div className="alert-form-row">
          <Field id="alert-radius" label="Radius (miles)" error={e.radiusMiles} hint={ALERT_RADIUS.min + '–' + ALERT_RADIUS.max + ' mi'}>
            <input className="input" type="number" inputMode="numeric" min={ALERT_RADIUS.min} max={ALERT_RADIUS.max} step={1}
              value={f.radiusMiles} onChange={(ev) => this.setForm({ radiusMiles: ev.target.value })} />
          </Field>
          <Field id="alert-max-price" label="Max price ($)" optional error={e.maxPrice} hint="Sales with something at or under this price.">
            <input className="input" type="text" inputMode="numeric" maxLength={7} placeholder="Any" disabled={f.freeOnly}
              value={f.freeOnly ? '' : f.maxPrice} onChange={(ev) => this.setForm({ maxPrice: ev.target.value })} />
          </Field>
        </div>
        <label className="checkbox-row" htmlFor="alert-free">
          <span className="switch">
            <input id="alert-free" type="checkbox" role="switch" checked={f.freeOnly} onChange={(ev) => this.setForm({ freeOnly: ev.target.checked })} />
            <span className="switch-track" aria-hidden="true" />
          </span>
          <span><strong>Free only</strong><span className="field-hint" style={{ display: 'block' }}>Only sales marked free.</span></span>
        </label>
        {e.form ? <Alert tone="danger">{e.form}</Alert> : null}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={s.saving}>{s.saving ? <Spinner /> : null}{f.id ? 'Save changes' : 'Create alert'}</button>
          <button type="button" className="btn btn-secondary" onClick={() => this.setState({ form: null, errors: {} })} disabled={s.saving}>Cancel</button>
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
          <h2 id="alerts-heading"><BellRing size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />Sale alerts</h2>
          <p>Get an email when a new garage sale is posted near a place you care about. Emails are bundled so you won't get flooded.</p>
        </header>
        <div className="stack">
          {!s.loading && !s.globallyEnabled ? (
            <Alert tone="warning" live={false}><p>Sale alerts are turned off on this site right now. Your alerts are saved but no emails are sent.</p></Alert>
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
                            onChange={() => this.toggle(a)} aria-label={(a.enabled ? 'Pause ' : 'Turn on ') + (a.label || 'alert')} />
                          <span className="switch-track" aria-hidden="true" />
                        </span>
                        <span className="alert-item-text">
                          <strong>{a.label || 'Unnamed alert'}</strong>
                          <span className="chips">
                            <span className="chip chip-brand">{alertSummary(a)}</span>
                            {a.enabled ? null : <span className="chip"><BellOff size={12} aria-hidden="true" />Paused</span>}
                          </span>
                        </span>
                      </label>
                      <div className="row alert-item-actions">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => this.openEdit(a)} disabled={s.busyId === a.id}><Pencil size={14} aria-hidden="true" />Edit</button>
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => this.remove(a)} disabled={s.busyId === a.id}><Trash2 size={14} aria-hidden="true" />Delete</button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (s.form ? null : (
                <EmptyState icon={BellRing} title="No alerts yet">Create one here, or search the map and choose “Alert me about sales here”.</EmptyState>
              ))}
              {s.form ? this.renderForm() : (
                <div className="row">
                  <button type="button" className="btn btn-primary" onClick={() => this.openNew()} disabled={full || !s.globallyEnabled}><Plus size={16} aria-hidden="true" />New alert</button>
                  <span className="small muted">{s.alerts.length} of {s.limit} alerts{full ? ' — delete one to add another' : ''}</span>
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
