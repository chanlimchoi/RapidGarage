import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch, errorMessage, canEditPost } from '../api';

// GET /post/:id with a simple photo gallery.
class Post extends Component {
  constructor(props) {
    super(props);
    this.state = { post: null, error: '', active: 0 };
  }

  componentDidMount() { this.load(); }

  componentDidUpdate(prev) {
    if (prev.match.params.id !== this.props.match.params.id) this.load();
  }

  load() {
    apiFetch('/post/' + encodeURIComponent(this.props.match.params.id))
      .then(({ ok, data }) => {
        if (!ok) return this.setState({ post: null, error: errorMessage(data, 'Post not found.') });
        this.setState({ post: data, error: '', active: 0 });
      })
      .catch(() => this.setState({ error: 'Unable to reach the server. Please try again.' }));
  }

  render() {
    const { post, error, active } = this.state;
    if (error) return <div className="col-sm-9"><p className="text-danger">{error}</p></div>;
    if (!post) return <div className="col-sm-9"><p>Loading…</p></div>;
    const photos = post.photos || [];
    const current = photos[Math.min(active, photos.length - 1)];
    return (
      <div className="col-sm-9">
        <article>
          <h1>{post.title}</h1>
          <h5><span className="glyphicon glyphicon-time"></span> Posted {new Date(post.createdAt).toLocaleDateString()}</h5>
          {current ? (
            <div className="post-gallery">
              <a href={current.url} target="_blank" rel="noopener noreferrer">
                <img src={current.url} alt={post.title + ' photo ' + (active + 1)} className="gallery-main"
                  style={{ maxWidth: '100%', maxHeight: 480, borderRadius: 4 }} />
              </a>
              {photos.length > 1 ? (
                <div className="gallery-thumbs" style={{ display: 'flex', marginTop: 8 }}>
                  {photos.map((p, i) => (
                    <button key={p.id} type="button" onClick={() => this.setState({ active: i })} aria-label={'Show photo ' + (i + 1)}
                      style={{ border: i === active ? '2px solid #31b0d5' : '2px solid transparent', padding: 0, marginRight: 6, background: 'none' }}>
                      <img src={p.thumbUrl} alt="" style={{ width: 80, height: 80, objectFit: 'cover' }} />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <p>Location: {[post.street, post.city, post.state, post.zipCode].filter(Boolean).join(', ')}</p>
          {post.startDate ? <h4>Sale begins {new Date(post.startDate).toLocaleDateString()}</h4> : null}
          {post.endDate ? <h4>Ends {new Date(post.endDate).toLocaleDateString()}</h4> : null}
          <p style={{ whiteSpace: 'pre-wrap' }}>{post.description}</p>
          {canEditPost(this.props.user, post) ? <Link className="btn btn-default" to={'/post/' + post.id + '/edit'}>Edit post &amp; photos</Link> : null}
        </article>
      </div>
    );
  }
}

export default Post;
