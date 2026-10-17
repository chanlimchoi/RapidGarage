import React from 'react';
import { Link } from 'react-router-dom';
import { Search, LocateFixed, Ruler, List, Map as MapIcon, ChevronLeft, ChevronRight, SearchX, Store, Plus } from 'lucide-react';
import Map from './Map';
import PostCard from './PostCard';
import { Alert, EmptyState, SkeletonGrid, Spinner } from './ui';
import { apiFetch, searchPosts, errorMessage, SEARCH_RADII } from '../api';

const PAGE_SIZE = 10;

class PostList extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      results: [], mode: 'recent', notice: '', error: '', loading: true,
      q: '', radius: 10, coords: null, center: null, page: 1, totalPages: 1, total: 0,
      selectedId: null, locating: false, view: 'list',
    };
    this.handleSubmit = this.handleSubmit.bind(this);
    this.useMyLocation = this.useMyLocation.bind(this);
    this.select = this.select.bind(this);
    this.showOnMap = this.showOnMap.bind(this);
  }

  componentDidMount() {
    this.mounted = true;
    this.loadRecent();
  }

  loadRecent() {
    apiFetch('/allPosts')
      .then(({ ok, data }) => this.mounted && this.setState({ loading: false, results: ok && Array.isArray(data) ? data : [],
        error: ok ? '' : errorMessage(data, 'Could not load recent sales.') }))
      .catch(() => this.mounted && this.setState({ loading: false, results: [], error: 'Unable to reach the server. Please try again.' }));
  }

  componentWillUnmount() { this.mounted = false; }

  // where: { coords } or { q }
  runSearch(where, page) {
    const params = Object.assign({ radius: this.state.radius, page: page || 1, pageSize: PAGE_SIZE },
      where.coords ? { lat: where.coords.lat, lng: where.coords.lng } : { q: where.q });
    this.setState({ loading: true, error: '', notice: '' });
    return searchPosts(params).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) {
        return this.setState({ loading: false, results: [], total: 0, mode: 'error', center: null,
          error: errorMessage(data, 'Search failed.') });
      }
      this.setState({
        loading: false, results: data.results, mode: data.mode, page: data.page, totalPages: data.totalPages,
        total: data.total, resultRadius: data.radius, center: data.center ? { lat: data.center.lat, lng: data.center.lng } : null,
        notice: data.notice ? data.notice.message : '', selectedId: null, lastWhere: where,
      });
    }).catch(() => this.mounted && this.setState({ loading: false, error: 'Unable to reach the server. Please try again.' }));
  }

  handleSubmit(e) {
    e.preventDefault();
    const q = this.state.q.trim();
    if (q) return this.runSearch({ q }, 1);
    if (this.state.coords) return this.runSearch({ coords: this.state.coords }, 1);
    this.setState({ error: 'Type an address or zip code, or use your location.' });
    if (this.qInput) this.qInput.focus();
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

  // Map -> list: highlight the card and bring it into view.
  select(id) {
    this.setState({ selectedId: id });
    const el = document.querySelector('[data-post-id="' + id + '"]');
    if (el && el.scrollIntoView && this.state.view === 'list') el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // List -> map: on phones, switch to the map first.
  showOnMap(id) {
    this.setState({ selectedId: id, view: 'map' });
  }

  clearSearch() {
    this.setState({ q: '', coords: null, lastWhere: null, notice: '', error: '', mode: 'recent', center: null, loading: true, results: [] });
    this.loadRecent();
  }

  renderResults() {
    const s = this.state;
    if (s.loading) return <SkeletonGrid count={4} />;
    if (!s.results.length) {
      if (s.mode === 'recent' && !s.error) {
        return (
          <EmptyState icon={Store} title="No sales posted yet"
            action={<Link to="/newpost" className="btn btn-primary"><Plus size={16} aria-hidden="true" />Post the first sale</Link>}>
            Be the first to list a garage or yard sale in your area.
          </EmptyState>
        );
      }
      return (
        <EmptyState icon={SearchX} title="No sales found"
          action={s.mode === 'distance' && s.resultRadius < 50
            ? <button type="button" className="btn btn-secondary" onClick={() => this.changeRadius(50)}>Search within 50 mi</button>
            : <button type="button" className="btn btn-secondary" onClick={() => this.clearSearch()}>Show recent sales</button>}>
          {s.mode === 'distance' ? 'Nothing within ' + s.resultRadius + ' miles of there. Try a bigger radius.' : 'Try a different address or zip code.'}
        </EmptyState>
      );
    }
    return (
      <React.Fragment>
        <div className="card-grid">
          {s.results.map((post) => <PostCard key={post.id} post={post} selected={post.id === s.selectedId} onShowOnMap={this.showOnMap} />)}
        </div>
        {s.mode !== 'recent' && s.totalPages > 1 ? (
          <nav className="pager search-pager" aria-label="Search results pages">
            <button type="button" className="btn btn-secondary btn-sm" disabled={s.page <= 1 || s.loading}
              onClick={() => this.runSearch(s.lastWhere, s.page - 1)}><ChevronLeft size={16} aria-hidden="true" />Prev</button>
            <span className="small muted">Page {s.page} of {s.totalPages}</span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={s.page >= s.totalPages || s.loading}
              onClick={() => this.runSearch(s.lastWhere, s.page + 1)}>Next<ChevronRight size={16} aria-hidden="true" /></button>
          </nav>
        ) : null}
      </React.Fragment>
    );
  }

  render() {
    const s = this.state;
    const heading = s.mode === 'distance'
      ? s.total + ' sale' + (s.total === 1 ? '' : 's') + ' within ' + s.resultRadius + ' mi'
      : s.mode === 'text' ? s.total + ' matching sale' + (s.total === 1 ? '' : 's') : 'Recent sales';
    return (
      <div className="container">
        <section className="hero">
          <h1>Find garage sales near you</h1>
          <p>Browse yard sales, estate sales and moving sales in your neighborhood.</p>
          <form className="search-bar map-search" onSubmit={this.handleSubmit} role="search" aria-label="Search sales">
            <div className="search-field">
              <Search size={18} aria-hidden="true" />
              <label htmlFor="search-q" className="sr-only">Address or zip code</label>
              <input id="search-q" name="q" type="search" value={s.q} maxLength={200} ref={(el) => { this.qInput = el; }}
                onChange={(e) => this.setState({ q: e.target.value })} placeholder="Address or zip code" autoComplete="postal-code" />
            </div>
            <div className="search-field search-field-radius">
              <Ruler size={18} aria-hidden="true" />
              <label htmlFor="search-radius" className="sr-only">Radius</label>
              <select id="search-radius" name="radius" value={s.radius} onChange={(e) => this.changeRadius(Number(e.target.value))}>
                {SEARCH_RADII.map((r) => <option key={r} value={r}>Within {r} mi</option>)}
              </select>
            </div>
            <div className="search-buttons">
              <button type="button" className="btn btn-secondary" onClick={this.useMyLocation} disabled={s.locating}>
                {s.locating ? <Spinner /> : <LocateFixed size={16} aria-hidden="true" />} {s.locating ? 'Locating…' : 'Use my location'}
              </button>
              <button type="submit" className="btn btn-primary" disabled={s.loading && s.mode !== 'recent'}>
                <Search size={16} aria-hidden="true" />Search
              </button>
            </div>
          </form>
        </section>

        {s.notice ? <Alert tone="warning" className="search-notice">{s.notice}</Alert> : null}
        {s.error ? <Alert tone="danger" className="search-error">{s.error}</Alert> : null}

        <div className="browse-toolbar">
          <h2 className="search-heading" aria-live="polite">{s.loading ? 'Searching…' : heading}</h2>
          <div className="segmented view-toggle" role="group" aria-label="View">
            <button type="button" aria-pressed={s.view === 'list'} onClick={() => this.setState({ view: 'list' })}><List size={16} aria-hidden="true" />List</button>
            <button type="button" aria-pressed={s.view === 'map'} onClick={() => this.setState({ view: 'map' })}><MapIcon size={16} aria-hidden="true" />Map</button>
          </div>
        </div>

        <div className={'browse' + (s.view === 'map' ? ' show-map' : '')}>
          <section className="browse-list" aria-label="Sales">{this.renderResults()}</section>
          <section className="browse-map" aria-label="Map">
            <Map posts={s.results} user={this.props.user} config={this.props.config}
              center={s.mode === 'distance' ? s.center : null} radius={s.mode === 'distance' ? s.resultRadius : null}
              selectedId={s.selectedId} onSelect={this.select} />
          </section>
        </div>
      </div>
    );
  }
}

export default PostList;
