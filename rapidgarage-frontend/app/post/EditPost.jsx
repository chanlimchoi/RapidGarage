import React, { Component } from 'react';
import { Redirect } from 'react-router';
import { Link } from 'react-router-dom';
import { ArrowLeft, X, Lock, SearchX } from 'lucide-react';
import { apiFetch, errorMessage, uploadPhotos, deletePhoto, canEditPost, MAX_PHOTOS } from '../api';
import PhotoPicker from '../components/PhotoPicker';
import PostForm from './PostForm';
import { EmptyState, SkeletonBlock } from '../components/ui';
import toast from '../components/toast';

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
      .then(({ ok, data }) => this.setState(ok ? { post: data, loadError: '' } : { loadError: errorMessage(data, 'Post not found.') }))
      .catch(() => this.setState({ loadError: 'Unable to reach the server. Please try again.' }));
  }

  removePhoto(photo, index) {
    if (!window.confirm('Delete photo ' + (index + 1) + '? This cannot be undone.')) return;
    deletePhoto(this.state.post.id, photo.id).then(({ ok, data }) => {
      if (!ok) { toast.error(errorMessage(data, 'Could not delete the photo.')); return; }
      toast.success('Photo deleted.');
      this.setState({ post: Object.assign({}, this.state.post, { photos: this.state.post.photos.filter((p) => p.id !== photo.id) }) });
    }).catch(() => toast.error('Unable to reach the server. Please try again.'));
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
          throw new Error(errorMessage(r.data, 'Could not save the post.'));
        }
        if (!this.state.newPhotos.length) return null;
        return uploadPhotos(post.id, this.state.newPhotos).then((up) => {
          if (!up.ok) throw new Error(errorMessage(up.data, 'Could not upload the photos.'));
        });
      })
      .then(() => { toast.success('Changes saved.'); this.setState({ done: true }); })
      .catch((err) => this.setState({ error: err.message || 'Something went wrong.', saving: false }));
  }

  render() {
    const { post, loadError } = this.state;
    if (this.state.done) return <Redirect to={'/post/' + post.id} />;
    if (loadError) {
      return <div className="container container-narrow"><EmptyState icon={SearchX} title="We couldn't load that sale" action={<Link className="btn btn-primary" to="/">Browse sales</Link>}>{loadError}</EmptyState></div>;
    }
    if (!post) return <div className="container container-narrow"><SkeletonBlock height={320} lines={4} /></div>;
    if (!canEditPost(this.props.user, post)) {
      return <div className="container container-narrow"><EmptyState icon={Lock} title="You can't edit this sale" action={<Link className="btn btn-secondary" to={'/post/' + post.id}>Back to the sale</Link>}>Only the post's owner or an admin can edit it.</EmptyState></div>;
    }
    const photos = post.photos || [];
    const remaining = MAX_PHOTOS - photos.length;
    const own = this.props.user && this.props.user.id === post.userId;
    return (
      <div className="container container-narrow">
        <Link to={'/post/' + post.id} className="back-link"><ArrowLeft size={16} aria-hidden="true" />Back to the sale</Link>
        <header className="page-header"><div><h1>Edit sale</h1><p>{post.title}</p></div></header>
        <PostForm ref={this.form} post={post} textDisabled={!own} saving={this.state.saving} submitLabel="Save changes"
          error={this.state.error} onSubmit={this.handleSubmit}
          cancel={<Link className="btn btn-ghost btn-lg" to={'/post/' + post.id}>Cancel</Link>}>
          <section className="card-form">
            <h2 className="h4">Photos <span className="muted small">({photos.length}/{MAX_PHOTOS})</span></h2>
            {photos.length ? (
              <div className="photo-grid existing-photos" style={{ marginBottom: 16 }}>
                {photos.map((p, i) => (
                  <div key={p.id} className="photo-tile existing-photo">
                    <img src={p.thumbUrl} alt={'Photo ' + (i + 1)} />
                    {i === 0 ? <span className="chip photo-cover">Cover</span> : null}
                    <button type="button" className="btn photo-remove" aria-label={'Delete photo ' + (i + 1)} onClick={() => this.removePhoto(p, i)}><X size={16} aria-hidden="true" /></button>
                  </div>
                ))}
              </div>
            ) : <p className="muted small">No photos yet.</p>}
            {remaining > 0
              ? <PhotoPicker key={remaining} max={remaining} onChange={(newPhotos) => this.setState({ newPhotos })} />
              : <p className="muted small">This post has the maximum of {MAX_PHOTOS} photos.</p>}
          </section>
        </PostForm>
      </div>
    );
  }
}

export default EditPost;
