import React from 'react';
import { Link } from 'react-router-dom';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { resolveMapsKey, loadGoogleMaps, onAuthFailure, geocode, addressOf } from './googleMaps';

const MILE_M = 1609.344;
const hasCoords = (p) => typeof p.lat === 'number' && typeof p.lng === 'number';

const NYC = { lat: 40.73061, lng: -73.935242 };
const MAX_GEOCODE = 25; // cap geocoding calls per render of the list
const boxStyle = { height: '400px', width: '100%' };
const fallbackStyle = Object.assign({}, boxStyle, {
  display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
  background: '#f5f5f5', color: '#555', padding: '1em', boxSizing: 'border-box',
});

const MESSAGES = {
  key_changed: 'Your Maps key changed. Reload the page to use the new key.',
  auth: 'Map unavailable: the Google Maps API key was rejected. Check that the key is valid, the Maps JavaScript API is enabled, and this site is allowed.',
  load_failed: 'Map unavailable: could not load Google Maps. Check your connection and try again.',
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
    if (prevProps.posts !== this.props.posts || prevProps.center !== this.props.center || prevProps.radius !== this.props.radius) this.renderMarkers();
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
  }

  openInfo(post, marker) {
    const el = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = post.title || 'Garage sale'; // textContent: no HTML injection
    const addr = document.createElement('div');
    addr.textContent = addressOf(post);
    el.appendChild(strong);
    el.appendChild(addr);
    if (typeof post.distanceMiles === 'number') {
      const d = document.createElement('div');
      d.textContent = post.distanceMiles + ' mi away';
      el.appendChild(d);
    }
    this.info.setContent(el);
    this.info.open(this.map, marker);
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

  addMarker(post, loc, bounds) {
    const maps = this.maps;
    const marker = new maps.Marker({ position: loc, title: post.title || '' });
    // Map -> list: tell the parent which post was clicked.
    marker.addListener('click', () => {
      this.openInfo(post, marker);
      if (this.props.onSelect) this.props.onSelect(post.id);
    });
    this.markers.push(marker);
    this.markerById[post.id] = marker;
    this.clusterer.addMarker(marker);
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
        strokeColor: '#31b0d5', strokeWeight: 1, fillColor: '#31b0d5', fillOpacity: 0.06, clickable: false,
      });
    }
    const all = this.props.posts || [];
    // Posts with stored coordinates need no geocoding.
    all.filter(hasCoords).forEach((p) => this.addMarker(p, { lat: p.lat, lng: p.lng }, bounds));
    this.fit(bounds);
    this.showSelected();
    // Older posts without coordinates: geocode in the browser (capped, sequential).
    const rest = all.filter((p) => !hasCoords(p) && addressOf(p)).slice(0, MAX_GEOCODE);
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
    const byok = !this.props.config || this.props.config.userMapsKeys !== false;
    if (this.state.error === 'no_key' && !byok) {
      // Users can't add keys on this server, so don't tell them to.
      return <div className="rg-map-fallback" role="status" style={fallbackStyle}>The map is unavailable right now.</div>;
    }
    if (this.state.error === 'no_key') {
      return (
        <div className="rg-map-fallback" role="status" style={fallbackStyle}>
          <div>
            Map unavailable: no Google Maps API key.{' '}
            {this.props.user
              ? <span><Link to="/settings">Add your own key in Settings</Link> to see the map.</span>
              : <span><Link to="/login">Log in</Link> and add your own key in Settings to see the map.</span>}
          </div>
        </div>
      );
    }
    if (this.state.error === 'key_changed') {
      return (
        <div className="rg-map-fallback" role="status" style={fallbackStyle}>
          <div>{MESSAGES.key_changed} <button type="button" className="btn btn-default btn-xs" onClick={() => window.location.reload()}>Reload</button></div>
        </div>
      );
    }
    if (this.state.error) {
      return <div className="rg-map-fallback" role="status" style={fallbackStyle}>{MESSAGES[this.state.error]}</div>;
    }
    return <div className="rg-map" style={boxStyle} ref={(el) => { this.container = el; }} aria-label="Map of garage sales" />;
  }
}

export default Map;
