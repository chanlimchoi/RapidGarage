import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, MapPin, CalendarDays, Clock, Pencil, ImageOff, Navigation, ExternalLink, SearchX, Tag, Flag } from 'lucide-react';
import { apiFetch, errorMessage, canEditPost, reportPost, REPORT_REASONS, REPORT_NOTE_MAX } from '../api';
import { addressLine, saleWhen, saleStatus, timeAgo } from '../lib/format';
import { formatPrice } from '../lib/price';
import { EmptyState, SkeletonBlock, Alert, Dialog, Field, Spinner } from '../components/ui';
import toast from '../components/toast';

// GET /post/:id with a photo gallery and a details sidebar.
class Post extends Component {
  constructor(props) {
    super(props);
    this.state = { post: null, error: '', active: 0, reportOpen: false, reason: '', note: '', reportError: '', reporting: false, reported: false };
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
        this.setState({ post: data, error: '', active: 0, reported: false });
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

  openReport() {
    if (!this.props.user) {
      toast.info('Log in to report a post.');
      this.props.history.push('/login');
      return;
    }
    this.setState({ reportOpen: true, reason: '', note: '', reportError: '' });
  }

  submitReport(e) {
    e.preventDefault();
    const { reason, note, post } = this.state;
    if (!reason) { this.setState({ reportError: 'Choose a reason.' }); return; }
    if (note.length > REPORT_NOTE_MAX) { this.setState({ reportError: 'Keep the note under ' + REPORT_NOTE_MAX + ' characters.' }); return; }
    this.setState({ reporting: true, reportError: '' });
    reportPost(post.id, reason, note.trim())
      .then(({ ok, status, data }) => {
        if (ok) {
          this.setState({ reporting: false, reportOpen: false, reported: true });
          toast.success('Thanks. A moderator will review this post.');
          return;
        }
        if (status === 409) {
          this.setState({ reporting: false, reportOpen: false, reported: true });
          toast.info("You've already reported this post. A moderator will look at it.");
          return;
        }
        if (status === 429) {
          this.setState({ reporting: false, reportOpen: false });
          toast.error("You've sent a lot of reports recently. Please try again later.");
          return;
        }
        this.setState({ reporting: false, reportError: errorMessage(data, 'Could not send the report.') });
      })
      .catch(() => this.setState({ reporting: false, reportError: 'Unable to reach the server. Please try again.' }));
  }

  renderReportDialog() {
    const { reason, note, reportError, reporting } = this.state;
    const left = REPORT_NOTE_MAX - note.length;
    return (
      <Dialog id="report-dialog" title="Report this sale" onClose={() => !reporting && this.setState({ reportOpen: false })}
        description="Moderators review every report. The seller won't see who reported them.">
        <form onSubmit={(e) => this.submitReport(e)} noValidate>
          <fieldset className="field report-reasons">
            <legend className="field-label">Why are you reporting it?</legend>
            {REPORT_REASONS.map((r) => (
              <label key={r.value} className="radio-row">
                <input type="radio" name="report-reason" value={r.value} checked={reason === r.value}
                  onChange={() => this.setState({ reason: r.value, reportError: '' })} />
                <span>{r.label}</span>
              </label>
            ))}
          </fieldset>
          <Field id="report-note" label="Details" optional hint={left >= 0 ? left + ' characters left' : 'Too long by ' + (-left)}>
            <textarea className="textarea" rows={3} maxLength={REPORT_NOTE_MAX} value={note} onChange={(e) => this.setState({ note: e.target.value })}
              placeholder="Anything that helps a moderator understand the problem" />
          </Field>
          {reportError ? <Alert tone="danger">{reportError}</Alert> : null}
          <div className="dialog-footer">
            <button type="button" className="btn btn-ghost" disabled={reporting} onClick={() => this.setState({ reportOpen: false })}>Cancel</button>
            <button type="submit" className="btn btn-danger" disabled={reporting}>{reporting ? <Spinner /> : <Flag size={16} aria-hidden="true" />}Send report</button>
          </div>
        </form>
      </Dialog>
    );
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
    const isOwner = !!(this.props.user && this.props.user.id === post.userId);
    const mapsHref = address ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address) : null;
    return (
      <div className="container">
        <Link to="/" className="back-link"><ArrowLeft size={16} aria-hidden="true" />All sales</Link>
        {post.hidden ? (
          <Alert tone="warning" className="hidden-banner">
            <p><strong>Hidden by moderator.</strong>{' '}
              {isOwner ? "Other people can't see this sale in listings, search or on the map. Only you and site admins can open it." : 'Only the owner and admins can see this sale.'}</p>
          </Alert>
        ) : null}
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
            {!isOwner ? (
              <div className="report-row">
                {this.state.reported
                  ? <span className="muted"><Flag size={14} aria-hidden="true" /> Reported. Thanks for letting us know.</span>
                  : <button type="button" className="btn btn-ghost btn-sm report-btn" onClick={() => this.openReport()}><Flag size={14} aria-hidden="true" />Report this sale</button>}
              </div>
            ) : null}
          </aside>
          {this.state.reportOpen ? this.renderReportDialog() : null}
        </article>
      </div>
    );
  }
}

export default Post;
