import React from 'react';
import { Link } from 'react-router-dom';
import { Star, Flag, UserX } from 'lucide-react';
import { errorMessage, fetchPersonRatings, reportRating, RATING_REPORT_REASONS, REPORT_NOTE_MAX } from '../api';
import { Alert, EmptyState, SkeletonBlock, Spinner, Dialog, Field } from '../components/ui';
import { timeAgo } from '../lib/format';
import toast from '../components/toast';
import { Stars } from './Stars';

// Public page: /people/:id. Name is "First L."; no email anywhere.
export default class PersonRatings extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, error: '', data: null, page: 1, reporting: null, reason: '', note: '', sending: false, reportError: '' };
  }

  componentDidMount() { this.load(1); }
  componentDidUpdate(prev) { if (prev.match.params.id !== this.props.match.params.id) this.load(1); }

  load(page) {
    this.setState({ loading: true, error: '', page });
    return fetchPersonRatings(this.props.match.params.id, page).then(({ ok, status, data }) => {
      if (!ok) return this.setState({ loading: false, error: status === 404 ? 'not_found' : errorMessage(data, 'Could not load ratings.') });
      document.title = data.user.name + ' · Ratings · RapidGarage';
      return this.setState({ loading: false, data });
    }).catch(() => this.setState({ loading: false, error: 'Unable to reach the server.' }));
  }

  sendReport(e) {
    e.preventDefault();
    const { reporting, reason, note } = this.state;
    if (!reason) { this.setState({ reportError: 'Choose a reason.' }); return; }
    this.setState({ sending: true, reportError: '' });
    reportRating(reporting.id, reason, note.trim()).then(({ ok, status, data }) => {
      if (!ok && status !== 409) { this.setState({ sending: false, reportError: errorMessage(data, 'Could not send the report.') }); return; }
      const ratings = this.state.data.ratings.map((r) => (r.id === reporting.id ? Object.assign({}, r, { reportedByMe: true }) : r));
      this.setState({ sending: false, reporting: null, data: Object.assign({}, this.state.data, { ratings }) });
      toast.success('Thanks. A moderator will review this rating.');
    }).catch(() => this.setState({ sending: false, reportError: 'Unable to reach the server.' }));
  }

  renderReport() {
    const { reason, note, sending, reportError } = this.state;
    return (
      <Dialog id="ratingreport" title="Report this rating" onClose={() => this.setState({ reporting: null })}
        description="Moderators can remove abusive comments or ratings. The person who wrote it won't see who reported it."
        footer={(
          <React.Fragment>
            <button type="button" className="btn btn-secondary" onClick={() => this.setState({ reporting: null })}>Cancel</button>
            <button type="submit" form="ratingreport-form" className="btn btn-danger" disabled={sending}>{sending ? <Spinner /> : null}Send report</button>
          </React.Fragment>
        )}>
        <form id="ratingreport-form" className="stack" onSubmit={(e) => this.sendReport(e)} noValidate>
          <fieldset className="report-reasons">
            <legend className="field-label">What's wrong?</legend>
            {RATING_REPORT_REASONS.map((r) => (
              <label key={r.value} className="radio-row">
                <input type="radio" name="ratingreport-reason" value={r.value} checked={reason === r.value} onChange={() => this.setState({ reason: r.value, reportError: '' })} />
                <span>{r.label}</span>
              </label>
            ))}
          </fieldset>
          <Field id="ratingreport-note" label="Anything else?" optional>
            <textarea id="ratingreport-note" className="textarea textarea-short" rows={2} maxLength={REPORT_NOTE_MAX} value={note} onChange={(e) => this.setState({ note: e.target.value })} />
          </Field>
          {reportError ? <p className="field-error" role="alert">{reportError}</p> : null}
        </form>
      </Dialog>
    );
  }

  render() {
    const { loading, error, data, page } = this.state;
    const user = this.props.user;
    if (loading && !data) return <div className="container container-narrow"><SkeletonBlock lines={5} /></div>;
    if (error === 'not_found') return <div className="container container-narrow"><EmptyState icon={UserX} title="Person not found">They may have deleted their account.</EmptyState></div>;
    if (error) return <div className="container container-narrow"><Alert tone="danger">{error}</Alert></div>;
    const { summary, distribution, ratings } = data;
    const max = Math.max(1, ...Object.values(distribution));
    return (
      <div className="container container-narrow person-ratings">
        <header className="person-header">
          <h1>{data.user.name}</h1>
          <p className="muted">Ratings from people they've chatted with on RapidGarage.</p>
        </header>
        <section className="panel rating-summary" aria-label="Rating summary">
          <div className="rating-summary-score">
            <span className="rating-summary-big">{summary.count ? summary.average.toFixed(1) : '–'}</span>
            <Stars value={summary.average || 0} size={18} />
            <span className="small muted">{summary.count ? summary.count + (summary.count === 1 ? ' rating' : ' ratings') : 'No ratings yet'}</span>
          </div>
          <ol className="rating-bars" aria-label="Ratings by stars">
            {[5, 4, 3, 2, 1].map((n) => (
              <li key={n}>
                <span className="rating-bars-label">{n}<Star size={11} aria-hidden="true" /></span>
                <span className="rating-bars-track"><span className="rating-bars-fill" style={{ width: (distribution[n] / max * 100) + '%' }} /></span>
                <span className="rating-bars-count">{distribution[n]}<span className="sr-only"> with {n} stars</span></span>
              </li>
            ))}
          </ol>
        </section>
        {!ratings.length ? (
          <EmptyState icon={Star} title="No ratings yet">After a chat, buyers and sellers can rate each other.</EmptyState>
        ) : (
          <ul className="rating-list">
            {ratings.map((r) => (
              <li key={r.id} className="rating-item panel">
                <div className="rating-item-head">
                  <Stars value={r.stars} /><span className="sr-only">{r.stars} out of 5</span>
                  <strong>{r.rater ? r.rater.name : 'Former user'}</strong>
                  <span className="chip">{r.raterRole === 'buyer' ? 'Buyer' : 'Seller'}</span>
                  <span className="small muted">{timeAgo(r.updatedAt)}{r.edited ? ' · edited' : ''}</span>
                </div>
                {r.comment ? <p className="rating-comment">{r.comment}</p> : null}
                {r.commentRemoved ? <p className="small muted rating-comment-removed">Comment removed by a moderator.</p> : null}
                {user && !r.mine && user.id !== undefined ? (
                  <div className="rating-item-actions">
                    {r.reportedByMe
                      ? <span className="small muted"><Flag size={12} aria-hidden="true" /> Reported</span>
                      : <button type="button" className="btn btn-ghost btn-sm report-btn" onClick={() => this.setState({ reporting: r, reason: '', note: '', reportError: '' })}><Flag size={12} aria-hidden="true" />Report</button>}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {data.totalPages > 1 ? (
          <div className="pager">
            <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => this.load(page - 1)}>Newer</button>
            <span className="small muted">Page {page} of {data.totalPages}</span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={page >= data.totalPages} onClick={() => this.load(page + 1)}>Older</button>
          </div>
        ) : null}
        {!user ? <p className="small muted"><Link to="/login">Log in</Link> to report a rating.</p> : null}
        {this.state.reporting ? this.renderReport() : null}
      </div>
    );
  }
}
