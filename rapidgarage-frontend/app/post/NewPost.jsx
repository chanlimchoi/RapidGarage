import React, { Component } from 'react';
import { Redirect } from 'react-router';
import { Link } from 'react-router-dom';
import { LogIn, Images } from 'lucide-react';
import { apiFetch, errorMessage, uploadPhotos, MAX_PHOTOS } from '../api';
import PhotoPicker from '../components/PhotoPicker';
import PostForm from './PostForm';
import { EmptyState } from '../components/ui';
import toast from '../components/toast';

class NewPost extends Component {
  constructor(props) {
    super(props);
    this.state = { created: false, createdId: null, photos: [], saving: false, error: '' };
    this.form = React.createRef();
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  componentDidMount() { this.mounted = true; }
  componentWillUnmount() { this.mounted = false; }

  handleSubmit(body) {
    // The server enforces login; this is just a friendlier early message.
    if (!this.props.user) {
      this.setState({ error: 'Please log in before creating a post.' });
      return;
    }
    this.setState({ saving: true, error: '' });
    apiFetch('/post', { method: 'POST', body: JSON.stringify(body) })
      .then(({ ok, data }) => {
        if (!ok) {
          if (this.form.current) this.form.current.setServerErrors(data);
          this.setState({ error: errorMessage(data, 'Could not create the post.') });
          return null;
        }
        if (!this.state.photos.length) {
          toast.success('Your sale is live.');
          this.setState({ created: true, createdId: data.id, error: '' });
          return null;
        }
        return uploadPhotos(data.id, this.state.photos).then((up) => {
          if (!up.ok) {
            // The post exists; send the user to edit it and retry the photos.
            toast.error('The post was created, but the photos could not be uploaded.');
            this.setState({ error: errorMessage(up.data, 'The post was created, but the photos could not be uploaded.'), createdId: data.id });
            return;
          }
          toast.success('Your sale is live with ' + this.state.photos.length + ' photo' + (this.state.photos.length === 1 ? '' : 's') + '.');
          this.setState({ created: true, createdId: data.id, error: '' });
        });
      })
      .catch(() => this.setState({ error: 'Unable to reach the server. Please try again.' }))
      .then(() => { if (this.mounted) this.setState({ saving: false }); });
  }

  render() {
    if (this.state.created) {
      return <Redirect to={this.state.createdId ? '/post/' + this.state.createdId : '/'} />;
    }
    if (this.props.ready && !this.props.user) {
      return (
        <div className="container container-narrow">
          <EmptyState icon={LogIn} title="Log in to post a sale"
            action={<div className="row" style={{ justifyContent: 'center' }}><Link className="btn btn-primary" to="/login">Log in</Link><Link className="btn btn-secondary" to="/signup">Create an account</Link></div>}>
            You need an account so buyers know who's selling and you can edit your listing later.
          </EmptyState>
        </div>
      );
    }
    return (
      <div className="container container-narrow">
        <header className="page-header">
          <div>
            <h1>Post a sale</h1>
            <p>Tell neighbors what you're selling, where and when.</p>
          </div>
        </header>
        <PostForm ref={this.form} autoFocus saving={this.state.saving} submitLabel="Publish sale" error={this.state.error}
          onSubmit={this.handleSubmit}
          footer={this.state.createdId && !this.state.created
            ? <p><Link to={'/post/' + this.state.createdId + '/edit'}>Edit the post to retry the photos</Link></p> : null}>
          <section className="card-form">
            <h2 className="h4"><Images size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />Photos</h2>
            <p className="muted small">Listings with photos get far more visitors. The first photo is the cover.</p>
            <PhotoPicker max={MAX_PHOTOS} onChange={(photos) => this.setState({ photos })} />
          </section>
        </PostForm>
      </div>
    );
  }
}

export default NewPost;
