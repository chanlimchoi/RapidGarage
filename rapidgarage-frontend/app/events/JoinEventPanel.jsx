import React from 'react';
import { Link } from 'react-router-dom';
import { UsersRound, DoorOpen, Plus } from 'lucide-react';
import { errorMessage, eventsForPost, joinEvent, removeParticipant } from '../api';
import { shortWhen } from '../lib/schedule';
import { Spinner } from '../components/ui';
import toast from '../components/toast';
import { t } from '../i18n';

const PART_STATUS = { pending: 'ev.status.pending', approved: 'ev.status.approved' };

// Seller's view on their own sale page: which neighborhood sale it is part of,
// or the nearby ones it can join (and why not, when it can't).
export default class JoinEventPanel extends React.Component {
  constructor(props) {
    super(props);
    this.state = { data: null, busy: null };
  }
  componentDidMount() { this.mounted = true; this.load(); }
  componentWillUnmount() { this.mounted = false; }

  load() {
    eventsForPost(this.props.post.id).then(({ ok, data }) => { if (this.mounted && ok) this.setState({ data }); }).catch(() => null);
  }

  join(ev) {
    this.setState({ busy: ev.id });
    joinEvent(ev.id, this.props.post.id).then(({ ok, data }) => {
      if (!this.mounted) return;
      this.setState({ busy: null });
      if (!ok) { toast.error(errorMessage(data, t('ev.joinFailed'))); return; }
      toast.success(data.status === 'approved' ? t('ev.joined') : t('ev.requested'));
      this.load();
      if (this.props.onChange) this.props.onChange();
    }).catch(() => { if (this.mounted) { this.setState({ busy: null }); toast.error(t('common.networkShort')); } });
  }

  leave(ev) {
    if (!window.confirm(t('ev.confirmLeave'))) return;
    this.setState({ busy: ev.id });
    removeParticipant(ev.id, this.props.post.id).then(({ ok, data }) => {
      if (!this.mounted) return;
      this.setState({ busy: null });
      if (!ok) { toast.error(errorMessage(data, t('ev.actionFailed'))); return; }
      toast.success(t('ev.leftToast'));
      this.load();
      if (this.props.onChange) this.props.onChange();
    }).catch(() => { if (this.mounted) { this.setState({ busy: null }); toast.error(t('common.networkShort')); } });
  }

  render() {
    const d = this.state.data;
    if (!d) return null;
    const cur = d.current;
    return (
      <section className="panel join-event-panel" aria-labelledby="join-event-title">
        <h2 id="join-event-title" className="h4"><UsersRound size={18} aria-hidden="true" />{t('ev.panelTitle')}</h2>
        {cur ? (
          <div className="join-event-current">
            <p><Link to={'/events/' + cur.id}><strong>{cur.name}</strong></Link> <span className={'chip ' + (cur.participation === 'approved' ? 'chip-success' : 'chip-info')}>{t(PART_STATUS[cur.participation])}</span></p>
            <p className="small muted">{cur.areaLabel}{shortWhen(cur) ? ' · ' + shortWhen(cur) : ''}</p>
            <button type="button" className="btn btn-ghost btn-sm" disabled={this.state.busy === cur.id} onClick={() => this.leave(cur)}><DoorOpen size={14} aria-hidden="true" />{t('ev.leave')}</button>
          </div>
        ) : d.options.length ? (
          <ul className="join-event-options">
            {d.options.map((ev) => (
              <li key={ev.id}>
                <div>
                  <Link to={'/events/' + ev.id}><strong>{ev.name}</strong></Link>
                  <div className="small muted">{ev.areaLabel}{shortWhen(ev) ? ' · ' + shortWhen(ev) : ''}</div>
                  {!ev.canJoin ? <div className="small join-event-why">{ev.reason}</div> : null}
                </div>
                {ev.canJoin ? (
                  <button type="button" className="btn btn-secondary btn-sm" disabled={this.state.busy === ev.id} onClick={() => this.join(ev)}>
                    {this.state.busy === ev.id ? <Spinner /> : <UsersRound size={14} aria-hidden="true" />}{ev.joinMode === 'open' ? t('ev.joinBtn') : t('ev.askBtn')}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted">{d.hasLocation ? t('ev.noneNearby') : t('ev.needsLocation')}</p>
        )}
        {!cur ? <Link className="small" to="/events/new"><Plus size={14} aria-hidden="true" /> {t('ev.startOne')}</Link> : null}
      </section>
    );
  }
}
