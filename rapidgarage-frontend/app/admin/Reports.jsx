import React from 'react';
import { Link } from 'react-router-dom';
import { Flag, EyeOff, Eye, Trash2, Check, ImageOff, History, Inbox, ExternalLink } from 'lucide-react';
import { errorMessage, fetchReportQueue, fetchReportHistory, moderatePost, reasonLabel, REPORT_NOTE_MAX } from '../api';
import { Alert, EmptyState, SkeletonBlock, Spinner } from '../components/ui';
import { displayName, timeAgo } from '../lib/format';
import { formatPrice } from '../lib/price';
import toast from '../components/toast';
import ConversationReports from './ConversationReports';
import RatingReports from './RatingReports';
import { fetchRatingReportQueue } from '../api';
import { t } from '../i18n';

const ACTION_TEXT = {
  dismiss: { get done() { return t('rep.dismissed'); }, get verb() { return t('rep.dismiss'); } },
  hide: { get done() { return t('rep.hidden'); }, get verb() { return t('rep.hide'); } },
  unhide: { get done() { return t('rep.visible'); }, get verb() { return t('rep.unhide'); } },
  delete: { get done() { return t('rep.deleted'); }, get verb() { return t('rep.delete'); } },
};
const OUTCOME = {
  get dismissed() { return t('rep.outDismissed'); }, get hidden() { return t('rep.outHidden'); },
  get unhidden() { return t('rep.outUnhidden'); }, get deleted() { return t('rep.outDeleted'); },
};

// Admin > Reports: open reports grouped by post, plus resolved history.
export default class Reports extends React.Component {
  constructor(props) {
    super(props);
    this.state = { kind: 'posts', convCount: 0, view: 'open', loading: true, error: '', groups: [], hidden: [], threshold: null, history: null, page: 1, notes: {}, busy: null };
  }

  componentDidMount() { this.loadQueue(); }

  loadQueue() {
    this.setState({ loading: true, error: '' });
    return fetchReportQueue()
      .then(({ ok, data }) => {
        if (!ok) return this.setState({ loading: false, error: errorMessage(data, t('rep.loadFailed')) });
        const postCount = data.groups.reduce((n, g) => n + g.openCount, 0);
        this.setState({ loading: false, groups: data.groups, hidden: data.hidden, threshold: data.autoHideThreshold, postCount, convCount: data.conversationOpenCount || 0 });
        this.reportCount();
        return null;
      })
      .catch(() => this.setState({ loading: false, error: t('common.networkShort') }));
  }

  // Badge total = posts + conversations + ratings.
  reportCount() {
    return fetchRatingReportQueue().then(({ ok, data }) => {
      const ratingCount = ok ? data.openCount : 0;
      this.setState({ ratingCount });
      if (this.props.onCount) this.props.onCount((this.state.postCount || 0) + (this.state.convCount || 0) + ratingCount);
    }).catch(() => null);
  }

  loadHistory(page) {
    this.setState({ loading: true, error: '', page });
    return fetchReportHistory(page)
      .then(({ ok, data }) => {
        if (!ok) return this.setState({ loading: false, error: errorMessage(data, t('rep.historyFailed')) });
        this.setState({ loading: false, history: data });
        return null;
      })
      .catch(() => this.setState({ loading: false, error: t('common.networkShort') }));
  }

  switchView(view) {
    this.setState({ view });
    if (view === 'open') this.loadQueue(); else this.loadHistory(1);
  }

  act(postId, title, action) {
    if (action === 'delete' && !window.confirm(t('rep.confirmDelete', { title }))) return;
    const note = (this.state.notes[postId] || '').trim();
    this.setState({ busy: postId + ':' + action });
    moderatePost(postId, action, note)
      .then(({ ok, data }) => {
        this.setState({ busy: null });
        if (!ok) { toast.error(errorMessage(data, t('rep.actionFailed'))); return null; }
        const notes = Object.assign({}, this.state.notes); delete notes[postId];
        this.setState({ notes });
        toast.success(ACTION_TEXT[action].done + (data.resolved ? t('rep.resolved', { count: data.resolved }) : ''));
        return this.loadQueue();
      })
      .catch(() => { this.setState({ busy: null }); toast.error(t('common.networkShort')); });
  }

  renderActions(post, title, actions) {
    const busy = this.state.busy;
    const noteId = 'mod-note-' + post;
    return (
      <div className="moderate-row">
        <div className="field">
          <label className="field-label" htmlFor={noteId}>{t('rep.note')}<span className="optional"> {t('ui.optional')}</span></label>
          <input id={noteId} className="input" type="text" maxLength={REPORT_NOTE_MAX} value={this.state.notes[post] || ''}
            onChange={(e) => this.setState({ notes: Object.assign({}, this.state.notes, { [post]: e.target.value }) })} placeholder={t('rep.notePlaceholder')} />
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
            {p ? [p.city, p.state].filter(Boolean).join(', ') + (formatPrice(p) ? ' · ' + formatPrice(p) : '') : t('rep.postGone')}
            {g.owner ? t('rep.by', { name: displayName(g.owner), email: g.owner.email }) : null}
          </div>
          <div className="chips">
            <span className="chip chip-danger"><Flag size={12} aria-hidden="true" />{t('rep.openReports', { count: g.openCount })}</span>
            {Object.keys(g.reasons).map((r) => <span key={r} className="chip">{reasonLabel(r)} × {g.reasons[r]}</span>)}
            {p && p.hidden ? <span className="chip chip-warning"><EyeOff size={12} aria-hidden="true" />{p.hiddenSource === 'auto' ? t('rep.autoHidden') : t('card.hidden')}</span> : null}
            <span className="chip">{t('rep.last', { when: timeAgo(g.lastReportedAt) })}</span>
          </div>
          {p && p.description ? <p className="muted" style={{ margin: 0 }}>{p.description}</p> : null}
          <ul className="report-list">
            {g.reports.map((r) => (
              <li key={r.id}>
                <strong>{reasonLabel(r.reason)}</strong> · {r.reporter ? r.reporter.email : t('rep.deletedUser')} · {timeAgo(r.createdAt)}
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
          {threshold ? t('rep.threshold', { n: threshold }) : t('rep.noAutoHide')}
        </p>
        {groups.length ? groups.map((g) => this.renderGroup(g)) : <EmptyState icon={Inbox} title={t('rep.noneOpen')}>{t('rep.nothing')}</EmptyState>}
        {hidden.length ? (
          <section aria-labelledby="hidden-heading" className="stack">
            <h3 id="hidden-heading" className="h4">{t('rep.hiddenNoReports')}</h3>
            {hidden.map((p) => (
              <article key={p.id} className="panel report-group">
                {this.renderThumb(p)}
                <div>
                  <h3><Link to={'/post/' + p.id}>{p.title}</Link></h3>
                  <div className="chips">
                    <span className="chip chip-warning"><EyeOff size={12} aria-hidden="true" />{p.hiddenSource === 'auto' ? t('rep.autoHidden') : t('card.hidden')} {p.hiddenAt ? timeAgo(p.hiddenAt) : ''}</span>
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
    if (!h.results.length) return <EmptyState icon={History} title={t('rep.noneResolved')} />;
    return (
      <div className="stack">
        <div className="table-wrap">
          <table className="table report-history">
            <thead><tr><th scope="col">{t('rep.post')}</th><th scope="col">{t('rep.reason')}</th><th scope="col">{t('rep.reporter')}</th><th scope="col">{t('rep.outcome')}</th><th scope="col">{t('rep.reviewed')}</th></tr></thead>
            <tbody>
              {h.results.map((r) => (
                <tr key={r.id}>
                  <td>{r.postExists ? <Link to={'/post/' + r.postId}>{r.postTitle || t('rep.postN', { id: r.postId })}</Link> : <span>{r.postTitle || t('rep.postN', { id: r.postId })} <small className="muted">{t('rep.deletedTag')}</small></span>}</td>
                  <td>{reasonLabel(r.reason)}{r.note ? <small className="muted" style={{ display: 'block' }}>{r.note}</small> : null}</td>
                  <td>{r.reporter ? r.reporter.email : '—'}</td>
                  <td><span className={'chip ' + (r.status === 'actioned' ? 'chip-warning' : '')}>{OUTCOME[r.action] || r.status}</span>{r.resolutionNote ? <small className="muted" style={{ display: 'block' }}>{r.resolutionNote}</small> : null}</td>
                  <td>{r.reviewer ? r.reviewer.email : (r.action === 'deleted' ? t('rep.owner') : '—')}<small className="muted" style={{ display: 'block' }}>{r.reviewedAt ? timeAgo(r.reviewedAt) : ''}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {h.totalPages > 1 ? (
          <div className="form-actions">
            <button type="button" className="btn btn-secondary btn-sm" disabled={h.page <= 1} onClick={() => this.loadHistory(h.page - 1)}>{t('rep.newer')}</button>
            <span className="muted">{t('common.pageOf', { page: h.page, total: h.totalPages })}</span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={h.page >= h.totalPages} onClick={() => this.loadHistory(h.page + 1)}>{t('rep.older')}</button>
          </div>
        ) : null}
      </div>
    );
  }

  render() {
    const { view, loading, error, kind, postCount, convCount, ratingCount } = this.state;
    const count = (n) => (n ? <span className="count" aria-label={t('admin.open', { count: n })}>{n}</span> : null);
    return (
      <section className="rg-admin-reports stack" aria-labelledby="admin-reports-heading">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 id="admin-reports-heading" className="h4" style={{ margin: 0 }}><Flag size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />{t('admin.reports')}</h2>
          <div className="segmented admin-tabs report-kind" role="group" aria-label={t('rep.type')} style={{ margin: 0 }}>
            <button type="button" aria-pressed={kind === 'posts'} onClick={() => this.setState({ kind: 'posts' })}>{t('rep.posts')}{count(postCount)}</button>
            <button type="button" aria-pressed={kind === 'conversations'} onClick={() => this.setState({ kind: 'conversations' })}>{t('msg.conversations')}{count(convCount)}</button>
            <button type="button" aria-pressed={kind === 'ratings'} onClick={() => this.setState({ kind: 'ratings' })}>{t('rep.ratings')}{count(ratingCount)}</button>
          </div>
        </div>
        {kind === 'ratings' ? (
          <RatingReports onCount={(n) => { this.setState({ ratingCount: n }); if (this.props.onCount) this.props.onCount((this.state.postCount || 0) + (this.state.convCount || 0) + n); }} />
        ) : kind === 'conversations' ? (
          <ConversationReports onCount={(n) => { this.setState({ convCount: n }); if (this.props.onCount) this.props.onCount((this.state.postCount || 0) + n + (this.state.ratingCount || 0)); }}
            onChanged={() => this.loadQueue()} />
        ) : (
        <React.Fragment>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div className="segmented" role="group" aria-label={t('rep.view')}>
            <button type="button" aria-pressed={view === 'open'} onClick={() => this.switchView('open')}>{t('rep.openTab')}</button>
            <button type="button" aria-pressed={view === 'history'} onClick={() => this.switchView('history')}><History size={14} aria-hidden="true" />{t('rep.history')}</button>
          </div>
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {loading ? <SkeletonBlock height={120} lines={3} /> : (view === 'open' ? this.renderOpen() : this.renderHistory())}
        </React.Fragment>
        )}
      </section>
    );
  }
}
