import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Eye, Check, AlertTriangle, Ban, Undo2, Trash2, History, Inbox, ShieldCheck, MessageCircle } from 'lucide-react';
import {
  errorMessage, fetchConversationReportQueue, fetchConversationReportHistory, fetchReportedConversation,
  moderateConversation, conversationReasonLabel, REPORT_NOTE_MAX,
} from '../api';
import { Alert, EmptyState, SkeletonBlock, Spinner } from '../components/ui';
import { timeAgo } from '../lib/format';
import toast from '../components/toast';

const fullTime = (v) => (v ? new Date(v).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const who = (p) => (p ? p.name + (p.email ? ' (' + p.email + ')' : '') : 'Former user');
const OUTCOME = { dismissed: 'Dismissed', warned: 'Warned', banned: 'Messaging ban' };
const EVENT = {
  read: 'Read the conversation', dismiss: 'Dismissed reports', warn: 'Warned', ban: 'Banned from messaging',
  unban: 'Lifted messaging ban', remove_message: 'Removed a message',
};
const DONE = {
  dismiss: 'Reports dismissed.', warn: 'Warning recorded.', ban: 'Messaging ban applied.', unban: 'Messaging ban lifted.', remove_message: 'Message removed.',
};

// Admin > Reports > Conversations. Message text is only fetched from the
// detail view, which the server allows for reported conversations and logs.
export default class ConversationReports extends React.Component {
  constructor(props) {
    super(props);
    this.state = { view: 'open', loading: true, error: '', groups: [], history: null, detailId: null, detail: null, note: '', busy: null };
  }

  componentDidMount() { this.loadQueue(); }

  loadQueue() {
    this.setState({ loading: true, error: '' });
    return fetchConversationReportQueue()
      .then(({ ok, data }) => {
        if (!ok) return this.setState({ loading: false, error: errorMessage(data, 'Could not load conversation reports.') });
        this.setState({ loading: false, groups: data.groups });
        if (this.props.onCount) this.props.onCount(data.openCount);
        return null;
      })
      .catch(() => this.setState({ loading: false, error: 'Unable to reach the server.' }));
  }

  loadHistory(page) {
    this.setState({ loading: true, error: '' });
    return fetchConversationReportHistory(page)
      .then(({ ok, data }) => {
        if (!ok) return this.setState({ loading: false, error: errorMessage(data, 'Could not load history.') });
        this.setState({ loading: false, history: data });
        return null;
      })
      .catch(() => this.setState({ loading: false, error: 'Unable to reach the server.' }));
  }

  switchView(view) {
    this.setState({ view, detailId: null, detail: null });
    if (view === 'open') this.loadQueue(); else this.loadHistory(1);
  }

  openDetail(id) {
    this.setState({ detailId: id, detail: null, error: '', note: '' });
    return this.reloadDetail(id);
  }

  reloadDetail(id) {
    return fetchReportedConversation(id)
      .then(({ ok, data }) => {
        if (!ok) { this.setState({ error: errorMessage(data, 'Conversation not found.') }); return; }
        this.setState({ detail: data });
      })
      .catch(() => this.setState({ error: 'Unable to reach the server.' }));
  }

  back() {
    this.setState({ detailId: null, detail: null });
    if (this.state.view === 'open') this.loadQueue(); else this.loadHistory(this.state.history ? this.state.history.page : 1);
  }

  act(action, extra, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    const id = this.state.detailId;
    const body = Object.assign({ action, note: this.state.note.trim() || undefined }, extra || {});
    this.setState({ busy: action + (extra && (extra.userId || extra.messageId) || '') });
    moderateConversation(id, body)
      .then(({ ok, data }) => {
        this.setState({ busy: null });
        if (!ok) { toast.error(errorMessage(data, 'Could not apply that action.')); return null; }
        this.setState({ note: '' });
        toast.success(DONE[action] + (data.resolved ? ' ' + data.resolved + ' report' + (data.resolved === 1 ? '' : 's') + ' resolved.' : ''));
        if (this.props.onChanged) this.props.onChanged();
        return this.reloadDetail(id);
      })
      .catch(() => { this.setState({ busy: null }); toast.error('Unable to reach the server.'); });
  }

  renderPeople(people) {
    return (
      <div className="admin-convo-people">
        {people.map((p) => (
          <span key={p.id} className={'chip' + (p.messagingBanned ? ' chip-danger' : '')}>
            {p.role === 'buyer' ? 'Buyer' : p.role === 'seller' ? 'Seller' : ''}{p.role ? ': ' : ''}{who(p)}{p.messagingBanned ? ' · banned' : ''}
          </span>
        ))}
      </div>
    );
  }

  renderOpen() {
    const { groups } = this.state;
    if (!groups.length) return <EmptyState icon={Inbox} title="No reported conversations">Nothing needs review right now.</EmptyState>;
    return (
      <div className="stack">
        {groups.map((g) => (
          <article key={g.conversationId} className="panel stack convo-report" aria-labelledby={'cr-' + g.conversationId}>
            <div>
              <h3 id={'cr-' + g.conversationId} style={{ margin: 0 }}><MessageCircle size={16} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />
                Conversation about {g.post.status === 'deleted' ? g.post.title + ' (deleted)' : <Link to={'/post/' + g.post.id}>{g.post.title}</Link>}
              </h3>
              <div className="chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                <span className="chip chip-danger">{g.openCount} open report{g.openCount === 1 ? '' : 's'}</span>
                {Object.keys(g.reasons).map((r) => <span key={r} className="chip">{conversationReasonLabel(r)} × {g.reasons[r]}</span>)}
                <span className="chip">Last {timeAgo(g.lastReportedAt)}</span>
              </div>
            </div>
            {this.renderPeople(g.participants)}
            <ul className="report-list">
              {g.reports.map((r) => (
                <li key={r.id}><strong>{conversationReasonLabel(r.reason)}</strong> · reported by {who(r.reporter)} · {timeAgo(r.createdAt)}
                  {r.note ? <div><q>{r.note}</q></div> : null}</li>
              ))}
            </ul>
            <div className="form-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => this.openDetail(g.conversationId)}><Eye size={14} aria-hidden="true" />Review conversation</button>
              <span className="field-hint">Opening it is recorded in the audit log.</span>
            </div>
          </article>
        ))}
      </div>
    );
  }

  renderHistory() {
    const h = this.state.history;
    if (!h) return null;
    if (!h.results.length) return <EmptyState icon={History} title="No resolved conversation reports yet" />;
    return (
      <div className="table-wrap">
        <table className="table convo-report-history">
          <thead><tr><th scope="col">Conversation</th><th scope="col">Reason</th><th scope="col">Reporter → reported</th><th scope="col">Outcome</th><th scope="col">Reviewed</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
          <tbody>
            {h.results.map((r) => (
              <tr key={r.id}>
                <td>{r.postTitle || 'Conversation #' + r.conversationId}</td>
                <td>{conversationReasonLabel(r.reason)}{r.note ? <small className="muted" style={{ display: 'block' }}>{r.note}</small> : null}</td>
                <td><small>{who(r.reporter)}<br />→ {who(r.reportedUser)}</small></td>
                <td><span className={'chip ' + (r.status === 'actioned' ? 'chip-warning' : '')}>{OUTCOME[r.action] || r.status}</span>{r.resolutionNote ? <small className="muted" style={{ display: 'block' }}>{r.resolutionNote}</small> : null}</td>
                <td><small>{r.reviewer ? r.reviewer.email : '—'}<br />{fullTime(r.reviewedAt)}</small></td>
                <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => this.openDetail(r.conversationId)}>View</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  renderDetail() {
    const { detail, busy, note, error } = this.state;
    const backBtn = <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.back()}><ArrowLeft size={14} aria-hidden="true" />Back to {this.state.view === 'open' ? 'open reports' : 'history'}</button>;
    if (error) return <div className="stack">{backBtn}<Alert tone="danger">{error}</Alert></div>;
    if (!detail) return <div className="stack">{backBtn}<SkeletonBlock height={160} lines={3} /></div>;
    const c = detail.conversation;
    const open = detail.access.mode === 'open';
    // Interleave report markers with the messages by time.
    const markers = detail.reports.map((r) => ({ marker: true, id: 'r' + r.id, createdAt: r.createdAt, report: r }));
    const timeline = detail.messages.map((m) => Object.assign({ marker: false }, m)).concat(markers)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || (a.marker ? 1 : -1));
    return (
      <div className="admin-convo">
        {backBtn}
        <header>
          <h3 style={{ margin: '0 0 8px' }}>Conversation about {c.post.status === 'deleted' ? c.post.title + ' (deleted)' : <Link to={'/post/' + c.post.id}>{c.post.title}</Link>}</h3>
          {this.renderPeople(c.participants)}
        </header>
        <Alert tone={open ? 'info' : 'warning'}>
          {open
            ? <p>This conversation has an open report, so you can read every message, before and after the report. Read-only. Your access is logged.</p>
            : <p>All reports are resolved. Showing messages up to {fullTime(detail.access.until)}.{detail.access.hiddenLaterMessages ? ' ' + detail.access.hiddenLaterMessages + ' later message' + (detail.access.hiddenLaterMessages === 1 ? ' stays' : 's stay') + ' private unless someone reports again.' : ''}</p>}
        </Alert>
        <section aria-labelledby="admin-convo-msgs">
          <h4 id="admin-convo-msgs" className="h4" style={{ margin: '0 0 8px' }}>Messages</h4>
          <ol className="admin-log" aria-label="Messages (read-only)">
            {timeline.map((t) => (t.marker ? (
              <li key={t.id} className="report-marker">Reported by {t.report.reporter.name} · {conversationReasonLabel(t.report.reason)} · {fullTime(t.createdAt)}</li>
            ) : (
              <li key={t.id} className={'admin-msg' + (t.removed ? ' removed' : '')}>
                <div>
                  <div className="admin-msg-meta"><strong>{t.sender.name}</strong> · {fullTime(t.createdAt)}{t.removed ? ' · removed by moderator' : ''}</div>
                  <p className="admin-msg-body">{t.body}</p>
                </div>
                {!t.removed ? (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} aria-label={'Remove message from ' + t.sender.name + ' sent ' + fullTime(t.createdAt)}
                    onClick={() => this.act('remove_message', { messageId: t.id }, 'Remove this message? Participants will see "Removed by moderator".')}>
                    {busy === 'remove_message' + t.id ? <Spinner /> : <Trash2 size={14} aria-hidden="true" />}Remove
                  </button>
                ) : null}
              </li>
            )))}
          </ol>
        </section>
        <section className="card-form stack" aria-labelledby="admin-convo-actions">
          <h4 id="admin-convo-actions" className="h4" style={{ margin: 0 }}>Actions</h4>
          <div className="field">
            <label className="field-label" htmlFor="convo-mod-note">Note<span className="optional"> (optional, admins only)</span></label>
            <input id="convo-mod-note" className="input" type="text" maxLength={REPORT_NOTE_MAX} value={note} onChange={(e) => this.setState({ note: e.target.value })} placeholder="Recorded in history and the audit log" />
          </div>
          <div className="form-actions" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy || !open} onClick={() => this.act('dismiss')}><Check size={14} aria-hidden="true" />Dismiss</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy || !open} onClick={() => this.act('warn')}><AlertTriangle size={14} aria-hidden="true" />Warn (note only)</button>
            {c.participants.map((p) => (p.messagingBanned ? (
              <button key={p.id} type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => this.act('unban', { userId: p.id })}><Undo2 size={14} aria-hidden="true" />Lift ban on {p.name}</button>
            ) : (
              <button key={p.id} type="button" className="btn btn-danger btn-sm" disabled={!!busy}
                onClick={() => this.act('ban', { userId: p.id }, 'Ban ' + p.name + ' (' + p.email + ') from messaging? They can still read conversations but not send or start them.')}>
                <Ban size={14} aria-hidden="true" />Ban {p.name} from messaging
              </button>
            )))}
          </div>
          {!open ? <p className="field-hint" style={{ margin: 0 }}>Dismiss and warn apply to open reports; there are none.</p> : null}
        </section>
        <section aria-labelledby="admin-convo-reports">
          <h4 id="admin-convo-reports" className="h4" style={{ margin: '0 0 8px' }}>Reports</h4>
          <ul className="audit-list">
            {detail.reports.map((r) => (
              <li key={r.id}>
                <strong>#{r.id} {conversationReasonLabel(r.reason)}</strong> · {who(r.reporter)} → {who(r.reportedUser)} · {fullTime(r.createdAt)}
                {' '}<span className={'chip ' + (r.status === 'open' ? 'chip-danger' : r.status === 'actioned' ? 'chip-warning' : '')}>{r.status === 'open' ? 'Open' : OUTCOME[r.action] || r.status}</span>
                {r.note ? <div><q>{r.note}</q></div> : null}
                {r.reviewer ? <div className="muted"><small>Reviewed by {r.reviewer.email} {fullTime(r.reviewedAt)}{r.resolutionNote ? ': ' + r.resolutionNote : ''}</small></div> : null}
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="admin-convo-audit">
          <h4 id="admin-convo-audit" className="h4" style={{ margin: '0 0 8px' }}><ShieldCheck size={16} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />Audit trail</h4>
          <ul className="audit-list audit-trail">
            {detail.events.map((e) => (
              <li key={e.id}>
                <strong>{EVENT[e.type] || e.type}</strong>{e.targetUser ? ' · ' + e.targetUser.name : ''}{e.messageId ? ' · message #' + e.messageId : ''}
                {' '}· {e.admin ? e.admin.email : 'former admin'} · {fullTime(e.createdAt)}{e.reportId ? ' · report #' + e.reportId : ''}
                {e.note ? <div className="muted"><small>{e.note}</small></div> : null}
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  }

  render() {
    const { view, loading, error, detailId } = this.state;
    return (
      <div className="stack">
        {!detailId ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <p className="muted" style={{ margin: 0 }}>Admins can read a conversation only after a participant reports it.</p>
            <div className="segmented" role="group" aria-label="Conversation report view">
              <button type="button" aria-pressed={view === 'open'} onClick={() => this.switchView('open')}>Open</button>
              <button type="button" aria-pressed={view === 'history'} onClick={() => this.switchView('history')}><History size={14} aria-hidden="true" />History</button>
            </div>
          </div>
        ) : null}
        {detailId ? this.renderDetail() : (
          <React.Fragment>
            {error ? <Alert tone="danger">{error}</Alert> : null}
            {loading ? <SkeletonBlock height={120} lines={3} /> : (view === 'open' ? this.renderOpen() : this.renderHistory())}
          </React.Fragment>
        )}
      </div>
    );
  }
}
