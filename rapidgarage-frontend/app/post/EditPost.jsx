import React, { Component } from 'react';
import { Redirect } from 'react-router';
import { apiFetch, errorMessage, uploadPhotos, deletePhoto, canEditPost, MAX_PHOTOS } from '../api';
import PhotoPicker from '../components/PhotoPicker';

// Edit a post's text and manage its photos (owner or admin).
class EditPost extends Component {
  constructor(props) {
    super(props);
    this.state = { post: null, error: '', newPhotos: [], pickerKey: 0, saving: false, done: false };
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  componentDidMount() { this.load(); }

  id() { return this.props.match.params.id; }

  load() {
    return apiFetch('/post/' + encodeURIComponent(this.id()))
      .then(({ ok, data }) => this.setState(ok ? { post: data, error: '' } : { error: errorMessage(data, 'Post not found.') }))
      .catch(() => this.setState({ error: 'Unable to reach the server. Please try again.' }));
  }

  removePhoto(photo) {
    deletePhoto(this.state.post.id, photo.id).then(({ ok, data }) => {
      if (!ok) return this.setState({ error: errorMessage(data, 'Could not delete the photo.') });
      this.setState({ post: Object.assign({}, this.state.post, { photos: this.state.post.photos.filter((p) => p.id !== photo.id) }) });
    });
  }

  handleSubmit(e) {
    e.preventDefault();
    const post = this.state.post;
    const body = {
      title: this.refs.title.value,
      street: this.refs.address.value,
      city: this.refs.city.value,
      zipCode: this.refs.zipcode.value,
      description: this.refs.description.value,
    };
    this.setState({ saving: true, error: '' });
    const own = this.props.user && this.props.user.id === post.userId;
    // Editing text is owner-only on the server; admins can still manage photos.
    const saveText = own ? apiFetch('/post/' + post.id, { method: 'PUT', body: JSON.stringify(body) }) : Promise.resolve({ ok: true });
    saveText
      .then((r) => {
        if (!r.ok) throw new Error(errorMessage(r.data, 'Could not save the post.'));
        if (!this.state.newPhotos.length) return null;
        return uploadPhotos(post.id, this.state.newPhotos).then((up) => {
          if (!up.ok) throw new Error(errorMessage(up.data, 'Could not upload the photos.'));
        });
      })
      .then(() => this.setState({ done: true }))
      .catch((err) => this.setState({ error: err.message || 'Something went wrong.', saving: false }));
  }

  render() {
    const { post, error } = this.state;
    if (this.state.done) return <Redirect to={'/post/' + post.id} />;
    if (!post) return <div className="col-sm-9">{error ? <p className="text-danger">{error}</p> : <p>Loading…</p>}</div>;
    if (!canEditPost(this.props.user, post)) return <div className="col-sm-9"><p className="text-danger">Only the post's owner or an admin can edit it.</p></div>;
    const photos = post.photos || [];
    const remaining = MAX_PHOTOS - photos.length;
    return (
      <div className="col-sm-9">
        <h2>Edit post</h2>
        <form onSubmit={this.handleSubmit}>
          <div className="input-group"><span className="input-group-addon">Title:</span>
            <input className="form-control" id="title" type="text" ref="title" defaultValue={post.title} required /></div>
          <br />
          <div className="input-group"><span className="input-group-addon">Address:</span>
            <input className="form-control" id="address" type="text" ref="address" defaultValue={post.street} required /></div>
          <div className="input-group"><span className="input-group-addon">City:</span>
            <input className="form-control" id="city" type="text" ref="city" defaultValue={post.city} required /></div>
          <div className="input-group"><span className="input-group-addon">ZipCode:</span>
            <input className="form-control" id="zipcode" type="text" ref="zipcode" defaultValue={post.zipCode} required /></div>
          <br />
          <div className="input-group"><span className="input-group-addon">Description:</span>
            <textarea className="form-control" rows="6" id="description" ref="description" defaultValue={post.description}></textarea></div>
          <br />
          <h4>Photos ({photos.length}/{MAX_PHOTOS})</h4>
          <div className="existing-photos" style={{ display: 'flex', flexWrap: 'wrap' }}>
            {photos.map((p, i) => (
              <div key={p.id} className="existing-photo" style={{ position: 'relative', marginRight: 8, marginBottom: 8 }}>
                <img src={p.thumbUrl} alt={'Photo ' + (i + 1)} style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 4 }} />
                <button type="button" className="btn btn-xs btn-danger" aria-label={'Delete photo ' + (i + 1)}
                  style={{ position: 'absolute', top: 2, right: 2 }} onClick={() => this.removePhoto(p)}>×</button>
              </div>
            ))}
          </div>
          {remaining > 0 ? <PhotoPicker key={remaining} max={remaining} onChange={(newPhotos) => this.setState({ newPhotos })} /> : <p className="text-muted">This post has the maximum of {MAX_PHOTOS} photos.</p>}
          {error ? <p className="text-danger">{error}</p> : null}
          <button type="submit" className="btn btn-info" disabled={this.state.saving}>{this.state.saving ? 'Saving…' : 'Save'}</button>
        </form>
      </div>
    );
  }
}

export default EditPost;
