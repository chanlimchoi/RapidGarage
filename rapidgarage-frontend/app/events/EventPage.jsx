import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, MapPin, CalendarDays, UserRound, Store, Pencil, QrCode, Trash2, Flag, Check, X, LogIn, Plus, UsersRound, DoorOpen, ShieldCheck, SearchX } from 'lucide-react';
import { apiFetch, errorMessage, fetchEvent, fetchEventPrint, joinEvent, approveParticipant, removeParticipant, deleteEvent } from '../api';
import { dayLines, saleBadge, zoneNote } from '../lib/schedule';
import AddToCalendar from '../components/AddToCalendar';
import ShareButton from '../components/ShareButton';
import { BADGE_CLASS } from '../components/PostCard';
import PostCard from '../components/PostCard';
import MapView from '../components/Map';
import { Alert, EmptyState, SkeletonBlock, Spinner } from '../components/ui';
import toast from '../components/toast';
import ScanStats from '../print/ScanStats';
import EventSketch from './EventSketch';
import ReportEventDialog from './ReportEventDialog';
import { t } from '../i18n';

const PART_STATUS = { pending: 'ev.status.pending', approved: 'ev.status.approved' };
const DONE = { approve: 'ev.approvedToast', decline: 'ev.declinedToast', remove: 'ev.removedToast', leave: 'ev.leftToast' };

// /events/:id: one neighborhood sale with its participating sales on a map.
export default class EventPage extends React.Component {
  constructor(props) {
    super(props);
    this.state = { event: null, error: '', myPosts: null, joinPostId: '', joinError: '', busy: null, reportOpen: false, reported: false, selectedId: null, scans: null };
  }

  componentDidMount() { this.mounted = true; this.load(); }
  componentWillUnmount() { this.mounted = false; }
  componentDidUpdate(prev) {
    if (prev.match.params.id !== this.props.match.params.id || (prev.user || {}).id !== (this.props.user || {}).id) this.load();
  }

  load() {
    const id = this.props.match.params.id;
    fetchEvent(id).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) { this.setState({ error: errorMessage(data, t('ev.notFound')) }); return; }
      this.setState({ event: data, error: '' });
      const user = this.props.user;
      if (user) {
        apiFetch('/allbyuserId/' + user.id).then((r) => { if (this.mounted) this.setState({ myPosts: r.ok && Array.isArray(r.data) ? r.data : [] }); }).catch(() => null);
      }
      if (data.mine || (user && user.role === 'admin')) {
        fetchEventPrint(id).then((r) => { if (this.mounted && r.ok) this.setState({ scans: r.data.scans }); }).catch(() => null);
      }
    }).catch(() => this.mounted && this.setState({ error: t('common.network') }));
  }

  join(e) {
    e.preventDefault();
    const postId = Number(this.state.joinPostId);
    if (!postId) { this.setState({ joinError: t('ev.chooseSale') }); return; }
    this.setState({ busy: 'join', joinError: '' });
    joinEvent(this.state.event.id, postId).then(({ ok, data }) => {
      if (!this.mounted) return;
      this.setState({ busy: null });
      if (!ok) { this.setState({ joinError: errorMessage(data, t('ev.joinFailed')) }); return; }
      toast.success(data.status === 'approved' ? t('ev.joined') : t('ev.requested'));
      this.setState({ joinPostId: '' });
      this.load();
    }).catch(() => this.mounted && this.setState({ busy: null, joinError: t('common.networkShort') }));
  }

  participant(postId, action) {
    const ev = this.state.event;
    if (action === 'remove' && !window.confirm(t('ev.confirmRemove'))) return;
    if (action === 'leave' && !window.confirm(t('ev.confirmLeave'))) return;
    this.setState({ busy: postId + ':' + action });
    const call = action === 'approve' ? approveParticipant(ev.id, postId) : removeParticipant(ev.id, postId);
    call.then(({ ok, data }) => {
      if (!this.mounted) return;
      this.setState({ busy: null });
      if (!ok) { toast.error(errorMessage(data, t('ev.actionFailed'))); return; }
      toast.success(t(DONE[action]));
      this.load();
    }).catch(() => { if (this.mounted) { this.setState({ busy: null }); toast.error(t('common.networkShort')); } });
  }

  remove() {
    const ev = this.state.event;
    if (!window.confirm(t('ev.confirmDelete', { name: ev.name }))) return;
    this.setState({ busy: 'delete' });
    deleteEvent(ev.id).then(({ ok, data }) => {
      if (!ok) { this.setState({ busy: null }); toast.error(errorMessage(data, t('ev.actionFailed'))); return; }
      toast.success(t('ev.deleted'));
      this.props.history.push('/events');
    }).catch(() => { this.setState({ busy: null }); toast.error(t('common.networkShort')); });
  }

  renderJoin(ev) {
    const user = this.props.user;
    if (ev.ended || ev.hidden) return null;
    if (!user) {
      return (
        <div className="panel event-join">
          <h2 className="h4">{t('ev.joinTitle')}</h2>
          <p className="small muted">{t('ev.joinLead')}</p>
          <Link className="btn btn-secondary" to="/login"><LogIn size={16} aria-hidden="true" />{t('ev.loginToJoin')}</Link>
        </div>
      );
    }
    const mine = (ev.myParticipation || []);
    const inIds = new Set(mine.map((p) => p.postId));
    const titles = new Map((this.state.myPosts || []).map((p) => [p.id, p.title]));
    const options = (this.state.myPosts || []).filter((p) => !inIds.has(p.id) && !p.hidden && !(saleBadge(p) && saleBadge(p).kind === 'ended'));
    return (
      <div className="panel event-join">
        <h2 className="h4">{t('ev.joinTitle')}</h2>
        {mine.length ? (
          <ul className="event-mine">
            {mine.map((p) => (
              <li key={p.postId}>
                <Link to={'/post/' + p.postId}>{titles.get(p.postId) || t('ev.yourSale')}</Link>
                <span className={'chip ' + (p.status === 'approved' ? 'chip-success' : 'chip-info')}>{t(PART_STATUS[p.status])}</span>
                <button type="button" className="btn btn-ghost btn-sm" disabled={this.state.busy === p.postId + ':leave'} onClick={() => this.participant(p.postId, 'leave')}>
                  <DoorOpen size={14} aria-hidden="true" />{t('ev.leave')}
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="small muted">{ev.joinMode === 'open' ? t('ev.joinLeadOpen') : t('ev.joinLeadApproval')}</p>}
        {this.state.myPosts && !options.length && !mine.length ? (
          <Link className="btn btn-secondary" to="/newpost"><Plus size={16} aria-hidden="true" />{t('ev.postFirst')}</Link>
        ) : null}
        {options.length ? (
          <form className="event-join-form" onSubmit={(e) => this.join(e)} noValidate>
            <label className="field" htmlFor="event-join-post">
              <span className="field-label">{t('ev.yourSaleLabel')}</span>
              <select id="event-join-post" className="select" value={this.state.joinPostId} aria-invalid={this.state.joinError ? 'true' : undefined}
                onChange={(e) => this.setState({ joinPostId: e.target.value, joinError: '' })}>
                <option value="">{t('ev.chooseSale')}</option>
                {options.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </label>
            {this.state.joinError ? <Alert tone="danger">{this.state.joinError}</Alert> : null}
            <button type="submit" className="btn btn-primary" disabled={this.state.busy === 'join'}>
              {this.state.busy === 'join' ? <Spinner /> : <UsersRound size={16} aria-hidden="true" />}{ev.joinMode === 'open' ? t('ev.joinBtn') : t('ev.askBtn')}
            </button>
          </form>
        ) : null}
      </div>
    );
  }

  renderRequests(ev) {
    if (!ev.requests || !ev.requests.length) return null;
    return (
      <section className="panel event-requests" aria-labelledby="event-requests-title">
        <h2 id="event-requests-title" className="h4"><ShieldCheck size={18} aria-hidden="true" />{t('ev.requestsTitle', { count: ev.requests.length })}</h2>
        <ul className="event-request-list">
          {ev.requests.map((p) => (
            <li key={p.id} className="event-request">
              <div>
                <Link to={'/post/' + p.id}><strong>{p.title}</strong></Link>
                <div className="small muted">{[p.street, p.seller ? t('ev.bySeller', { name: p.seller.name }) : null].filter(Boolean).join(' · ')}</div>
              </div>
              {ev.mine ? (
                <div className="event-request-actions">
                  <button type="button" className="btn btn-primary btn-sm" disabled={!!this.state.busy} onClick={() => this.participant(p.id, 'approve')}><Check size={14} aria-hidden="true" />{t('ev.approve')}</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!!this.state.busy} onClick={() => this.participant(p.id, 'decline')}><X size={14} aria-hidden="true" />{t('ev.decline')}</button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  render() {
    const { event: ev, error } = this.state;
    if (error) {
      return (
        <div className="container container-narrow">
          <EmptyState level={1} icon={SearchX} title={t('ev.cantFind')} action={<Link className="btn btn-primary" to="/events">{t('ev.allEvents')}</Link>}>{error}</EmptyState>
        </div>
      );
    }
    if (!ev) return <div className="container"><SkeletonBlock height={260} lines={4} /></div>;
    const badge = saleBadge(ev);
    const lines = dayLines(ev);
    const zone = zoneNote(ev);
    const user = this.props.user;
    const canReport = user && !ev.mine;
    return (
      <div className="container event-page">
        <Link to="/events" className="back-link"><ArrowLeft size={16} aria-hidden="true" />{t('ev.allEvents')}</Link>
        {ev.hidden ? <Alert tone="warning" className="hidden-banner"><p><strong>{t('ev.hiddenTitle')}</strong> {t('ev.hiddenOrganizer')}</p></Alert> : null}
        {ev.ended ? <Alert tone="info" className="ended-banner"><p><strong>{t('ev.endedTitle')}</strong> {t('ev.endedText')}</p></Alert> : null}
        <header className="post-header event-header">
          <span className="event-kicker">{t('ev.kicker')}</span>
          <h1>{ev.name}</h1>
          <div className="chips">
            {badge ? <span className={'chip sale-badge ' + BADGE_CLASS[badge.kind]}>{badge.label}</span> : null}
            <span className="chip chip-brand"><Store size={12} aria-hidden="true" />{t('ev.saleCount', { count: ev.saleCount })}</span>
            <span className="chip"><MapPin size={12} aria-hidden="true" />{ev.areaLabel}</span>
            <span className="chip">{ev.joinMode === 'open' ? t('ev.modeOpenShort') : t('ev.modeApprovalShort')}</span>
          </div>
        </header>
        <div className="post-layout">
          <div className="stack">
            {ev.description ? <p className="post-description">{ev.description}</p> : null}
            <section className="event-map" aria-label={t('ev.mapLabel')}>
              <EventSketch event={ev} sales={ev.sales} selectedId={this.state.selectedId} onSelect={(id) => this.setState({ selectedId: id })} />
              <div className="event-map-live">
                <MapView quiet posts={ev.sales} user={user} config={this.props.config} center={{ lat: ev.lat, lng: ev.lng }} radius={ev.radiusMiles}
                  selectedId={this.state.selectedId} onSelect={(id) => this.setState({ selectedId: id })} label={t('ev.mapLabel')} />
              </div>
            </section>
            <section aria-labelledby="event-sales-title">
              <h2 id="event-sales-title" className="h4 event-sales-title"><Store size={18} aria-hidden="true" />{t('ev.salesTitle')} <span className="muted small">{t('ev.saleCount', { count: ev.saleCount })}</span></h2>
              {ev.sales.length ? (
                <ol className="card-grid event-sales">
                  {ev.sales.map((p, i) => (
                    <li key={p.id} className="event-sale">
                      <span className="event-sale-n" aria-hidden="true">{i + 1}</span>
                      <PostCard post={p} selected={p.id === this.state.selectedId}
                        actions={ev.mine && p.userId !== ev.organizer.id ? (
                          <button type="button" className="btn btn-ghost btn-sm" disabled={!!this.state.busy} onClick={() => this.participant(p.id, 'remove')}><X size={14} aria-hidden="true" />{t('ev.remove')}</button>
                        ) : null} />
                    </li>
                  ))}
                </ol>
              ) : <EmptyState icon={Store} title={t('ev.noSalesTitle')}>{ev.ended ? t('ev.noSalesEnded') : t('ev.noSalesText')}</EmptyState>}
            </section>
          </div>
          <aside className="post-aside">
            <div className="panel">
              <h2>{t('post.details')}</h2>
              <dl className="detail-list">
                <div><dt><UserRound size={18} aria-hidden="true" /><span>{t('ev.organizer')}</span></dt><dd>{ev.organizer ? ev.organizer.name : t('msg.formerUser')}</dd></div>
                <div><dt><MapPin size={18} aria-hidden="true" /><span>{t('ev.area')}</span></dt><dd>{ev.areaLabel}<span className="small muted schedule-zone">{t('ev.radius', { miles: ev.radiusMiles })}</span></dd></div>
                <div><dt><CalendarDays size={18} aria-hidden="true" /><span>{t('post.when')}</span></dt><dd>
                  <ul className="schedule-list">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
                  {zone ? <span className="small muted schedule-zone">{zone}</span> : null}
                </dd></div>
                <div><dt><UsersRound size={18} aria-hidden="true" /><span>{t('ev.joining')}</span></dt><dd>{ev.joinMode === 'open' ? t('ev.modeOpen') : t('ev.modeApproval')}</dd></div>
              </dl>
              {!ev.hidden && !ev.ended ? <div className="form-actions event-cal"><AddToCalendar item={ev} kind="event" /><ShareButton kind="event" item={ev} title={ev.name} /></div> : null}
              {ev.mine ? (
                <div className="form-actions">
                  <Link className="btn btn-secondary" to={'/events/' + ev.id + '/edit'}><Pencil size={16} aria-hidden="true" />{t('ev.edit')}</Link>
                  {!ev.hidden ? <Link className="btn btn-secondary print-link" to={'/events/' + ev.id + '/print'}><QrCode size={16} aria-hidden="true" />{t('ev.print')}</Link> : null}
                  <button type="button" className="btn btn-ghost btn-danger-text" disabled={this.state.busy === 'delete'} onClick={() => this.remove()}><Trash2 size={16} aria-hidden="true" />{t('ev.delete')}</button>
                </div>
              ) : null}
            </div>
            {this.renderRequests(ev)}
            {this.renderJoin(ev)}
            {this.state.scans ? (
              <div className="panel scan-panel">
                <h2 className="h4">{t('post.scansTitle')}</h2>
                <ScanStats scans={this.state.scans} compact />
                {ev.mine ? <Link className="small" to={'/events/' + ev.id + '/print'}>{t('post.printAndScans')}</Link> : null}
              </div>
            ) : null}
            {canReport ? (
              <div className="report-row">
                {this.state.reported
                  ? <span className="muted"><Flag size={14} aria-hidden="true" /> {t('ev.reported')}</span>
                  : <button type="button" className="btn btn-ghost btn-sm report-btn" onClick={() => this.setState({ reportOpen: true })}><Flag size={14} aria-hidden="true" />{t('ev.reportTitle')}</button>}
              </div>
            ) : null}
          </aside>
        </div>
        {this.state.reportOpen ? <ReportEventDialog event={ev} onDone={(sent) => this.setState({ reportOpen: false, reported: this.state.reported || sent })} /> : null}
      </div>
    );
  }
}
