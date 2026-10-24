import React from 'react';
import { Link } from 'react-router-dom';
import { UsersRound, LogIn, Search, Mail, MailX, UserMinus } from 'lucide-react';
import { fetchFollows, setFollowing, setFollowEmails, apiFetch, errorMessage } from '../api';
import PostCard from '../components/PostCard';
import SaveButton from '../saved/SaveButton';
import { EmptyState, SkeletonGrid, SkeletonBlock, Alert } from '../components/ui';
import toast from '../components/toast';
import { t } from '../i18n';
import FavoritesTabs from '../favorites/FavoritesTabs';

// /following: current sales by people I follow, and the people themselves
// (email switch and unfollow per person).
export default class Following extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loading: true, error: '', people: [], sales: [] };
  }

  componentDidMount() { this.mounted = true; document.title = t('fav.sellers') + ' · ' + t('fav.title') + ' · RapidGarage'; this.load(); }
  componentDidUpdate(prev) { if ((prev.user && prev.user.id) !== (this.props.user && this.props.user.id)) this.load(); }
  componentWillUnmount() { this.mounted = false; }

  load() {
    if (!this.props.user) return this.setState({ loading: false });
    this.setState({ loading: true, error: '' });
    return Promise.all([fetchFollows(), apiFetch('/allPosts?following=1')]).then(([people, sales]) => {
      if (!this.mounted) return;
      if (!people.ok || !sales.ok) return this.setState({ loading: false, error: errorMessage(people.ok ? sales.data : people.data, t('follow.loadFailed')) });
      this.setState({ loading: false, people: people.data.results, sales: sales.data });
    }).catch(() => this.mounted && this.setState({ loading: false, error: t('common.networkShort') }));
  }

  emails(person, notify) {
    setFollowEmails(person.seller.id, notify).then(({ ok, data }) => {
      if (!ok) return toast.error(errorMessage(data, t('follow.failed')));
      this.setState({ people: this.state.people.map((p) => (p.seller.id === person.seller.id ? Object.assign({}, p, { notify: data.notify }) : p)) });
      toast.success(notify ? t('follow.emailsOnToast', { name: person.seller.name }) : t('follow.emailsOffToast', { name: person.seller.name }));
    }).catch(() => toast.error(t('common.networkShort')));
  }

  unfollow(person) {
    setFollowing(person.seller.id, false).then(({ ok, data }) => {
      if (!ok) return toast.error(errorMessage(data, t('follow.failed')));
      this.setState({
        people: this.state.people.filter((p) => p.seller.id !== person.seller.id),
        sales: this.state.sales.filter((s) => s.userId !== person.seller.id),
      });
      toast.success(t('follow.unfollowedName', { name: person.seller.name }));
    }).catch(() => toast.error(t('common.networkShort')));
  }

  render() {
    if (!this.props.user) {
      if (!this.props.ready) return <div className="container"><SkeletonBlock lines={3} /></div>;
      return (
        <div className="container container-narrow">
          <EmptyState level={1} icon={LogIn} title={t('follow.loginTitle')} action={<Link className="btn btn-primary" to="/login">{t('nav.logIn')}</Link>} />
        </div>
      );
    }
    const { loading, error, people, sales } = this.state;
    return (
      <div className="container page following-page">
        <header className="page-header">
          <div><h1>{t('fav.title')}</h1><p>{t('follow.pageLead')}</p></div>
        </header>
        <FavoritesTabs current="sellers" />
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {loading ? <SkeletonGrid count={3} /> : !people.length ? (
          <EmptyState icon={UsersRound} title={t('follow.none')} action={<Link className="btn btn-primary" to="/"><Search size={16} aria-hidden="true" />{t('nav.browseSales')}</Link>}>
            {t('follow.noneText')}
          </EmptyState>
        ) : (
          <div className="stack-lg">
            <section aria-labelledby="following-sales">
              <h2 id="following-sales">{t('follow.salesHeading')}</h2>
              {sales.length
                ? <div className="card-grid card-grid-wide">{sales.map((p) => <PostCard key={p.id} post={p} actions={<SaveButton post={p} />} />)}</div>
                : <p className="muted">{t('follow.noSales')}</p>}
            </section>
            <section aria-labelledby="following-people" className="panel">
              <h2 id="following-people">{t('follow.peopleHeading', { count: people.length })}</h2>
              <ul className="following-list">
                {people.map((p) => (
                  <li key={p.seller.id} className="following-row">
                    <div className="following-who">
                      <Link to={'/people/' + p.seller.id} className="following-name">{p.seller.name}</Link>
                      <span className="small muted">{t('follow.currentSales', { count: p.currentSales })}</span>
                    </div>
                    <div className="row following-actions">
                      <button type="button" className="btn btn-ghost btn-sm" aria-pressed={p.notify} onClick={() => this.emails(p, !p.notify)}>
                        {p.notify ? <Mail size={14} aria-hidden="true" /> : <MailX size={14} aria-hidden="true" />}
                        {p.notify ? t('follow.emailsOn') : t('follow.emailsOff')}
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => this.unfollow(p)}>
                        <UserMinus size={14} aria-hidden="true" />{t('follow.unfollow')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </div>
    );
  }
}
