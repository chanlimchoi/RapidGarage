import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, LocateFixed, LogIn, UsersRound, Check } from 'lucide-react';
import { errorMessage, createEvent, updateEvent, fetchEvent, EVENT_RADII, EVENT_MAX_DAYS } from '../api';
import { Alert, EmptyState, Field, SkeletonBlock, Spinner } from '../components/ui';
import ScheduleEditor from '../post/ScheduleEditor';
import { browserTimeZone, formDays, validateDays, nextSaturday } from '../lib/schedule';
import { serverFieldErrors, focusFirstError } from '../lib/validate';
import toast from '../components/toast';
import { t } from '../i18n';

const NAME_MAX = 80;
const AREA_MAX = 120;
const DESC_MAX = 1000;

// /events/new and /events/:id/edit. The area (center + radius) is set once at
// creation; editing changes the name, description, days and how sellers join.
export default class EventForm extends React.Component {
  constructor(props) {
    super(props);
    this.editId = props.match && props.match.params.id ? props.match.params.id : null;
    this.state = {
      loading: !!this.editId, loadError: '', saving: false, error: '', submitted: false, serverErrors: {}, locating: false,
      values: { name: '', description: '', areaLabel: '', radiusMiles: 0.5, joinMode: 'approval', coords: null, timeZone: browserTimeZone(),
        days: [{ date: nextSaturday(), start: '08:00', end: '15:00' }] },
    };
    this.formRef = React.createRef();
  }

  componentDidMount() {
    this.mounted = true;
    if (!this.editId) return;
    fetchEvent(this.editId).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) { this.setState({ loading: false, loadError: errorMessage(data, t('ev.notFound')) }); return; }
      if (!data.mine) { this.setState({ loading: false, loadError: t('ev.onlyOrganizer') }); return; }
      this.setState({ loading: false, event: data, values: Object.assign({}, this.state.values, {
        name: data.name, description: data.description || '', areaLabel: data.areaLabel, radiusMiles: data.radiusMiles, joinMode: data.joinMode,
        timeZone: data.schedule.timeZone, days: formDays(data),
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
    const v = this.state.values;
    const e = Object.assign({}, validateDays(v.days));
    if (!v.name.trim()) e.name = t('ev.errName');
    else if (v.name.trim().length > NAME_MAX) e.name = t('ev.errNameLong', { max: NAME_MAX });
    if (!this.editId && !v.areaLabel.trim()) e.areaLabel = t('ev.errArea');
    if (v.description.length > DESC_MAX) e.description = t('ev.errDescLong', { max: DESC_MAX });
    if (!v.days.length) e.schedule = t('ev.errDays');
    else if (v.days.length > EVENT_MAX_DAYS) e.schedule = t('ev.errMaxDays', { max: EVENT_MAX_DAYS });
    return Object.assign({}, this.state.serverErrors, e);
  }

  locate() {
    if (!navigator.geolocation) { toast.error(t('list.noGeo')); return; }
    this.setState({ locating: true });
    navigator.geolocation.getCurrentPosition(
      (pos) => { this.setState({ locating: false }); this.set({ coords: { lat: pos.coords.latitude, lng: pos.coords.longitude } }, ['areaLabel', 'location']); },
      () => { this.setState({ locating: false }); toast.error(t('list.geoFailed')); },
      { timeout: 10000, maximumAge: 300000 }
    );
  }

  submit(e) {
    e.preventDefault();
    const errors = this.errors();
    this.setState({ submitted: true });
    if (Object.keys(errors).length) { focusFirstError(this.formRef.current, errors); return; }
    const v = this.state.values;
    const body = {
      name: v.name.trim(), description: v.description.trim() || null, joinMode: v.joinMode,
      schedule: { timeZone: v.timeZone, days: v.days.map((d) => ({ date: d.date, start: d.start, end: d.end })) },
    };
    if (!this.editId) {
      Object.assign(body, { areaLabel: v.areaLabel.trim(), radiusMiles: Number(v.radiusMiles) });
      if (v.coords) Object.assign(body, v.coords);
    }
    this.setState({ saving: true, error: '' });
    (this.editId ? updateEvent(this.editId, body) : createEvent(body)).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) {
        const serverErrors = serverFieldErrors(data);
        this.setState({ saving: false, serverErrors, error: errorMessage(data, t('ev.saveFailed')) });
        focusFirstError(this.formRef.current, serverErrors);
        return;
      }
      toast.success(this.editId ? t('ev.saved') : t('ev.created'));
      this.props.history.push('/events/' + data.id);
    }).catch(() => this.mounted && this.setState({ saving: false, error: t('common.network') }));
  }

  render() {
    if (!this.props.user && this.props.ready) {
      return (
        <div className="container container-narrow">
          <EmptyState level={1} icon={LogIn} title={t('ev.loginTitle')} action={<Link className="btn btn-primary" to="/login">{t('nav.logIn')}</Link>}>{t('ev.loginText')}</EmptyState>
        </div>
      );
    }
    if (this.state.loading) return <div className="container container-narrow"><SkeletonBlock lines={6} /></div>;
    if (this.state.loadError) return <div className="container container-narrow"><Alert tone="danger">{this.state.loadError}</Alert></div>;
    const v = this.state.values;
    const errors = this.errors();
    const shown = (k) => (this.state.submitted || this.state.serverErrors[k] ? errors[k] : '');
    const editing = !!this.editId;
    return (
      <div className="container container-narrow">
        <Link to={editing ? '/events/' + this.editId : '/events'} className="back-link"><ArrowLeft size={16} aria-hidden="true" />{editing ? t('ev.backToEvent') : t('ev.allEvents')}</Link>
        <header className="page-header">
          <span className="event-kicker">{t('ev.kicker')}</span>
          <h1>{editing ? t('ev.editTitle') : t('ev.newTitle')}</h1>
          {!editing ? <p className="muted">{t('ev.newLead')}</p> : null}
        </header>
        <form ref={this.formRef} className="panel stack event-form" onSubmit={(e) => this.submit(e)} noValidate>
          <Field id="event-name" label={t('ev.name')} error={shown('name')} hint={t('ev.nameHint')}>
            <input className="input" name="name" type="text" maxLength={NAME_MAX} value={v.name} onChange={(e) => this.set({ name: e.target.value })} />
          </Field>
          {!editing ? (
            <div className="field">
              <label className="field-label" htmlFor="event-area">{t('ev.area')}</label>
              <div className="event-area-row">
                <input id="event-area" className="input" name="areaLabel" type="text" maxLength={AREA_MAX} value={v.areaLabel} placeholder={t('ev.areaPlaceholder')}
                  aria-invalid={shown('areaLabel') ? 'true' : undefined} aria-describedby="event-area-hint"
                  onChange={(e) => this.set({ areaLabel: e.target.value })} />
                <button type="button" className="btn btn-secondary" onClick={() => this.locate()} disabled={this.state.locating}>
                  {this.state.locating ? <Spinner /> : v.coords ? <Check size={16} aria-hidden="true" /> : <LocateFixed size={16} aria-hidden="true" />}{t('ev.useLocation')}
                </button>
              </div>
              {shown('areaLabel') ? <span className="field-error" role="alert">{shown('areaLabel')}</span> : null}
              <span className="field-hint" id="event-area-hint">{v.coords ? t('ev.centeredHere') : t('ev.areaHint')}</span>
            </div>
          ) : (
            <div className="field"><span className="field-label">{t('ev.area')}</span><p>{v.areaLabel} · {t('ev.radius', { miles: v.radiusMiles })}</p><span className="field-hint">{t('ev.areaFixed')}</span></div>
          )}
          {!editing ? (
            <Field id="event-radius" label={t('ev.radiusLabel')} error={shown('radiusMiles')} hint={t('ev.radiusHint')}>
              <select className="select" name="radiusMiles" value={v.radiusMiles} onChange={(e) => this.set({ radiusMiles: Number(e.target.value) })}>
                {EVENT_RADII.map((r) => <option key={r} value={r}>{t('ev.radius', { miles: r })}</option>)}
              </select>
            </Field>
          ) : null}
          <ScheduleEditor days={v.days} timeZone={v.timeZone} errors={errors} shownFor={(k) => this.state.submitted || !!this.state.serverErrors[k]}
            onChange={(days) => this.set({ days }, ['schedule'])} onBlurRow={() => null} disabled={this.state.saving}
            legend={t('ev.days')} required maxDays={EVENT_MAX_DAYS} hint={t('ev.daysHint')} />
          <fieldset className="field event-mode">
            <legend className="field-label">{t('ev.joining')}</legend>
            {[['approval', 'ev.modeApproval', 'ev.modeApprovalHint'], ['open', 'ev.modeOpen', 'ev.modeOpenHint']].map(([value, label, hint]) => (
              <label key={value} className={'event-mode-option' + (v.joinMode === value ? ' is-checked' : '')}>
                <input type="radio" name="joinMode" value={value} checked={v.joinMode === value} onChange={() => this.set({ joinMode: value })} />
                <span><strong>{t(label)}</strong><span className="small muted">{t(hint)}</span></span>
              </label>
            ))}
          </fieldset>
          <Field id="event-description" label={t('ev.description')} optional error={shown('description')} hint={t('common.charsLeft', { count: Math.max(0, DESC_MAX - v.description.length) })}>
            <textarea className="textarea" name="description" rows={4} value={v.description} placeholder={t('ev.descriptionPlaceholder')} onChange={(e) => this.set({ description: e.target.value })} />
          </Field>
          {this.state.error ? <Alert tone="danger">{this.state.error}</Alert> : null}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={this.state.saving}>
              {this.state.saving ? <Spinner /> : <UsersRound size={16} aria-hidden="true" />}{editing ? t('ev.save') : t('ev.create')}
            </button>
          </div>
        </form>
      </div>
    );
  }
}
