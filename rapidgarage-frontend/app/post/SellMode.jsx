import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, Undo2, Lock, SearchX, Search } from 'lucide-react';
import { apiFetch, errorMessage } from '../api';
import { EmptyState, SkeletonBlock, Spinner } from '../components/ui';
import { formatCents } from '../lib/items';
import { leftCount } from '../lib/whatsLeft';
import { timeAgo } from '../lib/format';
import toast from '../components/toast';
import { t } from '../i18n';

// /post/:id/sell: the seller's phone view during the sale. Big one-tap
// Sold / Available buttons, a filter box, and what's left. Each tap saves at
// once; buyers' open pages follow along (post/LiveItems.jsx).
class SellMode extends Component {
  constructor(props) {
    super(props);
    this.state = { post: null, loadError: '', filter: '', hideSold: false, busy: null };
  }

  componentDidMount() { this.load(); }

  load() {
    apiFetch('/post/' + encodeURIComponent(this.props.match.params.id)).then(({ ok, data }) => {
      if (!ok) return this.setState({ loadError: errorMessage(data, t('post.notFound')) });
      return this.setState({ post: data });
    }).catch(() => this.setState({ loadError: t('common.network') }));
  }

  toggle(item) {
    const post = this.state.post;
    this.setState({ busy: item.id });
    apiFetch('/post/' + post.id + '/items/' + item.id, { method: 'PUT', body: JSON.stringify({ sold: !item.sold }) }).then(({ ok, data }) => {
      this.setState({ busy: null });
      if (!ok) { toast.error(errorMessage(data, t('items.updateFailed'))); return; }
      const items = post.items.map((i) => (i.id === data.id ? Object.assign({}, i, { sold: data.sold, soldAt: data.soldAt, reserved: data.reserved }) : i));
      this.setState({ post: Object.assign({}, this.state.post, { items, itemsUpdatedAt: data.itemsUpdatedAt || this.state.post.itemsUpdatedAt }) });
      toast.success(data.sold ? t('items.markedSold', { name: data.name }) : t('items.availableAgain', { name: data.name }));
    }).catch(() => { this.setState({ busy: null }); toast.error(t('common.networkProblem')); });
  }

  render() {
    const { post, loadError, filter, hideSold, busy } = this.state;
    if (loadError) return <div className="container container-narrow"><EmptyState level={1} icon={SearchX} title={t('edit.cantLoad')} action={<Link className="btn btn-primary" to="/">{t('nav.browseSales')}</Link>}>{loadError}</EmptyState></div>;
    if (!post) return <div className="container container-narrow"><SkeletonBlock height={240} lines={4} /></div>;
    const user = this.props.user;
    if (this.props.ready && (!user || user.id !== post.userId)) {
      return <div className="container container-narrow"><EmptyState level={1} icon={Lock} title={t('items.onlySeller')} action={<Link className="btn btn-secondary" to={'/post/' + post.id}>{t('edit.backToSale')}</Link>}>{t('items.managedBySeller')}</EmptyState></div>;
    }
    const items = (post.items || []).slice().sort((a, b) => a.position - b.position || a.id - b.id);
    const c = leftCount(items);
    const q = filter.trim().toLowerCase();
    const shown = items.filter((i) => (!hideSold || !i.sold) && (!q || i.name.toLowerCase().indexOf(q) >= 0));
    return (
      <div className="container container-narrow sell-mode">
        <Link to={'/post/' + post.id} className="back-link"><ArrowLeft size={16} aria-hidden="true" />{t('edit.backToSale')}</Link>
        <header className="page-header">
          <div>
            <h1>{t('left.sellTitle')}</h1>
            <p>{post.title}</p>
            <p className="small" aria-live="polite">{t('left.count', { count: c.left, total: c.total })}{post.itemsUpdatedAt ? ' · ' + t('left.updated', { when: timeAgo(post.itemsUpdatedAt) }) : ''}</p>
          </div>
        </header>
        <p className="small muted">{t('left.sellLead')}</p>
        <div className="sell-mode-tools">
          <label className="search-field" htmlFor="sell-filter">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">{t('left.filter')}</span>
            <input id="sell-filter" type="search" value={filter} placeholder={t('left.filter')} onChange={(e) => this.setState({ filter: e.target.value })} autoComplete="off" />
          </label>
          <label className="checkbox-row small" htmlFor="sell-hide-sold">
            <input id="sell-hide-sold" type="checkbox" role="switch" checked={hideSold} onChange={(e) => this.setState({ hideSold: e.target.checked })} />
            {t('items.hideSold')}
          </label>
        </div>
        {!items.length ? <EmptyState icon={SearchX} title={t('left.noItems')} action={<Link className="btn btn-primary" to={'/post/' + post.id + '/items'}>{t('post.addItems')}</Link>} /> : null}
        <ul className="sell-list">
          {shown.map((item) => (
            <li key={item.id} className={'sell-row' + (item.sold ? ' is-sold' : '')}>
              <span className="sell-name">{item.name}{item.priceCents !== null && item.priceCents !== undefined ? <span className="muted small"> · {formatCents(item.priceCents)}</span> : null}
                {item.reserved && !item.sold ? <span className="chip chip-muted">{t('items.reserved')}</span> : null}</span>
              <button type="button" className={'btn sell-toggle ' + (item.sold ? 'btn-secondary' : 'btn-primary')} disabled={busy === item.id} aria-pressed={!!item.sold}
                onClick={() => this.toggle(item)}>
                {busy === item.id ? <Spinner /> : item.sold ? <Undo2 size={18} aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}
                {item.sold ? t('left.markAvailable') : t('items.markSold')}
                <span className="sr-only">: {item.name}</span>
              </button>
            </li>
          ))}
        </ul>
        {items.length && !shown.length ? <p className="muted">{t('left.noneShown')}</p> : null}
      </div>
    );
  }
}

export default SellMode;
