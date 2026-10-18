import React, { Component } from 'react';
import { Redirect } from 'react-router';
import { Link } from 'react-router-dom';
import { LogIn, Images } from 'lucide-react';
import { apiFetch, errorMessage, uploadPhotos, MAX_PHOTOS } from '../api';
import PhotoPicker from '../components/PhotoPicker';
import PostForm from './PostForm';
import { EmptyState } from '../components/ui';
import toast from '../components/toast';
import { t } from '../i18n';

class NewPost extends Component {
  constructor(props) {
    super(props);
    this.state = { created: false, createdId: null, photos: [], alts: [], saving: false, error: '' };
    this.form = React.createRef();
    this.handleSubmit = this.handleSubmit.bind(this);
  }

  componentDidMount() { this.mounted = true; }
  componentWillUnmount() { this.mounted = false; }

  handleSubmit(body) {
    // The server enforces login; this is just a friendlier early message.
    if (!this.props.user) {
      this.setState({ error: t('new.loginFirst') });
      return;
    }
    this.setState({ saving: true, error: '' });
    apiFetch('/post', { method: 'POST', body: JSON.stringify(body) })
      .then(({ ok, data }) => {
        if (!ok) {
          if (this.form.current) this.form.current.setServerErrors(data);
          this.setState({ error: errorMessage(data, t('new.createFailed')) });
          return null;
        }
        if (!this.state.photos.length) {
          toast.success(t('new.live'));
          this.setState({ created: true, createdId: data.id, error: '' });
          return null;
        }
        return uploadPhotos(data.id, this.state.photos, this.state.alts).then((up) => {
          if (!up.ok) {
            // The post exists; send the user to edit it and retry the photos.
            toast.error(t('new.photosFailed'));
            this.setState({ error: errorMessage(up.data, t('new.photosFailed')), createdId: data.id });
            return;
          }
          toast.success(t('new.liveWithPhotos', { count: this.state.photos.length }));
          this.setState({ created: true, createdId: data.id, error: '' });
        });
      })
      .catch(() => this.setState({ error: t('common.network') }))
      .then(() => { if (this.mounted) this.setState({ saving: false }); });
  }

  render() {
    if (this.state.created) {
      return <Redirect to={this.state.createdId ? '/post/' + this.state.createdId : '/'} />;
    }
    if (this.props.ready && !this.props.user) {
      return (
        <div className="container container-narrow">
          <EmptyState level={1} icon={LogIn} title={t('new.loginTitle')}
            action={<div className="row" style={{ justifyContent: 'center' }}><Link className="btn btn-primary" to="/login">{t('nav.logIn')}</Link><Link className="btn btn-secondary" to="/signup">{t('new.createAccount')}</Link></div>}>
            {t('new.loginText')}
          </EmptyState>
        </div>
      );
    }
    return (
      <div className="container container-narrow">
        <header className="page-header">
          <div>
            <h1>{t('nav.postSale')}</h1>
            <p>{t('new.lead')}</p>
          </div>
        </header>
        <PostForm ref={this.form} autoFocus saving={this.state.saving} submitLabel={t('new.publish')} error={this.state.error}
          onSubmit={this.handleSubmit}
          footer={this.state.createdId && !this.state.created
            ? <p><Link to={'/post/' + this.state.createdId + '/edit'}>{t('new.retryPhotos')}</Link></p> : null}>
          <section className="card-form">
            <h2 className="h4"><Images size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />{t('post.photos')}</h2>
            <p className="muted small">{t('new.photosLead')}</p>
            <PhotoPicker max={MAX_PHOTOS} onChange={(photos, alts) => this.setState({ photos, alts })} />
          </section>
        </PostForm>
      </div>
    );
  }
}

export default NewPost;
