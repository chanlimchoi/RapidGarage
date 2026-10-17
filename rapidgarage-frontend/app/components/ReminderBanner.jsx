import React from 'react';
import { Link } from 'react-router-dom';
import { BellRing, X } from 'lucide-react';
import { fetchTodayReminders, markReminderSeen } from '../api';
import { t, intlLocale } from '../i18n';

// In-app half of the morning-of reminder: today's saved sales, shown once the
// reminder window opens (works without email). Dismissing marks it seen.
export function windowText(n) {
  try {
    const f = new Intl.DateTimeFormat(intlLocale(), { timeZone: n.timeZone, hour: 'numeric', minute: '2-digit' });
    return f.format(new Date(n.startsAt)) + '–' + f.format(new Date(n.endsAt));
  } catch (e) { return ''; }
}

export default class ReminderBanner extends React.Component {
  constructor(props) {
    super(props);
    this.state = { items: [] };
  }

  componentDidMount() { this.mounted = true; this.load(); }
  componentWillUnmount() { this.mounted = false; }
  componentDidUpdate(prev) {
    if (prev.count !== this.props.count || (prev.userId !== this.props.userId)) this.load();
  }

  load() {
    if (!this.props.userId || !this.props.count) { if (this.state.items.length) this.setState({ items: [] }); return; }
    fetchTodayReminders().then(({ ok, data }) => { if (this.mounted && ok && data) this.setState({ items: data.results || [] }); }).catch(() => null);
  }

  dismiss(n) {
    this.setState({ items: this.state.items.filter((x) => x.id !== n.id) });
    markReminderSeen(n.id).then(() => this.props.onChange && this.props.onChange()).catch(() => null);
  }

  render() {
    const items = this.state.items;
    if (!items.length) return null;
    return (
      <div className="reminder-banner-wrap container" role="region" aria-label={t('rem.bannerLabel')}>
        {items.slice(0, 3).map((n) => (
          <div key={n.id} className="reminder-banner">
            <BellRing size={18} aria-hidden="true" className="reminder-banner-icon" />
            <p>
              <strong>{n.open ? t('rem.bannerOpen') : t('rem.bannerToday')}</strong>{' '}
              <Link to={'/post/' + n.postId}>{n.title}</Link>
              <span className="muted"> · {windowText(n)}{n.city ? ' · ' + [n.city, n.state].filter(Boolean).join(', ') : ''}</span>
            </p>
            <Link className="btn btn-secondary btn-sm" to="/saved?when=today#route">{t('rem.route')}</Link>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label={t('rem.dismissNamed', { title: n.title })} onClick={() => this.dismiss(n)}><X size={16} aria-hidden="true" /></button>
          </div>
        ))}
        {items.length > 3 ? <p className="small muted"><Link to="/saved?when=today#route">{t('rem.more', { count: items.length - 3 })}</Link></p> : null}
      </div>
    );
  }
}
