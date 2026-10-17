import React from 'react';
import { Link } from 'react-router-dom';
import { Check, Eraser, Trash2, Inbox } from 'lucide-react';
import { errorMessage, fetchRatingReportQueue, moderateRating, ratingReasonLabel, REPORT_NOTE_MAX } from '../api';
import { Alert, EmptyState, SkeletonBlock, Spinner } from '../components/ui';
import { timeAgo } from '../lib/format';
import { Stars } from '../ratings/Stars';
import toast from '../components/toast';

const DONE = { dismiss: 'Reports dismissed.', remove_comment: 'Comment removed. The stars stay.', remove_rating: 'Rating removed.' };

// Admin > Reports > Ratings: open rating reports grouped by rating.
export default class RatingReports extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, error: '', groups: [], notes: {}, busy: null };
  }

  componentDidMount() { this.load(); }

  load() {
    this.setState({ loading: true, error: '' });
    return fetchRatingReportQueue().then(({ ok, data }) => {
      if (!ok) return this.setState({ loading: false, error: errorMessage(data, 'Could not load rating reports.') });
      this.setState({ loading: false, groups: data.groups });
      if (this.props.onCount) this.props.onCount(data.openCount);
      return null;
    }).catch(() => this.setState({ loading: false, error: 'Unable to reach the server.' }));
  }

  act(g, action) {
    if (action === 'remove_rating' && !window.confirm('Remove this whole rating? It no longer counts toward their average.')) return;
    this.setState({ busy: g.ratingId + ':' + action });
    moderateRating(g.ratingId, action, (this.state.notes[g.ratingId] || '').trim()).then(({ ok, data }) => {
      this.setState({ busy: null });
      if (!ok) { toast.error(errorMessage(data, 'Could not update the rating.')); return; }
      toast.success(DONE[action]);
      this.load();
    }).catch(() => this.setState({ busy: null }));
  }

  render() {
    const { loading, error, groups, busy, notes } = this.state;
    if (loading) return <SkeletonBlock height={120} lines={3} />;
    if (error) return <Alert tone="danger">{error}</Alert>;
    if (!groups.length) return <EmptyState icon={Inbox} title="No rating reports">Reported ratings show up here.</EmptyState>;
    return (
      <ul className="rating-report-list">
        {groups.map((g) => (
          <li key={g.ratingId} className="panel rating-report">
            <div className="rating-item-head">
              <Stars value={g.rating ? g.rating.stars : 0} /><span className="sr-only">{g.rating && g.rating.stars} out of 5</span>
              <span><strong>{g.rater ? g.rater.name : 'Former user'}</strong> <span className="small muted">({g.rater ? g.rater.email : '—'})</span>
                {' rated '}<Link to={'/people/' + (g.ratee ? g.ratee.id : '')}>{g.ratee ? g.ratee.name : 'Former user'}</Link> <span className="small muted">({g.ratee ? g.ratee.email : '—'})</span></span>
              <span className="chip chip-danger">{g.reports.length} {g.reports.length === 1 ? 'report' : 'reports'}</span>
            </div>
            {g.rating && g.rating.comment ? <blockquote className="rating-comment">{g.rating.comment}</blockquote> : <p className="small muted">{g.rating && g.rating.commentRemoved ? 'Comment already removed.' : 'No comment.'}</p>}
            <ul className="rating-report-reasons small">
              {g.reports.map((r) => (
                <li key={r.id}><strong>{ratingReasonLabel(r.reason)}</strong> · {r.reporter ? r.reporter.name : 'Former user'} · {timeAgo(r.createdAt)}{r.note ? <span className="muted"> · “{r.note}”</span> : null}</li>
              ))}
            </ul>
            <label className="sr-only" htmlFor={'rnote-' + g.ratingId}>Moderator note</label>
            <input id={'rnote-' + g.ratingId} type="text" className="input" placeholder="Note for the record (optional)" maxLength={REPORT_NOTE_MAX}
              value={notes[g.ratingId] || ''} onChange={(e) => this.setState({ notes: Object.assign({}, notes, { [g.ratingId]: e.target.value }) })} />
            <div className="form-actions">
              <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => this.act(g, 'dismiss')}>{busy === g.ratingId + ':dismiss' ? <Spinner /> : <Check size={14} aria-hidden="true" />}Dismiss</button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy || !(g.rating && g.rating.comment)} onClick={() => this.act(g, 'remove_comment')}>{busy === g.ratingId + ':remove_comment' ? <Spinner /> : <Eraser size={14} aria-hidden="true" />}Remove comment</button>
              <button type="button" className="btn btn-danger btn-sm" disabled={!!busy} onClick={() => this.act(g, 'remove_rating')}>{busy === g.ratingId + ':remove_rating' ? <Spinner /> : <Trash2 size={14} aria-hidden="true" />}Remove rating</button>
            </div>
          </li>
        ))}
      </ul>
    );
  }
}
