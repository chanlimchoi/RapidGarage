import React from 'react';
import { Link } from 'react-router-dom';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { MapPinOff as MapOff, KeyRound, RefreshCw } from 'lucide-react';
import { resolveMapsKey, loadGoogleMaps, onAuthFailure, geocode, addressOf } from './googleMaps';
import { saleBadge } from '../lib/schedule';
import { formatMiles } from '../lib/format';
import { t } from '../i18n';
import { tx } from '../i18n/rich';
import { groupForMap, pinCount } from '../lib/events';

const MILE_M = 1609.344;
const hasCoords = (p) => typeof p.lat === 'number' && typeof p.lng === 'number';

const NYC = { lat: 40.73061, lng: -73.935242 };
const MAX_GEOCODE = 25; // cap geocoding calls per render of the list
// Circle/pin accent follows the theme (light/dark) via the design tokens.
function accentColor() {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--color-map-accent').trim();
    return v || '#c2410c';
  } catch (e) { return '#c2410c'; }
}

function Fallback({ title, children, icon }) {
  const Icon = icon || MapOff;
  return (
    <div className="map-box rg-map-fallback" role="status">
      <div className="fallback-inner">
        <span className="fallback-icon"><Icon size={26} aria-hidden="true" /></span>
        {title ? <strong>{title}</strong> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

const MESSAGES = {
  key_changed: 'map.keyChanged',
  auth: 'map.authFailed',
  load_failed: 'map.loadFailed',
};

// Shows the given posts as markers on a Google Map. Falls back to a plain
// message (instead of a broken grey box) when no key is configured or loading fails.
class Map extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: '', ready: false, keySource: null };
    this.container = null;
    this.map = null;
    this.markers = [];
    this.markerById = {};
    this.renderToken = 0;
  }

  componentDidMount() {
    this.mounted = true;
    onAuthFailure(() => this.mounted && this.setState({ error: 'auth' }));
    this.init();
  }

  // Resolve which key to use (user's own > server's), then load the map.
  init() {
    resolveMapsKey()
      .then(({ key, source }) => {
        if (!this.mounted) return null;
        this.setState({ keySource: source });
        return loadGoogleMaps(key).then((maps) => {
          if (!this.mounted) return;
          if (!this.map) {
            this.maps = maps;
            this.geocoder = new maps.Geocoder();
            this.info = new maps.InfoWindow();
            this.map = new maps.Map(this.container, { center: NYC, zoom: 12 });
          }
          this.setState({ ready: true, error: '' });
          this.renderMarkers();
        });
      })
      .catch((err) => {
        if (!this.mounted) return;
        const known = ['no_key', 'key_changed'];
        this.setState({ error: known.indexOf(err.message) >= 0 ? err.message : 'load_failed' });
      });
  }

  componentDidUpdate(prevProps) {
    if (prevProps.posts !== this.props.posts || prevProps.events !== this.props.events || prevProps.center !== this.props.center || prevProps.radius !== this.props.radius || prevProps.start !== this.props.start) this.renderMarkers();
    else if (prevProps.selectedId !== this.props.selectedId) this.showSelected();
    // Logging in/out or saving a key in Settings can change which key applies.
    const sig = (u) => (u ? u.id + ':' + (u.mapsKeyLast4 || '') : '');
    const cfg = (c) => (c && c.userMapsKeys === false ? 'off' : 'on');
    if (sig(prevProps.user) !== sig(this.props.user) || cfg(prevProps.config) !== cfg(this.props.config)) this.init();
  }

  componentWillUnmount() {
    this.mounted = false;
    this.clearMarkers();
  }

  clearMarkers() {
    if (this.clusterer) this.clusterer.clearMarkers();
    this.markers.forEach((m) => m.setMap(null));
    this.markers = [];
    this.markerById = {};
    if (this.circle) { this.circle.setMap(null); this.circle = null; }
    if (this.line) { this.line.setMap(null); this.line = null; }
  }

  openInfo(post, marker) {
    const el = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = post.title || t('common.garageSale'); // textContent: no HTML injection
    const addr = document.createElement('div');
    addr.textContent = addressOf(post);
    el.appendChild(strong);
    el.appendChild(addr);
    const badge = saleBadge(post);
    if (badge) {
      const b = document.createElement('div');
      b.className = 'map-info-badge map-info-badge-' + badge.kind;
      b.textContent = badge.label;
      el.appendChild(b);
    }
    if (typeof post.distanceMiles === 'number') {
      const d = document.createElement('div');
      d.textContent = t('map.away', { distance: formatMiles(post.distanceMiles) });
      el.appendChild(d);
    }
    this.info.setContent(el);
    this.info.open(this.map, marker);
  }

  // A neighborhood sale's pin: its name, area, sale count and a link to its page.
  openEventInfo(group, marker) {
    const ev = group.event;
    const el = document.createElement('div');
    el.className = 'map-info-event';
    const kicker = document.createElement('div');
    kicker.className = 'map-info-kicker';
    kicker.textContent = t('ev.kicker');
    const strong = document.createElement('strong');
    strong.textContent = ev.name;
    const area = document.createElement('div');
    area.textContent = ev.areaLabel;
    const count = document.createElement('div');
    count.textContent = t('ev.saleCount', { count: pinCount(group) });
    const link = document.createElement('a');
    link.href = '/events/' + ev.id;
    link.textContent = t('ev.viewEvent');
    link.addEventListener('click', (e) => {
      if (this.props.onOpenEvent) { e.preventDefault(); this.props.onOpenEvent(ev.id); }
    });
    [kicker, strong, area, count, link].forEach((n) => el.appendChild(n));
    this.info.setContent(el);
    this.info.open(this.map, marker);
  }

  // One pin per neighborhood sale (not clustered with single sales), labelled with its count.
  addEventMarker(group, bounds) {
    const maps = this.maps;
    const ev = group.event;
    const loc = { lat: ev.lat, lng: ev.lng };
    const marker = new maps.Marker({
      position: loc, map: this.map, title: ev.name, zIndex: 1000,
      label: { text: String(pinCount(group)), color: '#fff', fontWeight: '700' },
      icon: { path: maps.SymbolPath.CIRCLE, scale: 16, fillColor: accentColor(), fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 },
    });
    marker.addListener('click', () => this.openEventInfo(group, marker));
    this.markers.push(marker);
    group.posts.forEach((p) => { this.markerById[p.id] = marker; });
    bounds.extend(loc);
  }

  // List -> map: pan to the selected post and open its info window.
  showSelected() {
    const marker = this.markerById[this.props.selectedId];
    if (!marker || !this.map) return;
    const post = (this.props.posts || []).find((p) => p.id === this.props.selectedId);
    this.map.panTo(marker.getPosition());
    if (this.map.getZoom() < 14) this.map.setZoom(14);
    if (post) this.openInfo(post, marker);
  }

  addMarker(post, loc, bounds, label) {
    const maps = this.maps;
    const opts = { position: loc, title: post.title || '' };
    if (label) Object.assign(opts, { label: { text: label, color: '#fff', fontWeight: '700' }, map: this.map });
    const marker = new maps.Marker(opts);
    // Map -> list: tell the parent which post was clicked.
    marker.addListener('click', () => {
      this.openInfo(post, marker);
      if (this.props.onSelect) this.props.onSelect(post.id);
    });
    this.markers.push(marker);
    this.markerById[post.id] = marker;
    if (!label) this.clusterer.addMarker(marker);
    bounds.extend(loc);
  }

  fit(bounds) {
    if (this.circle) this.map.fitBounds(this.circle.getBounds());
    else if (this.markers.length === 1) { this.map.setCenter(bounds.getCenter()); this.map.setZoom(13); }
    else if (this.markers.length > 1) this.map.fitBounds(bounds);
  }

  renderMarkers() {
    if (!this.map) return;
    const token = ++this.renderToken;
    const maps = this.maps;
    this.clearMarkers();
    // Official clusterer: groups nearby pins at low zoom levels.
    if (!this.clusterer) this.clusterer = new MarkerClusterer({ map: this.map, markers: [] });
    const bounds = new maps.LatLngBounds();
    const { center, radius } = this.props;
    if (center && radius) {
      this.circle = new maps.Circle({
        map: this.map, center, radius: radius * MILE_M,
        strokeColor: accentColor(), strokeWeight: 1.5, fillColor: accentColor(), fillOpacity: 0.08, clickable: false,
      });
    }
    const all = this.props.posts || [];
    // Route mode: numbered pins in visiting order, joined by a line (no clustering, no geocoding).
    if (this.props.route) {
      const path = [];
      const { start } = this.props;
      if (start) {
        path.push(start);
        bounds.extend(start);
        const you = new maps.Marker({ position: start, map: this.map, title: t('map.start'), label: { text: '•', color: '#fff' } });
        this.markers.push(you);
      }
      all.filter(hasCoords).forEach((p, i) => {
        const loc = { lat: p.lat, lng: p.lng };
        path.push(loc);
        this.addMarker(p, loc, bounds, String(i + 1));
      });
      if (path.length > 1) {
        this.line = new maps.Polyline({ map: this.map, path, strokeColor: accentColor(), strokeOpacity: 0.85, strokeWeight: 4, clickable: false });
        this.map.fitBounds(bounds);
      } else this.fit(bounds);
      return;
    }
    // Sales in a shown neighborhood sale collapse into that event's pin.
    const grouped = groupForMap(all, this.props.events);
    grouped.events.forEach((g) => this.addEventMarker(g, bounds));
    // Posts with stored coordinates need no geocoding.
    grouped.singles.filter(hasCoords).forEach((p) => this.addMarker(p, { lat: p.lat, lng: p.lng }, bounds));
    this.fit(bounds);
    this.showSelected();
    // Older posts without coordinates: geocode in the browser (capped, sequential).
    const rest = grouped.singles.filter((p) => !hasCoords(p) && addressOf(p)).slice(0, MAX_GEOCODE);
    rest.reduce((chain, post) => chain.then(() => {
      if (token !== this.renderToken || !this.mounted) return null;
      return geocode(maps, this.geocoder, addressOf(post)).then((loc) => {
        if (!loc || token !== this.renderToken || !this.mounted) return;
        this.addMarker(post, loc, bounds);
        this.fit(bounds);
      });
    }), Promise.resolve());
  }

  render() {
    // quiet: the parent shows its own fallback (e.g. the route sketch), so render nothing on errors.
    if (this.props.quiet && this.state.error) return null;
    const byok = !this.props.config || this.props.config.userMapsKeys !== false;
    if (this.state.error === 'no_key' && !byok) {
      // Users can't add keys on this server, so don't tell them to.
      return <Fallback title={t('map.unavailable')}>{t('map.unavailableNow')}</Fallback>;
    }
    if (this.state.error === 'no_key') {
      return (
        <Fallback title={t('map.unavailable')} icon={KeyRound}>
          {t('map.noKey')}{' '}
          {this.props.user
            ? <span>{tx('map.noKeyUser', { link: <Link to="/settings">{t('map.addKeyLink')}</Link> })}</span>
            : <span>{tx('map.noKeyGuest', { link: <Link to="/login">{t('map.logInLink')}</Link> })}</span>}
        </Fallback>
      );
    }
    if (this.state.error === 'key_changed') {
      return (
        <Fallback title={t('map.reloadNeeded')} icon={RefreshCw}>
          <p>{t(MESSAGES.key_changed)}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.location.reload()}><RefreshCw size={14} aria-hidden="true" />{t('map.reload')}</button>
        </Fallback>
      );
    }
    if (this.state.error) {
      return <Fallback title={t('map.unavailable')}>{t(MESSAGES[this.state.error] || 'map.loadFailed')}</Fallback>;
    }
    return <div className="map-box rg-map" ref={(el) => { this.container = el; }} role="region" aria-label={this.props.label || t('map.label')} />;
  }
}

export default Map;
