import React from 'react';
import { Link } from 'react-router-dom';
import { Bell, LogIn, Settings as SettingsIcon, Search } from 'lucide-react';
import { fetchNotifications, markNotificationsSeen, errorMessage } from '../api';
import { EmptyState, SkeletonBlock, Alert } from '../components/ui';
import { timeAgo } from '../lib/format';
import { notificationLink, notificationText } from '../lib/savedSearch';
import { t } from '../i18n';

// /notifications: new sales matching my saved searches (and later, updates
// about favorites). Opening the page marks everything seen; items that were
// new when it opened keep a "New" chip until the next visit.
export default class Notifications extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, error: '', results: [] };
  }

  componentDidMount() { this.mounted = true; document.title = t('notif.pageTitle') + ' · RapidGarage'; this.load(); }
  componentDidUpdate(prev) { if ((prev.user && prev.user.id) !== (this.props.user && this.props.user.id)) this.load(); }
  componentWillUnmount() { this.mounted = false; }

  load() {
    if (!this.props.user) return this.setState({ loading: false });
    this.setState({ loading: true, error: '' });
    return fetchNotifications().then(({ ok, data }) => {
      if (!this.mounted) return undefined;
      if (!ok) return this.setState({ loading: false, error: errorMessage(data, t('notif.loadFailed')) });
      this.setState({ loading: false, results: data.results });
      if (!data.unread) return undefined;
      return markNotificationsSeen().then(() => { if (this.props.onSeen) this.props.onSeen(); }).catch(() => {});
    }).catch(() => this.mounted && this.setState({ loading: false, error: t('common.networkShort') }));
  }

  render() {
    if (!this.props.user) {
      if (!this.props.ready) return <div className="container"><SkeletonBlock lines={3} /></div>;
      return (
        <div className="container container-narrow">
          <EmptyState level={1} icon={LogIn} title={t('notif.loginTitle')} action={<Link className="btn btn-primary" to="/login">{t('nav.logIn')}</Link>} />
        </div>
      );
    }
    const { loading, error, results } = this.state;
    return (
      <div className="container container-narrow page notifications-page">
        <header className="page-header">
          <div><h1>{t('notif.pageTitle')}</h1><p>{t('notif.pageLead')}</p></div>
          <Link className="btn btn-secondary btn-sm" to="/settings#alerts"><SettingsIcon size={16} aria-hidden="true" />{t('notif.manage')}</Link>
        </header>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {loading ? <SkeletonBlock lines={4} height={44} /> : !results.length ? (
          <EmptyState icon={Bell} title={t('notif.none')} action={<Link className="btn btn-primary" to="/"><Search size={16} aria-hidden="true" />{t('nav.browseSales')}</Link>}>
            {t('notif.noneText')}
          </EmptyState>
        ) : (
          <ul className="notification-list panel">
            {results.map((n) => (
              <li key={n.id} className={'notification-row' + (n.seen ? '' : ' is-new')} data-notification-id={n.id}>
                <Link to={notificationLink(n)} className="notification-link">{notificationText(n)}</Link>
                <span className="small muted notification-meta">
                  {!n.seen ? <span className="chip chip-brand">{t('notif.new')}</span> : null}
                  {n.post && n.post.seller ? <span>{t('notif.by', { name: n.post.seller.name })}</span> : null}
                  {n.post && n.post.city ? <span>{n.post.city}</span> : null}
                  <time dateTime={n.createdAt}>{timeAgo(n.createdAt)}</time>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
}
