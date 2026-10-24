import React from 'react';
import { Link } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { fetchFollowStatus, setFollowing, errorMessage } from '../api';
import { Spinner } from '../components/ui';
import toast from '../components/toast';
import { t } from '../i18n';

// Favorite-seller (follow) toggle for a seller (sale page, /people/:id): a heart, like sales.
// props: sellerId, user (null when logged out), showCount
export default class FollowButton extends React.Component {
  constructor(props) {
    super(props);
    this.state = { loaded: false, following: false, followers: 0, busy: false };
  }

  componentDidMount() { this.mounted = true; this.load(); }
  componentDidUpdate(prev) {
    if (prev.sellerId !== this.props.sellerId || (prev.user && prev.user.id) !== (this.props.user && this.props.user.id)) this.load();
  }
  componentWillUnmount() { this.mounted = false; }

  load() {
    if (!this.props.sellerId) return;
    fetchFollowStatus(this.props.sellerId).then(({ ok, data }) => {
      if (this.mounted && ok) this.setState({ loaded: true, following: data.following, followers: data.followers });
    }).catch(() => null);
  }

  toggle() {
    const next = !this.state.following;
    this.setState({ busy: true });
    setFollowing(this.props.sellerId, next).then(({ ok, data }) => {
      if (!this.mounted) return;
      if (!ok) { this.setState({ busy: false }); return toast.error(errorMessage(data, t('follow.failed'))); }
      this.setState({ busy: false, following: data.following, followers: data.followers });
      toast.success(data.following ? t('follow.followedToast') : t('follow.unfollowedToast'));
    }).catch(() => { if (this.mounted) { this.setState({ busy: false }); toast.error(t('common.networkShort')); } });
  }

  render() {
    const { user, sellerId, showCount } = this.props;
    const s = this.state;
    if (!sellerId || (user && user.id === sellerId)) return null;
    const count = showCount && s.loaded ? <span className="small muted follow-count">{t('follow.followers', { count: s.followers })}</span> : null;
    if (!user) {
      return <span className="follow-wrap"><Link className="btn btn-secondary" to="/login"><Heart size={16} aria-hidden="true" />{t('follow.follow')}</Link>{count}</span>;
    }
    return (
      <span className="follow-wrap">
        <button type="button" className={'btn ' + (s.following ? 'btn-secondary follow-on' : 'btn-secondary')} aria-pressed={s.following}
          disabled={s.busy || !s.loaded} onClick={() => this.toggle()}>
          {s.busy ? <Spinner /> : <Heart size={16} aria-hidden="true" fill={s.following ? 'currentColor' : 'none'} />}
          {s.following ? t('follow.following') : t('follow.follow')}
        </button>
        {count}
      </span>
    );
  }
}
