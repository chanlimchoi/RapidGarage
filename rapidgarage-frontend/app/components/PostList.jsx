import React from 'react';
import { Link } from 'react-router-dom';
import Map from './Map';
import { apiFetch, searchPosts, errorMessage, SEARCH_RADII } from '../api';

const PAGE_SIZE = 10;

function formatMiles(d) {
  if (typeof d !== 'number') return null;
  return (d < 10 ? d.toFixed(1) : Math.round(d)) + ' mi';
}

function PostItem({ post, selected, onSelect }) {
  const photos = post.photos || [];
  const distance = formatMiles(post.distanceMiles);
  return (
    <div className={'panel-info post-item' + (selected ? ' post-item-selected' : '')} data-post-id={post.id}
      onClick={() => onSelect(post.id)}
      style={{ cursor: 'pointer', outline: selected ? '2px solid #31b0d5' : 'none', marginBottom: 8 }}>
      <div className="panel-heading">
        {photos.length ? (
          <Link to={'/post/' + post.id}><img className="post-thumb" src={photos[0].thumbUrl} alt={post.title}
            style={{ float: 'right', width: 72, height: 72, objectFit: 'cover', borderRadius: 4, marginLeft: 8 }} /></Link>
        ) : null}
        <h4 style={{ marginTop: 0 }}>
          <Link to={'/post/' + post.id}>{post.title}</Link>{' '}
          {distance ? <span className="label label-info post-distance">{distance}</span> : null}{' '}
          {photos.length > 1 ? <small>({photos.length} photos)</small> : null}
        </h4>
        <span><span className="glyphicon glyphicon-time"></span> Posted {new Date(post.createdAt).toLocaleDateString()}</span>
      </div>
      <div className="panel-body">
        Location: {[post.street, post.city, post.state, post.zipCode].filter(Boolean).join(', ')}
      </div>
    </div>
  );
}

class PostList extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      results: [], mode: 'recent', notice: '', error: '', loading: false,
      q: '', radius: 10, coords: null, center: null, page: 1, totalPages: 1, total: 0,
      selectedId: null, locating: false,
    };
    this.handleSubmit = this.handleSubmit.bind(this);
    this.useMyLocation = this.useMyLocation.bind(this);
    this.select = this.select.bind(this);
  }

  componentDidMount() {
    apiFetch('/allPosts')
      .then(({ ok, data }) => this.setState({ results: ok && Array.isArray(data) ? data : [] }))
      .catch(() => this.setState({ results: [] }));
  }

  // where: { coords } or { q }
  runSearch(where, page) {
    const params = Object.assign({ radius: this.state.radius, page: page || 1, pageSize: PAGE_SIZE },
      where.coords ? { lat: where.coords.lat, lng: where.coords.lng } : { q: where.q });
    this.setState({ loading: true, error: '', notice: '' });
    return searchPosts(params).then(({ ok, data }) => {
      if (!ok) {
        return this.setState({ loading: false, results: [], total: 0, mode: 'error', center: null,
          error: errorMessage(data, 'Search failed.') });
      }
      this.setState({
        loading: false, results: data.results, mode: data.mode, page: data.page, totalPages: data.totalPages,
        total: data.total, resultRadius: data.radius, center: data.center ? { lat: data.center.lat, lng: data.center.lng } : null,
        notice: data.notice ? data.notice.message : '', selectedId: null, lastWhere: where,
      });
    }).catch(() => this.setState({ loading: false, error: 'Unable to reach the server. Please try again.' }));
  }

  handleSubmit(e) {
    e.preventDefault();
    const q = this.state.q.trim();
    if (q) return this.runSearch({ q }, 1);
    if (this.state.coords) return this.runSearch({ coords: this.state.coords }, 1);
    this.setState({ error: 'Type an address or zip code, or use your location.' });
  }

  useMyLocation() {
    if (!navigator.geolocation) return this.setState({ error: 'Your browser cannot share its location.' });
    this.setState({ locating: true, error: '' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        this.setState({ coords, q: '', locating: false });
        this.runSearch({ coords }, 1);
      },
      () => this.setState({ locating: false, error: 'Could not get your location. Allow location access or type an address.' }),
      { timeout: 10000, maximumAge: 300000 }
    );
  }

  changeRadius(radius) {
    this.setState({ radius }, () => { if (this.state.lastWhere) this.runSearch(this.state.lastWhere, 1); });
  }

  select(id) {
    this.setState({ selectedId: id });
    const el = document.querySelector('[data-post-id="' + id + '"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  render() {
    const s = this.state;
    const heading = s.mode === 'distance'
      ? s.total + ' sale' + (s.total === 1 ? '' : 's') + ' within ' + s.resultRadius + ' mi'
      : s.mode === 'text' ? s.total + ' matching sale' + (s.total === 1 ? '' : 's') : 'RECENT POSTS';
    return (
      <div>
        <div className="col-sm-4 well">
          <form className="map-search" onSubmit={this.handleSubmit} role="search">
            <label htmlFor="search-q" className="sr-only">Address or zip code</label>
            <input id="search-q" name="q" type="search" className="form-control" value={s.q} maxLength={200}
              onChange={(e) => this.setState({ q: e.target.value })} placeholder="Address or zip code" />
            <div style={{ display: 'flex', marginTop: 6, gap: 6 }}>
              <label htmlFor="search-radius" className="sr-only">Radius</label>
              <select id="search-radius" name="radius" className="form-control" style={{ width: 'auto' }} value={s.radius}
                onChange={(e) => this.changeRadius(Number(e.target.value))}>
                {SEARCH_RADII.map((r) => <option key={r} value={r}>{r} mi</option>)}
              </select>
              <button type="submit" className="btn btn-info" disabled={s.loading}>Search</button>
              <button type="button" className="btn btn-default" onClick={this.useMyLocation} disabled={s.locating}>
                <span className="glyphicon glyphicon-screenshot"></span> {s.locating ? 'Locating…' : 'Use my location'}
              </button>
            </div>
          </form>
          {s.notice ? <p className="text-warning search-notice" role="status" style={{ marginTop: 8 }}>{s.notice}</p> : null}
          {s.error ? <p className="text-danger search-error" role="alert" style={{ marginTop: 8 }}>{s.error}</p> : null}
          <div className="panel-group" style={{ marginTop: 8 }}>
            <h5><small className="search-heading">{heading}</small></h5>
            {s.results.length
              ? s.results.map((post) => <PostItem key={post.id} post={post} selected={post.id === s.selectedId} onSelect={this.select} />)
              : <h4 className="no-results">{s.loading ? 'Searching…' : 'No sales found'}</h4>}
            {s.mode !== 'recent' && s.totalPages > 1 ? (
              <div className="search-pager" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button type="button" className="btn btn-default btn-sm" disabled={s.page <= 1 || s.loading}
                  onClick={() => this.runSearch(s.lastWhere, s.page - 1)}>‹ Prev</button>
                <span>Page {s.page} of {s.totalPages}</span>
                <button type="button" className="btn btn-default btn-sm" disabled={s.page >= s.totalPages || s.loading}
                  onClick={() => this.runSearch(s.lastWhere, s.page + 1)}>Next ›</button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="col-sm-5 well">
          <Map posts={s.results} user={this.props.user} config={this.props.config}
            center={s.mode === 'distance' ? s.center : null} radius={s.mode === 'distance' ? s.resultRadius : null}
            selectedId={s.selectedId} onSelect={this.select} />
        </div>
      </div>
    );
  }
}

export default PostList;
