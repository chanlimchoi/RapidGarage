import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { Star, LogIn, Route as RouteIcon, ExternalLink, LocateFixed, MapPin, Navigation, Search, EyeOff } from 'lucide-react';
import { apiFetch, errorMessage } from '../api';
import PostCard, { BADGE_CLASS } from '../components/PostCard';
import Map from '../components/Map';
import { EmptyState, SkeletonGrid, SkeletonBlock, Alert, Spinner } from '../components/ui';
import { placeLine } from '../lib/format';
import { saleBadge } from '../lib/schedule';
import * as saved from '../lib/saved';
import SaveButton from './SaveButton';
import RouteSketch from './RouteSketch';

const WHEN = [
  { value: 'weekend', label: 'This weekend' },
  { value: 'today', label: 'Today' },
  { value: 'all', label: 'All upcoming' },
];
const WHEN_TEXT = { weekend: 'this weekend', today: 'today', all: 'coming up' };
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

// Saved sales plus a suggested route that visits the ones still coming up.
class Saved extends Component {
  constructor(props) {
    super(props);
    this.state = {
      loading: true, error: '', results: [], unavailable: 0,
      when: 'weekend', start: null, locating: false, locError: '',
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
      if (!ok) { this.setState({ loading: false, error: errorMessage(data, "Couldn't load your saved sales.") }); return; }
      this.setState({ loading: false, results: data.results || [], unavailable: data.unavailable || 0 }, () => this.loadRoute());
    }).catch(() => !this.gone && this.setState({ loading: false, error: 'Network problem. Please try again.' }));
  }

  loadRoute() {
    const { when, start } = this.state;
    const q = ['when=' + when];
    if (start) q.push('lat=' + start.lat, 'lng=' + start.lng);
    const token = (this.routeToken = (this.routeToken || 0) + 1);
    this.setState({ routeLoading: true, routeError: '' });
    apiFetch('/saved/route?' + q.join('&')).then(({ ok, data }) => {
      if (this.gone || token !== this.routeToken) return;
      if (!ok) { this.setState({ routeLoading: false, routeError: errorMessage(data, "Couldn't plan a route.") }); return; }
      this.setState({ routeLoading: false, route: data });
    }).catch(() => !this.gone && this.setState({ routeLoading: false, routeError: 'Network problem. Please try again.' }));
  }

  changeWhen(when) {
    if (when === this.state.when) return;
    this.setState({ when }, () => this.loadRoute());
  }

  locate() {
    if (!navigator.geolocation) { this.setState({ locError: "Your browser can't share its location." }); return; }
    this.setState({ locating: true, locError: '' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const start = { lat: Math.round(pos.coords.latitude * 1e5) / 1e5, lng: Math.round(pos.coords.longitude * 1e5) / 1e5 };
        this.setState({ locating: false, start }, () => this.loadRoute());
      },
      () => this.setState({ locating: false, locError: "Couldn't get your location. Check the browser's location permission." }),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }

  clearStart() { this.setState({ start: null }, () => this.loadRoute()); }

  renderRoute() {
    const { route, routeLoading, routeError, when, start, locating, locError, results } = this.state;
    const live = results.filter((p) => p.status !== 'ended');
    return (
      <section className="panel route-panel" aria-labelledby="route-title">
        <div className="route-head">
          <h2 id="route-title" className="saved-h2"><RouteIcon size={20} aria-hidden="true" />Your route</h2>
          <div className="segmented route-when" role="group" aria-label="Which sales">
            {WHEN.map((w) => <button key={w.value} type="button" aria-pressed={when === w.value} onClick={() => this.changeWhen(w.value)}>{w.label}</button>)}
          </div>
        </div>
        <div className="route-start row">
          {start ? (
            <React.Fragment>
              <span className="small"><LocateFixed size={14} aria-hidden="true" /> Starting from your location</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.clearStart()}>Don't use my location</button>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <span className="small muted">Starting at the sale that opens first.</span>
              <button type="button" className="btn btn-secondary btn-sm locate-btn" disabled={locating} onClick={() => this.locate()}>
                {locating ? <Spinner /> : <LocateFixed size={14} aria-hidden="true" />}Start from my location
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
            ? 'None of your saved sales are open ' + WHEN_TEXT[route.when] + (route.when === 'all' ? '.' : '. ')
            : 'Save sales that are coming up and we’ll plan a route for you.'}
          {liveCount && route.when !== 'all' ? <button type="button" className="btn-link" onClick={() => this.changeWhen('all')}>Show all upcoming</button> : null}</p>
        </div>
      );
    }
    const notes = [];
    if (skipped.overLimit) notes.push(plural(skipped.overLimit, 'more sale') + ' didn’t fit (Google Maps takes up to ' + route.maxStops + ' stops).');
    if (skipped.noLocation) notes.push(plural(skipped.noLocation, 'sale') + ' couldn’t be placed on the map.');
    return (
      <div className="route-body">
        <p className="route-summary">
          <strong>{plural(stops.length, 'stop')}</strong>
          {route.totalMiles ? <span className="muted"> · about {route.totalMiles} mi in a straight line</span> : null}
        </p>
        <div className="route-visual">
          <RouteSketch start={route.start} stops={stops} />
          <div className="route-map"><Map quiet posts={stops.map((s) => s.post)} route start={route.start} user={this.props.user} config={this.props.config} label="Map of your route" /></div>
        </div>
        <ol className="route-stops">
          {stops.map((s) => {
            const badge = saleBadge(s.post);
            return (
              <li key={s.post.id} className="route-stop">
                <span className="route-stop-n" aria-hidden="true">{s.order}</span>
                <div className="route-stop-body">
                  <Link to={'/post/' + s.post.id} className="route-stop-title">{s.post.title}</Link>
                  <span className="small muted"><MapPin size={12} aria-hidden="true" /> {placeLine(s.post) || 'Location not given'}</span>
                  <span className="row route-stop-meta">
                    {badge ? <span className={'chip sale-badge sale-badge-' + badge.kind + ' ' + BADGE_CLASS[badge.kind]}>{badge.label}</span> : null}
                    {s.legMiles !== null ? <span className="small muted"><Navigation size={12} aria-hidden="true" /> {s.legMiles} mi {s.order === 1 ? 'from you' : 'from stop ' + (s.order - 1)}</span> : <span className="small muted">First stop</span>}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
        {notes.length ? <p className="small muted">{notes.join(' ')}</p> : null}
        <div className="form-actions">
          <a className="btn btn-primary open-in-maps" href={route.googleMapsUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={16} aria-hidden="true" />Open in Google Maps
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
          <EmptyState icon={LogIn} title="Log in to see your saved sales" action={<Link className="btn btn-primary" to="/login">Log in</Link>}>
            Star sales you want to visit and we’ll plan a route.
          </EmptyState>
        </div>
      );
    }
    const { loading, error, results, unavailable } = this.state;
    const upcoming = results.filter((p) => p.status !== 'ended');
    const ended = results.filter((p) => p.status === 'ended');
    const card = (p) => <PostCard key={p.id} post={p} actions={<SaveButton post={p} />} />;
    return (
      <div className="container page saved-page">
        <header className="page-header">
          <h1><Star size={26} aria-hidden="true" />Saved sales</h1>
          {!loading && results.length ? <p className="muted">{plural(results.length, 'saved sale')}</p> : null}
        </header>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {unavailable ? <Alert tone="info"><EyeOff size={14} aria-hidden="true" /> {plural(unavailable, 'saved sale is', 'saved sales are')} no longer available.</Alert> : null}
        {loading ? <SkeletonGrid count={3} /> : null}
        {!loading && !error && !results.length ? (
          <EmptyState icon={Star} title="No saved sales yet" action={<Link className="btn btn-primary" to="/"><Search size={16} aria-hidden="true" />Browse sales</Link>}>
            Tap the star on any sale to save it here. We’ll put the ones coming up into a route.
          </EmptyState>
        ) : null}
        {!loading && results.length ? (
          <div className="stack">
            {this.renderRoute()}
            {upcoming.length ? (
              <section aria-labelledby="saved-upcoming">
                <h2 id="saved-upcoming" className="saved-h2">Coming up</h2>
                <div className="card-grid card-grid-wide">{upcoming.map(card)}</div>
              </section>
            ) : null}
            {ended.length ? (
              <section aria-labelledby="saved-ended" className="saved-ended">
                <h2 id="saved-ended" className="saved-h2">Ended</h2>
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
