import React from 'react';
import { Link } from 'react-router-dom';
import { Plus, UsersRound, CalendarSearch } from 'lucide-react';
import { errorMessage, fetchEvents, fetchMyEvents } from '../api';
import { Alert, EmptyState, SkeletonGrid } from '../components/ui';
import EventCard from './EventCard';
import { t } from '../i18n';

const PART_STATUS = { pending: 'ev.status.pending', approved: 'ev.status.approved' };

// /events: upcoming neighborhood sales, plus the ones I organize or joined.
export default class EventsIndex extends React.Component {
  constructor(props) {
    super(props);
    this.state = { upcoming: null, mine: null, error: '' };
  }

  componentDidMount() { this.mounted = true; this.load(); }
  componentWillUnmount() { this.mounted = false; }
  componentDidUpdate(prev) { if ((prev.user || {}).id !== (this.props.user || {}).id) this.load(); }

  load() {
    fetchEvents().then(({ ok, data }) => this.mounted && this.setState(ok ? { upcoming: data.results } : { upcoming: [], error: errorMessage(data, t('ev.loadFailed')) }))
      .catch(() => this.mounted && this.setState({ upcoming: [], error: t('common.network') }));
    if (this.props.user) {
      fetchMyEvents().then(({ ok, data }) => this.mounted && ok && this.setState({ mine: data })).catch(() => null);
    } else this.setState({ mine: null });
  }

  render() {
    const { upcoming, mine, error } = this.state;
    const organized = mine ? mine.organized : [];
    const joined = mine ? mine.joined : [];
    return (
      <div className="container events-index">
        <header className="page-header page-header-row">
          <div>
            <h1>{t('ev.indexTitle')}</h1>
            <p className="muted">{t('ev.indexLead')}</p>
          </div>
          <Link className="btn btn-primary new-event" to="/events/new"><Plus size={16} aria-hidden="true" />{t('ev.start')}</Link>
        </header>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {organized.length ? (
          <section aria-labelledby="ev-organized" className="events-section">
            <h2 id="ev-organized" className="h4">{t('ev.organizedTitle')}</h2>
            <div className="event-grid">
              {organized.map((e) => <EventCard key={e.id} event={e} extra={e.pendingCount ? <p className="small event-pending"><Link to={'/events/' + e.id}>{t('ev.pendingCount', { count: e.pendingCount })}</Link></p> : null} />)}
            </div>
          </section>
        ) : null}
        {joined.length ? (
          <section aria-labelledby="ev-joined" className="events-section">
            <h2 id="ev-joined" className="h4">{t('ev.joinedTitle')}</h2>
            <div className="event-grid">
              {joined.map((e) => <EventCard key={e.id} event={e} extra={(
                <ul className="event-mine small">{e.myParticipation.map((p) => <li key={p.postId}><Link to={'/post/' + p.postId}>{p.postTitle}</Link> <span className={'chip ' + (p.status === 'approved' ? 'chip-success' : 'chip-info')}>{t(PART_STATUS[p.status])}</span></li>)}</ul>
              )} />)}
            </div>
          </section>
        ) : null}
        <section aria-labelledby="ev-upcoming" className="events-section">
          <h2 id="ev-upcoming" className="h4">{t('ev.upcomingTitle')}</h2>
          {upcoming === null ? <SkeletonGrid count={3} /> : upcoming.length ? (
            <div className="event-grid">{upcoming.map((e) => <EventCard key={e.id} event={e} />)}</div>
          ) : (
            <EmptyState icon={CalendarSearch} title={t('ev.noneTitle')} action={<Link className="btn btn-secondary" to="/events/new"><UsersRound size={16} aria-hidden="true" />{t('ev.start')}</Link>}>{t('ev.noneText')}</EmptyState>
          )}
        </section>
      </div>
    );
  }
}
