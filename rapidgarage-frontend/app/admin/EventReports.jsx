import React from 'react';
import { Link } from 'react-router-dom';
import { Check, EyeOff, Eye, Trash2, Inbox } from 'lucide-react';
import { errorMessage, fetchEventReports, moderateEvent, reasonLabel, REPORT_NOTE_MAX } from '../api';
import { Alert, EmptyState, SkeletonBlock, Spinner } from '../components/ui';
import { timeAgo } from '../lib/format';
import toast from '../components/toast';
import { t } from '../i18n';

const DONE = {
  get dismiss() { return t('rep.dismissed'); },
  get hide() { return t('rep.hidden'); },
  get unhide() { return t('rep.visible'); },
  get delete() { return t('ev.deleted'); },
};
const STATUS = { get upcoming() { return t('ev.statusUpcoming'); }, get live() { return t('ev.statusLive'); }, get ended() { return t('ev.statusEnded'); } };

// Admin > Reports > Neighborhood sales: open reports grouped by event, plus hidden events.
// Hiding takes the event out of search and its short link; the member sales stay.
export default class EventReports extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, error: '', groups: [], hidden: [], notes: {}, busy: null };
  }

  componentDidMount() { this.load(); }

  load() {
    this.setState({ loading: true, error: '' });
    return fetchEventReports().then(({ ok, data }) => {
      if (!ok) return this.setState({ loading: false, error: errorMessage(data, t('ev.reportsFailed')) });
      this.setState({ loading: false, groups: data.groups, hidden: data.hidden });
      if (this.props.onCount) this.props.onCount(data.groups.reduce((n, g) => n + g.openCount, 0));
      return null;
    }).catch(() => this.setState({ loading: false, error: t('common.networkShort') }));
  }

  act(id, action) {
    if (action === 'delete' && !window.confirm(t('ev.confirmAdminDelete'))) return;
    this.setState({ busy: id + ':' + action });
    moderateEvent(id, action, (this.state.notes[id] || '').trim()).then(({ ok, data }) => {
      this.setState({ busy: null });
      if (!ok) { toast.error(errorMessage(data, t('ev.actionFailed'))); return; }
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

  head(e, fallbackName) {
    return (
      <div className="rating-item-head">
        {e ? <Link to={'/events/' + e.id}><strong>{e.name}</strong></Link> : <strong>{fallbackName}</strong>}
        {e ? <span className="small muted">{e.areaLabel} · {STATUS[e.status]} · {t('ev.saleCount', { count: e.saleCount || 0 })}{e.organizer ? ' · ' + t('ev.bySeller', { name: e.organizer.name }) : ''}</span> : null}
        {e && e.hidden ? <span className="chip chip-warning">{t('card.hidden')}</span> : null}
      </div>
    );
  }

  render() {
    const { loading, error, groups, hidden, notes } = this.state;
    if (loading) return <SkeletonBlock height={120} lines={3} />;
    if (error) return <Alert tone="danger">{error}</Alert>;
    if (!groups.length && !hidden.length) return <EmptyState icon={Inbox} title={t('ev.noReports')}>{t('ev.noReportsText')}</EmptyState>;
    return (
      <div className="stack">
        {groups.length ? (
          <ul className="rating-report-list event-report-list">
            {groups.map((g) => {
              const e = g.event;
              return (
                <li key={g.eventId} className="panel rating-report">
                  {this.head(e, g.eventName)}
                  <span className="chip chip-danger">{t('rr.reports', { count: g.openCount })}</span>
                  {e && e.description ? <blockquote className="rating-comment">{e.description}</blockquote> : null}
                  <ul className="rating-report-reasons small">
                    {g.reports.map((r) => (
                      <li key={r.id}><strong>{reasonLabel(r.reason)}</strong> · {r.reporter ? r.reporter.name : t('msg.formerUser')} · {timeAgo(r.createdAt)}{r.note ? <span className="muted"> · “{r.note}”</span> : null}</li>
                    ))}
                  </ul>
                  <label className="sr-only" htmlFor={'enote-' + g.eventId}>{t('rr.modNote')}</label>
                  <input id={'enote-' + g.eventId} type="text" className="input" placeholder={t('rr.notePlaceholder')} maxLength={REPORT_NOTE_MAX}
                    value={notes[g.eventId] || ''} onChange={(ev) => this.setState({ notes: Object.assign({}, notes, { [g.eventId]: ev.target.value }) })} />
                  {e ? (
                    <div className="form-actions">
                      {this.button(e.id, 'dismiss', Check, t('rep.dismiss'))}
                      {e.hidden ? this.button(e.id, 'unhide', Eye, t('rep.unhide')) : this.button(e.id, 'hide', EyeOff, t('rep.hide'))}
                      {this.button(e.id, 'delete', Trash2, t('rep.delete'), 'btn-danger')}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {hidden.length ? (
          <section className="stack" aria-labelledby="hidden-events">
            <h3 id="hidden-events" className="h4">{t('ev.hiddenEvents')}</h3>
            <ul className="rating-report-list">
              {hidden.map((e) => (
                <li key={e.id} className="panel rating-report">
                  {this.head(e)}
                  <div className="form-actions">
                    {this.button(e.id, 'unhide', Eye, t('rep.unhide'))}
                    {this.button(e.id, 'delete', Trash2, t('rep.delete'), 'btn-danger')}
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
