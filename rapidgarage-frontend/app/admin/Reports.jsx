import React from 'react';
import { Link } from 'react-router-dom';
import { Flag, EyeOff, Eye, Trash2, Check, ImageOff, History, Inbox, ExternalLink } from 'lucide-react';
import { errorMessage, fetchReportQueue, fetchReportHistory, moderatePost, reasonLabel, REPORT_NOTE_MAX } from '../api';
import { Alert, EmptyState, SkeletonBlock, Spinner } from '../components/ui';
import { displayName, timeAgo } from '../lib/format';
import { formatPrice } from '../lib/price';
import toast from '../components/toast';

const ACTION_TEXT = {
  dismiss: { done: 'Reports dismissed.', verb: 'Dismiss reports' },
  hide: { done: 'Post hidden. Its owner will see a notice.', verb: 'Hide post' },
  unhide: { done: 'Post is visible again.', verb: 'Unhide post' },
  delete: { done: 'Post deleted.', verb: 'Delete post' },
};
const OUTCOME = { dismissed: 'Dismissed', hidden: 'Hidden', unhidden: 'Unhidden', deleted: 'Deleted' };

// Admin > Reports: open reports grouped by post, plus resolved history.
export default class Reports extends React.Component {
  constructor(props) {
    super(props);
    this.state = { view: 'open', loading: true, error: '', groups: [], hidden: [], threshold: null, history: null, page: 1, notes: {}, busy: null };
  }

  componentDidMount() { this.loadQueue(); }

  loadQueue() {
    this.setState({ loading: true, error: '' });
    return fetchReportQueue()
      .then(({ ok, data }) => {
        if (!ok) return this.setState({ loading: false, error: errorMessage(data, 'Could not load reports.') });
        this.setState({ loading: false, groups: data.groups, hidden: data.hidden, threshold: data.autoHideThreshold });
        if (this.props.onCount) this.props.onCount(data.groups.reduce((n, g) => n + g.openCount, 0));
        return null;
      })
      .catch(() => this.setState({ loading: false, error: 'Unable to reach the server.' }));
  }

  loadHistory(page) {
    this.setState({ loading: true, error: '', page });
    return fetchReportHistory(page)
      .then(({ ok, data }) => {
        if (!ok) return this.setState({ loading: false, error: errorMessage(data, 'Could not load history.') });
        this.setState({ loading: false, history: data });
        return null;
      })
      .catch(() => this.setState({ loading: false, error: 'Unable to reach the server.' }));
  }

  switchView(view) {
    this.setState({ view });
    if (view === 'open') this.loadQueue(); else this.loadHistory(1);
  }

  act(postId, title, action) {
    if (action === 'delete' && !window.confirm('Delete "' + title + '" and its photos? This can\'t be undone.')) return;
    const note = (this.state.notes[postId] || '').trim();
    this.setState({ busy: postId + ':' + action });
    moderatePost(postId, action, note)
      .then(({ ok, data }) => {
        this.setState({ busy: null });
        if (!ok) { toast.error(errorMessage(data, 'Could not apply that action.')); return null; }
        const notes = Object.assign({}, this.state.notes); delete notes[postId];
        this.setState({ notes });
        toast.success(ACTION_TEXT[action].done + (data.resolved ? ' ' + data.resolved + ' report' + (data.resolved === 1 ? '' : 's') + ' resolved.' : ''));
        return this.loadQueue();
      })
      .catch(() => { this.setState({ busy: null }); toast.error('Unable to reach the server.'); });
  }

  renderActions(post, title, actions) {
    const busy = this.state.busy;
    const noteId = 'mod-note-' + post;
    return (
      <div className="moderate-row">
        <div className="field">
          <label className="field-label" htmlFor={noteId}>Resolution note<span className="optional"> (optional)</span></label>
          <input id={noteId} className="input" type="text" maxLength={REPORT_NOTE_MAX} value={this.state.notes[post] || ''}
            onChange={(e) => this.setState({ notes: Object.assign({}, this.state.notes, { [post]: e.target.value }) })} placeholder="Visible to admins in history" />
        </div>
        {actions.map((a) => {
          const Icon = { dismiss: Check, hide: EyeOff, unhide: Eye, delete: Trash2 }[a];
          const cls = a === 'delete' ? 'btn-danger' : a === 'hide' ? 'btn-primary' : 'btn-secondary';
          return (
            <button key={a} type="button" className={'btn btn-sm ' + cls} disabled={!!busy} onClick={() => this.act(post, title, a)}>
              {busy === post + ':' + a ? <Spinner /> : <Icon size={14} aria-hidden="true" />}{ACTION_TEXT[a].verb}
            </button>
          );
        })}
      </div>
    );
  }

  renderThumb(p) {
    return p && p.thumbUrl ? <img className="report-thumb" src={p.thumbUrl} alt="" /> : <div className="report-thumb"><ImageOff size={22} aria-hidden="true" /></div>;
  }

  renderGroup(g) {
    const p = g.post;
    const title = p ? p.title : g.postTitle;
    const actions = p && p.hidden ? ['unhide', 'dismiss', 'delete'] : ['dismiss', 'hide', 'delete'];
    return (
      <article key={g.postId} className="panel report-group" aria-labelledby={'rg-' + g.postId}>
        {this.renderThumb(p)}
        <div>
          <h3 id={'rg-' + g.postId}>{p ? <Link to={'/post/' + g.postId}>{title}</Link> : title}</h3>
          <div className="muted" style={{ fontSize: 'var(--text-sm)' }}>
            {p ? [p.city, p.state].filter(Boolean).join(', ') + (formatPrice(p) ? ' · ' + formatPrice(p) : '') : 'Post no longer exists'}
            {g.owner ? <> · by {displayName(g.owner)} ({g.owner.email})</> : null}
          </div>
          <div className="chips">
            <span className="chip chip-danger"><Flag size={12} aria-hidden="true" />{g.openCount} open report{g.openCount === 1 ? '' : 's'}</span>
            {Object.keys(g.reasons).map((r) => <span key={r} className="chip">{reasonLabel(r)} × {g.reasons[r]}</span>)}
            {p && p.hidden ? <span className="chip chip-warning"><EyeOff size={12} aria-hidden="true" />{p.hiddenSource === 'auto' ? 'Auto-hidden' : 'Hidden'}</span> : null}
            <span className="chip">Last {timeAgo(g.lastReportedAt)}</span>
          </div>
          {p && p.description ? <p className="muted" style={{ margin: 0 }}>{p.description}</p> : null}
          <ul className="report-list">
            {g.reports.map((r) => (
              <li key={r.id}>
                <strong>{reasonLabel(r.reason)}</strong> · {r.reporter ? r.reporter.email : 'deleted user'} · {timeAgo(r.createdAt)}
                {r.note ? <div><q>{r.note}</q></div> : null}
              </li>
            ))}
          </ul>
          {this.renderActions(g.postId, title, actions)}
        </div>
      </article>
    );
  }

  renderOpen() {
    const { groups, hidden, threshold } = this.state;
    return (
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>
          {threshold ? 'Posts are hidden automatically once ' + threshold + ' different people report them.' : 'Auto-hide is off; reported posts stay visible until you act.'}
        </p>
        {groups.length ? groups.map((g) => this.renderGroup(g)) : <EmptyState icon={Inbox} title="No open reports">Nothing needs review right now.</EmptyState>}
        {hidden.length ? (
          <section aria-labelledby="hidden-heading" className="stack">
            <h3 id="hidden-heading" className="h4">Hidden posts without open reports</h3>
            {hidden.map((p) => (
              <article key={p.id} className="panel report-group">
                {this.renderThumb(p)}
                <div>
                  <h3><Link to={'/post/' + p.id}>{p.title}</Link></h3>
                  <div className="chips">
                    <span className="chip chip-warning"><EyeOff size={12} aria-hidden="true" />{p.hiddenSource === 'auto' ? 'Auto-hidden' : 'Hidden'} {p.hiddenAt ? timeAgo(p.hiddenAt) : ''}</span>
                    {p.owner ? <span className="chip">{p.owner.email}</span> : null}
                  </div>
                  {this.renderActions(p.id, p.title, ['unhide', 'delete'])}
                </div>
              </article>
            ))}
          </section>
        ) : null}
      </div>
    );
  }

  renderHistory() {
    const h = this.state.history;
    if (!h) return null;
    if (!h.results.length) return <EmptyState icon={History} title="No resolved reports yet" />;
    return (
      <div className="stack">
        <div className="table-wrap">
          <table className="table report-history">
            <thead><tr><th scope="col">Post</th><th scope="col">Reason</th><th scope="col">Reporter</th><th scope="col">Outcome</th><th scope="col">Reviewed</th></tr></thead>
            <tbody>
              {h.results.map((r) => (
                <tr key={r.id}>
                  <td>{r.postExists ? <Link to={'/post/' + r.postId}>{r.postTitle || 'Post #' + r.postId}</Link> : <span>{r.postTitle || 'Post #' + r.postId} <small className="muted">(deleted)</small></span>}</td>
                  <td>{reasonLabel(r.reason)}{r.note ? <small className="muted" style={{ display: 'block' }}>{r.note}</small> : null}</td>
                  <td>{r.reporter ? r.reporter.email : '—'}</td>
                  <td><span className={'chip ' + (r.status === 'actioned' ? 'chip-warning' : '')}>{OUTCOME[r.action] || r.status}</span>{r.resolutionNote ? <small className="muted" style={{ display: 'block' }}>{r.resolutionNote}</small> : null}</td>
                  <td>{r.reviewer ? r.reviewer.email : (r.action === 'deleted' ? 'Owner' : '—')}<small className="muted" style={{ display: 'block' }}>{r.reviewedAt ? timeAgo(r.reviewedAt) : ''}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {h.totalPages > 1 ? (
          <div className="form-actions">
            <button type="button" className="btn btn-secondary btn-sm" disabled={h.page <= 1} onClick={() => this.loadHistory(h.page - 1)}>Newer</button>
            <span className="muted">Page {h.page} of {h.totalPages}</span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={h.page >= h.totalPages} onClick={() => this.loadHistory(h.page + 1)}>Older</button>
          </div>
        ) : null}
      </div>
    );
  }

  render() {
    const { view, loading, error } = this.state;
    return (
      <section className="rg-admin-reports stack" aria-labelledby="admin-reports-heading">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 id="admin-reports-heading" className="h4" style={{ margin: 0 }}><Flag size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />Reports</h2>
          <div className="segmented" role="group" aria-label="Report view">
            <button type="button" aria-pressed={view === 'open'} onClick={() => this.switchView('open')}>Open</button>
            <button type="button" aria-pressed={view === 'history'} onClick={() => this.switchView('history')}><History size={14} aria-hidden="true" />History</button>
          </div>
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {loading ? <SkeletonBlock height={120} lines={3} /> : (view === 'open' ? this.renderOpen() : this.renderHistory())}
      </section>
    );
  }
}
