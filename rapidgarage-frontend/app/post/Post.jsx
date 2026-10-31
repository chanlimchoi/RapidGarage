import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, MapPin, CalendarDays, Clock, Pencil, ImageOff, Navigation, ExternalLink, SearchX, Tag, Flag, MessageCircle, Package, UserRound, QrCode, UsersRound, BarChart3, Gift, Percent, Smartphone, Sunrise } from 'lucide-react';
import { apiFetch, errorMessage, canEditPost, reportPost, REPORT_REASONS, REPORT_NOTE_MAX, startConversation } from '../api';
import { addressLine, timeAgo, formatMiles, formatTime, formatDay } from '../lib/format';
import { dayLines, saleBadge, zoneNote } from '../lib/schedule';
import { BADGE_CLASS } from '../components/PostCard';
import { formatPrice } from '../lib/price';
import { isActive as markdownNow } from '../lib/markdown';
import { chipLabel as markdownChip, describe as describeMarkdown } from '../lib/markdownText';
import { describe as describeBundle } from '../lib/bundles';
import { EmptyState, SkeletonBlock, Alert, Dialog, Field, Spinner } from '../components/ui';
import toast from '../components/toast';
import { RatingBadge } from '../ratings/Stars';
import ScanStats from '../print/ScanStats';
import { fetchPrintInfo, recordView, markCurbTaken, undoCurbTaken } from '../api';
import { liveOffer } from '../lib/curbside';
import { holdTime } from '../messages/holdText';
import CurbsidePanel from './CurbsidePanel';
import SaveButton from '../saved/SaveButton';
import AddToRouteButton from '../route/AddToRouteButton';
import RemindToggle from '../saved/RemindToggle';
import AddToCalendar from '../components/AddToCalendar';
import ShareButton from '../components/ShareButton';
import ItemList from './ItemList';
import LiveItems from './LiveItems';
import { earlyState } from '../lib/earlyBird';
import JoinEventPanel from '../events/JoinEventPanel';
import FollowButton from '../follows/FollowButton';
import DuplicateButton from './DuplicateButton';
import { scrollBehavior, photoAlt } from '../lib/a11y';
import { categoryLabel } from '../wanted/WantedCard';
import SaleWeather from './SaleWeather';
import { postponedNote } from '../lib/weatherText';
import { t } from '../i18n';
import * as activity from '../lib/activity';

// GET /post/:id with a photo gallery and a details sidebar.
class Post extends Component {
  constructor(props) {
    super(props);
    this.state = { post: null, error: '', active: 0, reportOpen: false, reason: '', note: '', reportError: '', reporting: false, reported: false, starting: false };
    this.onKey = this.onKey.bind(this);
  }

  componentDidMount() { this.load(); }

  componentDidUpdate(prev) {
    if (prev.match.params.id !== this.props.match.params.id) this.load();
    else if (prev.user !== this.props.user && this.state.post) this.loadScans(this.state.post);
  }

  // Seller and admins see how often the post's QR code was scanned.
  loadScans(post) {
    if (!canEditPost(this.props.user, post)) { if (this.state.scans) this.setState({ scans: null }); return; }
    fetchPrintInfo(post.id).then(({ ok, data }) => {
      if (ok && this.state.post && this.state.post.id === post.id) this.setState({ scans: data.scans });
    }).catch(() => null);
  }

  load() {
    this.setState({ post: null, error: '', scans: null });
    apiFetch('/post/' + encodeURIComponent(this.props.match.params.id))
      .then(({ ok, data }) => {
        if (!ok) return this.setState({ post: null, error: errorMessage(data, t('post.notFound')) });
        this.setState({ post: data, error: '', active: 0, reported: false });
        this.loadScans(data);
        // Seller dashboard view count (the server skips the seller, admins, bots and hidden sales).
        if (!data.hidden && !(this.props.user && this.props.user.id === data.userId)) recordView(data.id);
      })
      .catch(() => this.setState({ error: t('common.network') }));
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

  messageSeller() {
    if (!this.props.user) {
      toast.info(t('post.loginToMessage'));
      this.props.history.push('/login');
      return;
    }
    this.setState({ starting: true });
    startConversation(this.state.post.id)
      .then(({ ok, data }) => {
        this.setState({ starting: false });
        if (!ok) { toast.error(errorMessage(data, t('post.convFailed'))); return; }
        this.props.history.push('/messages/' + data.id);
      })
      .catch(() => { this.setState({ starting: false }); toast.error(t('common.network')); });
  }

  // Run a curbside call and merge its { items, curbside } answer into the post.
  curbAct(promise, okMessage) {
    return promise.then(({ ok, status, data }) => {
      if (!ok) {
        toast.error(status === 429 ? t('curb.tooMany') : errorMessage(data, t('curb.failed')));
        // The offer may have changed under us (taken, expired, paused): refresh it.
        if (status === 409 && data && data.error && data.error.code !== 'already_marked') this.refreshCurb();
        return false;
      }
      if (this.state.post && data && data.id === this.state.post.id) this.setState({ post: Object.assign({}, this.state.post, { items: data.items, curbside: data.curbside }) });
      if (okMessage) toast.success(okMessage);
      return true;
    }).catch(() => { toast.error(t('common.network')); return false; });
  }

  refreshCurb() {
    const id = this.state.post && this.state.post.id;
    apiFetch('/post/' + id).then(({ ok, data }) => {
      if (ok && this.state.post && this.state.post.id === id) this.setState({ post: Object.assign({}, this.state.post, { items: data.items, curbside: data.curbside }) });
    }).catch(() => null);
  }

  curbTaken(item) {
    if (!this.props.user) {
      toast.info(t('curb.loginToMark'));
      this.props.history.push('/login');
      return Promise.resolve(false);
    }
    const mine = this.props.user.id === this.state.post.userId;
    const msg = mine ? (item ? t('curb.markedGoneNamed', { name: item.name }) : t('curb.markedGone')) : t('curb.thanks');
    return this.curbAct(markCurbTaken(this.state.post.id, item ? item.id : null), msg);
  }

  curbUndo(item) {
    return this.curbAct(undoCurbTaken(this.state.post.id, item ? item.id : null), t('curb.putBackDone'));
  }

  openReport() {
    if (!this.props.user) {
      toast.info(t('post.loginToReport'));
      this.props.history.push('/login');
      return;
    }
    this.setState({ reportOpen: true, reason: '', note: '', reportError: '' });
  }

  submitReport(e) {
    e.preventDefault();
    const { reason, note, post } = this.state;
    if (!reason) { this.setState({ reportError: t('report.chooseReason') }); return; }
    if (note.length > REPORT_NOTE_MAX) { this.setState({ reportError: t('report.noteLong', { max: REPORT_NOTE_MAX }) }); return; }
    this.setState({ reporting: true, reportError: '' });
    reportPost(post.id, reason, note.trim())
      .then(({ ok, status, data }) => {
        if (ok) {
          this.setState({ reporting: false, reportOpen: false, reported: true });
          toast.success(t('post.reportThanks'));
          return;
        }
        if (status === 409) {
          this.setState({ reporting: false, reportOpen: false, reported: true });
          toast.info(t('post.reportedAlready'));
          return;
        }
        if (status === 429) {
          this.setState({ reporting: false, reportOpen: false });
          toast.error(t('report.tooMany'));
          return;
        }
        this.setState({ reporting: false, reportError: errorMessage(data, t('report.sendFailed')) });
      })
      .catch(() => this.setState({ reporting: false, reportError: t('common.network') }));
  }

  renderReportDialog() {
    const { reason, note, reportError, reporting } = this.state;
    const left = REPORT_NOTE_MAX - note.length;
    return (
      <Dialog id="report-dialog" title={t('post.reportTitle')} onClose={() => !reporting && this.setState({ reportOpen: false })}
        description={t('post.reportDesc')}>
        <form onSubmit={(e) => this.submitReport(e)} noValidate>
          <fieldset className="field report-reasons">
            <legend className="field-label">{t('post.reportWhy')}</legend>
            {REPORT_REASONS.map((r) => (
              <label key={r.value} className="radio-row">
                <input type="radio" name="report-reason" value={r.value} checked={reason === r.value}
                  onChange={() => this.setState({ reason: r.value, reportError: '' })} />
                <span>{r.label}</span>
              </label>
            ))}
          </fieldset>
          <Field id="report-note" label={t('report.details')} optional hint={left >= 0 ? t('common.charsLeft', { count: left }) : t('common.tooLongBy', { n: -left })}>
            <textarea className="textarea" rows={3} maxLength={REPORT_NOTE_MAX} value={note} onChange={(e) => this.setState({ note: e.target.value })}
              placeholder={t('report.notePlaceholder')} />
          </Field>
          {reportError ? <Alert tone="danger">{reportError}</Alert> : null}
          <div className="dialog-footer">
            <button type="button" className="btn btn-ghost" disabled={reporting} onClick={() => this.setState({ reportOpen: false })}>{t('common.cancel')}</button>
            <button type="submit" className="btn btn-danger" disabled={reporting}>{reporting ? <Spinner /> : <Flag size={16} aria-hidden="true" />}{t('report.send')}</button>
          </div>
        </form>
      </Dialog>
    );
  }

  // Early-bird access (lib/earlyBird.js): times only for people who have it.
  renderEarly(post, isOwner) {
    const e = earlyState(post);
    if (!e) return null;
    if (e.kind === 'offered') {
      return <p className="markdown-note early-note"><Sunrise size={16} aria-hidden="true" /><span>{t('early.offered')}</span></p>;
    }
    const key = isOwner ? (e.kind === 'active' ? 'early.ownerActive' : 'early.ownerUpcoming') : (e.kind === 'active' ? 'early.active' : 'early.upcoming');
    return (
      <p className={'markdown-note early-note' + (e.kind === 'active' ? ' is-now' : '')}>
        <Sunrise size={16} aria-hidden="true" />
        <span>{t(key, { from: e.kind === 'active' ? formatTime(e.startsAt) : formatDay(e.startsAt) + ' ' + formatTime(e.startsAt), until: formatTime(e.until) })}</span>
      </p>
    );
  }

  renderGallery(post) {
    const photos = post.photos || [];
    const active = Math.min(this.state.active, photos.length - 1);
    const current = photos[active];
    if (!current) {
      return <div className="gallery-stage gallery-empty post-card-placeholder"><ImageOff size={40} aria-hidden="true" /><span className="sr-only">{t('post.noPhotos')}</span></div>;
    }
    return (
      <div className="post-gallery" role="group" aria-roledescription="carousel" aria-label={t('post.photos')} onKeyDown={this.onKey}>
        <div className="gallery-stage">
          <a href={current.url} target="_blank" rel="noopener noreferrer">
            <img src={current.url} alt={photoAlt(current, active, photos.length, post.title, (v) => t('post.photoAltOf', v))} className="gallery-main" />
            <span className="sr-only"> {t('post.openFullSize')}</span>
          </a>
          {photos.length > 1 ? (
            <React.Fragment>
              <button type="button" className="btn btn-icon gallery-nav gallery-prev" aria-label={t('post.prevPhoto')} onClick={() => this.step(-1)}><ChevronLeft size={20} aria-hidden="true" /></button>
              <button type="button" className="btn btn-icon gallery-nav gallery-next" aria-label={t('post.nextPhoto')} onClick={() => this.step(1)}><ChevronRight size={20} aria-hidden="true" /></button>
              <span className="post-card-badge gallery-count" aria-live="polite">{active + 1} / {photos.length}</span>
            </React.Fragment>
          ) : null}
        </div>
        {photos.length > 1 ? (
          <div className="gallery-thumbs">
            {photos.map((p, i) => (
              <button key={p.id} type="button" onClick={() => this.setState({ active: i })} aria-label={t('post.showPhoto', { n: i + 1 })} aria-current={i === active ? 'true' : undefined}>
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
          <EmptyState level={1} icon={SearchX} title={t('post.cantFind')} action={<Link className="btn btn-primary" to="/">{t('nav.browseSales')}</Link>}>{error}</EmptyState>
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
    const lines = dayLines(post);
    const badge = saleBadge(post);
    const zone = lines.length ? zoneNote(post) : null;
    const address = addressLine(post);
    const isOwner = !!(this.props.user && this.props.user.id === post.userId);
    const mapsHref = address ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address) : null;
    return (
      <div className="container">
        <Link to="/" className="back-link"><ArrowLeft size={16} aria-hidden="true" />{t('post.allSales')}</Link>
        {post.offlineSavedAt ? (
          <Alert tone="info" className="offline-copy-banner">
            <p><strong>{t('post.offlineCopyTitle')}</strong>{' '}{t('post.offlineCopy', { when: timeAgo(post.offlineSavedAt) })}</p>
          </Alert>
        ) : null}
        {badge && badge.kind === 'ended' ? (
          <Alert tone="info" className="ended-banner">
            <p><strong>{t('post.endedTitle')}</strong>{' '}
              {liveOffer(post) ? (isOwner ? t('curb.endedOwnerFree') : t('curb.endedButFree')) : isOwner ? t('post.endedOwner') : t('post.endedOther')}</p>
          </Alert>
        ) : null}
        {post.hidden ? (
          <Alert tone="warning" className="hidden-banner">
            <p><strong>{t('post.hiddenTitle')}</strong>{' '}
              {isOwner ? t('post.hiddenOwner') : t('post.hiddenOther')}</p>
          </Alert>
        ) : null}
        <header className="post-header">
          <h1>{post.title}</h1>
          <div className="chips">
            {formatPrice(post) ? <span className={'chip chip-price' + (post.isFree ? ' chip-free' : '')}><Tag size={12} aria-hidden="true" />{formatPrice(post)}</span> : null}
            {badge ? <span className={'chip sale-badge sale-badge-' + badge.kind + ' ' + BADGE_CLASS[badge.kind]}>{badge.label}</span> : null}
            {markdownChip(post) ? <span className={'chip chip-markdown' + (markdownNow(post) ? ' is-now' : '')}><Percent size={12} aria-hidden="true" />{markdownChip(post)}</span> : null}
            {post.bundle && !post.isFree ? <span className="chip chip-bundle"><Package size={12} aria-hidden="true" />{describeBundle(post.bundle)}</span> : null}
            {liveOffer(post) ? <span className="chip chip-free chip-curb" title={t('curb.until', { time: holdTime(post.curbside.until) })}><Gift size={12} aria-hidden="true" />{t('curb.badge')}</span> : null}
            {post.category ? <span className="chip chip-category">{categoryLabel(post.category)}</span> : null}
            {address ? <span className="chip"><MapPin size={12} aria-hidden="true" />{[post.city, post.state].filter(Boolean).join(', ')}</span> : null}
            <span className="chip"><Clock size={12} aria-hidden="true" />{t('card.posted', { when: timeAgo(post.createdAt) })}</span>
            {post.event ? <Link className="chip chip-event" to={'/events/' + post.event.id}><UsersRound size={12} aria-hidden="true" />{t('ev.partOf', { name: post.event.name })}</Link> : null}
          </div>
        </header>
        <article className="post-layout">
          <div className="stack">
            {post.markdown && post.markdown.startsAt ? (
              <p className={'markdown-note' + (post.markdown.active ? ' is-now' : '')}>
                <Percent size={16} aria-hidden="true" />
                <span>{post.markdown.active ? t('md.runningNow', { percent: post.markdown.percent }) + ' ' : ''}{describeMarkdown(post.markdown)}</span>
              </p>
            ) : null}
            {post.bundle && !post.isFree ? (
              <p className="markdown-note bundle-note-post">
                <Package size={16} aria-hidden="true" />
                <span>{describeBundle(post.bundle)}. {t('bundle.postNote')}</span>
              </p>
            ) : null}
            {this.renderEarly(post, isOwner)}
            {this.renderGallery(post)}
            {post.description ? (
              <section>
                <h2 className="h4">{t('post.aboutSale')}</h2>
                <p className="post-description">{post.description}</p>
              </section>
            ) : <p className="muted">{t('post.noDescription')}</p>}
            {!post.hidden ? <LiveItems key={'live-' + post.id} post={post} onItems={(items) => this.setState({ post: Object.assign({}, this.state.post, { items }) })}
              onStamp={(at) => this.setState({ post: Object.assign({}, this.state.post, { itemsUpdatedAt: at }) })} /> : null}
            {isOwner && (post.items || []).length && !post.hidden ? <p className="sell-mode-link"><Link className="btn btn-secondary btn-sm" to={'/post/' + post.id + '/sell'}><Smartphone size={16} aria-hidden="true" />{t('left.sellMode')}</Link></p> : null}
            <ItemList post={post} owner={isOwner} user={this.props.user} onTaken={(i) => this.curbTaken(i)} onUndo={(i) => this.curbUndo(i)} onItems={(items) => this.setState({ post: Object.assign({}, post, { items }) })}
              onPhoto={(i) => { this.setState({ active: i }); const g = document.querySelector('.post-gallery'); if (g && g.scrollIntoView) g.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() }); }} />
          </div>
          <aside className="post-aside">
            <CurbsidePanel post={post} user={this.props.user} act={(p, m) => this.curbAct(p, m)} taken={(i) => this.curbTaken(i)} undo={(i) => this.curbUndo(i)} />
            <div className="panel">
              <h2>{t('post.details')}</h2>
              <dl className="detail-list">
                {post.seller ? <div><dt><UserRound size={18} aria-hidden="true" /><span>{t('post.seller')}</span></dt><dd className="seller-line">{post.seller.name} <RatingBadge summary={post.seller.rating} personId={post.seller.id} /></dd></div> : null}
                <div><dt><MapPin size={18} aria-hidden="true" /><span>{t('post.where')}</span></dt><dd>{address || t('post.notGiven')}</dd></div>
                <div><dt><CalendarDays size={18} aria-hidden="true" /><span>{t('post.when')}</span></dt><dd>
                  {lines.length ? (
                    <ul className="schedule-list">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                  ) : t('post.datesNotSet')}
                  {zone ? <span className="small muted schedule-zone">{zone}</span> : null}
                  {postponedNote(post) ? <span className="chip chip-warning postponed-chip"><CalendarDays size={12} aria-hidden="true" />{postponedNote(post)}</span> : null}
                  {lines.length && !post.offlineSavedAt && !(badge && badge.kind === 'ended') ? <SaleWeather postId={post.id} onPostponed={() => this.load()} /> : null}
                </dd></div>
                {typeof post.lat === 'number' && typeof post.distanceMiles === 'number' ? <div><dt><Navigation size={18} aria-hidden="true" /><span>{t('post.distance')}</span></dt><dd>{formatMiles(post.distanceMiles)}</dd></div> : null}
              </dl>
              <div className="form-actions">
                {mapsHref ? <a className="btn btn-primary" href={mapsHref} target="_blank" rel="noopener noreferrer" onClick={() => activity.track('directions', { type: 'post', id: post.id })}><ExternalLink size={16} aria-hidden="true" />{t('post.directions')}</a> : null}
                {!isOwner && !post.hidden ? (
                  <button type="button" className="btn btn-secondary message-seller" disabled={this.state.starting} onClick={() => this.messageSeller()}>
                    {this.state.starting ? <Spinner /> : <MessageCircle size={16} aria-hidden="true" />}{t('post.messageSeller')}
                  </button>
                ) : null}
                {!isOwner ? <SaveButton post={post} /> : null}
                {!post.hidden && !(badge && badge.kind === 'ended') ? <AddToRouteButton post={post} /> : null}
                {!isOwner && post.seller ? <FollowButton sellerId={post.seller.id} user={this.props.user} /> : null}
                <AddToCalendar item={post} kind="post" />
                <ShareButton kind="post" item={post} title={post.title} />
                {!isOwner ? <RemindToggle post={post} /> : null}
                {canEditPost(this.props.user, post) ? <Link className="btn btn-secondary" to={'/post/' + post.id + '/edit'}><Pencil size={16} aria-hidden="true" />{t('post.editPost')}</Link> : null}
                {isOwner ? <Link className="btn btn-secondary print-link" to={'/post/' + post.id + '/print'}><QrCode size={16} aria-hidden="true" />{t('post.printFlyer')}</Link> : null}
                {isOwner ? <Link className="btn btn-secondary sale-dashboard-link" to={'/dashboard/sales/' + post.id}><BarChart3 size={16} aria-hidden="true" />{t('dash.saleStats')}</Link> : null}
                {isOwner ? <Link className="btn btn-secondary" to={'/post/' + post.id + '/items'}><Package size={16} aria-hidden="true" />{(post.items || []).length ? t('post.editItems') : t('post.addItems')}</Link> : null}
                {isOwner && !post.hidden ? <DuplicateButton postId={post.id} /> : null}
              </div>
            </div>
            {isOwner && !post.hidden ? <JoinEventPanel post={post} /> : null}
            {this.state.scans ? (
              <div className="panel scan-panel">
                <h2 className="h4">{t('post.scansTitle')}</h2>
                <ScanStats scans={this.state.scans} compact />
                <Link className="small" to={'/post/' + post.id + '/print'}>{isOwner ? t('post.printAndScans') : t('post.dailyScans')}</Link>
              </div>
            ) : null}
            {!isOwner ? (
              <div className="report-row">
                {this.state.reported
                  ? <span className="muted"><Flag size={14} aria-hidden="true" /> {t('post.reported')}</span>
                  : <button type="button" className="btn btn-ghost btn-sm report-btn" onClick={() => this.openReport()}><Flag size={14} aria-hidden="true" />{t('post.reportTitle')}</button>}
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
