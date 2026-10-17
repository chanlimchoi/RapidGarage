import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, LocateFixed, LogIn, MapPin, Check, Search } from 'lucide-react';
import { errorMessage, createWanted, updateWanted, fetchWanted } from '../api';
import { Alert, EmptyState, Field, SkeletonBlock, Spinner } from '../components/ui';
import { serverFieldErrors, focusFirstError } from '../lib/validate';
import { TITLE_MAX, KEYWORDS_MAX, DETAILS_MAX, AREA_MAX, RADIUS, DAYS_DEFAULT, DAY_CHOICES, CATEGORIES,
  validateWanted, wantedBody, matchWords, centsToInput } from '../lib/wanted';
import { categoryLabel } from './WantedCard';
import toast from '../components/toast';
import { t } from '../i18n';

const SERVER_ALIASES = { maxPriceCents: 'maxPrice', lat: 'location', lng: 'location', address: 'location' };

// /wanted/new and /wanted/:id/edit.
export default class WantedForm extends React.Component {
  constructor(props) {
    super(props);
    this.editId = props.match && props.match.params.id ? props.match.params.id : null;
    this.state = {
      loading: !!this.editId, loadError: '', saving: false, error: '', submitted: false, serverErrors: {}, locating: false,
      values: { title: '', keywords: '', category: '', maxPrice: '', details: '', areaLabel: '', where: this.editId ? 'keep' : 'address',
        address: '', coords: null, radiusMiles: '10', days: DAYS_DEFAULT, emailEnabled: true },
    };
    this.formRef = React.createRef();
  }

  componentDidMount() {
    this.mounted = true;
    if (!this.editId) return;
    fetchWanted(this.editId).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) { this.setState({ loading: false, loadError: errorMessage(data, t('want.notFound')) }); return; }
      if (!data.mine) { this.setState({ loading: false, loadError: t('want.onlyOwner') }); return; }
      this.setState({ loading: false, values: Object.assign({}, this.state.values, {
        title: data.title, keywords: (data.keywords || []).join(' '), category: data.category || '', maxPrice: centsToInput(data.maxPriceCents),
        details: data.details || '', areaLabel: data.areaLabel, radiusMiles: String(data.radiusMiles), emailEnabled: !!data.emailEnabled,
      }) });
    }).catch(() => this.mounted && this.setState({ loading: false, loadError: t('common.network') }));
  }
  componentWillUnmount() { this.mounted = false; }

  set(patch, clear) {
    const serverErrors = Object.assign({}, this.state.serverErrors);
    (clear || Object.keys(patch)).forEach((k) => { delete serverErrors[k]; });
    this.setState({ values: Object.assign({}, this.state.values, patch), serverErrors });
  }

  errors() {
    const raw = validateWanted(this.state.values, !!this.editId);
    const e = {};
    Object.keys(raw).forEach((k) => { e[k] = t(raw[k][0], raw[k][1] || undefined); });
    return Object.assign({}, this.state.serverErrors, e);
  }

  locate() {
    if (!navigator.geolocation) { toast.error(t('list.noGeo')); return; }
    this.setState({ locating: true });
    navigator.geolocation.getCurrentPosition(
      (pos) => { this.setState({ locating: false }); this.set({ where: 'here', coords: { lat: pos.coords.latitude, lng: pos.coords.longitude } }, ['location']); },
      () => { this.setState({ locating: false }); toast.error(t('list.geoFailed')); },
      { timeout: 10000, maximumAge: 300000 }
    );
  }

  submit(e) {
    e.preventDefault();
    const errors = this.errors();
    this.setState({ submitted: true });
    if (Object.keys(errors).length) { focusFirstError(this.formRef.current, errors); return; }
    const body = wantedBody(this.state.values, !!this.editId);
    this.setState({ saving: true, error: '' });
    (this.editId ? updateWanted(this.editId, body) : createWanted(body)).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) {
        const serverErrors = serverFieldErrors(data, SERVER_ALIASES);
        this.setState({ saving: false, serverErrors, error: errorMessage(data, t('want.saveFailed')) });
        focusFirstError(this.formRef.current, serverErrors);
        return;
      }
      const n = (data.matches || []).length;
      toast.success(this.editId ? t('want.saved') : (n ? t('want.createdMatches', { count: n }) : t('want.created')));
      this.props.history.push('/wanted/' + data.id);
    }).catch(() => this.mounted && this.setState({ saving: false, error: t('common.network') }));
  }

  render() {
    if (!this.props.user && this.props.ready) {
      return (
        <div className="container container-narrow">
          <EmptyState icon={LogIn} title={t('want.loginTitle')} action={<Link className="btn btn-primary" to="/login">{t('nav.logIn')}</Link>}>{t('want.loginText')}</EmptyState>
        </div>
      );
    }
    if (this.state.loading) return <div className="container container-narrow"><SkeletonBlock lines={6} /></div>;
    if (this.state.loadError) return <div className="container container-narrow"><Alert tone="danger">{this.state.loadError}</Alert></div>;
    const v = this.state.values;
    const errors = this.errors();
    const shown = (k) => (this.state.submitted || this.state.serverErrors[k] ? errors[k] : '');
    const editing = !!this.editId;
    const words = matchWords(v.title, v.keywords);
    return (
      <div className="container container-narrow">
        <Link to={editing ? '/wanted/' + this.editId : '/wanted'} className="back-link"><ArrowLeft size={16} aria-hidden="true" />{editing ? t('want.backToPost') : t('want.board')}</Link>
        <header className="page-header">
          <span className="event-kicker">{t('want.kicker')}</span>
          <h1>{editing ? t('want.editTitle') : t('want.newTitle')}</h1>
          {!editing ? <p className="muted">{t('want.newLead')}</p> : null}
        </header>
        <form ref={this.formRef} className="panel stack wanted-form" onSubmit={(e) => this.submit(e)} noValidate>
          <Field id="wanted-title" label={t('want.titleLabel')} error={shown('title')} hint={t('want.titleHint')}>
            <input className="input" name="title" type="text" maxLength={TITLE_MAX} value={v.title} placeholder={t('want.titlePlaceholder')} onChange={(e) => this.set({ title: e.target.value }, ['title', 'keywords'])} />
          </Field>
          <Field id="wanted-keywords" label={t('want.keywords')} optional error={shown('keywords')} hint={t('want.keywordsHint')}>
            <input className="input" name="keywords" type="text" maxLength={KEYWORDS_MAX} value={v.keywords} placeholder={t('want.keywordsPlaceholder')} onChange={(e) => this.set({ keywords: e.target.value })} />
          </Field>
          {words.length ? (
            <div className="wanted-words" aria-live="polite">
              <span className="small muted"><Search size={14} aria-hidden="true" />{t('want.matchPreview')}</span>
              <span className="chips">{words.map((w) => <span key={w} className="chip chip-brand">{w}</span>)}</span>
            </div>
          ) : null}
          <div className="form-grid-2">
            <Field id="wanted-category" label={t('want.category')} optional error={shown('category')}>
              <select className="select" name="category" value={v.category} onChange={(e) => this.set({ category: e.target.value })}>
                <option value="">{t('want.anyCategory')}</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
              </select>
            </Field>
            <Field id="wanted-price" label={t('want.maxPrice')} optional error={shown('maxPrice')} hint={t('want.maxPriceHint')}>
              <div className="input-prefix"><span aria-hidden="true">$</span>
                <input className="input" name="maxPrice" type="text" inputMode="decimal" value={v.maxPrice} placeholder="0.00" onChange={(e) => this.set({ maxPrice: e.target.value }, ['maxPrice'])} />
              </div>
            </Field>
          </div>
          <Field id="wanted-details" label={t('want.details')} optional error={shown('details')}
            hint={DETAILS_MAX - v.details.length >= 0 ? t('common.charsLeft', { count: DETAILS_MAX - v.details.length }) : t('common.tooLongBy', { n: v.details.length - DETAILS_MAX })}>
            <textarea className="textarea" name="details" rows={3} value={v.details} placeholder={t('want.detailsPlaceholder')} onChange={(e) => this.set({ details: e.target.value })} />
          </Field>
          <fieldset className="field wanted-area">
            <legend className="field-label">{t('want.area')}</legend>
            <Field id="wanted-area" label={t('want.areaLabel')} error={shown('areaLabel')} hint={t('want.areaHint')}>
              <input className="input" name="areaLabel" type="text" maxLength={AREA_MAX} value={v.areaLabel} placeholder={t('want.areaPlaceholder')} onChange={(e) => this.set({ areaLabel: e.target.value })} />
            </Field>
            <span className="field-label" id="wanted-where-label">{t('alerts.location')}</span>
            <div className="segmented" role="group" aria-labelledby="wanted-where-label">
              {editing ? <button type="button" aria-pressed={v.where === 'keep'} onClick={() => this.set({ where: 'keep' }, ['location'])}><MapPin size={14} aria-hidden="true" />{t('alerts.keep')}</button> : null}
              <button type="button" aria-pressed={v.where === 'address'} onClick={() => this.set({ where: 'address' }, ['location'])}>{t('alerts.address')}</button>
              <button type="button" aria-pressed={v.where === 'here'} onClick={() => this.locate()} disabled={this.state.locating}>
                {this.state.locating ? <Spinner /> : v.coords ? <Check size={14} aria-hidden="true" /> : <LocateFixed size={14} aria-hidden="true" />}{t('alerts.myLocation')}
              </button>
            </div>
            {v.where === 'here' && v.coords ? <span className="field-hint">{t('alerts.usingLocation')}</span> : null}
            {shown('location') && v.where !== 'address' ? <span className="field-error" role="alert">{shown('location')}</span> : null}
            {v.where === 'address' ? (
              <Field id="wanted-address" label={t('list.whereLabel')} error={shown('location')} hint={t('want.addressHint')}>
                <input className="input" name="location" type="text" autoComplete="postal-code" value={v.address} onChange={(e) => this.set({ address: e.target.value }, ['location'])} />
              </Field>
            ) : null}
            <Field id="wanted-radius" label={t('want.radius')} error={shown('radiusMiles')}>
              <div className="input-suffix">
                <input className="input" name="radiusMiles" type="number" min={RADIUS.min} max={RADIUS.max} step="1" value={v.radiusMiles} onChange={(e) => this.set({ radiusMiles: e.target.value })} />
                <span aria-hidden="true">{t('want.miles')}</span>
              </div>
            </Field>
            <p className="field-hint">{t('want.privacyHint')}</p>
          </fieldset>
          {!editing ? (
            <Field id="wanted-days" label={t('want.keepFor')} hint={t('want.keepForHint')}>
              <select className="select" name="days" value={v.days} onChange={(e) => this.set({ days: Number(e.target.value) })}>
                {DAY_CHOICES.map((d) => <option key={d} value={d}>{t('want.days', { count: d })}</option>)}
              </select>
            </Field>
          ) : null}
          <label className="checkbox-row" htmlFor="wanted-email">
            <span className="switch">
              <input id="wanted-email" type="checkbox" role="switch" checked={v.emailEnabled} onChange={(e) => this.set({ emailEnabled: e.target.checked })} />
              <span className="switch-track" aria-hidden="true" />
            </span>
            <span><strong>{t('want.emailMe')}</strong><span className="field-hint" style={{ display: 'block' }}>{t('want.emailHint')}</span></span>
          </label>
          {this.state.error ? <Alert tone="danger">{this.state.error}</Alert> : null}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={this.state.saving}>{this.state.saving ? <Spinner /> : null}{editing ? t('edit.saveChanges') : t('want.post')}</button>
            <Link className="btn btn-secondary" to={editing ? '/wanted/' + this.editId : '/wanted'}>{t('common.cancel')}</Link>
          </div>
        </form>
      </div>
    );
  }
}
