import React from 'react';
import { MAPS_API_KEY, loadGoogleMaps, onAuthFailure, geocode, addressOf } from './googleMaps';

const NYC = { lat: 40.73061, lng: -73.935242 };
const MAX_GEOCODE = 25; // cap geocoding calls per render of the list
const boxStyle = { height: '400px', width: '100%' };
const fallbackStyle = Object.assign({}, boxStyle, {
  display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
  background: '#f5f5f5', color: '#555', padding: '1em', boxSizing: 'border-box',
});

const MESSAGES = {
  missing_key: 'Map unavailable: no Google Maps API key is configured (set GOOGLE_MAPS_API_KEY).',
  auth: 'Map unavailable: the Google Maps API key was rejected. Check that the key is valid, the Maps JavaScript API is enabled, and this site is allowed.',
  load_failed: 'Map unavailable: could not load Google Maps. Check your connection and try again.',
};

// Shows the given posts as markers on a Google Map. Falls back to a plain
// message (instead of a broken grey box) when no key is configured or loading fails.
class Map extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: MAPS_API_KEY ? '' : 'missing_key', ready: false };
    this.container = null;
    this.map = null;
    this.markers = [];
    this.renderToken = 0;
  }

  componentDidMount() {
    if (!MAPS_API_KEY) return;
    this.mounted = true;
    onAuthFailure(() => this.mounted && this.setState({ error: 'auth' }));
    loadGoogleMaps()
      .then((maps) => {
        if (!this.mounted) return;
        this.maps = maps;
        this.geocoder = new maps.Geocoder();
        this.info = new maps.InfoWindow();
        this.map = new maps.Map(this.container, { center: NYC, zoom: 12 });
        this.setState({ ready: true });
        this.renderMarkers();
      })
      .catch((err) => this.mounted && this.setState({ error: err.message === 'missing_key' ? 'missing_key' : 'load_failed' }));
  }

  componentDidUpdate(prevProps) {
    if (prevProps.posts !== this.props.posts) this.renderMarkers();
  }

  componentWillUnmount() {
    this.mounted = false;
    this.clearMarkers();
  }

  clearMarkers() {
    this.markers.forEach((m) => m.setMap(null));
    this.markers = [];
  }

  renderMarkers() {
    if (!this.map) return;
    const token = ++this.renderToken;
    const maps = this.maps;
    this.clearMarkers();
    const posts = (this.props.posts || []).filter((p) => addressOf(p)).slice(0, MAX_GEOCODE);
    const bounds = new maps.LatLngBounds();

    // Sequential geocoding stays well under the per-second rate limit.
    posts.reduce((chain, post) => chain.then(() => {
      if (token !== this.renderToken || !this.mounted) return null;
      return geocode(maps, this.geocoder, addressOf(post)).then((loc) => {
        if (!loc || token !== this.renderToken || !this.mounted) return;
        const marker = new maps.Marker({ position: loc, map: this.map, title: post.title || '' });
        marker.addListener('click', () => {
          const el = document.createElement('div');
          const strong = document.createElement('strong');
          strong.textContent = post.title || 'Garage sale'; // textContent: no HTML injection
          const addr = document.createElement('div');
          addr.textContent = addressOf(post);
          el.appendChild(strong);
          el.appendChild(addr);
          this.info.setContent(el);
          this.info.open(this.map, marker);
        });
        this.markers.push(marker);
        bounds.extend(loc);
        if (this.markers.length === 1) {
          this.map.setCenter(loc);
          this.map.setZoom(13);
        } else {
          this.map.fitBounds(bounds);
        }
      });
    }), Promise.resolve());
  }

  render() {
    if (this.state.error) {
      return <div className="rg-map-fallback" role="status" style={fallbackStyle}>{MESSAGES[this.state.error]}</div>;
    }
    return <div className="rg-map" style={boxStyle} ref={(el) => { this.container = el; }} aria-label="Map of garage sales" />;
  }
}

export default Map;
