import React from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, LocateFixed, X, PackageSearch, Check } from 'lucide-react';
import { errorMessage, fetchWantedBoard, fetchMyWanted, SEARCH_RADII } from '../api';
import { Alert, EmptyState, SkeletonGrid, Spinner } from '../components/ui';
import { CATEGORIES } from '../lib/wanted';
import WantedCard, { categoryLabel } from './WantedCard';
import toast from '../components/toast';
import { t } from '../i18n';

// /wanted: the public board of what neighbors are looking for, newest first
// (nearest first when "near me" is on), plus my own wanted posts.
export default class WantedBoard extends React.Component {
  constructor(props) {
    super(props);
    this.state = { board: null, total: 0, page: 1, enabled: true, mine: null, limits: null, error: '', q: '', category: '', near: null, radius: 10, locating: false, loadingMore: false };
  }

  componentDidMount() { this.mounted = true; this.load(); this.loadMine(); }
  componentWillUnmount() { this.mounted = false; }
  componentDidUpdate(prev) { if ((prev.user || {}).id !== (this.props.user || {}).id) { this.load(); this.loadMine(); } }

  params(page) {
    const s = this.state;
    const p = { page: page > 1 ? page : undefined, q: s.q.trim() || undefined, category: s.category || undefined };
    if (s.near) Object.assign(p, { lat: s.near.lat, lng: s.near.lng, radius: s.radius });
    return p;
  }

  load(page) {
    const more = page > 1;
    this.setState(more ? { loadingMore: true } : { board: null, error: '' });
    fetchWantedBoard(this.params(page)).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) { this.setState({ board: [], loadingMore: false, error: errorMessage(data, t('want.loadFailed')) }); return; }
      this.setState({ board: more ? (this.state.board || []).concat(data.results) : data.results, total: data.total, page: data.page, enabled: data.enabled, loadingMore: false });
    }).catch(() => this.mounted && this.setState({ board: [], loadingMore: false, error: t('common.network') }));
  }

  loadMine() {
    if (!this.props.user) { this.setState({ mine: null }); return; }
    fetchMyWanted().then(({ ok, data }) => this.mounted && ok && this.setState({ mine: data.results, limits: data.limits })).catch(() => null);
  }

  locate() {
    if (this.state.near) { this.setState({ near: null }, () => this.load()); return; }
    if (!navigator.geolocation) { toast.error(t('list.noGeo')); return; }
    this.setState({ locating: true });
    navigator.geolocation.getCurrentPosition(
      (pos) => this.mounted && this.setState({ locating: false, near: { lat: pos.coords.latitude, lng: pos.coords.longitude } }, () => this.load()),
      () => { if (this.mounted) this.setState({ locating: false }); toast.error(t('list.geoFailed')); },
      { timeout: 10000, maximumAge: 300000 }
    );
  }

  search(e) { e.preventDefault(); this.load(); }
  clear() { this.setState({ q: '', category: '', near: null }, () => this.load()); }

  render() {
    const s = this.state;
    const filtered = !!(s.q.trim() || s.category || s.near);
    const full = s.limits && s.limits.active >= s.limits.maxActive;
    const newCta = <Link className="btn btn-primary" to="/wanted/new" aria-disabled={full || !s.enabled ? 'true' : undefined} onClick={(e) => { if (full) { e.preventDefault(); toast.info(t('want.limitNote', { max: s.limits.maxActive })); } }}><Plus size={16} aria-hidden="true" />{t('want.postCta')}</Link>;
    return (
      <div className="container wanted-board">
        <header className="page-header page-header-row">
          <div>
            <h1>{t('want.boardTitle')}</h1>
            <p className="muted">{t('want.boardLead')}</p>
          </div>
          {s.enabled ? newCta : null}
        </header>
        {!s.enabled ? <Alert tone="warning" live={false}>{t('want.siteOff')}</Alert> : null}
        {error(s.error)}
        {s.mine && s.mine.length ? (
          <section aria-labelledby="wanted-mine" className="events-section">
            <h2 id="wanted-mine" className="h4">{t('want.mineTitle')} <span className="small muted">{t('want.activeCount', { n: s.limits.active, max: s.limits.maxActive })}</span></h2>
            <div className="event-grid">
              {s.mine.map((w) => <WantedCard key={w.id} wanted={w} extra={w.newMatches ? <p className="small"><Link to={'/wanted/' + w.id} className="chip chip-brand">{t('want.newMatches', { count: w.newMatches })}</Link></p> : null} />)}
            </div>
          </section>
        ) : null}
        {s.enabled ? (
          <section aria-labelledby="wanted-all" className="events-section">
            <h2 id="wanted-all" className="h4">{t('want.allTitle')}</h2>
            <form className="wanted-filters" role="search" onSubmit={(e) => this.search(e)}>
              <label className="sr-only" htmlFor="wanted-q">{t('want.searchLabel')}</label>
              <div className="wanted-search">
                <Search size={16} aria-hidden="true" />
                <input id="wanted-q" className="input" type="search" value={s.q} placeholder={t('want.searchPlaceholder')} onChange={(e) => this.setState({ q: e.target.value })} />
              </div>
              <label className="sr-only" htmlFor="wanted-cat">{t('want.category')}</label>
              <select id="wanted-cat" className="select" value={s.category} onChange={(e) => this.setState({ category: e.target.value }, () => this.load())}>
                <option value="">{t('want.anyCategory')}</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
              </select>
              <button type="button" className="btn btn-secondary" aria-pressed={!!s.near} onClick={() => this.locate()} disabled={s.locating}>
                {s.locating ? <Spinner /> : s.near ? <Check size={16} aria-hidden="true" /> : <LocateFixed size={16} aria-hidden="true" />}{t('want.nearMe')}
              </button>
              {s.near ? (
                <React.Fragment>
                  <label className="sr-only" htmlFor="wanted-radius">{t('want.radius')}</label>
                  <select id="wanted-radius" className="select" value={s.radius} onChange={(e) => this.setState({ radius: Number(e.target.value) }, () => this.load())}>
                    {SEARCH_RADII.map((r) => <option key={r} value={r}>{t('want.withinMiles', { miles: r })}</option>)}
                  </select>
                </React.Fragment>
              ) : null}
              <button type="submit" className="btn btn-primary">{t('want.search')}</button>
              {filtered ? <button type="button" className="btn btn-ghost" onClick={() => this.clear()}><X size={16} aria-hidden="true" />{t('want.clear')}</button> : null}
            </form>
            {s.board === null ? <SkeletonGrid count={3} /> : s.board.length ? (
              <React.Fragment>
                <p className="small muted" aria-live="polite">{t('want.resultCount', { count: s.total })}</p>
                <div className="event-grid">{s.board.map((w) => <WantedCard key={w.id} wanted={w} />)}</div>
                {s.board.length < s.total ? (
                  <div className="row"><button type="button" className="btn btn-secondary" onClick={() => this.load(s.page + 1)} disabled={s.loadingMore}>{s.loadingMore ? <Spinner /> : null}{t('want.more')}</button></div>
                ) : null}
              </React.Fragment>
            ) : (
              <EmptyState icon={PackageSearch} title={filtered ? t('want.noResults') : t('want.noneTitle')} action={filtered ? null : newCta}>{filtered ? t('want.noResultsText') : t('want.noneText')}</EmptyState>
            )}
          </section>
        ) : null}
      </div>
    );
  }
}

function error(msg) { return msg ? <Alert tone="danger">{msg}</Alert> : null; }
