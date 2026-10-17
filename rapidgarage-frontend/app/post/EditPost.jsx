import React, { Component } from 'react';
import { Redirect } from 'react-router';
import { Link } from 'react-router-dom';
import { ArrowLeft, X, Lock, SearchX } from 'lucide-react';
import { apiFetch, errorMessage, uploadPhotos, deletePhoto, canEditPost, MAX_PHOTOS } from '../api';
import PhotoPicker from '../components/PhotoPicker';
import PostForm from './PostForm';
import { EmptyState, SkeletonBlock } from '../components/ui';
import toast from '../components/toast';
import { t } from '../i18n';

// Edit a post's text and manage its photos (owner or admin).
class EditPost extends Component {
  constructor(props) {
    super(props);
    this.state = { post: null, error: '', loadError: '', newPhotos: [], saving: false, done: false };
    this.form = React.createRef();
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  componentDidMount() { this.load(); }

  id() { return this.props.match.params.id; }

  load() {
    return apiFetch('/post/' + encodeURIComponent(this.id()))
      .then(({ ok, data }) => this.setState(ok ? { post: data, loadError: '' } : { loadError: errorMessage(data, t('post.notFound')) }))
      .catch(() => this.setState({ loadError: t('common.network') }));
  }

  removePhoto(photo, index) {
    if (!window.confirm(t('edit.confirmDeletePhoto', { n: index + 1 }))) return;
    deletePhoto(this.state.post.id, photo.id).then(({ ok, data }) => {
      if (!ok) { toast.error(errorMessage(data, t('edit.deletePhotoFailed'))); return; }
      toast.success(t('edit.photoDeleted'));
      this.setState({ post: Object.assign({}, this.state.post, { photos: this.state.post.photos.filter((p) => p.id !== photo.id) }) });
    }).catch(() => toast.error(t('common.network')));
  }

  handleSubmit(body) {
    const post = this.state.post;
    this.setState({ saving: true, error: '' });
    const own = this.props.user && this.props.user.id === post.userId;
    // Editing text is owner-only on the server; admins can still manage photos.
    const saveText = own && body ? apiFetch('/post/' + post.id, { method: 'PUT', body: JSON.stringify(body) }) : Promise.resolve({ ok: true });
    saveText
      .then((r) => {
        if (!r.ok) {
          if (this.form.current) this.form.current.setServerErrors(r.data);
          throw new Error(errorMessage(r.data, t('edit.saveFailed')));
        }
        if (!this.state.newPhotos.length) return null;
        return uploadPhotos(post.id, this.state.newPhotos).then((up) => {
          if (!up.ok) throw new Error(errorMessage(up.data, t('edit.uploadFailed')));
        });
      })
      .then(() => { toast.success(t('edit.saved')); this.setState({ done: true }); })
      .catch((err) => this.setState({ error: err.message || t('common.wentWrong'), saving: false }));
  }

  render() {
    const { post, loadError } = this.state;
    if (this.state.done) return <Redirect to={'/post/' + post.id} />;
    if (loadError) {
      return <div className="container container-narrow"><EmptyState icon={SearchX} title={t('edit.cantLoad')} action={<Link className="btn btn-primary" to="/">{t('nav.browseSales')}</Link>}>{loadError}</EmptyState></div>;
    }
    if (!post) return <div className="container container-narrow"><SkeletonBlock height={320} lines={4} /></div>;
    if (!canEditPost(this.props.user, post)) {
      return <div className="container container-narrow"><EmptyState icon={Lock} title={t('edit.cantEdit')} action={<Link className="btn btn-secondary" to={'/post/' + post.id}>{t('edit.backToSale')}</Link>}>{t('edit.onlyOwner')}</EmptyState></div>;
    }
    const photos = post.photos || [];
    const remaining = MAX_PHOTOS - photos.length;
    const own = this.props.user && this.props.user.id === post.userId;
    return (
      <div className="container container-narrow">
        <Link to={'/post/' + post.id} className="back-link"><ArrowLeft size={16} aria-hidden="true" />{t('edit.backToSale')}</Link>
        <header className="page-header"><div><h1>{t('edit.title')}</h1><p>{post.title}</p></div></header>
        <PostForm ref={this.form} post={post} textDisabled={!own} saving={this.state.saving} submitLabel={t('edit.saveChanges')}
          error={this.state.error} onSubmit={this.handleSubmit}
          cancel={<Link className="btn btn-ghost btn-lg" to={'/post/' + post.id}>{t('common.cancel')}</Link>}>
          <section className="card-form">
            <h2 className="h4">{t('post.photos')} <span className="muted small">({photos.length}/{MAX_PHOTOS})</span></h2>
            {photos.length ? (
              <div className="photo-grid existing-photos" style={{ marginBottom: 16 }}>
                {photos.map((p, i) => (
                  <div key={p.id} className="photo-tile existing-photo">
                    <img src={p.thumbUrl} alt={t('edit.photoAlt', { n: i + 1 })} />
                    {i === 0 ? <span className="chip photo-cover">{t('edit.cover')}</span> : null}
                    <button type="button" className="btn photo-remove" aria-label={t('edit.deletePhoto', { n: i + 1 })} onClick={() => this.removePhoto(p, i)}><X size={16} aria-hidden="true" /></button>
                  </div>
                ))}
              </div>
            ) : <p className="muted small">{t('edit.noPhotos')}</p>}
            {remaining > 0
              ? <PhotoPicker key={remaining} max={remaining} onChange={(newPhotos) => this.setState({ newPhotos })} />
              : <p className="muted small">{t('edit.maxPhotos', { max: MAX_PHOTOS })}</p>}
          </section>
          {own ? (
            <section className="card-form">
              <h2 className="h4">{t('edit.items')}</h2>
              <p className="muted small">{(post.items || []).length ? t('edit.onList', { count: post.items.length }) : ''}{t('edit.itemsLead')}</p>
              <div><Link className="btn btn-secondary" to={'/post/' + post.id + '/items'}>{(post.items || []).length ? t('post.editItems') : t('post.addItems')}</Link></div>
            </section>
          ) : null}
        </PostForm>
      </div>
    );
  }
}

export default EditPost;
