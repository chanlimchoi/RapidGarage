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
import { t, intlLocale } from '../i18n';
import { tx } from '../i18n/rich';

const fullTime = (v) => (v ? new Date(v).toLocaleString(intlLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const who = (p) => (p ? p.name + (p.email ? ' (' + p.email + ')' : '') : t('msg.formerUser'));
const OUTCOME = {
  get dismissed() { return t('rep.outDismissed'); },
  get warned() { return t('cr.warned'); },
  get banned() { return t('cr.ban'); },
};
const EVENT = {
  get read() { return t('cr.evRead'); },
  get dismiss() { return t('cr.evDismiss'); },
  get warn() { return t('cr.warned'); },
  get ban() { return t('cr.evBan'); },
  get unban() { return t('cr.evUnban'); },
  get remove_message() { return t('cr.evRemove'); },
};
const DONE = {
  get dismiss() { return t('rep.dismissed'); },
  get warn() { return t('cr.warnDone'); },
  get ban() { return t('cr.banDone'); },
  get unban() { return t('cr.unbanDone'); },
  get remove_message() { return t('cr.removeDone'); },
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
        if (!ok) return this.setState({ loading: false, error: errorMessage(data, t('cr.loadFailed')) });
        this.setState({ loading: false, groups: data.groups });
        if (this.props.onCount) this.props.onCount(data.openCount);
        return null;
      })
      .catch(() => this.setState({ loading: false, error: t('common.networkShort') }));
  }

  loadHistory(page) {
    this.setState({ loading: true, error: '' });
    return fetchConversationReportHistory(page)
      .then(({ ok, data }) => {
        if (!ok) return this.setState({ loading: false, error: errorMessage(data, t('rep.historyFailed')) });
        this.setState({ loading: false, history: data });
        return null;
      })
      .catch(() => this.setState({ loading: false, error: t('common.networkShort') }));
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
        if (!ok) { this.setState({ error: errorMessage(data, t('msg.notFound')) }); return; }
        this.setState({ detail: data });
      })
      .catch(() => this.setState({ error: t('common.networkShort') }));
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
        if (!ok) { toast.error(errorMessage(data, t('rep.actionFailed'))); return null; }
        this.setState({ note: '' });
        toast.success(DONE[action] + (data.resolved ? t('rep.resolved', { count: data.resolved }) : ''));
        if (this.props.onChanged) this.props.onChanged();
        return this.reloadDetail(id);
      })
      .catch(() => { this.setState({ busy: null }); toast.error(t('common.networkShort')); });
  }

  renderPeople(people) {
    return (
      <div className="admin-convo-people">
        {people.map((p) => (
          <span key={p.id} className={'chip' + (p.messagingBanned ? ' chip-danger' : '')}>
            {p.role ? t('msg.speaker', { name: p.role === 'buyer' ? t('msg.buyer') : t('post.seller') }) + ' ' : ''}{who(p)}{p.messagingBanned ? t('cr.bannedTag') : ''}
          </span>
        ))}
      </div>
    );
  }

  renderOpen() {
    const { groups } = this.state;
    if (!groups.length) return <EmptyState icon={Inbox} title={t('cr.none')}>{t('rep.nothing')}</EmptyState>;
    return (
      <div className="stack">
        {groups.map((g) => (
          <article key={g.conversationId} className="panel stack convo-report" aria-labelledby={'cr-' + g.conversationId}>
            <div>
              <h3 id={'cr-' + g.conversationId} style={{ margin: 0 }}><MessageCircle size={16} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />
                {tx('cr.about', { title: g.post.status === 'deleted' ? t('cr.deletedTitle', { title: g.post.title }) : <Link to={'/post/' + g.post.id}>{g.post.title}</Link> })}
              </h3>
              <div className="chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                <span className="chip chip-danger">{t('rep.openReports', { count: g.openCount })}</span>
                {Object.keys(g.reasons).map((r) => <span key={r} className="chip">{conversationReasonLabel(r)} × {g.reasons[r]}</span>)}
                <span className="chip">{t('rep.last', { when: timeAgo(g.lastReportedAt) })}</span>
              </div>
            </div>
            {this.renderPeople(g.participants)}
            <ul className="report-list">
              {g.reports.map((r) => (
                <li key={r.id}><strong>{conversationReasonLabel(r.reason)}</strong>{t('cr.reportedBy', { name: who(r.reporter) })}{timeAgo(r.createdAt)}
                  {r.note ? <div><q>{r.note}</q></div> : null}</li>
              ))}
            </ul>
            <div className="form-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => this.openDetail(g.conversationId)}><Eye size={14} aria-hidden="true" />{t('cr.review')}</button>
              <span className="field-hint">{t('cr.logged')}</span>
            </div>
          </article>
        ))}
      </div>
    );
  }

  renderHistory() {
    const h = this.state.history;
    if (!h) return null;
    if (!h.results.length) return <EmptyState icon={History} title={t('cr.noneResolved')} />;
    return (
      <div className="table-wrap">
        <table className="table convo-report-history">
          <thead><tr><th scope="col">{t('cr.conversation')}</th><th scope="col">{t('rep.reason')}</th><th scope="col">{t('cr.reporterReported')}</th><th scope="col">{t('rep.outcome')}</th><th scope="col">{t('rep.reviewed')}</th><th scope="col"><span className="sr-only">{t('rep.openTab')}</span></th></tr></thead>
          <tbody>
            {h.results.map((r) => (
              <tr key={r.id}>
                <td>{r.postTitle || t('cr.convN', { id: r.conversationId })}</td>
                <td>{conversationReasonLabel(r.reason)}{r.note ? <small className="muted" style={{ display: 'block' }}>{r.note}</small> : null}</td>
                <td><small>{who(r.reporter)}<br />→ {who(r.reportedUser)}</small></td>
                <td><span className={'chip ' + (r.status === 'actioned' ? 'chip-warning' : '')}>{OUTCOME[r.action] || r.status}</span>{r.resolutionNote ? <small className="muted" style={{ display: 'block' }}>{r.resolutionNote}</small> : null}</td>
                <td><small>{r.reviewer ? r.reviewer.email : '—'}<br />{fullTime(r.reviewedAt)}</small></td>
                <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => this.openDetail(r.conversationId)}>{t('common.viewShort')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  renderDetail() {
    const { detail, busy, note, error } = this.state;
    const backBtn = <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.back()}><ArrowLeft size={14} aria-hidden="true" />{this.state.view === 'open' ? t('cr.backOpen') : t('cr.backHistory')}</button>;
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
          <h3 style={{ margin: '0 0 8px' }}>{tx('cr.about', { title: c.post.status === 'deleted' ? t('cr.deletedTitle', { title: c.post.title }) : <Link to={'/post/' + c.post.id}>{c.post.title}</Link> })}</h3>
          {this.renderPeople(c.participants)}
        </header>
        <Alert tone={open ? 'info' : 'warning'}>
          {open
            ? <p>{t('cr.openAccess')}</p>
            : <p>{t('cr.closedAccess', { time: fullTime(detail.access.until) })}{detail.access.hiddenLaterMessages ? t('cr.laterPrivate', { count: detail.access.hiddenLaterMessages }) : ''}</p>}
        </Alert>
        <section aria-labelledby="admin-convo-msgs">
          <h4 id="admin-convo-msgs" className="h4" style={{ margin: '0 0 8px' }}>{t('nav.messages')}</h4>
          <ol className="admin-log" aria-label={t('cr.messagesRO')}>
            {timeline.map((ev) => (ev.marker ? (
              <li key={ev.id} className="report-marker">{t('cr.markerBy', { name: ev.report.reporter.name })} · {conversationReasonLabel(ev.report.reason)} · {fullTime(ev.createdAt)}</li>
            ) : (
              <li key={ev.id} className={'admin-msg' + (ev.removed ? ' removed' : '')}>
                <div>
                  <div className="admin-msg-meta"><strong>{ev.sender.name}</strong> · {fullTime(ev.createdAt)}{ev.removed ? t('cr.removedTag') : ''}{ev.kind === 'meetup' ? <span className="chip chip-sm" style={{ marginLeft: 6 }}>{t('cr.meetupTag')}</span> : ev.kind === 'hold' ? <span className="chip chip-sm" style={{ marginLeft: 6 }}>{t('cr.holdTag')}</span> : null}</div>
                  <p className="admin-msg-body">{ev.body}</p>
                </div>
                {!ev.removed ? (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} aria-label={t('cr.removeFrom', { name: ev.sender.name, time: fullTime(ev.createdAt) })}
                    onClick={() => this.act('remove_message', { messageId: ev.id }, t('cr.confirmRemoveMsg', { label: t('msg.removedShort') }))}>
                    {busy === 'remove_message' + ev.id ? <Spinner /> : <Trash2 size={14} aria-hidden="true" />}{t('common.remove')}
                  </button>
                ) : null}
              </li>
            )))}
          </ol>
        </section>
        <section className="card-form stack" aria-labelledby="admin-convo-actions">
          <h4 id="admin-convo-actions" className="h4" style={{ margin: 0 }}>{t('admin.actions')}</h4>
          <div className="field">
            <label className="field-label" htmlFor="convo-mod-note">{t('cr.note')}<span className="optional">{t('cr.noteOptional')}</span></label>
            <input id="convo-mod-note" className="input" type="text" maxLength={REPORT_NOTE_MAX} value={note} onChange={(e) => this.setState({ note: e.target.value })} placeholder={t('cr.notePlaceholder')} />
          </div>
          <div className="form-actions" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy || !open} onClick={() => this.act('dismiss')}><Check size={14} aria-hidden="true" />{t('rr.dismiss')}</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!!busy || !open} onClick={() => this.act('warn')}><AlertTriangle size={14} aria-hidden="true" />{t('cr.warn')}</button>
            {c.participants.map((p) => (p.messagingBanned ? (
              <button key={p.id} type="button" className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => this.act('unban', { userId: p.id })}><Undo2 size={14} aria-hidden="true" />{t('cr.lift', { name: p.name })}</button>
            ) : (
              <button key={p.id} type="button" className="btn btn-danger btn-sm" disabled={!!busy}
                onClick={() => this.act('ban', { userId: p.id }, t('cr.confirmBan', { name: p.name, email: p.email }))}>
                <Ban size={14} aria-hidden="true" />{t('cr.banNamed', { name: p.name })}
              </button>
            )))}
          </div>
          {!open ? <p className="field-hint" style={{ margin: 0 }}>{t('cr.noneOpenHint')}</p> : null}
        </section>
        <section aria-labelledby="admin-convo-reports">
          <h4 id="admin-convo-reports" className="h4" style={{ margin: '0 0 8px' }}>{t('admin.reports')}</h4>
          <ul className="audit-list">
            {detail.reports.map((r) => (
              <li key={r.id}>
                <strong>#{r.id} {conversationReasonLabel(r.reason)}</strong> · {who(r.reporter)} → {who(r.reportedUser)} · {fullTime(r.createdAt)}
                {' '}<span className={'chip ' + (r.status === 'open' ? 'chip-danger' : r.status === 'actioned' ? 'chip-warning' : '')}>{r.status === 'open' ? t('rep.openTab') : OUTCOME[r.action] || r.status}</span>
                {r.note ? <div><q>{r.note}</q></div> : null}
                {r.reviewer ? <div className="muted"><small>{t('cr.reviewedBy', { email: r.reviewer.email, time: fullTime(r.reviewedAt) })}{r.resolutionNote ? ': ' + r.resolutionNote : ''}</small></div> : null}
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="admin-convo-audit">
          <h4 id="admin-convo-audit" className="h4" style={{ margin: '0 0 8px' }}><ShieldCheck size={16} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />{t('cr.audit')}</h4>
          <ul className="audit-list audit-trail">
            {detail.events.map((e) => (
              <li key={e.id}>
                <strong>{EVENT[e.type] || e.type}</strong>{e.targetUser ? ' · ' + e.targetUser.name : ''}{e.messageId ? t('cr.messageN', { id: e.messageId }) : ''}
                {' '}· {e.admin ? e.admin.email : t('cr.formerAdmin')} · {fullTime(e.createdAt)}{e.reportId ? t('cr.reportN', { id: e.reportId }) : ''}
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
            <p className="muted" style={{ margin: 0 }}>{t('cr.lead')}</p>
            <div className="segmented" role="group" aria-label={t('cr.view')}>
              <button type="button" aria-pressed={view === 'open'} onClick={() => this.switchView('open')}>{t('rep.openTab')}</button>
              <button type="button" aria-pressed={view === 'history'} onClick={() => this.switchView('history')}><History size={14} aria-hidden="true" />{t('rep.history')}</button>
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
