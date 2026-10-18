import React from 'react';
import { Link } from 'react-router-dom';
import { Check, EyeOff, Eye, Trash2, Inbox } from 'lucide-react';
import { errorMessage, fetchWantedReports, moderateWanted, reasonLabel, REPORT_NOTE_MAX } from '../api';
import { Alert, EmptyState, SkeletonBlock, Spinner } from '../components/ui';
import { timeAgo } from '../lib/format';
import toast from '../components/toast';
import { t } from '../i18n';

const DONE = {
  get dismiss() { return t('rep.dismissed'); },
  get hide() { return t('want.hiddenToast'); },
  get unhide() { return t('want.visibleToast'); },
  get delete() { return t('want.deleted'); },
};
const STATUS = { get active() { return t('want.status.active'); }, get expired() { return t('want.status.expired'); }, get fulfilled() { return t('want.status.fulfilled'); } };

// Admin > Reports > Wanted: open reports grouped by wanted post, plus hidden ones.
// Hiding takes it off the board, stops matching and blocks new conversations.
export default class WantedReports extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, error: '', groups: [], hidden: [], notes: {}, busy: null };
  }

  componentDidMount() { this.load(); }

  load() {
    this.setState({ loading: true, error: '' });
    return fetchWantedReports().then(({ ok, data }) => {
      if (!ok) return this.setState({ loading: false, error: errorMessage(data, t('want.reportsFailed')) });
      this.setState({ loading: false, groups: data.groups, hidden: data.hidden });
      if (this.props.onCount) this.props.onCount(data.groups.reduce((n, g) => n + g.openCount, 0));
      return null;
    }).catch(() => this.setState({ loading: false, error: t('common.networkShort') }));
  }

  act(id, action) {
    if (action === 'delete' && !window.confirm(t('want.confirmAdminDelete'))) return;
    this.setState({ busy: id + ':' + action });
    moderateWanted(id, action, (this.state.notes[id] || '').trim()).then(({ ok, data }) => {
      this.setState({ busy: null });
      if (!ok) { toast.error(errorMessage(data, t('want.actionFailed'))); return; }
      toast.success(DONE[action]);
      this.load();
    }).catch(() => this.setState({ busy: null }));
  }

  button(id, action, Icon, label, tone) {
    const { busy } = this.state;
    return (
      <button type="button" className={'btn btn-sm ' + (tone || 'btn-secondary')} disabled={!!busy} onClick={() => this.act(id, action)}>
        {busy === id + ':' + action ? <Spinner /> : <Icon size={14} aria-hidden="true" />}{label}
      </button>
    );
  }

  head(w, fallbackTitle) {
    return (
      <div className="rating-item-head">
        {w ? <Link to={'/wanted/' + w.id}><strong>{w.title}</strong></Link> : <strong>{fallbackTitle}</strong>}
        {w ? <span className="small muted">{w.areaLabel} · {STATUS[w.status]}{w.poster ? ' · ' + t('want.by', { name: w.poster.name }) : ''}</span> : null}
        {w && w.hidden ? <span className="chip chip-warning">{t('card.hidden')}</span> : null}
      </div>
    );
  }

  render() {
    const { loading, error, groups, hidden, notes } = this.state;
    if (loading) return <SkeletonBlock height={120} lines={3} />;
    if (error) return <Alert tone="danger">{error}</Alert>;
    if (!groups.length && !hidden.length) return <EmptyState icon={Inbox} title={t('want.noReports')}>{t('want.noReportsText')}</EmptyState>;
    return (
      <div className="stack">
        {groups.length ? (
          <ul className="rating-report-list wanted-report-list">
            {groups.map((g) => {
              const e = g.wanted;
              return (
                <li key={g.wantedId} className="panel rating-report">
                  {this.head(e, g.wantedTitle)}
                  <span className="chip chip-danger">{t('rr.reports', { count: g.openCount })}</span>
                  {e && e.details ? <blockquote className="rating-comment">{e.details}</blockquote> : null}
                  <ul className="rating-report-reasons small">
                    {g.reports.map((r) => (
                      <li key={r.id}><strong>{reasonLabel(r.reason)}</strong> · {r.reporter ? r.reporter.name : t('msg.formerUser')} · {timeAgo(r.createdAt)}{r.note ? <span className="muted"> · “{r.note}”</span> : null}</li>
                    ))}
                  </ul>
                  <label className="sr-only" htmlFor={'wnote-' + g.wantedId}>{t('rr.modNote')}</label>
                  <input id={'wnote-' + g.wantedId} type="text" className="input" placeholder={t('rr.notePlaceholder')} maxLength={REPORT_NOTE_MAX}
                    value={notes[g.wantedId] || ''} onChange={(ev) => this.setState({ notes: Object.assign({}, notes, { [g.wantedId]: ev.target.value }) })} />
                  {e ? (
                    <div className="form-actions">
                      {this.button(e.id, 'dismiss', Check, t('rep.dismiss'))}
                      {e.hidden ? this.button(e.id, 'unhide', Eye, t('want.adminUnhide')) : this.button(e.id, 'hide', EyeOff, t('want.adminHide'))}
                      {this.button(e.id, 'delete', Trash2, t('want.adminDelete'), 'btn-danger')}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {hidden.length ? (
          <section className="stack" aria-labelledby="hidden-wanted">
            <h3 id="hidden-wanted" className="h4">{t('want.hiddenList')}</h3>
            <ul className="rating-report-list">
              {hidden.map((e) => (
                <li key={e.id} className="panel rating-report">
                  {this.head(e)}
                  <div className="form-actions">
                    {this.button(e.id, 'unhide', Eye, t('want.adminUnhide'))}
                    {this.button(e.id, 'delete', Trash2, t('want.adminDelete'), 'btn-danger')}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  }
}
