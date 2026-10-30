import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ChevronRight } from 'lucide-react';
import { fetchUpcomingPickups } from '../api';
import { t, intlLocale } from '../i18n';
import { slotText, openSlots } from '../messages/pickupText';

const list = (names) => { try { return new Intl.ListFormat(intlLocale(), { style: 'long', type: 'conjunction' }).format(names); } catch (e) { return names.join(', '); } };

// Dashboard: pickups I'm part of (selling or buying), booked ones first.
// Nothing shows when there are none (or the request fails).
export default class UpcomingPickups extends React.Component {
  constructor(props) { super(props); this.state = { rows: [] }; }
  componentDidMount() {
    this.unmounted = false;
    fetchUpcomingPickups().then(({ ok, data }) => { if (!this.unmounted && ok) this.setState({ rows: data.results || [] }); }).catch(() => {});
  }
  componentWillUnmount() { this.unmounted = true; }

  render() {
    const { rows } = this.state;
    if (!rows.length) return null;
    return (
      <section className="panel dash-pickups" aria-labelledby="dash-pickups-title">
        <h2 id="dash-pickups-title" className="h4"><CalendarClock size={18} aria-hidden="true" className="h1-icon" />{t('dash.pickups')}</h2>
        <ul className="dash-pickup-list">
          {rows.map((p) => {
            const name = p.other ? p.other.name : t('msg.formerUser');
            const when = p.status === 'booked' ? slotText(p.chosen)
              : p.role === 'buyer' ? t('dash.pickupPick', { count: openSlots(p).length }) : t('pickup.waiting', { name }).replace(/\.\.$/, '.');
            return (
              <li key={p.id} className={'dash-pickup dash-pickup-' + p.status}>
                <div className="dash-pickup-main">
                  <strong>{when}</strong>
                  <span className="small muted">
                    <span className="chip">{p.role === 'seller' ? t('dash.pickupSelling') : t('dash.pickupBuying')}</span>{' '}
                    {t('dash.pickupWith', { name, items: list(p.items), title: p.post ? p.post.title : '' })}
                  </span>
                </div>
                <Link className="btn btn-ghost btn-sm" to={'/messages/' + p.conversationId} aria-label={t('dash.pickupOpenFor', { name })}>
                  {p.status === 'offered' && p.role === 'buyer' ? t('dash.pickupChoose') : t('dash.pickupOpen')}<ChevronRight size={14} aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }
}
