import React from 'react';
import { Link } from 'react-router-dom';
import { BellOff, AlertCircle } from 'lucide-react';
import { unsubscribeAlert, unsubscribeWanted, unsubscribeReminders, unsubscribeFollow, errorMessage } from '../api';
import { EmptyState, SkeletonBlock } from '../components/ui';
import { t } from '../i18n';

// Landing page for the email's "Turn off this alert" link. It POSTs from the
// browser, so link scanners that only GET the URL never unsubscribe anyone.
export default class Unsubscribe extends React.Component {
  constructor(props) {
    super(props);
    this.state = { status: 'working', alert: null, wanted: null, error: '' };
  }

  componentDidMount() {
    const q = new URLSearchParams(this.props.location.search);
    const a = q.get('a');
    // ?w=: match emails for a wanted post (same token scheme, its own purpose).
    const w = q.get('w');
    // ?r=: morning-of sale reminders (all of them for this account).
    const r = q.get('r');
    // ?f=: emails about one seller you follow.
    const f = q.get('f');
    const token = q.get('t');
    if ((!a && !w && !r && !f) || !token) return this.setState({ status: 'error', error: t('unsub.incomplete') });
    if (f) {
      return unsubscribeFollow(f, token).then(({ ok, data }) => {
        if (!ok) return this.setState({ status: 'error', error: errorMessage(data, t('unsub.invalid')), isFollow: true });
        this.setState({ status: data.gone ? 'gone' : 'done', isFollow: true, seller: data.seller || null });
      }).catch(() => this.setState({ status: 'error', error: t('unsub.network'), isFollow: true }));
    }
    (r ? unsubscribeReminders(r, token) : w ? unsubscribeWanted(w, token) : unsubscribeAlert(a, token)).then(({ ok, data }) => {
      if (!ok) return this.setState({ status: 'error', error: errorMessage(data, t('unsub.invalid')), isReminder: !!r });
      this.setState({ status: data.gone ? 'gone' : 'done', alert: data.alert || null, wanted: data.wanted || null, isWanted: !!w, isReminder: !!r });
    }).catch(() => this.setState({ status: 'error', error: t('unsub.network') }));
  }

  render() {
    const s = this.state;
    const isReminder = s.isReminder || !!new URLSearchParams(this.props.location.search).get('r');
    const isFollow = s.isFollow || !!new URLSearchParams(this.props.location.search).get('f');
    const manage = isFollow ? <Link className="btn btn-primary" to="/following">{t('unsub.manageFollowing')}</Link> : isReminder ? <Link className="btn btn-primary" to="/settings#reminders">{t('unsub.manageReminders')}</Link> : s.isWanted || (!s.alert && new URLSearchParams(this.props.location.search).get('w'))
      ? <Link className="btn btn-primary" to={s.wanted ? '/wanted/' + s.wanted.id : '/wanted'}>{t('unsub.manageWanted')}</Link>
      : <Link className="btn btn-primary" to="/settings#alerts">{t('unsub.manage')}</Link>;
    let body;
    if (s.status === 'working') body = <SkeletonBlock lines={2} />;
    else if (s.status === 'error') body = <EmptyState level={1} icon={AlertCircle} title={t('unsub.failedTitle')} action={manage}>{s.error} {t('unsub.failedText')}</EmptyState>;
    else if (s.status === 'gone') body = <EmptyState level={1} icon={BellOff} title={t('unsub.goneTitle')} action={manage}>{t('unsub.goneText')}</EmptyState>;
    else if (isFollow) body = <EmptyState level={1} icon={BellOff} title={t('unsub.followDoneTitle')} action={manage}>{t('unsub.followDoneText', { name: s.seller ? s.seller.name : '' })}</EmptyState>;
    else if (isReminder) body = <EmptyState level={1} icon={BellOff} title={t('unsub.remindersDoneTitle')} action={manage}>{t('unsub.remindersDoneText')}</EmptyState>;
    else if (s.isWanted) body = <EmptyState level={1} icon={BellOff} title={t('unsub.wantedDoneTitle')} action={manage}>{t('unsub.wantedDoneText', { title: s.wanted ? s.wanted.title : '' })}</EmptyState>;
    else {
      const name = s.alert && s.alert.label ? t('unsub.quoted', { label: s.alert.label }) : t('unsub.thisAlert');
      body = <EmptyState level={1} icon={BellOff} title={t('unsub.doneTitle')} action={manage}>{t('unsub.doneText', { name })}</EmptyState>;
    }
    return <div className="container container-narrow rg-unsubscribe" aria-live="polite">{body}</div>;
  }
}
