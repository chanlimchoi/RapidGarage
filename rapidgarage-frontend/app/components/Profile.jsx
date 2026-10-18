import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, Eye, Store, LogIn, Settings as SettingsIcon } from 'lucide-react';
import { apiFetch, errorMessage } from '../api';
import PostCard from './PostCard';
import { EmptyState, SkeletonGrid } from './ui';
import { initials, displayName } from '../lib/format';
import toast from './toast';
import { t } from '../i18n';

// The signed-in user's profile and listings; the user comes from GET /me (via App).
class Profile extends Component {
  constructor(props) {
    super(props);
    this.state = { listResult: [], loading: true };
  }

  componentDidMount() {
    this.load();
  }

  componentDidUpdate(prevProps) {
    const prev = prevProps.user && prevProps.user.id;
    const cur = this.props.user && this.props.user.id;
    if (prev !== cur) this.load();
  }

  load() {
    const user = this.props.user;
    if (!user) {
      this.setState({ listResult: [], loading: !this.props.ready });
      return;
    }
    this.setState({ loading: true });
    apiFetch('/allbyuserId/' + user.id)
      .then(({ ok, data }) => this.setState({ loading: false, listResult: ok && Array.isArray(data) ? data : [] }))
      .catch(() => { this.setState({ loading: false, listResult: [] }); toast.error(t('profile.loadFailed')); });
  }

  deletePost(post) {
    if (!window.confirm(t('profile.confirmDelete', { title: post.title }))) return;
    apiFetch('/post/' + post.id, { method: 'DELETE' })
      .then(({ ok, data }) => {
        if (!ok) { toast.error(errorMessage(data, t('profile.deleteFailed'))); return; }
        toast.success(t('profile.deleted', { title: post.title }));
        this.setState({ listResult: this.state.listResult.filter((p) => p.id !== post.id) });
      })
      .catch(() => toast.error(t('common.network')));
  }

  render() {
    const user = this.props.user;
    if (!user) {
      if (!this.props.ready) return <div className="container"><SkeletonGrid count={3} className="card-grid-wide" /></div>;
      return (
        <div className="container container-narrow">
          <EmptyState level={1} icon={LogIn} title={t('profile.loginTitle')} action={<Link className="btn btn-primary" to="/login">{t('nav.logIn')}</Link>} />
        </div>
      );
    }
    const list = this.state.listResult;
    return (
      <div className="container">
        <section className="profile-hero">
          <span className="avatar" aria-hidden="true">{initials(user)}</span>
          <div>
            <h1>{displayName(user)}</h1>
            <p>{user.email}{user.role === 'admin' ? t('profile.adminSuffix') : ''}</p>
          </div>
          <div className="row">
            <Link className="btn btn-secondary" to="/settings"><SettingsIcon size={16} aria-hidden="true" />{t('nav.settings')}</Link>
            <Link className="btn btn-primary" to="/newpost"><Plus size={16} aria-hidden="true" />{t('nav.postSale')}</Link>
          </div>
        </section>
        <div className="browse-toolbar"><h2>{this.state.loading ? t('profile.yourListings') : t('profile.yourListingsCount', { count: list.length })}</h2></div>
        {this.state.loading ? <SkeletonGrid count={3} className="card-grid-wide" /> : list.length ? (
          <div className="card-grid card-grid-wide">
            {list.map((post) => (
              <PostCard key={post.id} post={post} actions={(
                <React.Fragment>
                  <Link className="btn btn-secondary btn-sm" to={'/post/' + post.id}><Eye size={14} aria-hidden="true" />{t('common.view')}</Link>
                  <Link className="btn btn-secondary btn-sm" to={'/post/' + post.id + '/edit'}><Pencil size={14} aria-hidden="true" />{t('common.edit')}</Link>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => this.deletePost(post)} aria-label={t('common.deleteNamed', { name: post.title })}><Trash2 size={14} aria-hidden="true" />{t('common.delete')}</button>
                </React.Fragment>
              )} />
            ))}
          </div>
        ) : (
          <EmptyState icon={Store} title={t('profile.emptyTitle')}
            action={<Link className="btn btn-primary" to="/newpost"><Plus size={16} aria-hidden="true" />{t('profile.firstSale')}</Link>}>
            {t('profile.emptyText')}
          </EmptyState>
        )}
      </div>
    );
  }
}

export default Profile;
