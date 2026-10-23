import React from 'react';
import { Link } from 'react-router-dom';
import { Route as RouteIcon, ExternalLink, LocateFixed, Heart, Search, Trash2, Clock, X } from 'lucide-react';
import { planRoute, apiFetch, errorMessage } from '../api';
import { Field, EmptyState, SkeletonBlock, Alert, Spinner } from '../components/ui';
import { formatTime, formatDay, formatMiles, placeLine } from '../lib/format';
import * as plan from '../lib/routePlan';
import { t } from '../i18n';

// /route: an ordered, time-aware route through the sales you picked ("Add to
// route" on a sale or in Favorites), with a Google Maps directions link.
// Sales you can't reach while they're open are listed with the reason.
export default class RoutePlanner extends React.Component {
  constructor(props) {
    super(props);
    this.state = { ids: plan.picked(), start: null, locating: false, departAt: plan.localInputValue(new Date()), dwell: String(plan.DWELL.default),
      busy: false, result: null, error: '', errors: {}, addingFavs: false };
    this.update = (ids) => this.setState({ ids: ids.slice() });
    this.submit = this.submit.bind(this);
  }

  componentDidMount() {
    this.mounted = true;
    document.title = t('rt.title') + ' · RapidGarage';
    this.unsub = plan.subscribe(this.update);
    if (this.state.ids.length) this.run();
  }
  componentWillUnmount() { this.mounted = false; if (this.unsub) this.unsub(); }

  run() {
    const { body, errors } = plan.routeBody({ ids: this.state.ids, start: this.state.start, departAt: this.state.departAt, dwell: this.state.dwell });
    if (errors) return this.setState({ errors });
    this.setState({ busy: true, error: '', errors: {} });
    return planRoute(body).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) {
        const d = (data && data.error && data.error.details) || {};
        return this.setState({ busy: false, result: null, error: errorMessage(data, t('rt.failed')), errors: { departAt: d.departAt, dwell: d.dwellMinutes, location: d.location } });
      }
      this.setState({ busy: false, result: data });
    }).catch(() => this.mounted && this.setState({ busy: false, error: t('common.networkShort') }));
  }

  submit(e) { e.preventDefault(); this.run(); }

  locate() {
    if (!navigator.geolocation) return this.setState({ errors: { location: t('list.noGeo') } });
    this.setState({ locating: true });
    return navigator.geolocation.getCurrentPosition(
      (pos) => { if (this.mounted) this.setState({ locating: false, start: { lat: pos.coords.latitude, lng: pos.coords.longitude } }, () => this.run()); },
      () => this.mounted && this.setState({ locating: false, errors: { location: t('list.geoFailed') } }),
      { timeout: 10000, maximumAge: 300000 }
    );
  }

  addFavorites() {
    this.setState({ addingFavs: true });
    apiFetch('/saved').then(({ ok, data }) => {
      if (!this.mounted) return;
      this.setState({ addingFavs: false });
      if (!ok) return this.setState({ error: errorMessage(data, t('rt.failed')) });
      plan.addMany(data.results.filter((p) => p.status !== 'ended').map((p) => p.id));
      return this.run();
    }).catch(() => this.mounted && this.setState({ addingFavs: false, error: t('common.networkShort') }));
  }

  remove(id) { plan.remove(id); this.setState({ result: null }, () => { if (plan.picked().length) this.run(); }); }

  renderForm() {
    const s = this.state;
    const e = s.errors;
    return (
      <form className="panel stack route-form" onSubmit={this.submit} noValidate aria-labelledby="route-form-title">
        <h2 id="route-form-title" className="saved-h2">{t('rt.settings')}</h2>
        <div className="field">
          <span className="field-label" id="route-start-label">{t('rt.startFrom')}</span>
          <div className="segmented" role="group" aria-labelledby="route-start-label">
            <button type="button" aria-pressed={!s.start} onClick={() => this.setState({ start: null }, () => this.run())}>{t('rt.firstSale')}</button>
            <button type="button" aria-pressed={!!s.start} onClick={() => this.locate()} disabled={s.locating}>
              {s.locating ? <Spinner size={14} /> : <LocateFixed size={14} aria-hidden="true" />}{t('alerts.myLocation')}
            </button>
          </div>
          {e.location ? <span className="field-error" role="alert">{e.location}</span> : null}
        </div>
        <div className="alert-form-row">
          <Field id="route-depart" label={t('rt.departAt')} error={e.departAt ? (e.departAt.indexOf('rt.') === 0 ? t(e.departAt) : e.departAt) : ''}>
            <input className="input" type="datetime-local" value={s.departAt} onChange={(ev) => this.setState({ departAt: ev.target.value })} />
          </Field>
          <Field id="route-dwell" label={t('rt.dwell')} error={e.dwell ? (e.dwell.indexOf('rt.') === 0 ? t(e.dwell) : e.dwell) : ''}>
            <select className="input" value={s.dwell} onChange={(ev) => this.setState({ dwell: ev.target.value })}>
              {plan.DWELL_CHOICES.map((m) => <option key={m} value={String(m)}>{t('rt.minutes', { count: m })}</option>)}
            </select>
          </Field>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={s.busy}>{s.busy ? <Spinner /> : <RouteIcon size={16} aria-hidden="true" />}{t('rt.plan')}</button>
          {this.props.user ? <button type="button" className="btn btn-secondary" onClick={() => this.addFavorites()} disabled={s.addingFavs || plan.isFull()}><Heart size={16} aria-hidden="true" />{t('rt.addFavorites')}</button> : null}
          <button type="button" className="btn btn-ghost" onClick={() => { plan.clear(); this.setState({ result: null }); }}><Trash2 size={16} aria-hidden="true" />{t('rt.clear')}</button>
        </div>
      </form>
    );
  }

  renderResult() {
    const r = this.state.result;
    if (!r) return null;
    return (
      <section aria-labelledby="route-stops-title" className="stack">
        <div className="row route-summary">
          <h2 id="route-stops-title" className="saved-h2">{t('rt.stops', { count: r.stops.length })}</h2>
          {r.stops.length ? <span className="muted small">{t('rt.summary', { miles: formatMiles(r.totalMiles), time: formatTime(r.finishAt) })}</span> : null}
        </div>
        {r.googleMapsUrl ? (
          <a className="btn btn-primary route-maps" href={r.googleMapsUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={16} aria-hidden="true" />{t('rt.openMaps')}<span className="sr-only"> {t('rt.newTab')}</span>
          </a>
        ) : null}
        <ol className="route-stops">
          {r.stops.map((s) => (
            <li key={s.post.id} className="route-stop panel" data-post-id={s.post.id}>
              <div className="route-stop-head">
                <span className="route-stop-n" aria-hidden="true">{s.order}</span>
                <Link to={'/post/' + s.post.id} className="route-stop-title">{s.post.title}</Link>
                <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={t('rt.removeNamed', { title: s.post.title })} onClick={() => this.remove(s.post.id)}><X size={16} aria-hidden="true" /></button>
              </div>
              <p className="small muted">{placeLine(s.post)}{s.legMiles !== null ? ' · ' + t('rt.leg', { miles: formatMiles(s.legMiles) }) : ''}</p>
              <p className="small route-times"><Clock size={14} aria-hidden="true" />
                {t('rt.arrive', { time: formatTime(s.arriveAt) })}
                {s.waitMinutes > 0 ? ' · ' + t('rt.wait', { count: s.waitMinutes, time: formatTime(s.opensAt) }) : ''}
                {' · ' + t('rt.leave', { time: formatTime(s.leaveAt) })}
                {s.closesAt ? ' · ' + t('rt.closes', { day: formatDay(s.closesAt), time: formatTime(s.closesAt) }) : ''}
              </p>
            </li>
          ))}
        </ol>
        {r.skipped.length ? (
          <section aria-labelledby="route-skipped-title" className="panel">
            <h3 id="route-skipped-title">{t('rt.skipped', { count: r.skipped.length })}</h3>
            <ul className="route-skipped">
              {r.skipped.map((x) => (
                <li key={x.postId}>
                  {x.title ? <Link to={'/post/' + x.postId}>{x.title}</Link> : t('rt.unknownSale')}: {t(plan.skipKey(x.reason), { max: plan.MAX_STOPS })}
                  {' '}<button type="button" className="btn btn-ghost btn-sm" onClick={() => this.remove(x.postId)}>{t('common.remove')}</button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <p className="small muted">{t('rt.assumptions', { mph: r.assumptions.avgMph, min: r.assumptions.minBrowseMinutes })}</p>
      </section>
    );
  }

  render() {
    const s = this.state;
    return (
      <div className="container container-narrow page route-page">
        <header className="page-header">
          <div><h1><RouteIcon size={26} aria-hidden="true" />{t('rt.title')}</h1><p>{t('rt.lead', { max: plan.MAX_STOPS })}</p></div>
        </header>
        {s.error ? <Alert tone="danger">{s.error}</Alert> : null}
        {!s.ids.length ? (
          <EmptyState icon={RouteIcon} title={t('rt.none')}
            action={<span className="row">
              <Link className="btn btn-primary" to="/"><Search size={16} aria-hidden="true" />{t('nav.browseSales')}</Link>
              {this.props.user ? <button type="button" className="btn btn-secondary" onClick={() => this.addFavorites()} disabled={s.addingFavs}><Heart size={16} aria-hidden="true" />{t('rt.addFavorites')}</button> : null}
            </span>}>
            {t('rt.noneText')}
          </EmptyState>
        ) : (
          <div className="stack-lg">
            {this.renderForm()}
            {s.busy && !s.result ? <SkeletonBlock lines={3} height={60} /> : this.renderResult()}
          </div>
        )}
      </div>
    );
  }
}
