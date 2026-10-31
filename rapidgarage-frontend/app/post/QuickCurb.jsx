import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { Gift, LocateFixed, ArrowLeft, Check } from 'lucide-react';
import { createCurbPost, uploadPhotos, errorMessage } from '../api';
import { Alert, Field, Spinner } from '../components/ui';
import PhotoPicker from '../components/PhotoPicker';
import toast from '../components/toast';
import { HOUR_CHOICES, DEFAULT_HOURS, TITLE_MAX, NOTE_MAX, curbPostBody } from '../lib/curbPost';
import { t } from '../i18n';

// /curb/new: put something out for free, fast. A photo, where it is (your
// location or a street and zip), a few words, and for how long (default 4
// hours). It disappears by itself; people nearby who turned on curb alerts
// hear about it.
class QuickCurb extends Component {
  constructor(props) {
    super(props);
    this.state = { title: '', note: '', hours: String(DEFAULT_HOURS), coords: null, street: '', zipCode: '', files: [], alts: [], locating: false, busy: false, errors: {}, error: '' };
  }

  locate() {
    if (!navigator.geolocation) return this.setState({ error: t('list.noGeo') });
    this.setState({ locating: true, error: '' });
    return navigator.geolocation.getCurrentPosition(
      (pos) => this.setState({ locating: false, coords: { lat: pos.coords.latitude, lng: pos.coords.longitude }, errors: Object.assign({}, this.state.errors, { location: null }) }),
      () => this.setState({ locating: false, error: t('list.geoFailed') }),
      { timeout: 10000, maximumAge: 60000, enableHighAccuracy: true }
    );
  }

  submit(e) {
    e.preventDefault();
    const { errors, body } = curbPostBody(this.state);
    this.setState({ errors });
    if (Object.keys(errors).length) return;
    this.setState({ busy: true, error: '' });
    createCurbPost(body).then(({ ok, status, data }) => {
      if (!ok) {
        const d = (data && data.error && data.error.details) || {};
        this.setState({ busy: false, error: status === 429 ? t('quick.tooMany') : (d.location || errorMessage(data, t('quick.failed'))) });
        return null;
      }
      const go = () => { toast.success(t('quick.posted')); this.props.history.push('/post/' + data.id); };
      if (!this.state.files.length) return go();
      return uploadPhotos(data.id, this.state.files, this.state.alts).then((up) => {
        if (!up.ok) toast.error(t('quick.photoFailed'));
        go();
      }, go);
    }).catch(() => this.setState({ busy: false, error: t('common.network') }));
  }

  render() {
    const s = this.state;
    const err = (k) => (s.errors[k] ? t(s.errors[k]) : null);
    if (this.props.ready && !this.props.user) {
      return <div className="container container-narrow"><Alert tone="info">{t('quick.loginFirst')} <Link to="/login">{t('nav.logIn')}</Link></Alert></div>;
    }
    return (
      <div className="container container-narrow quick-curb">
        <Link to="/" className="back-link"><ArrowLeft size={16} aria-hidden="true" />{t('nav.browseSales')}</Link>
        <header className="page-header"><div><h1><Gift size={24} aria-hidden="true" /> {t('quick.title')}</h1><p>{t('quick.lead')}</p></div></header>
        {s.error ? <Alert tone="danger">{s.error}</Alert> : null}
        <form className="card-form stack" onSubmit={(e) => this.submit(e)} noValidate>
          <section aria-labelledby="quick-photo">
            <h2 id="quick-photo" className="h4">{t('quick.photo')}</h2>
            <PhotoPicker max={3} onChange={(files, alts) => this.setState({ files, alts })} />
          </section>
          <fieldset className="stack" aria-describedby={s.errors.location ? 'quick-location-error' : undefined}>
            <legend className="field-label">{t('quick.where')}</legend>
            <button type="button" className="btn btn-secondary" onClick={() => this.locate()} disabled={s.locating}>
              {s.locating ? <Spinner /> : s.coords ? <Check size={16} aria-hidden="true" /> : <LocateFixed size={16} aria-hidden="true" />}
              {s.coords ? t('quick.locationSet') : t('list.useLocation')}
            </button>
            <div className="form-grid form-grid-2">
              <Field id="quick-street" label={t('quick.street')} optional hint={t('quick.streetHint')}>
                <input id="quick-street" className="input" value={s.street} maxLength={120} onChange={(e) => this.setState({ street: e.target.value })} autoComplete="address-line1" />
              </Field>
              <Field id="quick-zip" label={t('form.zip')} optional error={err('zipCode')}>
                <input id="quick-zip" className="input" value={s.zipCode} maxLength={5} inputMode="numeric" onChange={(e) => this.setState({ zipCode: e.target.value })} autoComplete="postal-code" />
              </Field>
            </div>
            {s.errors.location ? <span className="field-error" id="quick-location-error">{err('location')}</span> : null}
          </fieldset>
          <Field id="quick-title" label={t('quick.titleLabel')} optional error={err('title')}>
            <input id="quick-title" className="input" value={s.title} maxLength={TITLE_MAX} placeholder={t('quick.titlePlaceholder')} onChange={(e) => this.setState({ title: e.target.value })} />
          </Field>
          <Field id="quick-note" label={t('quick.note')} optional error={err('note')}>
            <textarea id="quick-note" className="textarea" rows="3" value={s.note} maxLength={NOTE_MAX} placeholder={t('quick.notePlaceholder')} onChange={(e) => this.setState({ note: e.target.value })} />
          </Field>
          <Field id="quick-hours" label={t('quick.hours')} error={err('hours')} hint={t('quick.hoursHint')}>
            <select id="quick-hours" className="input" value={s.hours} onChange={(e) => this.setState({ hours: e.target.value })}>
              {HOUR_CHOICES.map((h) => <option key={h} value={String(h)}>{t('quick.hoursOption', { count: h })}</option>)}
            </select>
          </Field>
          <button type="submit" className="btn btn-primary" disabled={s.busy}>{s.busy ? <Spinner /> : <Gift size={16} aria-hidden="true" />}{t('quick.submit')}</button>
        </form>
      </div>
    );
  }
}

export default QuickCurb;
