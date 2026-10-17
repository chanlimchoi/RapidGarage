import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, MapPin, CalendarDays, Clock, Pencil, ImageOff, Navigation, ExternalLink, SearchX, Tag } from 'lucide-react';
import { apiFetch, errorMessage, canEditPost } from '../api';
import { addressLine, saleWhen, saleStatus, timeAgo } from '../lib/format';
import { formatPrice } from '../lib/price';
import { EmptyState, SkeletonBlock } from '../components/ui';

// GET /post/:id with a photo gallery and a details sidebar.
class Post extends Component {
  constructor(props) {
    super(props);
    this.state = { post: null, error: '', active: 0 };
    this.onKey = this.onKey.bind(this);
  }

  componentDidMount() { this.load(); }

  componentDidUpdate(prev) {
    if (prev.match.params.id !== this.props.match.params.id) this.load();
  }

  load() {
    this.setState({ post: null, error: '' });
    apiFetch('/post/' + encodeURIComponent(this.props.match.params.id))
      .then(({ ok, data }) => {
        if (!ok) return this.setState({ post: null, error: errorMessage(data, 'Post not found.') });
        this.setState({ post: data, error: '', active: 0 });
      })
      .catch(() => this.setState({ error: 'Unable to reach the server. Please try again.' }));
  }

  step(delta) {
    const n = (this.state.post.photos || []).length;
    if (n < 2) return;
    this.setState({ active: (this.state.active + delta + n) % n });
  }

  onKey(e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); this.step(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); this.step(1); }
  }

  renderGallery(post) {
    const photos = post.photos || [];
    const active = Math.min(this.state.active, photos.length - 1);
    const current = photos[active];
    if (!current) {
      return <div className="gallery-stage gallery-empty post-card-placeholder"><ImageOff size={40} aria-hidden="true" /><span className="sr-only">No photos for this sale</span></div>;
    }
    return (
      <div className="post-gallery" role="group" aria-roledescription="carousel" aria-label="Photos" onKeyDown={this.onKey}>
        <div className="gallery-stage">
          <a href={current.url} target="_blank" rel="noopener noreferrer" aria-label={'Open photo ' + (active + 1) + ' full size in a new tab'}>
            <img src={current.url} alt={post.title + ' photo ' + (active + 1)} className="gallery-main" />
          </a>
          {photos.length > 1 ? (
            <React.Fragment>
              <button type="button" className="btn btn-icon gallery-nav gallery-prev" aria-label="Previous photo" onClick={() => this.step(-1)}><ChevronLeft size={20} aria-hidden="true" /></button>
              <button type="button" className="btn btn-icon gallery-nav gallery-next" aria-label="Next photo" onClick={() => this.step(1)}><ChevronRight size={20} aria-hidden="true" /></button>
              <span className="post-card-badge gallery-count" aria-live="polite">{active + 1} / {photos.length}</span>
            </React.Fragment>
          ) : null}
        </div>
        {photos.length > 1 ? (
          <div className="gallery-thumbs">
            {photos.map((p, i) => (
              <button key={p.id} type="button" onClick={() => this.setState({ active: i })} aria-label={'Show photo ' + (i + 1)} aria-current={i === active ? 'true' : undefined}>
                <img src={p.thumbUrl} alt="" />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  render() {
    const { post, error } = this.state;
    if (error) {
      return (
        <div className="container container-narrow">
          <EmptyState icon={SearchX} title="We couldn't find that sale" action={<Link className="btn btn-primary" to="/">Browse sales</Link>}>{error}</EmptyState>
        </div>
      );
    }
    if (!post) {
      return (
        <div className="container">
          <div className="post-layout"><SkeletonBlock height={420} lines={2} /><SkeletonBlock lines={5} /></div>
        </div>
      );
    }
    const when = saleWhen(post);
    const status = saleStatus(post);
    const address = addressLine(post);
    const mapsHref = address ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address) : null;
    return (
      <div className="container">
        <Link to="/" className="back-link"><ArrowLeft size={16} aria-hidden="true" />All sales</Link>
        <header className="post-header">
          <h1>{post.title}</h1>
          <div className="chips">
            {formatPrice(post) ? <span className={'chip chip-price' + (post.isFree ? ' chip-free' : '')}><Tag size={12} aria-hidden="true" />{formatPrice(post)}</span> : null}
            {status === 'live' ? <span className="chip chip-success">Happening now</span> : null}
            {status === 'upcoming' ? <span className="chip chip-brand">Upcoming</span> : null}
            {status === 'ended' ? <span className="chip">Ended</span> : null}
            {address ? <span className="chip"><MapPin size={12} aria-hidden="true" />{[post.city, post.state].filter(Boolean).join(', ')}</span> : null}
            <span className="chip"><Clock size={12} aria-hidden="true" />Posted {timeAgo(post.createdAt)}</span>
          </div>
        </header>
        <article className="post-layout">
          <div className="stack">
            {this.renderGallery(post)}
            {post.description ? (
              <section>
                <h2 className="h4">About this sale</h2>
                <p className="post-description">{post.description}</p>
              </section>
            ) : <p className="muted">The seller didn't add a description.</p>}
          </div>
          <aside className="post-aside">
            <div className="panel">
              <h2>Sale details</h2>
              <dl className="detail-list">
                <div><dt><MapPin size={18} aria-hidden="true" /><span>Where</span></dt><dd>{address || 'Not given'}</dd></div>
                <div><dt><CalendarDays size={18} aria-hidden="true" /><span>When</span></dt><dd>{when || 'Dates not set'}</dd></div>
                {typeof post.lat === 'number' && typeof post.distanceMiles === 'number' ? <div><dt><Navigation size={18} aria-hidden="true" /><span>Distance</span></dt><dd>{post.distanceMiles} mi</dd></div> : null}
              </dl>
              <div className="form-actions">
                {mapsHref ? <a className="btn btn-primary" href={mapsHref} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} aria-hidden="true" />Get directions</a> : null}
                {canEditPost(this.props.user, post) ? <Link className="btn btn-secondary" to={'/post/' + post.id + '/edit'}><Pencil size={16} aria-hidden="true" />Edit post &amp; photos</Link> : null}
              </div>
            </div>
          </aside>
        </article>
      </div>
    );
  }
}

export default Post;
