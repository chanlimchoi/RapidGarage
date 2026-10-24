import React from 'react';
import { Link } from 'react-router-dom';
import { Search, LocateFixed, Ruler, List, Map as MapIcon, ChevronLeft, ChevronRight, SearchX, Store, Plus, Tag, BellRing, Check, Package, X, UsersRound, Gift, Percent } from 'lucide-react';
import Map from './Map';
import PostCard from './PostCard';
import { Alert, EmptyState, SkeletonGrid, Spinner } from './ui';
import { apiFetch, searchPosts, errorMessage, SEARCH_RADII, createAlert, fetchEvents } from '../api';
import EventCard from '../events/EventCard';
import toast from './toast';
import { priceFieldError, formatUSD } from '../lib/price';
import { WHEN_FILTERS } from '../lib/schedule';
import { KEYWORD_MAX } from '../lib/items';
import { scrollBehavior } from '../lib/a11y';
import { t } from '../i18n';
import { searchAlertBody, searchKey } from '../lib/savedSearch';

const PAGE_SIZE = 10;

class PostList extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      results: [], mode: 'recent', notice: '', error: '', loading: true,
      q: '', radius: 10, coords: null, center: null, page: 1, totalPages: 1, total: 0,
      selectedId: null, locating: false, view: 'list',
      maxPrice: '', freeOnly: false, when: '', alertBusy: false, alertSavedFor: null,
      // keyword: what's typed; activeKeyword: what the shown results were filtered by.
      keyword: '', activeKeyword: '',
      // Neighborhood sales: shown as a strip and as one map pin each; neighborhood = only their sales.
      events: [], neighborhood: false,
      // Free on the curb only (?curbside=true): leftovers neighbors can pick up now.
      curbside: false,
      // Last-hour markdown running now (?markdown=true).
      markdown: false,
    };
    this.handleSubmit = this.handleSubmit.bind(this);
    this.useMyLocation = this.useMyLocation.bind(this);
    this.select = this.select.bind(this);
    this.showOnMap = this.showOnMap.bind(this);
    this.alertHere = this.alertHere.bind(this);
  }

  componentDidMount() {
    this.mounted = true;
    this.loadRecent();
    this.loadRecentEvents();
  }

  loadRecent() {
    const q = [];
    if (this.state.when) q.push('when=' + encodeURIComponent(this.state.when));
    if (this.state.activeKeyword) q.push('keyword=' + encodeURIComponent(this.state.activeKeyword));
    if (this.state.curbside) q.push('curbside=true');
    if (this.state.markdown) q.push('markdown=true');
    apiFetch('/allPosts' + (q.length ? '?' + q.join('&') : ''))
      .then(({ ok, data }) => this.mounted && this.setState({ loading: false, results: ok && Array.isArray(data) ? data.filter((p) => !this.state.neighborhood || p.event) : [],
        error: ok ? '' : errorMessage(data, t('list.loadFailed')) }))
      .catch(() => this.mounted && this.setState({ loading: false, results: [], error: t('common.network') }));
  }

  componentWillUnmount() { this.mounted = false; }

  // Upcoming neighborhood sales for the recent (no-location) view.
  loadRecentEvents() {
    fetchEvents().then(({ ok, data }) => { if (this.mounted && ok && this.state.mode === 'recent') this.setState({ events: data.results.slice(0, 6) }); }).catch(() => null);
  }

  // where: { coords } or { q }
  runSearch(where, page) {
    if (priceFieldError(this.state.maxPrice, t('list.maxPrice'))) return Promise.resolve();
    const params = Object.assign({ radius: this.state.radius, page: page || 1, pageSize: PAGE_SIZE },
      where.coords ? { lat: where.coords.lat, lng: where.coords.lng } : { q: where.q },
      this.state.freeOnly ? { free: 'true' } : {},
      this.state.when ? { when: this.state.when } : {},
      this.state.activeKeyword ? { keyword: this.state.activeKeyword } : {},
      this.state.neighborhood ? { neighborhood: 'true' } : {},
      this.state.curbside ? { curbside: 'true' } : {},
      this.state.markdown ? { markdown: 'true' } : {},
      !this.state.freeOnly && this.state.maxPrice.trim() ? { maxPrice: this.state.maxPrice.trim() } : {});
    this.setState({ loading: true, error: '', notice: '' });
    return searchPosts(params).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) {
        return this.setState({ loading: false, results: [], total: 0, mode: 'error', center: null,
          error: errorMessage(data, t('list.searchFailed')) });
      }
      this.setState({
        loading: false, results: data.results, mode: data.mode, page: data.page, totalPages: data.totalPages,
        total: data.total, resultRadius: data.radius, center: data.center ? { lat: data.center.lat, lng: data.center.lng } : null,
        notice: data.notice ? data.notice.message : '', selectedId: null, lastWhere: where, resultFilter: data.filter || null,
        events: data.events || [],
      });
    }).catch(() => this.mounted && this.setState({ loading: false, error: t('common.network') }));
  }

  handleSubmit(e) {
    e.preventDefault();
    const q = this.state.q.trim();
    const activeKeyword = this.state.keyword.trim().replace(/\s+/g, ' ');
    return new Promise((resolve) => this.setState({ activeKeyword }, resolve)).then(() => {
      if (q) return this.runSearch({ q }, 1);
      if (this.state.coords) return this.runSearch({ coords: this.state.coords }, 1);
      // Only "what": filter the recent list.
      if (activeKeyword || this.state.mode === 'recent') {
        this.setState({ loading: true, error: '', mode: 'recent', lastWhere: null, center: null });
        return this.loadRecent();
      }
      this.setState({ error: t('list.needWhere') });
      if (this.qInput) this.qInput.focus();
      return null;
    });
  }

  clearKeyword() {
    this.setState({ keyword: '', activeKeyword: '' }, () => {
      if (this.state.lastWhere) return this.runSearch(this.state.lastWhere, 1);
      this.setState({ loading: true });
      return this.loadRecent();
    });
  }

  useMyLocation() {
    if (!navigator.geolocation) return this.setState({ error: t('list.noGeo') });
    this.setState({ locating: true, error: '' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        this.setState({ coords, q: '', locating: false });
        this.runSearch({ coords }, 1);
      },
      () => this.setState({ locating: false, error: t('list.geoFailed') }),
      { timeout: 10000, maximumAge: 300000 }
    );
  }

  // Price filters re-run the current search (they need a center or text).
  changeFilter(patch) {
    this.setState(patch, () => { if (this.state.lastWhere && !priceFieldError(this.state.maxPrice, t('list.maxPrice'))) this.runSearch(this.state.lastWhere, 1); });
  }

  // When filter works on the recent list too (server-side ?when=).
  changeWhen(when) {
    this.setState({ when }, () => {
      if (this.state.lastWhere) return this.runSearch(this.state.lastWhere, 1);
      this.setState({ loading: true });
      return this.loadRecent();
    });
  }

  // "Neighborhood sales only": re-runs the search (server-side) or filters the recent list.
  changeNeighborhood(neighborhood) {
    this.setState({ neighborhood }, () => {
      if (this.state.lastWhere) return this.runSearch(this.state.lastWhere, 1);
      this.setState({ loading: true });
      return this.loadRecent();
    });
  }

  // "Free on the curb" works on both the search and the recent list (server-side).
  changeMarkdown(markdown) {
    this.setState({ markdown }, () => {
      if (this.state.lastWhere) return this.runSearch(this.state.lastWhere, 1);
      this.setState({ loading: true });
      return this.loadRecent();
    });
  }

  changeCurbside(curbside) {
    this.setState({ curbside }, () => {
      if (this.state.lastWhere) return this.runSearch(this.state.lastWhere, 1);
      this.setState({ loading: true });
      return this.loadRecent();
    });
  }

  changeRadius(radius) {
    this.setState({ radius }, () => { if (this.state.lastWhere) this.runSearch(this.state.lastWhere, 1); });
  }

  // Save the current distance search (center, radius, price filters and the
  // words searched for) as a saved search with alerts (lib/savedSearch.js).
  searchSpec() {
    const s = this.state;
    return { center: s.center, radius: s.resultRadius, filter: s.resultFilter || {}, keyword: s.activeKeyword, place: s.lastWhere && s.lastWhere.q };
  }
  searchKey() { return this.state.center ? searchKey(this.searchSpec()) : null; }

  alertHere() {
    const s = this.state;
    if (!s.center) return;
    const body = searchAlertBody(this.searchSpec());
    const key = this.searchKey();
    this.setState({ alertBusy: true });
    createAlert(body).then(({ ok, data }) => {
      if (!this.mounted) return;
      this.setState({ alertBusy: false, alertSavedFor: ok ? key : this.state.alertSavedFor });
      if (ok) toast.success(body.keyword ? t('list.searchSaved', { miles: body.radiusMiles }) : t('list.alertSaved', { miles: body.radiusMiles }));
      else toast.error(errorMessage(data, t('list.alertFailed')));
    }).catch(() => { if (this.mounted) this.setState({ alertBusy: false }); toast.error(t('common.networkShort')); });
  }

  renderAlertCta() {
    const s = this.state;
    const config = this.props.config || {};
    // Saved searches need an area (center + radius); the words are optional.
    if (config.saleAlerts === false || s.loading || s.mode !== 'distance' || !s.center) return null;
    if (!this.props.user) {
      return <Link className="btn btn-secondary btn-sm search-alert-cta" to="/login"><BellRing size={16} aria-hidden="true" />{t('list.loginForAlerts')}</Link>;
    }
    if (s.alertSavedFor && s.alertSavedFor === this.searchKey()) {
      return <Link className="btn btn-secondary btn-sm search-alert-cta" to="/settings#alerts"><Check size={16} aria-hidden="true" />{t('list.alertSavedBtn')}</Link>;
    }
    return (
      <button type="button" className="btn btn-secondary btn-sm search-alert-cta" onClick={this.alertHere} disabled={s.alertBusy}>
        {s.alertBusy ? <Spinner /> : <BellRing size={16} aria-hidden="true" />}{s.activeKeyword ? t('list.saveSearch') : t('list.alertMe')}
      </button>
    );
  }

  // Map -> list: highlight the card and bring it into view.
  select(id) {
    this.setState({ selectedId: id });
    const el = document.querySelector('[data-post-id="' + id + '"]');
    if (el && el.scrollIntoView && this.state.view === 'list') el.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
  }

  // List -> map: on phones, switch to the map first.
  showOnMap(id) {
    this.setState({ selectedId: id, view: 'map' });
  }

  clearSearch() {
    this.setState({ q: '', coords: null, lastWhere: null, notice: '', error: '', mode: 'recent', center: null, loading: true, results: [], keyword: '', activeKeyword: '', events: [] });
    this.loadRecent();
    this.loadRecentEvents();
  }

  renderResults() {
    const s = this.state;
    if (s.loading) return <SkeletonGrid count={4} />;
    if (!s.results.length) {
      if (s.activeKeyword && !s.error) {
        return (
          <EmptyState icon={SearchX} title={t('list.noKeyword', { keyword: s.activeKeyword })}
            action={<button type="button" className="btn btn-secondary" onClick={() => this.clearKeyword()}>{t('list.showAll')}</button>}>
            {s.mode === 'distance' ? t('list.noKeywordNear', { miles: s.resultRadius }) : t('list.tryFewer')}
          </EmptyState>
        );
      }
      if (s.curbside && !s.error) {
        return (
          <EmptyState icon={Gift} title={t('curb.none')}
            action={<button type="button" className="btn btn-secondary" onClick={() => this.changeCurbside(false)}>{t('curb.showAllSales')}</button>}>
            {t('curb.noneText')}
          </EmptyState>
        );
      }
      if (s.mode === 'recent' && !s.error && s.when) {
        const noneTitle = { now: 'list.noneOpenNow', today: 'list.noneToday', weekend: 'list.noneWeekend' }[s.when] || 'list.noneFound';
        return (
          <EmptyState icon={SearchX} title={t(noneTitle)}
            action={<button type="button" className="btn btn-secondary" onClick={() => this.changeWhen('')}>{t('list.showAllDates')}</button>}>
            {t('list.tryAnotherDay')}
          </EmptyState>
        );
      }
      if (s.mode === 'recent' && !s.error) {
        return (
          <EmptyState icon={Store} title={t('list.noneYet')}
            action={<Link to="/newpost" className="btn btn-primary"><Plus size={16} aria-hidden="true" />{t('list.postFirst')}</Link>}>
            {t('list.beFirst')}
          </EmptyState>
        );
      }
      return (
        <EmptyState icon={SearchX} title={t('list.noneFound')}
          action={s.mode === 'distance' && s.resultRadius < 50
            ? <button type="button" className="btn btn-secondary" onClick={() => this.changeRadius(50)}>{t('list.within50')}</button>
            : <button type="button" className="btn btn-secondary" onClick={() => this.clearSearch()}>{t('list.showRecent')}</button>}>
          {s.mode === 'distance' ? t('list.nothingWithin', { miles: s.resultRadius }) : t('list.tryOtherAddress')}
        </EmptyState>
      );
    }
    return (
      <React.Fragment>
        <div className="card-grid">
          {s.results.map((post) => <PostCard key={post.id} post={post} selected={post.id === s.selectedId} onShowOnMap={this.showOnMap} />)}
        </div>
        {s.mode !== 'recent' && s.totalPages > 1 ? (
          <nav className="pager search-pager" aria-label={t('list.pages')}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={s.page <= 1 || s.loading}
              onClick={() => this.runSearch(s.lastWhere, s.page - 1)}><ChevronLeft size={16} aria-hidden="true" />{t('common.prev')}</button>
            <span className="small muted">{t('common.pageOf', { page: s.page, total: s.totalPages })}</span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={s.page >= s.totalPages || s.loading}
              onClick={() => this.runSearch(s.lastWhere, s.page + 1)}>{t('common.next')}<ChevronRight size={16} aria-hidden="true" /></button>
          </nav>
        ) : null}
      </React.Fragment>
    );
  }

  render() {
    const s = this.state;
    const heading = s.mode === 'distance'
      ? t('list.withinHeading', { count: s.total, miles: s.resultRadius })
      : s.mode === 'text' ? t('list.matchingHeading', { count: s.total }) : t('list.recent');
    const f = s.mode !== 'recent' ? s.resultFilter : null;
    const priceNote = f && f.freeOnly ? t('list.noteFree') : f && f.maxPrice !== null && f.maxPrice !== undefined ? t('list.noteMax', { price: formatUSD(f.maxPrice) }) : '';
    const whenItem = WHEN_FILTERS.filter((w) => w.value && w.value === s.when)[0];
    const filterNote = priceNote + (whenItem ? ' · ' + t(whenItem.labelKey).toLocaleLowerCase() : '') + (s.activeKeyword ? ' · “' + s.activeKeyword + '”' : '') + (f && f.neighborhood ? ' · ' + t('ev.noteNeighborhood') : '') + (s.curbside ? ' · ' + t('curb.noteFilter') : '') + (s.markdown ? ' · ' + t('md.noteFilter') : '');
    const maxPriceError = priceFieldError(s.maxPrice, t('list.maxPrice'));
    return (
      <div className="container">
        <section className="hero">
          <h1>{t('list.heroTitle')}</h1>
          <p>{t('list.heroLead')}</p>
          <form className="search-bar map-search" onSubmit={this.handleSubmit} role="search" aria-label={t('list.searchSales')}>
            <div className="search-field search-field-what">
              <Package size={18} aria-hidden="true" />
              <label htmlFor="search-keyword" className="sr-only">{t('list.whatLabel')}</label>
              <input id="search-keyword" name="keyword" type="search" value={s.keyword} maxLength={KEYWORD_MAX}
                onChange={(e) => this.setState({ keyword: e.target.value })} placeholder={t('list.whatPlaceholder')} autoComplete="off" />
              {s.activeKeyword ? <button type="button" className="btn btn-ghost btn-icon btn-sm keyword-clear" aria-label={t('list.clearWhat')} onClick={() => this.clearKeyword()}><X size={14} aria-hidden="true" /></button> : null}
            </div>
            <div className="search-field">
              <Search size={18} aria-hidden="true" />
              <label htmlFor="search-q" className="sr-only">{t('list.whereLabel')}</label>
              <input id="search-q" name="q" type="search" value={s.q} maxLength={200} ref={(el) => { this.qInput = el; }}
                onChange={(e) => this.setState({ q: e.target.value })} placeholder={t('list.whereLabel')} autoComplete="postal-code" />
            </div>
            <div className="search-field search-field-radius">
              <Ruler size={18} aria-hidden="true" />
              <label htmlFor="search-radius" className="sr-only">{t('list.radius')}</label>
              <select id="search-radius" name="radius" value={s.radius} onChange={(e) => this.changeRadius(Number(e.target.value))}>
                {SEARCH_RADII.map((r) => <option key={r} value={r}>{t('list.withinMi', { miles: r })}</option>)}
              </select>
            </div>
            <div className="search-buttons">
              <button type="button" className="btn btn-secondary" onClick={this.useMyLocation} disabled={s.locating}>
                {s.locating ? <Spinner /> : <LocateFixed size={16} aria-hidden="true" />} {s.locating ? t('list.locating') : t('list.useLocation')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={s.loading && s.mode !== 'recent'}>
                <Search size={16} aria-hidden="true" />{t('common.search')}
              </button>
            </div>
          </form>
          <div className="search-filters" role="group" aria-label={t('list.priceFilters')}>
            <div className="search-field">
              <Tag size={16} aria-hidden="true" />
              <label htmlFor="search-max-price" className="small muted">{t('list.maxPriceLabel')}</label>
              <input id="search-max-price" name="maxPrice" type="text" inputMode="numeric" maxLength={7} placeholder={t('list.any')}
                value={s.maxPrice} disabled={s.freeOnly} aria-invalid={maxPriceError ? 'true' : undefined}
                aria-describedby={maxPriceError ? 'search-max-price-error' : 'search-max-price-hint'}
                onChange={(e) => this.setState({ maxPrice: e.target.value })}
                onBlur={() => this.changeFilter({})}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); this.changeFilter({}); } }} />
            </div>
            <label className="chip-toggle" htmlFor="search-free">
              <input id="search-free" name="free" type="checkbox" checked={s.freeOnly} onChange={(e) => this.changeFilter({ freeOnly: e.target.checked })} />
              {t('list.freeOnly')}
            </label>
            <label className="chip-toggle chip-toggle-curb" htmlFor="search-curbside">
              <input id="search-curbside" name="curbside" type="checkbox" checked={s.curbside} onChange={(e) => this.changeCurbside(e.target.checked)} />
              <Gift size={14} aria-hidden="true" />{t('curb.filter')}
            </label>
            <label className="chip-toggle chip-toggle-markdown" htmlFor="search-markdown">
              <input id="search-markdown" name="markdown" type="checkbox" checked={s.markdown} onChange={(e) => this.changeMarkdown(e.target.checked)} />
              <Percent size={14} aria-hidden="true" />{t('md.filter')}
            </label>
            <label className="chip-toggle" htmlFor="search-neighborhood">
              <input id="search-neighborhood" name="neighborhood" type="checkbox" checked={s.neighborhood} onChange={(e) => this.changeNeighborhood(e.target.checked)} />
              <UsersRound size={14} aria-hidden="true" />{t('ev.filter')}
            </label>
            <div className="segmented when-filter" role="group" aria-label={t('list.when')}>
              {WHEN_FILTERS.map((w) => (
                <button key={w.value || 'any'} type="button" aria-pressed={s.when === w.value} onClick={() => this.changeWhen(w.value)}>{t(w.labelKey)}</button>
              ))}
            </div>
            {maxPriceError
              ? <span className="field-error" id="search-max-price-error">{maxPriceError}</span>
              : <span className="field-hint" id="search-max-price-hint">{t('list.maxPriceHint')}</span>}
          </div>
        </section>

        {s.notice ? <Alert tone="warning" className="search-notice">{s.notice}</Alert> : null}
        {s.error ? <Alert tone="danger" className="search-error">{s.error}</Alert> : null}

        <div className="browse-toolbar">
          <h2 className="search-heading" aria-live="polite">{s.loading ? t('list.searching') : heading + filterNote}</h2>
          {this.renderAlertCta()}
          <div className="segmented view-toggle" role="group" aria-label={t('list.view')}>
            <button type="button" aria-pressed={s.view === 'list'} onClick={() => this.setState({ view: 'list' })}><List size={16} aria-hidden="true" />{t('list.list')}</button>
            <button type="button" aria-pressed={s.view === 'map'} onClick={() => this.setState({ view: 'map' })}><MapIcon size={16} aria-hidden="true" />{t('card.map')}</button>
          </div>
        </div>

        {s.events.length && !s.loading ? (
          <section className="event-strip" aria-labelledby="event-strip-title">
            <div className="event-strip-head">
              <h2 id="event-strip-title" className="h4"><UsersRound size={18} aria-hidden="true" />{s.mode === 'distance' ? t('ev.stripNear') : t('ev.stripUpcoming')}</h2>
              <Link className="small" to="/events">{t('ev.seeAll')}</Link>
            </div>
            <div className="event-strip-list">{s.events.map((e) => <EventCard key={e.id} event={e} compact />)}</div>
          </section>
        ) : null}

        <div className={'browse' + (s.view === 'map' ? ' show-map' : '')}>
          <section className="browse-list" aria-label={t('list.sales')}>{this.renderResults()}</section>
          <section className="browse-map" aria-label={t('card.map')}>
            <Map posts={s.results} events={s.mode === 'distance' ? s.events : null} onOpenEvent={(id) => this.props.history.push('/events/' + id)} user={this.props.user} config={this.props.config}
              center={s.mode === 'distance' ? s.center : null} radius={s.mode === 'distance' ? s.resultRadius : null}
              selectedId={s.selectedId} onSelect={this.select} />
          </section>
        </div>
      </div>
    );
  }
}

export default PostList;
