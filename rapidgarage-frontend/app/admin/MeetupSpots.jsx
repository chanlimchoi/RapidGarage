import React from 'react';
import { MapPin, Plus, Pencil, Trash2, Search } from 'lucide-react';
import { errorMessage, adminSpots, adminSaveSpot, adminDeleteSpot } from '../api';
import { Alert, EmptyState, SkeletonBlock, Spinner } from '../components/ui';
import toast from '../components/toast';
import { t } from '../i18n';
import { KINDS, kindLabel } from '../messages/meetupText';

const EMPTY = { name: '', kind: 'police', address: '', city: '', state: '', lat: '', lng: '', notes: '', active: true };
const FIELDS = ['name', 'kind', 'address', 'city', 'state', 'lat', 'lng', 'notes'];

// Admin: the curated "Safe meetup spots" list. Spots are suggested in
// conversations nearest the sale's area. This page never shows conversations.
export default class MeetupSpots extends React.Component {
  constructor(props) {
    super(props);
    this.state = { list: null, geocoding: false, error: '', q: '', form: null, editId: null, busy: null, fieldErrors: {}, formError: '' };
  }
  componentDidMount() { this.load(); }
  componentWillUnmount() { this.unmounted = true; }

  load() {
    adminSpots(this.state.q.trim())
      .then(({ ok, data }) => { if (!this.unmounted) this.setState(ok ? { list: data.results, geocoding: data.geocoding, error: '' } : { error: errorMessage(data, t('spots.loadFailed')) }); })
      .catch(() => { if (!this.unmounted) this.setState({ error: t('common.networkShort') }); });
  }

  edit(s) {
    const form = s ? FIELDS.reduce((o, f) => Object.assign(o, { [f]: s[f] === null || s[f] === undefined ? '' : String(s[f]) }), { active: s.active }) : Object.assign({}, EMPTY);
    this.setState({ form, editId: s ? s.id : null, fieldErrors: {}, formError: '' });
  }

  save(e) {
    e.preventDefault();
    const f = this.state.form;
    const body = { name: f.name, kind: f.kind, address: f.address || null, city: f.city || null, state: f.state || null, notes: f.notes || null, active: f.active };
    if (f.lat !== '' || f.lng !== '') { body.lat = f.lat === '' ? '' : Number(f.lat); body.lng = f.lng === '' ? '' : Number(f.lng); }
    this.setState({ busy: 'save', fieldErrors: {}, formError: '' });
    adminSaveSpot(this.state.editId, body)
      .then(({ ok, data }) => {
        if (this.unmounted) return;
        if (!ok) {
          const details = (data && data.error && data.error.details) || {};
          this.setState({ busy: null, fieldErrors: details, formError: Object.keys(details).length ? '' : errorMessage(data, t('spots.failed')) });
          return;
        }
        toast.success(t('spots.saved'));
        this.setState({ busy: null, form: null, editId: null });
        this.load();
      })
      .catch(() => { if (!this.unmounted) this.setState({ busy: null, formError: t('common.networkShort') }); });
  }

  toggle(s) {
    this.setState({ busy: s.id });
    adminSaveSpot(s.id, { active: !s.active })
      .then(({ ok, data }) => { if (this.unmounted) return; this.setState({ busy: null }); if (!ok) toast.error(errorMessage(data, t('spots.failed'))); else toast.success(data.active ? t('spots.onToast', { name: s.name }) : t('spots.offToast', { name: s.name })); this.load(); })
      .catch(() => { if (!this.unmounted) { this.setState({ busy: null }); toast.error(t('common.networkShort')); } });
  }

  remove(s) {
    if (!window.confirm(t('spots.confirmDelete', { name: s.name }))) return;
    this.setState({ busy: s.id });
    adminDeleteSpot(s.id)
      .then(({ ok, data }) => { if (this.unmounted) return; this.setState({ busy: null }); if (!ok) toast.error(errorMessage(data, t('spots.failed'))); else toast.success(t('spots.deleted')); this.load(); })
      .catch(() => { if (!this.unmounted) { this.setState({ busy: null }); toast.error(t('common.networkShort')); } });
  }

  renderForm() {
    const { form, fieldErrors: fe, formError, busy, editId, geocoding } = this.state;
    const set = (k) => (e) => this.setState({ form: Object.assign({}, form, { [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }), fieldErrors: {} });
    const input = (k, label, extra) => (
      <label className="field" htmlFor={'spot-' + k}>
        <span className="field-label">{label}</span>
        <input id={'spot-' + k} className="input" value={form[k]} onChange={set(k)} aria-invalid={fe[k] ? 'true' : undefined} {...(extra || {})} />
        {fe[k] ? <span className="field-error" role="alert">{fe[k]}</span> : null}
      </label>
    );
    return (
      <form className="panel spot-form" onSubmit={(e) => this.save(e)} noValidate aria-labelledby="spot-form-title">
        <h3 id="spot-form-title" className="h4">{editId ? t('spots.editTitle') : t('spots.addTitle')}</h3>
        <div className="spot-grid">
          {input('name', t('spots.name'), { maxLength: 120, required: true, placeholder: t('spots.namePlaceholder') })}
          <label className="field" htmlFor="spot-kind">
            <span className="field-label">{t('spots.kind')}</span>
            <select id="spot-kind" className="select" value={form.kind} onChange={set('kind')}>{KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}</select>
            {fe.kind ? <span className="field-error" role="alert">{fe.kind}</span> : null}
          </label>
          {input('address', t('spots.address'), { maxLength: 200 })}
          {input('city', t('spots.city'), { maxLength: 80 })}
          {input('state', t('spots.state'), { maxLength: 40 })}
          {input('lat', t('spots.lat'), { inputMode: 'decimal' })}
          {input('lng', t('spots.lng'), { inputMode: 'decimal' })}
        </div>
        <p className="field-hint">{geocoding ? t('spots.coordsHint') : t('spots.coordsHintNoKey')}</p>
        <label className="field" htmlFor="spot-notes">
          <span className="field-label">{t('spots.notes')} <span className="muted small">{t('ui.optional')}</span></span>
          <input id="spot-notes" className="input" value={form.notes} maxLength={300} onChange={set('notes')} placeholder={t('spots.notesPlaceholder')} />
        </label>
        <label className="checkbox-row" htmlFor="spot-active">
          <input id="spot-active" type="checkbox" checked={form.active} onChange={set('active')} />
          <span><strong>{t('spots.activeLabel')}</strong><span className="field-hint" style={{ display: 'block' }}>{t('spots.activeHint')}</span></span>
        </label>
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy === 'save'}>{busy === 'save' ? <Spinner /> : null}{t('spots.save')}</button>
          <button type="button" className="btn btn-ghost" onClick={() => this.setState({ form: null, editId: null })}>{t('common.cancel')}</button>
        </div>
      </form>
    );
  }

  render() {
    const { list, error, q, form, busy } = this.state;
    return (
      <section className="stack rg-admin-spots" aria-labelledby="admin-spots-heading">
        <div className="spots-head">
          <div>
            <h2 id="admin-spots-heading" className="h4" style={{ margin: '8px 0 4px' }}><MapPin size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />{t('spots.title')}</h2>
            <p className="small muted" style={{ margin: 0 }}>{t('spots.lead')}</p>
          </div>
          {!form ? <button type="button" className="btn btn-primary btn-sm" onClick={() => this.edit(null)}><Plus size={14} aria-hidden="true" />{t('spots.add')}</button> : null}
        </div>
        {form ? this.renderForm() : null}
        <form className="spots-search" role="search" onSubmit={(e) => { e.preventDefault(); this.load(); }}>
          <label htmlFor="spots-q" className="sr-only">{t('spots.search')}</label>
          <input id="spots-q" className="input" value={q} placeholder={t('spots.search')} onChange={(e) => this.setState({ q: e.target.value })} />
          <button type="submit" className="btn btn-secondary btn-sm"><Search size={14} aria-hidden="true" />{t('spots.searchBtn')}</button>
        </form>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {!list && !error ? <SkeletonBlock lines={4} /> : null}
        {list && !list.length ? <EmptyState icon={MapPin} title={t('spots.none')}>{t('spots.noneHint')}</EmptyState> : null}
        {list && list.length ? (
          <div className="table-wrap">
            <table className="table spots-table">
              <thead><tr><th scope="col">{t('spots.name')}</th><th scope="col">{t('spots.kind')}</th><th scope="col">{t('spots.where')}</th><th scope="col">{t('spots.status')}</th><th scope="col"><span className="sr-only">{t('admin.actions')}</span></th></tr></thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id} className={s.active ? '' : 'is-off'}>
                    <td><strong>{s.name}</strong>{s.notes ? <small className="muted" style={{ display: 'block' }}>{s.notes}</small> : null}</td>
                    <td>{kindLabel(s.kind)}</td>
                    <td>{[s.address, s.city, s.state].filter(Boolean).join(', ')}<small className="muted" style={{ display: 'block' }}>{s.lat.toFixed(4)}, {s.lng.toFixed(4)}</small></td>
                    <td>
                      <label className="switch" title={s.active ? t('spots.active') : t('spots.inactive')}>
                        <input type="checkbox" role="switch" checked={s.active} disabled={busy === s.id} onChange={() => this.toggle(s)} aria-label={t('spots.activeFor', { name: s.name })} />
                        <span className="switch-track" aria-hidden="true" />
                      </label>
                      <span className="small muted spot-state">{s.active ? t('spots.active') : t('spots.inactive')}</span>
                    </td>
                    <td className="spot-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.edit(s)} aria-label={t('spots.editNamed', { name: s.name })}><Pencil size={14} aria-hidden="true" />{t('spots.edit')}</button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={busy === s.id} onClick={() => this.remove(s)} aria-label={t('spots.deleteNamed', { name: s.name })}><Trash2 size={14} aria-hidden="true" />{t('spots.delete')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="small muted">{t('spots.privacy')}</p>
      </section>
    );
  }
}
