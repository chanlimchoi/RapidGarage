import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { Star, LogIn, Route as RouteIcon, ExternalLink, LocateFixed, MapPin, Navigation, Search, EyeOff, CalendarPlus } from 'lucide-react';
import { apiFetch, errorMessage } from '../api';
import PostCard, { BADGE_CLASS } from '../components/PostCard';
import Map from '../components/Map';
import { EmptyState, SkeletonGrid, SkeletonBlock, Alert, Spinner } from '../components/ui';
import { placeLine, formatMiles } from '../lib/format';
import { saleBadge } from '../lib/schedule';
import * as saved from '../lib/saved';
import SaveButton from './SaveButton';
import RemindToggle from './RemindToggle';
import { savedIcsPath } from '../lib/calendar';
import RouteSketch from './RouteSketch';
import { t } from '../i18n';

const WHEN = [
  { value: 'weekend', labelKey: 'when.weekend' },
  { value: 'today', labelKey: 'when.today' },
  { value: 'all', labelKey: 'sv.allUpcoming' },
];
const WHEN_VALUES = WHEN.map((w) => w.value);
const CAL_LABEL = { weekend: 'cal.routeWeekend', today: 'cal.routeToday', all: 'cal.routeAll' };
const NONE_OPEN = { weekend: 'sv.noneOpenWeekend', today: 'sv.noneOpenToday', all: 'sv.noneOpenAll' };

// ?when=today (from the reminder email / banner) picks the route's day.
function initialWhen(location) {
  const w = location ? new URLSearchParams(location.search).get('when') : null;
  return WHEN_VALUES.indexOf(w) >= 0 ? w : 'weekend';
}

// Saved sales plus a suggested route that visits the ones still coming up.
class Saved extends Component {
  constructor(props) {
    super(props);
    this.state = {
      loading: true, error: '', results: [], unavailable: 0,
      when: initialWhen(props.location), start: null, locating: false, locError: '',
      route: null, routeLoading: false, routeError: '',
    };
    this.onStore = this.onStore.bind(this);
  }

  componentDidMount() {
    this.unsub = saved.subscribe(this.onStore);
    this.load();
  }

  componentWillUnmount() { if (this.unsub) this.unsub(); this.gone = true; }

  componentDidUpdate(prevProps) {
    const id = (u) => (u ? u.id : null);
    if (id(prevProps.user) !== id(this.props.user) || prevProps.ready !== this.props.ready) this.load();
  }

  // A star was toggled somewhere (e.g. on this page): refresh the route.
  onStore() {
    if (!this.props.user || this.state.loading) return;
    const ids = this.state.results.map((p) => p.id).filter((i) => saved.isSaved(i));
    if (ids.length !== this.state.results.length && !this.reloading) {
      this.reloading = true;
      setTimeout(() => { this.reloading = false; if (!this.gone) this.load(true); }, 150);
    }
  }

  load(quiet) {
    if (!this.props.user) { this.setState({ loading: !this.props.ready, results: [] }); return; }
    if (!quiet) this.setState({ loading: true, error: '' });
    apiFetch('/saved').then(({ ok, data }) => {
      if (this.gone) return;
      if (!ok) { this.setState({ loading: false, error: errorMessage(data, t('sv.loadFailed')) }); return; }
      this.setState({ loading: false, results: data.results || [], unavailable: data.unavailable || 0 }, () => this.loadRoute());
    }).catch(() => !this.gone && this.setState({ loading: false, error: t('common.networkProblem') }));
  }

  loadRoute() {
    const { when, start } = this.state;
    const q = ['when=' + when];
    if (start) q.push('lat=' + start.lat, 'lng=' + start.lng);
    const token = (this.routeToken = (this.routeToken || 0) + 1);
    this.setState({ routeLoading: true, routeError: '' });
    apiFetch('/saved/route?' + q.join('&')).then(({ ok, data }) => {
      if (this.gone || token !== this.routeToken) return;
      if (!ok) { this.setState({ routeLoading: false, routeError: errorMessage(data, t('sv.routeFailed')) }); return; }
      this.setState({ routeLoading: false, route: data }, () => this.scrollToRoute());
    }).catch(() => !this.gone && this.setState({ routeLoading: false, routeError: t('common.networkProblem') }));
  }

  // Deep link: /saved?when=today#route
  scrollToRoute() {
    if (this.scrolled || !this.props.location || this.props.location.hash !== '#route') return;
    this.scrolled = true;
    const el = document.getElementById('route');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
  }

  changeWhen(when) {
    if (when === this.state.when) return;
    this.setState({ when }, () => this.loadRoute());
  }

  locate() {
    if (!navigator.geolocation) { this.setState({ locError: t('sv.noGeo') }); return; }
    this.setState({ locating: true, locError: '' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const start = { lat: Math.round(pos.coords.latitude * 1e5) / 1e5, lng: Math.round(pos.coords.longitude * 1e5) / 1e5 };
        this.setState({ locating: false, start }, () => this.loadRoute());
      },
      () => this.setState({ locating: false, locError: t('sv.geoFailed') }),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  clearStart() { this.setState({ start: null }, () => this.loadRoute()); }

  renderRoute() {
    const { route, routeLoading, routeError, when, start, locating, locError, results } = this.state;
    const live = results.filter((p) => p.status !== 'ended');
    return (
      <section className="panel route-panel" id="route" aria-labelledby="route-title">
        <div className="route-head">
          <h2 id="route-title" className="saved-h2"><RouteIcon size={20} aria-hidden="true" />{t('sv.route')}</h2>
          <div className="segmented route-when" role="group" aria-label={t('sv.which')}>
            {WHEN.map((w) => <button key={w.value} type="button" aria-pressed={when === w.value} onClick={() => this.changeWhen(w.value)}>{t(w.labelKey)}</button>)}
          </div>
        </div>
        <div className="route-start row">
          {start ? (
            <React.Fragment>
              <span className="small"><LocateFixed size={14} aria-hidden="true" /> {t('sv.fromYou')}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.clearStart()}>{t('sv.dontUse')}</button>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <span className="small muted">{t('sv.fromFirst')}</span>
              <button type="button" className="btn btn-secondary btn-sm locate-btn" disabled={locating} onClick={() => this.locate()}>
                {locating ? <Spinner /> : <LocateFixed size={14} aria-hidden="true" />}{t('sv.startFromMe')}
              </button>
            </React.Fragment>
          )}
        </div>
        {locError ? <Alert tone="warning">{locError}</Alert> : null}
        {routeError ? <Alert tone="danger">{routeError}</Alert> : null}
        {routeLoading && !route ? <SkeletonBlock lines={4} /> : null}
        {route ? this.renderStops(route, live.length) : null}
      </section>
    );
  }

  renderStops(route, liveCount) {
    const { stops, skipped } = route;
    if (!stops.length) {
      return (
        <div className="route-empty" role="status">
          <p className="muted">{liveCount
            ? t(NONE_OPEN[route.when] || 'sv.noneOpenAll')
            : t('sv.saveToPlan')}
          {liveCount && route.when !== 'all' ? <button type="button" className="btn-link" onClick={() => this.changeWhen('all')}>{t('sv.showAll')}</button> : null}</p>
        </div>
      );
    }
    const notes = [];
    if (skipped.overLimit) notes.push(t('sv.overLimit', { count: skipped.overLimit, max: route.maxStops }));
    if (skipped.noLocation) notes.push(t('sv.noLocation', { count: skipped.noLocation }));
    return (
      <div className="route-body">
        <p className="route-summary">
          <strong>{t('sv.stops', { count: stops.length })}</strong>
          {route.totalMiles ? <span className="muted">{t('sv.about', { distance: formatMiles(route.totalMiles) })}</span> : null}
        </p>
        <div className="route-visual">
          <RouteSketch start={route.start} stops={stops} />
          <div className="route-map"><Map quiet posts={stops.map((s) => s.post)} route start={route.start} user={this.props.user} config={this.props.config} label={t('sv.routeMap')} /></div>
        </div>
        <ol className="route-stops">
          {stops.map((s) => {
            const badge = saleBadge(s.post);
            return (
              <li key={s.post.id} className="route-stop">
                <span className="route-stop-n" aria-hidden="true">{s.order}</span>
                <div className="route-stop-body">
                  <Link to={'/post/' + s.post.id} className="route-stop-title">{s.post.title}</Link>
                  <span className="small muted"><MapPin size={12} aria-hidden="true" /> {placeLine(s.post) || t('card.noLocation')}</span>
                  <span className="row route-stop-meta">
                    {badge ? <span className={'chip sale-badge sale-badge-' + badge.kind + ' ' + BADGE_CLASS[badge.kind]}>{badge.label}</span> : null}
                    {s.legMiles !== null ? <span className="small muted"><Navigation size={12} aria-hidden="true" /> {s.order === 1 ? t('sv.fromYouLeg', { distance: formatMiles(s.legMiles) }) : t('sv.fromStop', { distance: formatMiles(s.legMiles), n: s.order - 1 })}</span> : <span className="small muted">{t('sv.firstStop')}</span>}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
        {notes.length ? <p className="small muted">{notes.join(' ')}</p> : null}
        <div className="form-actions">
          <a className="btn btn-primary open-in-maps" href={route.googleMapsUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={16} aria-hidden="true" />{t('sv.openMaps')}
          </a>
          <a className="btn btn-secondary route-ics" href={savedIcsPath(route.when)} download>
            <CalendarPlus size={16} aria-hidden="true" />{t(CAL_LABEL[route.when] || 'cal.routeAll')}
          </a>
        </div>
      </div>
    );
  }

  render() {
    const { user, ready } = this.props;
    if (ready && !user) {
      return (
        <div className="container page">
          <EmptyState level={1} icon={LogIn} title={t('sv.loginTitle')} action={<Link className="btn btn-primary" to="/login">{t('nav.logIn')}</Link>}>
            {t('sv.loginText')}
          </EmptyState>
        </div>
      );
    }
    const { loading, error, results, unavailable } = this.state;
    const upcoming = results.filter((p) => p.status !== 'ended');
    const ended = results.filter((p) => p.status === 'ended');
    const card = (p) => <PostCard key={p.id} post={p} actions={<React.Fragment><SaveButton post={p} />{p.status !== 'ended' ? <RemindToggle post={p} compact /> : null}</React.Fragment>} />;
    return (
      <div className="container page saved-page">
        <header className="page-header">
          <h1><Star size={26} aria-hidden="true" />{t('nav.savedSales')}</h1>
          {!loading && results.length ? <p className="muted">{t('sv.count', { count: results.length })}</p> : null}
        </header>
        {!loading && upcoming.length ? (
          <div className="row saved-cal">
            <a className="btn btn-secondary btn-sm saved-ics" href={savedIcsPath('all')} download><CalendarPlus size={14} aria-hidden="true" />{t('cal.savedAll')}</a>
            <Link className="small" to="/settings#reminders">{t('rem.settingsLink')}</Link>
          </div>
        ) : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {unavailable ? <Alert tone="info"><EyeOff size={14} aria-hidden="true" /> {t('sv.unavailable', { count: unavailable })}</Alert> : null}
        {loading ? <SkeletonGrid count={3} /> : null}
        {!loading && !error && !results.length ? (
          <EmptyState icon={Star} title={t('sv.none')} action={<Link className="btn btn-primary" to="/"><Search size={16} aria-hidden="true" />{t('nav.browseSales')}</Link>}>
            {t('sv.noneText')}
          </EmptyState>
        ) : null}
        {!loading && results.length ? (
          <div className="stack">
            {this.renderRoute()}
            {upcoming.length ? (
              <section aria-labelledby="saved-upcoming">
                <h2 id="saved-upcoming" className="saved-h2">{t('sv.upcoming')}</h2>
                <div className="card-grid card-grid-wide">{upcoming.map(card)}</div>
              </section>
            ) : null}
            {ended.length ? (
              <section aria-labelledby="saved-ended" className="saved-ended">
                <h2 id="saved-ended" className="saved-h2">{t('sched.ended')}</h2>
                <div className="card-grid card-grid-wide">{ended.map(card)}</div>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }
}

export default Saved;
